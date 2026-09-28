/**
 * Tree commands (§8.6). `tree add` records a versioned forward operation; `tree remove` is
 * work-safe and retains every ref. Branch deletion is exclusively a native Git action.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { assertRecordedWork, assertWorktreeHeadRetained, consentAllows, destructiveConsent, isDirty, porcelainStatus } from "../git/worktree.ts";
import { containedPath, resolveContained, type ContainedPath } from "../paths/fs.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { newGroveManifest, saveGroveManifest } from "../config/grove.ts";
import { register, type CommandContext } from "./registry.ts";
import { assertWorktreeMutationPath, observeWorkspace, observedWorktreeDetail } from "../model/observed.ts";
import { commandResultExit, completeResult } from "../model/result.ts";
import { expandTreePath, resolveLayoutTarget } from "../config/layout.ts";
import { expectedBranch, expectedTreeName } from "../config/conventions.ts";
import { assertTargetsAvailable, beginOperation, recordCompleted, recordPending, recordStepFailure, withOperationTargetLocks } from "../store/operation.ts";
import { buildCreationOperationPlan, classifyCreationBranch, selectAdvisoryCreationBase } from "../model/plan.ts";
import { parseCommand } from "./args.ts";
import { assertPathLimits } from "../model/validate.ts";

const git = () => new Git(createGitRunner());

async function resolveCommit(g: Git, cwd: string, input: string): Promise<string> {
  const result = await g.tryRun(cwd, ["rev-parse", "--verify", "--end-of-options", `${input}^{commit}`]);
  if (result.exitCode !== 0 || !/^[0-9a-fA-F]{40,64}$/.test(result.stdout.trim())) throw new GroveError({ kind: "invalid-input", what: `Cannot resolve revision "${input}"`, why: result.stderr.trim().split("\n")[0] ?? "it is not a commit", remedy: "Pass a revision resolving to a commit." });
  return result.stdout.trim().toLowerCase();
}

async function addTree(ctx: CommandContext, groveRef: string, repoRef: string, nameOverride?: string, branchOverride?: string, from?: string): Promise<number> {
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const g = git();
  await g.probeCapabilities(ws.root, ["worktree-porcelain-z", "rev-parse-end-of-options"]);
  const snapshot = await observeWorkspace(ws, g);
  const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
  if (!grove || grove.metadata?.state === "archived") throw new GroveError({ kind: "invalid-input", what: `No active Grove "${groveRef}"`, why: "no active observed or advisory Grove matches", remedy: "Run `grove ls`." });
  const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repoRef || candidate.registration?.name === repoRef);
  if (!repository?.registration || repository.problem) throw new GroveError({ kind: "invalid-input", what: `No healthy repository "${repoRef}"`, why: repository?.problem ?? "no registration matches", remedy: "Run `grove repo status`." });
  const registration = repository.registration;
  const tree = nameOverride ?? expectedTreeName(ws.config.conventions, { grove: grove.name, repo: registration.name });
  const branch = branchOverride ?? expectedBranch(ws.config.conventions, { branchPrefix: ws.config.defaults.branchPrefix ?? "", grove: grove.name, repo: registration.name, tree });
  assertTargetsAvailable(ws.root, [`grove:${grove.name}`, `repository:${registration.id}:branch:${branch}`]);
  const branchCheck = await g.tryRun(repository.commonGitDir, ["check-ref-format", "--branch", branch]);
  if (branchCheck.exitCode !== 0) throw new GroveError({ kind: "invalid-input", what: `Invalid branch "${branch}"`, why: branchCheck.stderr.trim().split("\n")[0] ?? "Git rejected it", remedy: "Choose a Git-valid branch." });
  const path = expandTreePath(snapshot.layout, grove.name, tree, registration.name);
  resolveLayoutTarget(snapshot.layout, path);
  assertPathLimits(path, `Tree path for ${registration.name}`);
  if (existsSync(path)) throw new GroveError({ kind: "refused-conflict", what: `Tree target ${path} is occupied`, why: "Grove never allocates an implicit suffix", remedy: "Choose another --name." });
  const local = await g.tryRun(repository.commonGitDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const remoteRef = registration.remote ? `refs/remotes/${registration.remote}/${branch}` : null;
  const remote = remoteRef ? await g.tryRun(repository.commonGitDir, ["show-ref", "--verify", "--quiet", remoteRef]) : { exitCode: 1 };
  let defaultBase: { revision: string; oid: string } | null = null;
  if (local.exitCode !== 0 && remote.exitCode !== 0 && !from && branchOverride === undefined) {
    const localRef = `refs/heads/${registration.trunk}`;
    const preferredRemoteRef = registration.remote ? `refs/remotes/${registration.remote}/${registration.trunk}` : null;
    const localBase = await g.tryRun(repository.commonGitDir, ["show-ref", "--verify", "--quiet", localRef]);
    const remoteBase = preferredRemoteRef
      ? await g.tryRun(repository.commonGitDir, ["show-ref", "--verify", "--quiet", preferredRemoteRef])
      : { exitCode: 1 };
    defaultBase = selectAdvisoryCreationBase({
      trunk: registration.trunk,
      localRef,
      localOid: localBase.exitCode === 0 ? await resolveCommit(g, repository.commonGitDir, localRef) : null,
      remoteRef: preferredRemoteRef,
      remoteOid: remoteBase.exitCode === 0 && preferredRemoteRef ? await resolveCommit(g, repository.commonGitDir, preferredRemoteRef) : null,
    });
  }
  const branchPlan = classifyCreationBranch({
    branch,
    explicit: branchOverride !== undefined,
    localOid: local.exitCode === 0 ? await resolveCommit(g, repository.commonGitDir, `refs/heads/${branch}`) : null,
    remoteOid: remote.exitCode === 0 && remoteRef ? await resolveCommit(g, repository.commonGitDir, remoteRef) : null,
    fromProvided: from !== undefined,
    fromOid: local.exitCode !== 0 && remote.exitCode !== 0 && from ? await resolveCommit(g, repository.commonGitDir, from) : null,
    defaultBaseOid: defaultBase?.oid ?? null,
    upstream: remote.exitCode === 0 ? remoteRef : null,
  });
  const { mode, oid, upstream } = branchPlan;
  const sourceRevision = mode === "remote" ? remoteRef : mode === "new" ? (from ?? defaultBase?.revision ?? null) : `refs/heads/${branch}`;
  const operationPlan = buildCreationOperationPlan("tree-add", { grove: grove.name }, [{ repositoryId: registration.id, repositoryAlias: registration.name, commonGitDir: repository.commonGitDir, grove: grove.name, tree, path, branch, oid, mode, upstream, sourceRevision, upstreamOid: upstream ? oid : null }]);
  return withOperationTargetLocks(ws.root, operationPlan.targetLocks, "tree-add", async () => {
  assertTargetsAvailable(ws.root, operationPlan.targetLocks);
  resolveLayoutTarget(snapshot.layout, path);
  if (existsSync(path)) throw new GroveError({ kind: "refused-conflict", what: `Tree target ${path} changed after planning`, why: "the path is now occupied", remedy: "Inspect the path and retry." });
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
    const created = await g.tryRun(repository.commonGitDir, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
    const intermediate = mode !== "existing" && !existsSync(path) && created.exitCode === 0 && created.stdout.trim().toLowerCase() === oid;
    recordStepFailure(operation, worktreeStep, intermediate ? "recoverable-intermediate" : "conflicted", intermediate ? "recoverable-intermediate" : "git-failed", { stderr: added.stderr.trim().split("\n")[0] });
    const result = { schemaVersion: 1 as const, command: "tree add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, grove: grove.name, tree, path }, before: null, action: "worktree-add", after: existsSync(path) ? { path } : null, reason: intermediate ? "stale-plan" : "git-failed" }], diagnostics: snapshot.diagnostics };
    return ctx.emit.result(result, commandResultExit(result));
  }
  const verifiedHead = await g.currentHead(path).catch(() => null);
  const verifiedStatus = await isDirty(g, path);
  if (!verifiedHead || verifiedHead.oid !== oid || verifiedHead.branch?.utf8 !== `refs/heads/${branch}` || verifiedStatus.problem || verifiedStatus.dirty) {
    recordStepFailure(operation, worktreeStep, "recoverable-intermediate", "stale-plan", { head: verifiedHead, status: verifiedStatus });
    const result = { schemaVersion: 1 as const, command: "tree add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, grove: grove.name, tree, path }, before: null, action: "verify-worktree", after: { path, branch: verifiedHead?.branch?.utf8 ?? null, headOid: verifiedHead?.oid ?? null, dirty: verifiedStatus.dirty }, reason: "stale-plan" }], diagnostics: snapshot.diagnostics };
    return ctx.emit.result(result, commandResultExit(result));
  }
  recordCompleted(operation, worktreeStep, { path, branch, headOid: oid });
  if (upstream) {
    recordPending(operation, upstreamStep, { upstream: null, branch, headOid: oid });
    const upstreamNow = await g.tryRun(repository.commonGitDir, ["rev-parse", "--verify", "--end-of-options", `${upstream}^{commit}`]);
    if (upstreamNow.exitCode !== 0 || upstreamNow.stdout.trim().toLowerCase() !== oid) { recordStepFailure(operation, upstreamStep, "conflicted", "stale-plan", { upstream, expectedOid: oid }); const result = { schemaVersion: 1 as const, command: "tree add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, grove: grove.name, tree, path }, before: null, action: "set-upstream", after: { path, branch, headOid: oid }, reason: "stale-plan" }], diagnostics: snapshot.diagnostics }; return ctx.emit.result(result, commandResultExit(result)); }
    const configured = await g.tryRun(path, ["branch", "--set-upstream-to", upstream.replace(/^refs\/remotes\//, ""), branch]);
    if (configured.exitCode !== 0) {
      recordStepFailure(operation, upstreamStep, "recoverable-intermediate", "git-failed");
      const result = { schemaVersion: 1 as const, command: "tree add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, grove: grove.name, tree, path }, before: null, action: "set-upstream", after: { path, branch, headOid: oid }, reason: "git-failed" }], diagnostics: snapshot.diagnostics };
      return ctx.emit.result(result, commandResultExit(result));
    }
    recordCompleted(operation, upstreamStep, { upstream, branch, headOid: oid });
  }
  const after = { path, branch, headOid: oid };
  const result = { ...completeResult("tree add", [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name, grove: grove.name, tree, path }, before: null, action: "worktree-add", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
  return ctx.emit.result(result, 0);
  });
}

async function addHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const groveRef = parsed.positionals[0];
  const repoRef = parsed.positionals[1];
  if (!groveRef || !repoRef) {
    throw new GroveError({ kind: "invalid-input", what: "tree add requires <grove> and <repo>", why: "missing positional arguments", remedy: "Use `grove tree add <grove> <repo> [--name <tree>] [--branch <branch>] [--from <ref>]`." });
  }
  return addTree(ctx, groveRef, repoRef, parsed.values.name, parsed.values.branch, parsed.values.from);
}

async function lsHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ref = parsed.positionals[0];
  if (!ref) throw new GroveError({ kind: "invalid-input", what: "tree ls requires <grove>", why: "no Grove given", remedy: "Run `grove ls` to see your Groves, then: grove tree ls <grove>" });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const grove = snapshot.groves.find((candidate) => candidate.name === ref || candidate.metadata?.manifest.id === ref);
  if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${ref}"`, why: "no observed or advisory Grove has that id or name", remedy: "Run `grove ls`." });
  const trees = grove.trees.map(observedWorktreeDetail);
  const diagnostics = snapshot.diagnostics.filter((diagnostic) => (diagnostic.subject as { grove?: unknown }).grove === grove.name);
  const result = completeResult("tree ls", grove.trees.map((tree, index) => ({ selector: { repositoryId: tree.selector?.repositoryId, grove: grove.name, tree: tree.treeName ?? undefined, path: tree.path.utf8 ?? undefined }, before: null, action: "observe", after: trees[index], reason: null })), diagnostics, { grove: grove.name, trees });
  return ctx.emit.result(result, commandResultExit(result));
}

async function removeHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const [groveRef, treeRef] = parsed.positionals;
  if (!groveRef || !treeRef) throw new GroveError({ kind: "invalid-input", what: "tree remove requires <grove> <tree>", why: "missing positional arguments", remedy: "Use `grove tree remove <grove> <tree> [--allow-destructive-all]`." });
  {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const g = git();
    const snapshot = await observeWorkspace(ws, g);
    const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
    if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${groveRef}"`, why: "no observed or advisory Grove matches", remedy: "Run `grove ls`." });
    const matches = grove.trees.filter((tree) => tree.treeName === treeRef || tree.selector?.tree === treeRef || `${tree.selector?.repositoryId}/${tree.treeName}` === treeRef);
    // E-4. `stale-metadata` fires precisely when an advisory Tree record has NO observed worktree,
    // and its remedy names this command — but resolution ran only over OBSERVED worktrees, so the
    // remedy could never execute for the state it was recommended for. A diagnostic whose own fix
    // is unreachable is worse than no diagnostic.
    //
    // With --forget-settings there is nothing to remove from Git; the record IS the target, so
    // resolve it from advisory metadata instead.
    if (matches.length === 0 && parsed.values["forget-settings"] && grove.metadata) {
      const manifest = grove.metadata.manifest;
      const recorded = [...manifest.treeOrder, ...manifest.treeSettings.map((setting) => setting.selector)]
        .filter((selector) => selector.tree === treeRef || `${selector.repositoryId}/${selector.tree}` === treeRef);
      const unique = new Map(recorded.map((selector) => [`${selector.repositoryId}\0${selector.tree}`, selector]));
      if (unique.size !== 1) throw new GroveError({ kind: "invalid-input", what: `No unambiguous Tree "${treeRef}"`, why: `${matches.length} observed and ${unique.size} recorded matches`, remedy: "Run `grove tree ls` and `grove doctor`." });
      const selector = [...unique.values()][0]!;
      const next = {
        ...manifest,
        treeOrder: manifest.treeOrder.filter((entry) => !(entry.repositoryId === selector.repositoryId && entry.tree === selector.tree)),
        treeSettings: manifest.treeSettings.filter((entry) => !(entry.selector.repositoryId === selector.repositoryId && entry.selector.tree === selector.tree)),
      };
      await saveGroveManifest(ws.root, next, grove.metadata.meta);
      const after = { grove: grove.name, tree: selector.tree, forgotten: true, worktreeRemoved: false };
      const result = completeResult("tree remove", [{ selector: { repositoryId: selector.repositoryId, grove: grove.name, tree: selector.tree }, before: { observed: false }, action: "forget-settings", after, reason: null }], snapshot.diagnostics, after);
      return ctx.emit.result(result, commandResultExit(result));
    }
    if (matches.length !== 1) throw new GroveError({ kind: "invalid-input", what: `No unambiguous Tree "${treeRef}"`, why: `${matches.length} observed matches`, remedy: "Run `grove tree ls`." });
    const tree = matches[0]!;
    const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
    if (!repository?.registration || tree.path.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot remove the Tree", why: "its repository or native path is not addressable", remedy: "Run `grove doctor`." });
    if (tree.detached && tree.headOid) {
      const reachable = await g.tryRun(repository.commonGitDir, ["for-each-ref", "--format=%(refname)", "--contains", tree.headOid]);
      if (reachable.exitCode !== 0 || reachable.stdout.trim() === "") throw new GroveError({ kind: "refused-precondition", what: "Cannot remove an unreachable detached Tree", why: "its HEAD commit is not reachable from any ref", remedy: "Create a native ref for the commit before removal.", detail: { reason: "unreachable-detached", headOid: tree.headOid } });
    }
    const treePath = tree.path.utf8;
    const shortBranch = tree.branch?.utf8?.replace(/^refs\/heads\//, "") ?? null;
    const targetLocks = [...new Set([`grove:${grove.name}`, `worktree:${resolve(treePath)}`, ...(shortBranch ? [`repository:${repository.registration.id}:branch:${shortBranch}`] : [])])].sort();
    return withOperationTargetLocks(ws.root, targetLocks, "tree-remove", async () => {
    assertTargetsAvailable(ws.root, targetLocks);
    const currentSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
    const currentRepository = currentSnapshot.repositories.find((candidate) => candidate.registration?.id === repository.registration?.id);
    const currentTree = currentRepository?.worktrees.find((candidate) => candidate.path.utf8 === treePath);
    if (!currentRepository?.registration || currentRepository.problem || !currentTree || currentTree.headOid !== tree.headOid || (currentTree.branch?.utf8 ?? null) !== (tree.branch?.utf8 ?? null)) throw new GroveError({ kind: "refused-conflict", what: `Cannot remove Tree ${tree.treeName}`, why: "its repository, path, branch, or HEAD changed after planning", remedy: "Retry from fresh observed state.", detail: { reason: "stale-plan" } });
    const currentRepositoryId = currentRepository.registration.id;
    // Ruling ④ / constitution Principle IV: itemize on the refusal AND on the forced run. This
    // reported a COUNT ("2 uncommitted file(s)") and then destroyed the files naming none.
    const dirtyStatus = await porcelainStatus(g, treePath);
    if (dirtyStatus.problem !== null) throw new GroveError({ kind: "refused-precondition", what: `Cannot inspect Tree ${tree.treeName} before removal`, why: dirtyStatus.problem || "Git could not enumerate its working state", remedy: "Repair the worktree so `git status --porcelain` succeeds, then retry." });
    const dirtyFiles = dirtyStatus.changes.map((change) => change.path).sort();
    const dirty = dirtyFiles.length > 0;
    const consent = destructiveConsent(parsed.values);
    const refused = dirtyStatus.changes.filter((entry) => !consentAllows(entry, consent));
    const itemizedTail = dirtyFiles.length === 0 ? "" : `\n  discarded in ${tree.treeName}: ${dirtyFiles.join(", ")}`;
    if (refused.length) throw new GroveError({ kind: "refused-precondition", what: `Cannot remove Tree ${tree.treeName}`, why: `uncommitted ${dirtyFiles.length === 1 ? "file" : "files"} ${dirtyFiles.join(", ")}`, detail: { uncommitted: dirtyFiles }, remedy: "Commit the work or pass --allow-destructive-all; --allow-destructive-git-ignored covers only ignored files." });
    // FR-012D preflight: no durable operation exists until the destructive endpoint proves safe.
    containedPath(ws.root, treePath, `Cannot remove Tree ${tree.treeName}`);
    assertWorktreeMutationPath(currentSnapshot, treePath, { allowObservedPath: treePath, groveName: grove.name });
    const operation = beginOperation(ws.root, { kind: "tree-remove", scope: { grove: grove.name }, targetLocks, targets: [{ selector: { repositoryId: currentRepository.registration.id, repositoryAlias: currentRepository.registration.name, grove: grove.name, tree: tree.treeName ?? "", path: treePath }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: treePath, commonGitDir: currentRepository.commonGitDir, headOid: tree.headOid, branch: tree.branch?.utf8 ?? null, consent, discardedWork: dirtyStatus.changes } }, ...(parsed.values["forget-settings"] ? [{ id: "forget", kind: "central-metadata-update", input: { selector: tree.selector } }] : [])] }] });
    recordPending(operation, "remove", { registered: true, headOid: tree.headOid, dirty });
    let provedTreePath: ContainedPath;
    let actualWork = dirtyStatus.changes;
    try {
      const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
      const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === currentRepositoryId);
      const mutationTree = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === treePath);
      if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== currentRepository.commonGitDir || !mutationTree || mutationTree.headOid !== tree.headOid || (mutationTree.branch?.utf8 ?? null) !== (tree.branch?.utf8 ?? null)) throw new GroveError({ kind: "refused-conflict", what: `Cannot remove Tree ${tree.treeName}`, why: "its identity changed at the point of use", remedy: "Retry from fresh observed state.", detail: { reason: "stale-plan" } });
      await assertWorktreeHeadRetained(g, mutationRepository.commonGitDir, treePath, tree.headOid);
      assertWorktreeMutationPath(mutationSnapshot, treePath, { allowObservedPath: treePath, groveName: grove.name });
      actualWork = await assertRecordedWork(g, treePath, dirtyStatus.changes, consent);
      provedTreePath = containedPath(ws.root, treePath, `Cannot remove Tree ${tree.treeName}`);
    }
    catch (error) { const reason = GroveError.is(error) && typeof error.detail === "object" && error.detail !== null && "reason" in error.detail ? String((error.detail as { reason: unknown }).reason) : "stale-plan"; recordStepFailure(operation, "remove", "conflicted", reason, { error: String((error as Error).message ?? error) }); throw error; }
    const removed = await g.tryRemoveWorktree(
      currentRepository.commonGitDir,
      provedTreePath,
      consent !== "none",
    );
    if (removed.exitCode !== 0) {
      recordStepFailure(operation, "remove", "conflicted", "git-failed", { stderr: removed.stderr.trim().split("\n")[0] });
      const result = { schemaVersion: 1 as const, command: "tree remove", outcome: "blocked" as const, operationId: operation.id, targets: [{ selector: { repositoryId: currentRepository.registration.id, grove: grove.name, tree: tree.treeName ?? undefined, path: treePath }, before: null, action: "worktree-remove", after: null, reason: "git-failed" }], diagnostics: snapshot.diagnostics };
      return ctx.emit.result(result, commandResultExit(result));
    }
    recordCompleted(operation, "remove", { registered: false, branchRetained: tree.branch?.utf8 ?? null });
    if (parsed.values["forget-settings"]) {
      recordPending(operation, "forget", { revision: grove.metadata?.meta.rev ?? null, selector: tree.selector });
      if (grove.metadata && tree.selector) {
        const manifest = grove.metadata.manifest;
        await saveGroveManifest(ws.root, { ...manifest, treeSettings: manifest.treeSettings.filter((entry) => entry.selector.repositoryId !== tree.selector?.repositoryId || entry.selector.tree !== tree.selector?.tree), treeOrder: manifest.treeOrder.filter((entry) => entry.repositoryId !== tree.selector?.repositoryId || entry.tree !== tree.selector?.tree) }, grove.metadata.meta);
      }
      recordCompleted(operation, "forget", { forgotten: true });
    }
    const after = {
      removed: true,
      branchRetained: tree.branch?.utf8 ?? null,
      settingsForgotten: parsed.values["forget-settings"],
      discardedWork: actualWork,
    };
    const result = { ...completeResult("tree remove", [{ selector: { repositoryId: currentRepository.registration.id, repositoryAlias: currentRepository.registration.name, grove: grove.name, tree: tree.treeName ?? undefined, path: treePath }, before: { headOid: tree.headOid, branch: tree.branch?.utf8 ?? null }, action: "worktree-remove", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
    return ctx.emit.result(result, 0);
    });
  }
}

async function configureHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const [groveRef, treeRef] = parsed.positionals;
  if (!groveRef || !treeRef) throw new GroveError({ kind: "invalid-input", what: "tree configure requires <grove> <tree>", why: "missing positional arguments", remedy: "Use `grove tree configure <grove> <tree> [...]`." });
  {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const snapshot = await observeWorkspace(ws, git());
    const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
    const matches = grove?.trees.filter((tree) => tree.treeName === treeRef || tree.selector?.tree === treeRef || `${tree.selector?.repositoryId}/${tree.treeName}` === treeRef) ?? [];
    if (!grove || matches.length !== 1 || !matches[0]?.selector || matches[0].path.utf8 === null) throw new GroveError({ kind: "invalid-input", what: `No addressable Tree "${treeRef}"`, why: "the selector is missing or ambiguous", remedy: "Run `grove tree ls`." });
    const observed = matches[0];
    const selector = observed.selector!;
    const observedPath = observed.path.utf8!;
    const manifest = grove.metadata?.manifest ?? newGroveManifest(grove.name);
    const existing = manifest.treeSettings.find((entry) => entry.selector.repositoryId === selector.repositoryId && entry.selector.tree === selector.tree);
    const setting = { selector, defaultAgent: existing?.defaultAgent ?? null, workingDir: existing?.workingDir ?? null };
    if (parsed.values["clear-default-agent"]) setting.defaultAgent = null;
    else if (parsed.values["default-agent"] !== undefined) setting.defaultAgent = parsed.values["default-agent"];
    if (parsed.values["clear-working-dir"]) setting.workingDir = null;
    else if (parsed.values["working-dir"] !== undefined) { resolveContained(observedPath, parsed.values["working-dir"], "Cannot set --working-dir"); setting.workingDir = parsed.values["working-dir"]; }
    const treeSettings = [...manifest.treeSettings.filter((entry) => entry.selector.repositoryId !== setting.selector.repositoryId || entry.selector.tree !== setting.selector.tree), setting];
    await saveGroveManifest(ws.root, { ...manifest, treeSettings }, grove.metadata?.meta);
    const after = { selector: setting.selector, defaultAgent: setting.defaultAgent, workingDir: setting.workingDir };
    const result = completeResult("tree configure", [{ selector: { repositoryId: setting.selector.repositoryId, grove: grove.name, tree: setting.selector.tree, path: observedPath }, before: existing ?? null, action: "configure", after, reason: null }], snapshot.diagnostics, after);
    return ctx.emit.result(result, 0);
  }
}

async function reorderHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const groveRef = parsed.positionals[0];
  const order = parsed.values.tree as string[];
  if (!groveRef || order.length === 0) throw new GroveError({ kind: "invalid-input", what: "tree reorder requires <grove> and --tree...", why: "missing arguments", remedy: "Use `grove tree reorder <grove> --tree <tree>...`." });
  {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const snapshot = await observeWorkspace(ws, git());
    const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
    if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${groveRef}"`, why: "no observed or advisory Grove matches", remedy: "Run `grove ls`." });
    const requested = order.map((ref) => {
      const matches = grove.trees.filter((tree) => tree.treeName === ref || tree.selector?.tree === ref || `${tree.selector?.repositoryId}/${tree.treeName}` === ref);
      if (matches.length !== 1 || !matches[0]?.selector) throw new GroveError({ kind: "invalid-input", what: `No unambiguous Tree "${ref}"`, why: `${matches.length} matches`, remedy: "Run `grove tree ls`." });
      return matches[0].selector;
    });
    // P5.4 (ledger V-3). A duplicate selector silently collapsed into the Set and the manifest was
    // rewritten anyway, so the user's stated order was not the order stored and nothing said so.
    // Refuse before writing; the manifest must be byte-identical after a refusal.
    const seen = new Set<string>();
    for (const selector of requested) {
      const key = `${selector.repositoryId}\0${selector.tree}`;
      if (seen.has(key)) throw new GroveError({ kind: "invalid-input", what: `Tree "${selector.tree}" was listed more than once`, why: "each Tree may appear at most once in an explicit order", remedy: "Remove the duplicate --tree argument.", detail: { tree: selector.tree, repositoryId: selector.repositoryId } });
      seen.add(key);
    }
    const keys = new Set(requested.map((selector) => `${selector.repositoryId}\0${selector.tree}`));
    const appended = grove.trees.flatMap((tree) => tree.selector && !keys.has(`${tree.selector.repositoryId}\0${tree.selector.tree}`) ? [tree.selector] : []).sort((a, b) => `${a.repositoryId}\0${a.tree}`.localeCompare(`${b.repositoryId}\0${b.tree}`));
    const manifest = grove.metadata?.manifest ?? newGroveManifest(grove.name);
    await saveGroveManifest(ws.root, { ...manifest, treeOrder: [...requested, ...appended] }, grove.metadata?.meta);
    const after = { order: [...requested, ...appended], stale: manifest.treeOrder.filter((selector) => !grove.trees.some((tree) => tree.selector?.repositoryId === selector.repositoryId && tree.selector.tree === selector.tree)) };
    const result = completeResult("tree reorder", [{ selector: { grove: grove.name }, before: { order: manifest.treeOrder }, action: "reorder", after, reason: null }], snapshot.diagnostics, after);
    return ctx.emit.result(result, 0);
  }
}

export function registerTree(): void {
  register({
    path: "tree add",
    summary: "Create or adopt one Tree in a Grove.",
    usage: "tree add <grove> <repo> [--name <tree>] [--branch <branch>] [--from <ref>]",
    args: [
      { name: "<grove>", desc: "Grove to add the Tree to." },
      { name: "<repo>", desc: "Repository for the new Tree." },
      { name: "--name <tree>", desc: "Use this exact final Tree identity instead of the default <grove>@<repo>." },
      { name: "--branch <branch>", desc: "Use this exact branch: adopted if it exists; when absent, --from is required." },
      { name: "--from <ref>", desc: "Base a newly created explicit branch at this exact ref. Invalid when adopting." },
    ],
    note: "Default Tree identity is <grove>@<repo>; an explicit --name is used exactly. Default branch is <prefix><grove-name>. Refused if the branch is already checked out anywhere (one branch, one worktree).",
    examples: [
      'grove tree add pricing-fix web                     # add a Tree in web on branch "pricing-fix"',
      "grove tree add pricing-fix web --name second --branch second --from main  # exact Tree name override",
      "grove tree add pricing-fix web --branch hotfix     # deliberately adopt existing branch hotfix",
      "grove tree add pricing-fix web --branch hotfix --from release-2.3  # create it off release-2.3 instead of trunk",
    ],
    handler: addHandler,
    mutates: true,
  });
  register({
    path: "tree ls",
    summary: "List a Grove's Trees.",
    usage: "tree ls <grove>",
    args: [{ name: "<grove>", desc: "Grove (id or name) whose Trees to list." }],
    note: "One line per observed Tree with its native branch, path, and worktree state.",
    examples: ["grove tree ls pricing-fix   # e.g. pricing-fix  pricing-fix@web  [created]"],
    handler: lsHandler,
  });
  register({
    path: "tree remove",
    summary: "Remove a Tree (branch retained).",
    usage: "tree remove <grove> <tree> [--allow-destructive-all | --allow-destructive-git-ignored] [--forget-settings]",
    args: [
      { name: "<grove>", desc: "Grove holding the Tree." },
      { name: "<tree>", desc: "Tree id or directory to remove." },
      { name: "--allow-destructive-all", desc: "Remove even if the worktree is dirty. You will lose the itemized uncommitted work." },
      { name: "--allow-destructive-git-ignored", desc: "Discard only itemized Git-ignored files." },
      { name: "--forget-settings", desc: "Also remove this Tree's advisory central settings." },
    ],
    note: "The branch and its commits are kept. Use native `git branch -d/-D` if branch deletion is desired.",
    examples: [
      "grove tree remove pricing-fix pricing-fix@web          # remove the Tree; branch pricing-fix kept",
      "grove tree remove pricing-fix pricing-fix@web --allow-destructive-all  # discard its uncommitted work and remove it",
    ],
    handler: removeHandler,
    mutates: true,
  });
  register({
    path: "tree configure",
    summary: "Change Tree-owned settings.",
    usage: "tree configure <grove> <tree> [--default-agent <agent>|--clear-default-agent] [--working-dir <path>|--clear-working-dir]",
    args: [
      { name: "<grove>", desc: "Grove holding the Tree." },
      { name: "<tree>", desc: "Tree id or directory to configure." },
      { name: "--default-agent <agent>", desc: "Set the Tree's default agent." },
      { name: "--clear-default-agent", desc: "Clear the Tree's default agent." },
      { name: "--working-dir <path>", desc: "Set the subdirectory (relative to the Tree's worktree) an agent starts in." },
      { name: "--clear-working-dir", desc: "Clear the working directory (agents start at the worktree root)." },
    ],
    note: "Pass a set flag or its --clear- pair; --working-dir must resolve inside the Tree's worktree.",
    examples: [
      "grove tree configure pricing-fix pricing-fix@web --default-agent claude --working-dir packages/ui  # set both",
      "grove tree configure pricing-fix pricing-fix@web --clear-working-dir                                # unset the working dir",
    ],
    handler: configureHandler,
    mutates: true,
  });
  register({
    path: "tree reorder",
    summary: "Set Tree order.",
    usage: "tree reorder <grove> --tree <tree>...",
    args: [
      { name: "<grove>", desc: "Grove whose Trees to reorder." },
      { name: "--tree <tree>", desc: "A Tree id or directory; repeat for every Tree, in the order you want." },
    ],
    note: "The Trees you name are ordered exactly as given; any Tree you omit keeps its place after them, in a stable order. Naming the same Tree twice is refused.",
    examples: ["grove tree reorder pricing-fix --tree pricing-fix@api --tree pricing-fix@web  # api first, then web"],
    handler: reorderHandler,
    mutates: true,
  });
}
