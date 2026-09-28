/**
 * Trunk commands (§8.4.1). `trunk sync` fast-forwards clean trunks only. Git enforces one
 * checked-out worktree per branch, and branch refs are never deleted by trunk removal.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { assertRecordedWork, assertWorktreeHeadRetained, consentAllows, destructiveConsent, isDirty, porcelainStatus } from "../git/worktree.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { register, resolve, type CommandContext } from "./registry.ts";
import { syncHandler as generalSyncHandler } from "./sync.ts";
import { assertWorktreeMutationPath, observeWorkspace, observedTrunkAllocationNames, observedWorktreeDetail } from "../model/observed.ts";
import { commandResultExit, completeResult } from "../model/result.ts";
import { expandTrunkPath, resolveLayoutTarget } from "../config/layout.ts";
import { assertTargetsAvailable, beginOperation, recordCompleted, recordPending, recordStepFailure, withOperationTargetLocks } from "../store/operation.ts";
import { buildCreationOperationPlan, classifyCreationBranch } from "../model/plan.ts";
import { parseCommand } from "./args.ts";
import { assertPathLimits, caseFoldKey } from "../model/validate.ts";
import { allocateDir } from "../model/encoding.ts";
import { containedPath, type ContainedPath } from "../paths/fs.ts";

const git = () => new Git(createGitRunner());

async function resolveCommit(g: Git, cwd: string, revision: string): Promise<string> {
  const result = await g.tryRun(cwd, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]);
  if (result.exitCode !== 0 || !/^[0-9a-fA-F]{40,64}$/.test(result.stdout.trim())) throw new GroveError({ kind: "invalid-input", what: `Cannot resolve revision "${revision}"`, why: result.stderr.trim().split("\n")[0] ?? "it is not a commit", remedy: "Pass a revision resolving to a commit." });
  return result.stdout.trim().toLowerCase();
}

async function addTrunk(ctx: CommandContext, repoRef: string, branch: string, from?: string): Promise<number> {
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const g = git();
  await g.probeCapabilities(ws.root, ["worktree-porcelain-z", "rev-parse-end-of-options"]);
  const snapshot = await observeWorkspace(ws, g);
  const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repoRef || candidate.registration?.name === repoRef);
  if (!repository?.registration || repository.problem) throw new GroveError({ kind: "invalid-input", what: `No healthy repository "${repoRef}"`, why: repository?.problem ?? "no registration matches", remedy: "Run `grove repo status`." });
  const registration = repository.registration;
  if (registration.location.kind === "linked") { const claimantPath = repository.worktrees.find((worktree) => worktree.branch?.utf8 === `refs/heads/${branch}`)?.path.utf8 ?? repository.worktrees.find((worktree) => worktree.path.utf8 !== null)?.path.utf8 ?? registration.location.commonGitDir; throw new GroveError({ kind: "refused-policy", what: `Cannot add trunk ${branch}; linked checkout ${claimantPath} is externally owned`, why: "repo link grants observation and Tree orchestration, not trunk-management consent", remedy: `Use native Git at ${claimantPath}, or register a managed repository with \`grove repo add\`.`, detail: { repositoryId: registration.id, branch, claimantPath } }); }
  const valid = await g.tryRun(repository.commonGitDir, ["check-ref-format", "--branch", branch]);
  if (valid.exitCode !== 0) throw new GroveError({ kind: "invalid-input", what: `Invalid branch "${branch}"`, why: valid.stderr.trim().split("\n")[0] ?? "Git rejected it", remedy: "Choose a Git-valid branch." });
  assertTargetsAvailable(ws.root, [`repository:${registration.id}:branch:${branch}`]);
  const allocation = allocateDir({
    branch,
    repo: registration.name,
    canonicalFullRef: Buffer.from(`refs/heads/${branch}`),
    taken: new Set(observedTrunkAllocationNames(snapshot).map(caseFoldKey)),
  });
  const path = expandTrunkPath(snapshot.layout, allocation);
  resolveLayoutTarget(snapshot.layout, path);
  assertPathLimits(path, `trunk path for ${registration.name}/${branch}`);
  if (existsSync(path)) throw new GroveError({ kind: "refused-conflict", what: `Trunk target ${path} is occupied`, why: "the compiled branch-key location already exists", remedy: "Inspect it with `grove trunk ls`." });
  const local = await g.tryRun(repository.commonGitDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const remoteRef = registration.remote ? `refs/remotes/${registration.remote}/${branch}` : null;
  const remote = remoteRef ? await g.tryRun(repository.commonGitDir, ["show-ref", "--verify", "--quiet", remoteRef]) : { exitCode: 1 };
  const branchPlan = classifyCreationBranch({
    branch,
    explicit: true,
    localOid: local.exitCode === 0 ? await resolveCommit(g, repository.commonGitDir, `refs/heads/${branch}`) : null,
    remoteOid: remote.exitCode === 0 && remoteRef ? await resolveCommit(g, repository.commonGitDir, remoteRef) : null,
    fromProvided: from !== undefined,
    fromOid: local.exitCode !== 0 && remote.exitCode !== 0 && from ? await resolveCommit(g, repository.commonGitDir, from) : null,
    defaultBaseOid: null,
    upstream: remote.exitCode === 0 ? remoteRef : null,
  });
  const { mode, oid, upstream } = branchPlan;
  const sourceRevision = mode === "remote" ? remoteRef : mode === "new" ? (from ?? null) : `refs/heads/${branch}`;
  const operationPlan = buildCreationOperationPlan("trunk-add", { repositoryId: registration.id }, [{ repositoryId: registration.id, repositoryAlias: registration.name, commonGitDir: repository.commonGitDir, path, branch, oid, mode, upstream, sourceRevision, upstreamOid: upstream ? oid : null }]);
  return withOperationTargetLocks(ws.root, operationPlan.targetLocks, "trunk-add", async () => {
  assertTargetsAvailable(ws.root, operationPlan.targetLocks);
  resolveLayoutTarget(snapshot.layout, path);
  if (existsSync(path)) throw new GroveError({ kind: "refused-conflict", what: `Trunk target ${path} changed after planning`, why: "the path is now occupied", remedy: "Inspect it and retry." });
  const currentSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
  const currentRepository = currentSnapshot.repositories.find((candidate) => candidate.registration?.id === registration.id);
  const claimant = currentRepository?.worktrees.find((worktree) => worktree.branch?.utf8 === `refs/heads/${branch}` && worktree.path.utf8 !== path);
  if (claimant?.path.utf8) throw new GroveError({ kind: "refused-conflict", what: `Branch ${branch} is already checked out at ${claimant.path.utf8}`, why: "Git permits one attached worktree for a local branch", remedy: `Remove or detach the claimant at ${claimant.path.utf8}, or choose another branch.`, detail: { repositoryId: registration.id, branch, claimantPath: claimant.path.utf8 } });
  const current = await g.tryRun(repository.commonGitDir, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
  const currentOid = current.exitCode === 0 ? current.stdout.trim().toLowerCase() : null;
  if ((mode === "existing" && currentOid !== oid) || (mode !== "existing" && currentOid !== null)) throw new GroveError({ kind: "refused-conflict", what: `Branch ${branch} changed after planning`, why: "the exact planned ref state is stale", remedy: "Retry from fresh observed state." });
  if (sourceRevision && (await resolveCommit(g, repository.commonGitDir, sourceRevision)) !== oid) throw new GroveError({ kind: "refused-conflict", what: `Creation source ${sourceRevision} changed after planning`, why: "it no longer resolves to the exact planned commit", remedy: "Retry from fresh observed state." });
  const operation = beginOperation(ws.root, operationPlan);
  const worktreeStep = `worktree-${registration.id}`;
  const upstreamStep = `upstream-${registration.id}`;
  recordPending(operation, worktreeStep, { pathAbsent: true, branch, oid, mode });
  resolveLayoutTarget(snapshot.layout, path);
  mkdirSync(dirname(path), { recursive: true });
  const added = await g.tryRun(repository.commonGitDir, mode === "existing" ? ["worktree", "add", "--", path, branch] : ["worktree", "add", "-b", branch, "--", path, oid]);
  if (added.exitCode !== 0) {
    recordStepFailure(operation, worktreeStep, "conflicted", "git-failed", { stderr: added.stderr.trim().split("\n")[0] });
    const result = { schemaVersion: 1 as const, command: "trunk add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, path }, before: null, action: "worktree-add", after: existsSync(path) ? { path } : null, reason: "git-failed" }], diagnostics: snapshot.diagnostics };
    return ctx.emit.result(result, commandResultExit(result));
  }
  const verifiedHead = await g.currentHead(path).catch(() => null);
  const verifiedStatus = await isDirty(g, path);
  if (!verifiedHead || verifiedHead.oid !== oid || verifiedHead.branch?.utf8 !== `refs/heads/${branch}` || verifiedStatus.problem || verifiedStatus.dirty) {
    recordStepFailure(operation, worktreeStep, "recoverable-intermediate", "stale-plan", { head: verifiedHead, status: verifiedStatus });
    const result = { schemaVersion: 1 as const, command: "trunk add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, path }, before: null, action: "verify-worktree", after: { path, branch: verifiedHead?.branch?.utf8 ?? null, headOid: verifiedHead?.oid ?? null, dirty: verifiedStatus.dirty }, reason: "stale-plan" }], diagnostics: snapshot.diagnostics };
    return ctx.emit.result(result, commandResultExit(result));
  }
  recordCompleted(operation, worktreeStep, { path, branch, headOid: oid });
  if (upstream) {
    recordPending(operation, upstreamStep, { upstream: null, branch, headOid: oid });
    const upstreamNow = await g.tryRun(repository.commonGitDir, ["rev-parse", "--verify", "--end-of-options", `${upstream}^{commit}`]);
    if (upstreamNow.exitCode !== 0 || upstreamNow.stdout.trim().toLowerCase() !== oid) { recordStepFailure(operation, upstreamStep, "conflicted", "stale-plan", { upstream, expectedOid: oid }); const result = { schemaVersion: 1 as const, command: "trunk add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, path }, before: null, action: "set-upstream", after: { path, branch, headOid: oid }, reason: "stale-plan" }], diagnostics: snapshot.diagnostics }; return ctx.emit.result(result, commandResultExit(result)); }
    const configured = await g.tryRun(path, ["branch", "--set-upstream-to", upstream.replace(/^refs\/remotes\//, ""), branch]);
    if (configured.exitCode !== 0) {
      recordStepFailure(operation, upstreamStep, "recoverable-intermediate", "git-failed");
      const result = { schemaVersion: 1 as const, command: "trunk add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, path }, before: null, action: "set-upstream", after: { path, branch, headOid: oid }, reason: "git-failed" }], diagnostics: snapshot.diagnostics };
      return ctx.emit.result(result, commandResultExit(result));
    }
    recordCompleted(operation, upstreamStep, { upstream, branch, headOid: oid });
  }
  const after = { path, branch, headOid: oid };
  const result = { ...completeResult("trunk add", [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, path }, before: null, action: "worktree-add", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
  return ctx.emit.result(result, 0);
  });
}

async function addHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const [repoRef, branch] = parsed.positionals;
  if (!repoRef || !branch) throw new GroveError({ kind: "invalid-input", what: "trunk add requires <repo> <branch>", why: "missing positional arguments", remedy: "Use `grove trunk add <repo> <branch>`." });
  return addTrunk(ctx, repoRef, branch, parsed.values.from);
}

async function lsHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const ref = parsed.positionals[0];
  const repositories = ref ? snapshot.repositories.filter((repository) => repository.registration?.id === ref || repository.registration?.name === ref) : snapshot.repositories;
  if (ref && repositories.length === 0) throw new GroveError({ kind: "invalid-input", what: `No repository "${ref}"`, why: "the selector matches no configured repository", remedy: "Run `grove repo ls`." });
  const selected = repositories.flatMap((repository) => repository.worktrees.filter((worktree) => worktree.role === "trunk").map((worktree) => ({ repository, worktree })));
  const trunks: Array<Record<string, unknown>> = selected.map(({ repository, worktree }) => ({ repository: repository.registration?.name, ...observedWorktreeDetail(worktree) }));
  const result = completeResult("trunk ls", selected.map(({ repository, worktree }, index) => ({ selector: { repositoryId: repository.registration?.id, repositoryAlias: repository.registration?.name, path: worktree.path.utf8 ?? undefined }, before: null, action: "observe", after: trunks[index], reason: null })), snapshot.diagnostics, { trunks });
  return ctx.emit.result(result, commandResultExit(result));
}

async function removeHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const [repoRef, branch] = parsed.positionals;
  if (!repoRef || !branch) throw new GroveError({ kind: "invalid-input", what: "trunk remove requires <repo> <branch>", why: "missing positional arguments", remedy: "Use `grove trunk remove <repo> <branch> [--allow-destructive-all]`." });
  {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const g = git();
    const snapshot = await observeWorkspace(ws, g);
    const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repoRef || candidate.registration?.name === repoRef);
    if (!repository?.registration || repository.problem) throw new GroveError({ kind: "invalid-input", what: `No healthy repository "${repoRef}"`, why: repository?.problem ?? "no registration matches", remedy: "Run `grove repo status`." });
    if (repository.registration.location.kind === "linked") throw new GroveError({ kind: "refused-policy", what: `Cannot remove trunk ${branch} for linked repository ${repository.registration.name}`, why: "its preferred trunk is advisory and Grove manages no trunk worktrees for linked repositories", remedy: "Use native Git if you intend to remove an external worktree." });
    const candidates = repository.worktrees.filter((worktree) => worktree.branch?.utf8 === `refs/heads/${branch}`);
    if (candidates.length !== 1) throw new GroveError({ kind: "invalid-input", what: `No unique trunk ${branch}`, why: `${candidates.length} observed worktrees use the branch`, remedy: "Run `grove trunk ls`." });
    const worktree = candidates[0]!;
    if (worktree.role !== "trunk" || worktree.path.utf8 === null) throw new GroveError({ kind: "invalid-input", what: `${branch} is not an addressable trunk worktree`, why: `observed role is ${worktree.role}`, remedy: "Use native Git or correct the trunk layout." });
    const trunkPath = worktree.path.utf8;
    const targetLocks = [`repository:${repository.registration.id}:branch:${branch}`, `worktree:${resolvePath(trunkPath)}`].sort();
    return withOperationTargetLocks(ws.root, targetLocks, "trunk-remove", async () => {
    assertTargetsAvailable(ws.root, targetLocks);
    const currentSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
    const currentRepository = currentSnapshot.repositories.find((candidate) => candidate.registration?.id === repository.registration?.id);
    const currentWorktree = currentRepository?.worktrees.find((candidate) => candidate.path.utf8 === trunkPath);
    if (!currentRepository?.registration || currentRepository.problem || !currentWorktree || currentWorktree.role !== "trunk" || currentWorktree.headOid !== worktree.headOid || currentWorktree.branch?.utf8 !== `refs/heads/${branch}`) throw new GroveError({ kind: "refused-conflict", what: `Cannot remove trunk ${branch}`, why: "its repository, path, branch, or HEAD changed after planning", remedy: "Retry from fresh observed state.", detail: { reason: "stale-plan" } });
    const currentRepositoryId = currentRepository.registration.id;
    // Ruling ④: same obligation as tree remove.
    const dirtyStatus = await porcelainStatus(g, trunkPath);
    if (dirtyStatus.problem !== null) throw new GroveError({ kind: "refused-precondition", what: `Cannot inspect trunk ${branch} before removal`, why: dirtyStatus.problem || "Git could not enumerate its working state", remedy: "Repair the worktree so `git status --porcelain` succeeds, then retry." });
    const dirtyFiles = dirtyStatus.changes.map((change) => change.path).sort();
    const dirty = dirtyFiles.length > 0;
    const itemizedTail = dirtyFiles.length === 0 ? "" : `\n  discarded in ${branch}: ${dirtyFiles.join(", ")}`;
    const consent = destructiveConsent(parsed.values);
    if (dirtyStatus.changes.some((entry) => !consentAllows(entry, consent))) throw new GroveError({ kind: "refused-precondition", what: `Cannot remove trunk ${branch}`, why: `uncommitted ${dirtyFiles.length === 1 ? "file" : "files"} ${dirtyFiles.join(", ")}`, detail: { uncommitted: dirtyFiles }, remedy: "Commit the work or pass --allow-destructive-all; --allow-destructive-git-ignored covers only ignored files." });
    containedPath(ws.root, trunkPath, `Cannot remove trunk ${branch}`);
    assertWorktreeMutationPath(currentSnapshot, trunkPath, { allowObservedPath: trunkPath });
    const operation = beginOperation(ws.root, { kind: "trunk-remove", scope: { repositoryId: currentRepository.registration.id }, targetLocks, targets: [{ selector: { repositoryId: currentRepository.registration.id, repositoryAlias: currentRepository.registration.name, path: trunkPath }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: trunkPath, commonGitDir: currentRepository.commonGitDir, branch, headOid: worktree.headOid, consent, discardedWork: dirtyStatus.changes } }] }] });
    recordPending(operation, "remove", { registered: true, branch, headOid: worktree.headOid, dirty });
    let provedTrunkPath: ContainedPath;
    let actualWork = dirtyStatus.changes;
    try {
      const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
      const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === currentRepositoryId);
      const mutationTrunk = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === trunkPath);
      if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== currentRepository.commonGitDir || !mutationTrunk || mutationTrunk.headOid !== worktree.headOid || (mutationTrunk.branch?.utf8 ?? null) !== (worktree.branch?.utf8 ?? null)) throw new GroveError({ kind: "refused-conflict", what: `Cannot remove trunk ${branch}`, why: "its identity changed at the point of use", remedy: "Retry from fresh observed state.", detail: { reason: "stale-plan" } });
      await assertWorktreeHeadRetained(g, mutationRepository.commonGitDir, trunkPath, worktree.headOid);
      assertWorktreeMutationPath(mutationSnapshot, trunkPath, { allowObservedPath: trunkPath });
      actualWork = await assertRecordedWork(g, trunkPath, dirtyStatus.changes, consent);
      provedTrunkPath = containedPath(ws.root, trunkPath, `Cannot remove trunk ${branch}`);
    }
    catch (error) { const reason = GroveError.is(error) && "reason" in error.detail ? String(error.detail.reason) : "stale-plan"; recordStepFailure(operation, "remove", "conflicted", reason, { error: String((error as Error).message ?? error) }); throw error; }
    const removed = await g.tryRemoveWorktree(
      currentRepository.commonGitDir,
      provedTrunkPath,
      consent !== "none",
    );
    if (removed.exitCode !== 0) { recordStepFailure(operation, "remove", "conflicted", "git-failed"); const result = { schemaVersion: 1 as const, command: "trunk remove", outcome: "blocked" as const, operationId: operation.id, targets: [{ selector: { repositoryId: currentRepository.registration.id, repositoryAlias: currentRepository.registration.name, path: trunkPath }, before: null, action: "worktree-remove", after: null, reason: "git-failed" }], diagnostics: snapshot.diagnostics }; return ctx.emit.result(result, commandResultExit(result)); }
    recordCompleted(operation, "remove", { registered: false, branchRetained: branch });
    const after = {
      removed: true,
      branchRetained: branch,
      discardedWork: actualWork,
    };
    const result = { ...completeResult("trunk remove", [{ selector: { repositoryId: currentRepository.registration.id, repositoryAlias: currentRepository.registration.name, path: trunkPath }, before: { headOid: worktree.headOid, branch }, action: "worktree-remove", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
    return ctx.emit.result(result, 0);
    });
  }
}

async function syncHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const repo = parsed.positionals[0];
  if (repo) {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const registration = ws.config.repositories.find((candidate) => candidate.id === repo || candidate.name === repo);
    if (registration?.location.kind === "linked") throw new GroveError({ kind: "refused-policy", what: `Cannot sync trunks for linked repository ${registration.name}`, why: "its preferred trunk is advisory and no Grove trunk target exists", remedy: "Use `grove sync --repo` for observed Tree worktrees or native Git for the external checkout." });
  }
  const syncSpec = resolve(["sync"])?.spec;
  if (!syncSpec) throw new Error("sync command is not registered");
  return generalSyncHandler({ ...ctx, spec: syncSpec, argv: ["--trunks", ...(repo ? ["--repo", repo] : []), ...(parsed.values.trunk ? ["--branch", parsed.values.trunk] : []), "--strategy", "ff-only"] });
}

export function registerTrunk(): void {
  register({
    path: "trunk ls",
    summary: "List trunk worktrees and health.",
    usage: "trunk ls [<repo>]",
    args: [{ name: "<repo>", desc: "Repository to list (default: all)." }],
    examples: [
      "grove trunk ls        # every repo's trunks, each marked ok/UNHEALTHY",
      "grove trunk ls api    # only api's trunks",
    ],
    handler: lsHandler,
  });
  register({
    path: "trunk add",
    summary: "Create a trunk worktree for a branch.",
    usage: "trunk add <repo> <branch> [--from <ref>]",
    args: [
      { name: "<repo>", desc: "Repository to add the trunk in." },
      { name: "<branch>", desc: "Existing branch to check out (remote-only branches are created locally first)." },
      { name: "--from <ref>", desc: "Create a missing branch from this exact commit-ish." },
    ],
    note: "Managed repositories only. The branch must exist or --from must be explicit; linked repositories refuse before mutation.",
    examples: [
      "grove trunk add api develop    # additional trunk; adopts a remote-only branch when needed",
      "grove trunk add api release/2  # another long-lived branch in the trunks/ layout",
    ],
    handler: addHandler,
    mutates: true,
  });
  register({
    path: "trunk remove",
    summary: "Remove a trunk worktree (branch retained).",
    usage: "trunk remove <repo> <branch> [--allow-destructive-all | --allow-destructive-git-ignored]",
    args: [
      { name: "<repo>", desc: "Repository holding the trunk." },
      { name: "<branch>", desc: "Trunk branch whose worktree to remove." },
      { name: "--allow-destructive-all", desc: "Remove even if the worktree is dirty. You will lose the uncommitted changes." },
      { name: "--allow-destructive-git-ignored", desc: "Discard only itemized Git-ignored files." },
    ],
    note: "The initial and additional peer trunks use the same removal contract; the branch ref and its commits are never deleted.",
    examples: [
      "grove trunk remove api develop           # remove the worktree, keep branch develop",
      "grove trunk remove api develop --allow-destructive-all   # remove even with uncommitted work (discards it)",
    ],
    handler: removeHandler,
    mutates: true,
  });
  register({
    path: "trunk sync",
    summary: "Fast-forward clean trunks.",
    usage: "trunk sync [<repo>] [--trunk <branch>]",
    args: [
      { name: "<repo>", desc: "Repository to sync (default: all)." },
      { name: "--trunk <branch>", desc: "Sync only this trunk branch." },
    ],
    note: "Fetches first; dirty, diverged, or missing trunks are skipped, never rebased or reset; repos with no remote are skipped.",
    examples: [
      "grove trunk sync                    # fetch, then fast-forward every clean trunk in every repo",
      "grove trunk sync api --trunk main   # fast-forward only api's main trunk",
    ],
    handler: syncHandler,
    mutates: true,
  });
}
