/**
 * Grove commands (§8.5): `grove new`, `grove ls`, `grove show`.
 *
 * `new` records a versioned forward operation before creating each native worktree. An
 * interruption remains visible and is resumed explicitly by `grove reconcile`. Derived branches
 * never adopt silently; `--branch` opts into an existing local or remote branch.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { assertGroveName, assertPathLimits } from "../model/validate.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { observeWorkspace, observedGroveDetail } from "../model/observed.ts";
import { completeResult, commandResultExit, sortResultTargets } from "../model/result.ts";
import { expandGrovePath, expandTreePath, assertNoLayoutCollisions, resolveLayoutTarget } from "../config/layout.ts";
import { expectedBranch, expectedTreeName } from "../config/conventions.ts";
import { assertTargetsAvailable, beginOperation, recordCompleted, recordPending, recordStepFailure, withOperationTargetLocks } from "../store/operation.ts";
import type { RepositoryEntry } from "../model/types.ts";
import { buildCreationOperationPlan, classifyCreationBranch, selectAdvisoryCreationBase, selectRepositoryRegistrations } from "../model/plan.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand, stringListValue } from "./args.ts";
import { newGroveManifest, saveGroveManifest } from "../config/grove.ts";
import { isDirty } from "../git/worktree.ts";

const git = () => new Git(createGitRunner());

interface BranchOverride {
  repo: string;
  branch: string;
}

function parseBranchOverrides(values: string[]): BranchOverride[] {
  return values.map((v) => {
    const eq = v.indexOf("=");
    if (eq < 0) {
      throw new GroveError({
        kind: "invalid-input",
        what: `Invalid --branch "${v}"`,
        why: "expected the form <repo>=<branch>",
        remedy: "Use --branch <repo>=<exact-branch>.",
        detail: { value: v },
      });
    }
    return { repo: v.slice(0, eq), branch: v.slice(eq + 1) };
  });
}

function uniqueOverrides(values: string[], option: string): BranchOverride[] {
  const parsed = parseBranchOverrides(values);
  const seen = new Set<string>();
  for (const override of parsed) {
    if (seen.has(override.repo)) throw new GroveError({ kind: "invalid-input", what: `Duplicate --${option} for ${override.repo}`, why: "each repository may appear once", remedy: `Remove the duplicate --${option}.` });
    seen.add(override.repo);
  }
  return parsed;
}

interface TreePlan {
  repository: RepositoryEntry;
  commonGitDir: string;
  tree: string;
  branch: string;
  path: string;
  mode: "existing" | "new" | "remote";
  oid: string;
  upstream: string | null;
  sourceRevision: string | null;
  upstreamOid: string | null;
}

async function resolveCommit(g: Git, cwd: string, input: string): Promise<string> {
  const result = await g.tryRun(cwd, ["rev-parse", "--verify", "--end-of-options", `${input}^{commit}`]);
  if (result.exitCode !== 0 || !/^[0-9a-fA-F]{40,64}$/.test(result.stdout.trim())) throw new GroveError({ kind: "invalid-input", what: `Cannot resolve revision "${input}"`, why: result.stderr.trim().split("\n")[0] ?? "it is not a commit", remedy: "Pass a revision that resolves to a commit." });
  return result.stdout.trim().toLowerCase();
}

async function newGrove(ctx: CommandContext, name: string, repoRefs: string[], branches: BranchOverride[], froms: BranchOverride[], prefixOverride?: string, all = false): Promise<number> {
  assertGroveName(name);
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  assertTargetsAvailable(ws.root, [`grove:${name}`]);
  const g = git();
  await g.probeCapabilities(ws.root, ["worktree-porcelain-z", "rev-parse-end-of-options"]);
  const selected = selectRepositoryRegistrations(ws.config.repositories, repoRefs, all);
  for (const override of [...branches, ...froms]) if (!selected.some((repository) => repository.name === override.repo || repository.id === override.repo)) throw new GroveError({ kind: "invalid-input", what: `--branch/--from names unselected repository "${override.repo}"`, why: "overrides must name a selected repository", remedy: "Select that repository or remove the override." });
  const snapshot = await observeWorkspace(ws, g);
  if (snapshot.groves.some((grove) => grove.name.toLowerCase() === name.toLowerCase())) throw new GroveError({ kind: "refused-conflict", what: `A Grove named "${name}" already exists`, why: "active and advisory Grove names are case-fold unique", remedy: "Choose another name." });
  if (selected.length === 0) {
    const path = expandGrovePath(snapshot.layout, name);
    resolveLayoutTarget(snapshot.layout, path);
    const targetLocks = [`grove:${name}`];
    return withOperationTargetLocks(ws.root, targetLocks, "new-grove", async () => {
      assertTargetsAvailable(ws.root, targetLocks);
      resolveLayoutTarget(snapshot.layout, path);
      const operation = beginOperation(ws.root, { kind: "new-grove", scope: { grove: name }, targetLocks, targets: [{ selector: { grove: name, path }, steps: [{ id: "publish-metadata", kind: "central-metadata-update", input: { grove: name, path } }] }] });
      recordPending(operation, "publish-metadata", { metadataAbsent: true, pathAbsent: !existsSync(path) });
      resolveLayoutTarget(snapshot.layout, path);
      mkdirSync(path, { recursive: true });
      let meta: Awaited<ReturnType<typeof saveGroveManifest>>;
      try { meta = await saveGroveManifest(ws.root, newGroveManifest(name)); }
      catch (error) {
        const why = String((error as Error).message ?? error);
        recordStepFailure(operation, "publish-metadata", "recoverable-intermediate", "io-failed", { error: why });
        throw new GroveError({ kind: "io", what: `New Grove metadata for ${name} was not saved`, why, remedy: `Correct the cause, then run \`grove reconcile --operation ${operation.id}\` to finish creation.`, detail: { operationId: operation.id } });
      }
      recordCompleted(operation, "publish-metadata", { revision: meta.rev, path });
      const after = { grove: name, path, trees: 0, revision: meta.rev };
      const result = { ...completeResult("new", [{ selector: { grove: name, path }, before: null, action: "create-empty-grove", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
      return ctx.emit.result(result, 0);
    });
  }
  const plans: TreePlan[] = [];
  for (const repository of selected) {
    const observed = snapshot.repositories.find((candidate) => candidate.registration?.id === repository.id);
    if (!observed || observed.problem) throw new GroveError({ kind: "refused-precondition", what: `Cannot use repository ${repository.name}`, why: observed?.problem ?? "it was not observed", remedy: "Run `grove doctor` and repair the repository." });
    const tree = expectedTreeName(ws.config.conventions, { grove: name, repo: repository.name });
    const branchOverride = branches.find((value) => value.repo === repository.name || value.repo === repository.id)?.branch;
    const from = froms.find((value) => value.repo === repository.name || value.repo === repository.id)?.branch;
    const branch = branchOverride ?? expectedBranch(ws.config.conventions, { branchPrefix: prefixOverride ?? ws.config.defaults.branchPrefix ?? "", grove: name, repo: repository.name, tree });
    const nativeValidation = await g.tryRun(observed.commonGitDir, ["check-ref-format", "--branch", branch]);
    if (nativeValidation.exitCode !== 0) throw new GroveError({ kind: "invalid-input", what: `Invalid branch "${branch}"`, why: nativeValidation.stderr.trim().split("\n")[0] ?? "Git rejected it", remedy: "Choose a Git-valid branch name." });
    const local = await g.tryRun(observed.commonGitDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    const remoteRef = repository.remote ? `refs/remotes/${repository.remote}/${branch}` : null;
    const remote = remoteRef ? await g.tryRun(observed.commonGitDir, ["show-ref", "--verify", "--quiet", remoteRef]) : { exitCode: 1 };
    let defaultBase: { revision: string; oid: string } | null = null;
    if (local.exitCode !== 0 && remote.exitCode !== 0 && !from && branchOverride === undefined) {
      const localRef = `refs/heads/${repository.trunk}`;
      const preferredRemoteRef = repository.remote ? `refs/remotes/${repository.remote}/${repository.trunk}` : null;
      const localBase = await g.tryRun(observed.commonGitDir, ["show-ref", "--verify", "--quiet", localRef]);
      const remoteBase = preferredRemoteRef
        ? await g.tryRun(observed.commonGitDir, ["show-ref", "--verify", "--quiet", preferredRemoteRef])
        : { exitCode: 1 };
      defaultBase = selectAdvisoryCreationBase({
        trunk: repository.trunk,
        localRef,
        localOid: localBase.exitCode === 0 ? await resolveCommit(g, observed.commonGitDir, localRef) : null,
        remoteRef: preferredRemoteRef,
        remoteOid: remoteBase.exitCode === 0 && preferredRemoteRef ? await resolveCommit(g, observed.commonGitDir, preferredRemoteRef) : null,
      });
    }
    const branchPlan = classifyCreationBranch({
      branch,
      explicit: branchOverride !== undefined,
      localOid: local.exitCode === 0 ? await resolveCommit(g, observed.commonGitDir, `refs/heads/${branch}`) : null,
      remoteOid: remote.exitCode === 0 && remoteRef ? await resolveCommit(g, observed.commonGitDir, remoteRef) : null,
      fromProvided: from !== undefined,
      fromOid: local.exitCode !== 0 && remote.exitCode !== 0 && from ? await resolveCommit(g, observed.commonGitDir, from) : null,
      defaultBaseOid: defaultBase?.oid ?? null,
      upstream: remote.exitCode === 0 ? remoteRef : null,
    });
    const { mode, oid, upstream } = branchPlan;
    const sourceRevision = mode === "remote" ? remoteRef : mode === "new" ? (from ?? defaultBase?.revision ?? null) : `refs/heads/${branch}`;
    const path = expandTreePath(snapshot.layout, name, tree, repository.name);
    resolveLayoutTarget(snapshot.layout, path);
    assertPathLimits(path, `Tree path for ${repository.name}`);
    if (existsSync(path)) throw new GroveError({ kind: "refused-conflict", what: `Tree target ${path} is occupied`, why: "Grove never allocates an implicit suffix", remedy: "Use `tree add --name` with an explicit Tree name." });
    plans.push({ repository, commonGitDir: observed.commonGitDir, tree, branch, path, mode, oid, upstream, sourceRevision, upstreamOid: upstream ? oid : null });
  }
  assertNoLayoutCollisions(plans.map((plan) => plan.path));
  const operationPlan = buildCreationOperationPlan("new-grove", { grove: name }, plans.map((plan) => ({
    repositoryId: plan.repository.id,
    repositoryAlias: plan.repository.name,
    commonGitDir: plan.commonGitDir,
    grove: name,
    tree: plan.tree,
    path: plan.path,
    branch: plan.branch,
    oid: plan.oid,
    mode: plan.mode,
    upstream: plan.upstream,
    sourceRevision: plan.sourceRevision,
    upstreamOid: plan.upstreamOid,
  })));
  return withOperationTargetLocks(ws.root, operationPlan.targetLocks, "new-grove", async () => {
  assertTargetsAvailable(ws.root, operationPlan.targetLocks);
  const currentSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
  for (const plan of plans) {
    resolveLayoutTarget(snapshot.layout, plan.path);
    if (existsSync(plan.path)) throw new GroveError({ kind: "refused-conflict", what: `Tree target ${plan.path} changed after planning`, why: "the path is now occupied", remedy: "Inspect the path and retry." });
    const currentRepository = currentSnapshot.repositories.find((candidate) => candidate.registration?.id === plan.repository.id);
    if (!currentRepository || currentRepository.problem || currentRepository.commonGitDir !== plan.commonGitDir) throw new GroveError({ kind: "refused-conflict", what: `Repository ${plan.repository.name} changed after planning`, why: "its stable registration no longer resolves to the planned common Git directory", remedy: "Retry creation from fresh observed state." });
    const claimant = currentRepository.worktrees.find((worktree) => worktree.branch?.utf8 === `refs/heads/${plan.branch}` && worktree.path.utf8 !== plan.path);
    if (claimant?.path.utf8) throw new GroveError({ kind: "refused-conflict", what: `Branch ${plan.branch} is already checked out at ${claimant.path.utf8}`, why: "Git permits one attached worktree for a local branch", remedy: `Remove or detach the claimant at ${claimant.path.utf8}, or choose another branch.`, detail: { repositoryId: plan.repository.id, branch: plan.branch, claimantPath: claimant.path.utf8 } });
    const current = await g.tryRun(plan.commonGitDir, ["rev-parse", "--verify", `refs/heads/${plan.branch}^{commit}`]);
    const currentOid = current.exitCode === 0 ? current.stdout.trim().toLowerCase() : null;
    if ((plan.mode === "existing" && currentOid !== plan.oid) || (plan.mode !== "existing" && currentOid !== null)) throw new GroveError({ kind: "refused-conflict", what: `Branch ${plan.branch} changed after planning`, why: "the exact planned ref state is stale", remedy: "Retry creation from fresh observed state." });
    if (plan.sourceRevision && (await resolveCommit(g, plan.commonGitDir, plan.sourceRevision)) !== plan.oid) throw new GroveError({ kind: "refused-conflict", what: `Creation source ${plan.sourceRevision} changed after planning`, why: "it no longer resolves to the exact planned commit", remedy: "Retry creation from fresh observed state." });
  }
  const operation = beginOperation(ws.root, operationPlan);
  const targets = plans.map((plan) => ({ selector: { repositoryId: plan.repository.id, repositoryAlias: plan.repository.name, grove: name, tree: plan.tree, path: plan.path }, before: { pathAbsent: true, branch: plan.branch, oid: plan.oid, mode: plan.mode }, action: "worktree-add", after: null as unknown, reason: null as string | null }));
  let failed = false;
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]!;
    const target = targets[index]!;
    const stepId = `worktree-${plan.repository.id}`;
    recordPending(operation, stepId, target.before);
    resolveLayoutTarget(snapshot.layout, plan.path);
    mkdirSync(dirname(plan.path), { recursive: true });
    const args = plan.mode === "existing"
      ? ["worktree", "add", "--", plan.path, plan.branch]
      : ["worktree", "add", "-b", plan.branch, "--", plan.path, plan.oid];
    const added = await g.tryRun(plan.commonGitDir, args);
    if (added.exitCode !== 0) {
      const branchNow = await g.tryRun(plan.commonGitDir, ["rev-parse", "--verify", `refs/heads/${plan.branch}^{commit}`]);
      const intermediate = plan.mode !== "existing" && !existsSync(plan.path) && branchNow.exitCode === 0 && branchNow.stdout.trim().toLowerCase() === plan.oid;
      recordStepFailure(operation, stepId, intermediate ? "recoverable-intermediate" : "conflicted", intermediate ? "recoverable-intermediate" : "git-failed", { stderr: added.stderr.trim().split("\n")[0] });
      target.after = existsSync(plan.path) ? { path: plan.path } : null;
      target.reason = intermediate ? "stale-plan" : "git-failed";
      failed = true;
      for (let rest = index + 1; rest < targets.length; rest++) targets[rest]!.reason = "stale-plan";
      break;
    }
    const verifiedHead = await g.currentHead(plan.path).catch(() => null);
    const verifiedStatus = await isDirty(g, plan.path);
    if (!verifiedHead || verifiedHead.oid !== plan.oid || verifiedHead.branch?.utf8 !== `refs/heads/${plan.branch}` || verifiedStatus.problem || verifiedStatus.dirty) {
      recordStepFailure(operation, stepId, "recoverable-intermediate", "stale-plan", { head: verifiedHead, status: verifiedStatus });
      target.after = { path: plan.path, branch: verifiedHead?.branch?.utf8 ?? null, headOid: verifiedHead?.oid ?? null, dirty: verifiedStatus.dirty };
      target.reason = "stale-plan";
      failed = true;
      for (let rest = index + 1; rest < targets.length; rest++) targets[rest]!.reason = "stale-plan";
      break;
    }
    recordCompleted(operation, stepId, { path: plan.path, branch: plan.branch, headOid: plan.oid });
    if (plan.upstream) {
      const upstreamId = `upstream-${plan.repository.id}`;
      recordPending(operation, upstreamId, { branch: plan.branch, upstream: null, headOid: plan.oid });
      const upstreamNow = await g.tryRun(plan.commonGitDir, ["rev-parse", "--verify", "--end-of-options", `${plan.upstream}^{commit}`]);
      if (upstreamNow.exitCode !== 0 || upstreamNow.stdout.trim().toLowerCase() !== plan.oid) {
        recordStepFailure(operation, upstreamId, "conflicted", "stale-plan", { upstream: plan.upstream, expectedOid: plan.oid });
        target.after = { path: plan.path, branch: plan.branch, headOid: plan.oid };
        target.reason = "stale-plan";
        failed = true;
        for (let rest = index + 1; rest < targets.length; rest++) targets[rest]!.reason = "stale-plan";
        break;
      }
      const short = plan.upstream.replace(/^refs\/remotes\//, "");
      const configured = await g.tryRun(plan.path, ["branch", "--set-upstream-to", short, plan.branch]);
      if (configured.exitCode !== 0) {
        recordStepFailure(operation, upstreamId, "recoverable-intermediate", "git-failed", { phase: "set-upstream" });
        target.after = { path: plan.path, branch: plan.branch, headOid: plan.oid };
        target.reason = "git-failed";
        failed = true;
        for (let rest = index + 1; rest < targets.length; rest++) targets[rest]!.reason = "stale-plan";
        break;
      }
      recordCompleted(operation, upstreamId, { branch: plan.branch, upstream: plan.upstream, headOid: plan.oid });
    }
    target.after = { path: plan.path, branch: plan.branch, headOid: plan.oid };
  }
  const result = { schemaVersion: 1 as const, command: "new", outcome: failed ? "partial" as const : "complete" as const, operationId: operation.id, targets: sortResultTargets(targets), diagnostics: snapshot.diagnostics, detail: { grove: name } };
  return ctx.emit.result(result, commandResultExit(result));
  });
}

async function newHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const name = parsed.positionals[0];
  const repoRefs = stringListValue(parsed.values, "repo");
  const overrides = uniqueOverrides(stringListValue(parsed.values, "branch"), "branch");
  const froms = uniqueOverrides(stringListValue(parsed.values, "from"), "from");

  // A Grove is always named (§8.5): the name is its stable, human-facing handle and the source of
  // its directory and derived branches. Refuse before any mutation rather than mint an inert,
  // ID-only Grove (Refuse-Never-Guess).
  if (name === undefined) {
    throw new GroveError({
      kind: "invalid-input",
      what: "grove new requires a name",
      why: "a Grove needs a name — it is the Grove's handle and the base for its derived branches",
      remedy: "Run `grove new <name>` (optionally with --repo/--branch).",
    });
  }

  return newGrove(ctx, name, repoRefs, overrides, froms, parsed.values.prefix, parsed.values.all === true);
}

async function lsHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const groves = snapshot.groves.filter((grove) => parsed.values.archived ? grove.metadata?.state === "archived" : grove.metadata?.state !== "archived").map(observedGroveDetail);
  const detail = { groves };
  const result = completeResult("ls", groves.map((grove) => ({ selector: { grove: grove.name as string }, before: null, action: "observe", after: grove, reason: null })), snapshot.diagnostics, detail);
  return ctx.emit.result(result, commandResultExit(result));
}

async function showHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ref = parsed.positionals[0];
  if (!ref) throw new GroveError({ kind: "invalid-input", what: "grove show requires a Grove", why: "no <grove> was given", remedy: "Run `grove ls` to see your Groves, then: grove show <grove>" });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const grove = snapshot.groves.find((candidate) => candidate.name === ref || candidate.metadata?.manifest.id === ref);
  if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${ref}"`, why: "no observed or advisory Grove has that id or name", remedy: "Run `grove ls`.", detail: { ref } });
  const detail: Record<string, unknown> = { ...observedGroveDetail(grove), path: expandGrovePath(snapshot.layout, grove.name) };
  const result = completeResult("show", [{ selector: { grove: grove.name }, before: null, action: "observe", after: detail, reason: null }], snapshot.diagnostics, detail);
  return ctx.emit.result(result, commandResultExit(result));
}

export function registerGrove(): void {
  register({
    path: "new",
    summary: "Create a named Grove and its initial Trees.",
    usage: "new <name> [--repo <repo>]... [--all] [--branch <repo>=<branch>]... [--from <repo>=<ref>]... [--prefix <prefix>]",
    args: [
      { name: "<name>", desc: "Grove name (required). Also the default work-branch name; unique across active and archived Groves." },
      { name: "--repo <repo>", desc: "Add a Tree for this repository, on branch <prefix><name> off its trunk (repeatable). Omit entirely to create an empty Grove." },
      { name: "--all", desc: "Add a Tree for every registered repository. Required to fan out: omitting --repo creates an empty Grove, it does not select everything." },
      { name: "--branch <repo>=<branch>", desc: "Use this exact branch for <repo>: adopted if it exists; when absent, --from is required. Must name a --repo." },
      { name: "--from <repo>=<ref>", desc: "Create a missing explicit branch from this exact commit-ish. Must name a --repo." },
      { name: "--prefix <prefix>", desc: "Prefix for the derived branch name (default: the workspace's defaults.branchPrefix, usually empty)." },
    ],
    note: "Every branch is based on its repository's trunk. If the derived branch already exists, new refuses rather than adopt it silently — pass --branch to adopt. Interrupted work remains in a forward operation for reconcile.",
    examples: [
      'grove new pricing-fix --repo api                                 # Grove "pricing-fix" + 1 Tree on new branch "pricing-fix"',
      'grove new pricing-fix --repo api --repo web                      # a Tree in each repo, both on branch "pricing-fix"',
      'grove new pricing-fix --repo api --branch api=feature/pricing --from api=main # create an explicitly named branch',
      'grove new hotfix --repo api --branch api=release-2.3             # adopt an existing branch instead of creating one',
      'grove new pricing-fix --repo api --prefix jc/                    # new branch "jc/pricing-fix"',
      'grove new pricing-fix                                            # empty Grove; add Trees later with `grove tree add`',
      'grove new pricing-fix --all                                      # a Tree in every registered repository',
    ],
    handler: newHandler,
    mutates: true,
  });
  register({
    path: "ls",
    summary: "List Groves and their Trees.",
    usage: "ls [--archived]",
    args: [{ name: "--archived", desc: "List archived Groves instead of active ones." }],
    note: "Lists active Groves by default, in name order.",
    examples: [
      "grove ls              # active Groves, in name order",
      "grove ls --archived   # archived Groves instead",
    ],
    handler: lsHandler,
  });
  register({
    path: "show",
    summary: "Show a Grove's state, path, and Trees.",
    usage: "show <grove>",
    args: [{ name: "<grove>", desc: "Grove name or id (see `grove ls`)." }],
    examples: ['grove show pricing-fix   # state, path, and Trees for Grove "pricing-fix"'],
    handler: showHandler,
  });
}
