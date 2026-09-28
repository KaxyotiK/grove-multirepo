/**
 * `grove reconcile` reports observed Git/worktree diagnostics without guessing identity and
 * resumes versioned forward operations at exact persisted boundaries. On a fully consistent
 * workspace it performs no mutation.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { assertRecordedWork, assertWorktreeHeadRetained, porcelainStatus, recordedConsent, type ChangeEntry } from "../git/worktree.ts";
import { register, type CommandContext } from "./registry.ts";
import { requireWorkspace, loadWorkspaceAt, saveWorkspace } from "../config/workspace.ts";
import { loadCentralGroveMetadata, newGroveManifest, saveGroveManifest } from "../config/grove.ts";
import { assertDestructiveMutationPath, assertWorktreeMutationPath, observeWorkspace } from "../model/observed.ts";
import { completeResult, commandResultExit } from "../model/result.ts";
import { abandonOperation, assertTargetsAvailable, canAbandonOperation, captureDirectoryTarget, closeInterruptedSyncAttempt, findOperation, pendingOperations, recordCompleted, recordPending, recordStepFailure, scanOperations, withOperationTargetLocks, type OperationRecord, type OperationStep } from "../store/operation.ts";
import type { RepositoryEntry } from "../model/types.ts";
import type { ArchiveRecipe } from "../model/types.ts";
import type { GroveManifest } from "../model/types.ts";
import { assertDirectoryContainsOnlyRoots, containedParentPath, containedPath, isStrictSubpath, isSubpath, mergeDirectoryForward, moveContainedDirectory, removeContainedDirectory, removeContainedFile, removeContainedSymbolicLink, inventoryLooseContent, looseEntryLabel, readRecordedLooseConsent, unaccountedEntries, unconsentedLooseEntries } from "../paths/fs.ts";
import { parseCommand } from "./args.ts";
import { compileLayout, expandArchivePath, expandGrovePath, expandRepositoryPath, expandTreePath, matchLayoutPath, resolveLayoutTarget, structuralTreeSlotPaths } from "../config/layout.ts";
import { caseFoldKey, isValidTrunkAllocation, nativePathFromBytes } from "../model/encoding.ts";
import { checkRemoteCredentials, checkRemoteName } from "../model/validate.ts";
import { centralGroveManifest } from "../paths/layout.ts";
import { isGitDirectory } from "./files.ts";
import { auditDiagnostics } from "./doctor.ts";
import { captureAcquisitionRemoteProof, isStandardAcquisitionPath, isStandardBareInitScaffold, matchesAcquisitionAnchorProof, matchesAcquisitionGenesis } from "../store/acquisition-anchor.ts";

function stepInput(step: OperationStep): Record<string, unknown> {
  if (typeof step.input !== "object" || step.input === null) throw new GroveError({ kind: "config", what: `Operation step ${step.id} has invalid input`, why: "the persisted input is not an object", remedy: "Inspect the durable operation record." });
  return step.input as Record<string, unknown>;
}

async function disposableAcquisitionAnchor(anchor: string, git: Git, proof: unknown, genesis: unknown): Promise<boolean> {
  if (!isStandardBareInitScaffold(anchor) || !matchesAcquisitionAnchorProof(anchor, proof, genesis)) return false;
  const [bare, refs, worktrees, config] = await Promise.all([
    git.tryRun(anchor, ["rev-parse", "--is-bare-repository"]),
    git.tryRun(anchor, ["for-each-ref", "--format=%(refname)"]),
    git.tryRun(anchor, ["worktree", "list", "--porcelain"]),
    git.tryRun(anchor, ["config", "--local", "--name-only", "--list"]),
  ]);
  const allowedKeys = new Set(["core.repositoryformatversion", "core.filemode", "core.bare", "core.ignorecase", "core.precomposeunicode", "remote.origin.url", "remote.origin.fetch"]);
  return bare.exitCode === 0 && bare.stdout.trim() === "true" && refs.exitCode === 0 && refs.stdout.trim() === "" &&
    worktrees.exitCode === 0 && worktrees.stdout.split("\n").filter((line) => line.startsWith("worktree ")).length === 1 &&
    config.exitCode === 0 && config.stdout.trim().split("\n").every((key) => allowedKeys.has(key)) &&
    matchesAcquisitionAnchorProof(anchor, proof, genesis);
}

type AcquisitionArtifact = { kind: string; path?: string; rawPathBase64?: string; ref?: string };

async function retainedAcquisitionArtifacts(anchor: string, git: Git): Promise<AcquisitionArtifact[]> {
  const artifacts: AcquisitionArtifact[] = [{ kind: "repository-anchor", path: anchor }];
  const [refs, worktrees] = await Promise.allSettled([
    git.tryRun(anchor, ["for-each-ref", "--format=%(refname)"]),
    git.tryRun(anchor, ["worktree", "list", "--porcelain"]),
  ]);
  if (refs.status === "fulfilled" && refs.value.exitCode === 0) for (const ref of refs.value.stdout.split("\n").filter(Boolean)) artifacts.push({ kind: "ref", ref });
  if (worktrees.status === "fulfilled" && worktrees.value.exitCode === 0) for (const line of worktrees.value.stdout.split("\n")) {
    if (line.startsWith("worktree ") && line.slice(9) !== anchor) artifacts.push({ kind: "worktree", path: line.slice(9) });
  }
  if (refs.status === "rejected" || refs.value.exitCode !== 0 || worktrees.status === "rejected" || worktrees.value.exitCode !== 0) {
    artifacts.push({ kind: "inventory-incomplete", path: anchor });
  }
  const joinBytes = (parent: Buffer, name: Buffer): Buffer => Buffer.concat([parent, Buffer.from("/"), name]);
  const report = (kind: string, absolute: Buffer): void => {
    const native = nativePathFromBytes(absolute);
    artifacts.push({ kind, path: native.utf8 ?? native.display, ...(native.utf8 === null ? { rawPathBase64: absolute.toString("base64") } : {}) });
  };
  let visited = 0;
  const visit = (absolute: Buffer, relativePath: Buffer, depth: number): void => {
    if (depth > 16) throw new Error("retained acquisition inventory depth limit");
    for (const name of readdirSync(absolute, { encoding: "buffer" }).sort(Buffer.compare)) {
      if (++visited > 4096) throw new Error("retained acquisition inventory entry limit");
      const child = joinBytes(absolute, name);
      const relativeChild = relativePath.length ? joinBytes(relativePath, name) : name;
      const stat = lstatSync(child);
      const relativeText = relativeChild.toString("utf8");
      const gitStorage = Buffer.from(relativeText).equals(relativeChild) && /^(?:objects|refs|worktrees)(?:\/|$)/.test(relativeText);
      const kind = gitStorage ? "repository-content" : isStandardAcquisitionPath(relativeChild) ? "retained-content" : "additional-content";
      if (!stat.isDirectory() || !isStandardAcquisitionPath(relativeChild)) report(kind, child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(child, relativeChild, depth + 1);
    }
  };
  try { visit(Buffer.from(anchor), Buffer.alloc(0), 0); }
  catch { if (!artifacts.some((item) => item.kind === "inventory-incomplete")) artifacts.push({ kind: "inventory-incomplete", path: anchor }); }
  return artifacts;
}

function repoAddGitFailureDetail(record: OperationRecord, step: OperationStep, exitCode?: number): { why: string; remedy: string } {
  return {
    why: exitCode === undefined ? `Git failed while resuming step ${step.id}` : `Git exited ${exitCode} while resuming step ${step.id}`,
    remedy: `Correct the Git failure and run \`grove reconcile --operation ${record.id}\` again, or explicitly close this failed acquisition with \`grove reconcile --abandon ${record.id}\`.`,
  };
}

function ensurePending(record: OperationRecord, step: OperationStep, preState: unknown): void {
  if (step.classification === "planned" || step.classification === "recoverable-intermediate") recordPending(record, step.id, preState);
  else if (step.classification !== "pending") throw new GroveError({ kind: "refused-conflict", what: `Cannot resume step ${step.id}`, why: `its classification is ${step.classification}`, remedy: "Abandon an eligible conflicted operation or inspect it." });
}

interface BoundDirectoryIdentity {
  role: "active-grove" | "archive-grove";
  grove: string;
  relativePath: string;
  canonicalPath: string;
  expectedPresent: boolean;
  device: number | null;
  inode: number | null;
}

function readBoundDirectoryIdentity(value: unknown): BoundDirectoryIdentity | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const selector = typeof raw.selector === "object" && raw.selector !== null ? raw.selector as Record<string, unknown> : null;
  if ((raw.role !== "active-grove" && raw.role !== "archive-grove") || typeof selector?.grove !== "string" || typeof raw.relativePath !== "string" || typeof raw.canonicalPath !== "string" || typeof raw.expectedPresent !== "boolean" || (raw.device !== null && typeof raw.device !== "number") || (raw.inode !== null && typeof raw.inode !== "number")) return null;
  return { role: raw.role, grove: selector.grove, relativePath: raw.relativePath, canonicalPath: raw.canonicalPath, expectedPresent: raw.expectedPresent, device: raw.device as number | null, inode: raw.inode as number | null };
}

function validateBoundDirectory(root: string, path: string, value: unknown): { identity: BoundDirectoryIdentity; present: boolean; device: number | null; inode: number | null } | null {
  const identity = readBoundDirectoryIdentity(value);
  if (!identity) return null;
  const workspace = loadWorkspaceAt(root);
  const layout = compileLayout(root, workspace.config.layout);
  const expectedPath = identity.role === "active-grove" ? expandGrovePath(layout, identity.grove) : expandArchivePath(layout, identity.grove);
  const present = existsSync(expectedPath);
  const canonicalPath = present ? realpathSync(expectedPath) : resolve(expectedPath);
  const stat = present ? lstatSync(expectedPath) : null;
  if (resolve(path) !== resolve(expectedPath) || identity.relativePath !== relative(resolve(root), resolve(expectedPath)) || identity.canonicalPath !== canonicalPath) return null;
  return { identity, present, device: stat?.dev ?? null, inode: stat?.ino ?? null };
}

function pendingIdentity(step: OperationStep, key: "fromIdentity" | "toIdentity", fallback: unknown): unknown {
  if (typeof step.preState === "object" && step.preState !== null && key in step.preState) return (step.preState as Record<string, unknown>)[key];
  return fallback;
}

function completedRenameDestinationIdentity(record: OperationRecord): unknown {
  for (const candidate of [...record.steps].reverse()) {
    if (candidate.kind !== "worktree-move" || candidate.classification !== "completed" || typeof candidate.postState !== "object" || candidate.postState === null) continue;
    const identity = (candidate.postState as Record<string, unknown>).destinationRootIdentity;
    if (identity !== undefined) return identity;
  }
  return null;
}

function isLexicallyStrictlyContained(root: string, path: string): boolean {
  return isAbsolute(path) && isStrictSubpath(resolve(root), resolve(path));
}

function recordedWorktreePaths(record: OperationRecord): string[] {
  return record.steps.flatMap((candidate) => {
    if (typeof record.scope.grove !== "string" || candidate.selector.grove !== record.scope.grove || (candidate.kind !== "worktree-remove" && candidate.kind !== "worktree-move")) return [];
    const input = typeof candidate.input === "object" && candidate.input !== null ? candidate.input as Record<string, unknown> : null;
    return typeof input?.path === "string" ? [input.path] : typeof input?.from === "string" ? [input.from] : [];
  });
}

/**
 * Movement (archive, rename) preserves everything below a top-level name, including later
 * additions, so a name-level comparison suffices here. Deletion uses the per-path inventory.
 */
function assertRecordedLooseMove(path: string, worktrees: readonly string[], recorded: unknown): void {
  if (!Array.isArray(recorded)) return;
  const currentLoose = unaccountedEntries(path, worktrees);
  if (currentLoose.some(entry => !recorded.includes(entry))) throw new GroveError({ kind: "refused-conflict", what: `Cannot resume movement of ${path}`, why: "loose content appeared after planning", remedy: "Inspect retained content and start a new plan.", detail: { reason: "stale-plan", recordedLoose: recorded, currentLoose } });
}

/**
 * Ruling ④ across runs: every completed destructive step of the operation, not only those this
 * resume completed, so removals by an interrupted run are reported too. `completedEarlier` marks
 * a step completed before this run; `discardsUnrecorded` marks a postState with no per-file
 * receipt (a record written before receipts existed, or a removal observed after a crash), for
 * which Grove cannot say what was removed.
 */
function destructionReceipts(record: OperationRecord, completedThisRun: readonly string[]): Array<{ step: string; tree?: string; completedEarlier?: true; discardsUnrecorded?: true; evidence: unknown }> {
  return record.steps
    .filter((step) => step.classification === "completed" && (step.kind === "worktree-remove" || step.kind === "directory-remove"))
    .map((step) => {
      const post = typeof step.postState === "object" && step.postState !== null ? step.postState as Record<string, unknown> : {};
      const itemized = Array.isArray(post.discardedWork) || Array.isArray(post.discardedLoose);
      return { step: step.id, ...(typeof step.selector.tree === "string" ? { tree: step.selector.tree } : {}), ...(completedThisRun.includes(step.id) ? {} : { completedEarlier: true as const }), ...(itemized ? {} : { discardsUnrecorded: true as const }), evidence: step.postState };
    });
}

interface RecoveryDetail { why: string; remedy: string }

/**
 * A metadata step that fails on resume. A filesystem failure (Grove's `io` error or a raw Node
 * errno error) leaves the step resumable with `io-failed`, as the direct run does, so a reconcile
 * tried before the cause is corrected never strands the operation. Anything else is a conflict
 * that cannot resume. Both carry a why and a true remedy (json-results-v1; V3DES-13).
 */
function metadataStepFailure(record: OperationRecord, step: OperationStep, completed: string[], error: unknown): RecoveryResult {
  const message = String((error as Error)?.message ?? error);
  const io = GroveError.is(error) ? error.kind === "io" : typeof (error as NodeJS.ErrnoException)?.code === "string";
  if (io) {
    const detail = { why: `the metadata step ${step.id} failed on the filesystem: ${message}`, remedy: `Correct the cause, then run \`grove reconcile --operation ${record.id}\` (or \`grove reconcile\`) to finish this ${record.kind}; completed steps are not repeated.` };
    recordStepFailure(record, step.id, "recoverable-intermediate", "io-failed", detail);
    return { id: record.id, state: record.state, completed, problem: "io-failed", detail };
  }
  const detail = { why: `the metadata step ${step.id} cannot resume: ${message}`, remedy: `Inspect operation ${record.id} and the Grove metadata it names, then run \`grove reconcile --abandon ${record.id}\` to close it; completed steps stay in place.` };
  recordStepFailure(record, step.id, "conflicted", "stale-plan", detail);
  return { id: record.id, state: record.state, completed, problem: "stale-plan", detail };
}
interface RecoveryResult { discarded?: unknown; evidence?: unknown; id: string; state: string; completed: string[]; problem: string | null; detail?: RecoveryDetail }

async function resumeOperation(root: string, record: OperationRecord, git: Git): Promise<RecoveryResult> {
  const completed: string[] = [];
  for (const step of record.steps) {
    if (step.classification === "completed") continue;
    if (step.classification === "conflicted") return { id: record.id, state: record.state, completed, problem: step.error?.reason ?? "stale-plan", evidence: step.error?.detail };
    // Legacy records may predate repo add's direct-URL refusal. Validate the retained original
    // before *any* unfinished acquisition step can write it to Git config or send it to Git. The
    // per-invocation opt-in applies only to credentials introduced by Git configuration.
    const originalRemote = record.kind === "repo-add" && typeof record.secret === "object" && record.secret !== null
      ? (record.secret as { remote?: unknown }).remote : null;
    if (typeof originalRemote === "string" && checkRemoteCredentials(originalRemote) !== null) {
      const detail = {
        why: "The retained original remote URL embeds credentials; Git-config opt-in cannot authorize a directly supplied credentialed URL",
        remedy: `Inspect this legacy operation, then run \`grove reconcile --abandon ${record.id}\` to close it before retrying with a credential-free URL.`,
      };
      recordStepFailure(record, step.id, "conflicted", "refused-policy", detail);
      return { id: record.id, state: record.state, completed, problem: "refused-policy", detail };
    }
    const input = stepInput(step);
    if (step.kind === "worktree-remove") {
      const repositoryId = step.selector.repositoryId;
      const path = input.path;
      const commonGitDir = input.commonGitDir;
      const expectedHead = input.headOid;
      const consent = recordedConsent(input);
      const force = consent !== "none";
      if (typeof repositoryId !== "string" || typeof path !== "string" || typeof commonGitDir !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      if (!isLexicallyStrictlyContained(root, path)) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const workspace = loadWorkspaceAt(root); const snapshot = await observeWorkspace(workspace, git);
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
      if (!repository || repository.problem || repository.commonGitDir !== commonGitDir) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedCommonGitDir: commonGitDir, observedCommonGitDir: repository?.commonGitDir ?? null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const observed = repository.worktrees.find((worktree) => worktree.path.utf8 === path);
      if (!observed) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { path, registered: false, refsRetained: true, observedAfterCrash: true }); completed.push(step.id); continue; }
      if ((typeof expectedHead === "string" && observed.headOid !== expectedHead) || observed.path.utf8 === null) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { observedHead: observed.headOid }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      let discardedWork: ChangeEntry[] = [];
      try {
        assertWorktreeMutationPath(snapshot, path, { allowObservedPath: path, ...(typeof step.selector.grove === "string" ? { groveName: step.selector.grove } : {}) });
        containedPath(root, path, `Cannot resume worktree removal ${path}`);
        ensurePending(record, step, step.preState ?? { path, headOid: observed.headOid, dirty: observed.dirty });
        const mutationSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
        const mutationWorktree = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === path);
        if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== commonGitDir || !mutationWorktree || (typeof expectedHead === "string" && mutationWorktree.headOid !== expectedHead)) throw new GroveError({ kind: "refused-conflict", what: `Cannot resume worktree removal ${path}`, why: "the repository or worktree identity changed at the point of use", remedy: "Inspect the retained operation and reconcile explicitly." });
        assertWorktreeMutationPath(mutationSnapshot, path, { allowObservedPath: path, ...(typeof step.selector.grove === "string" ? { groveName: step.selector.grove } : {}) });
        await assertWorktreeHeadRetained(git, mutationRepository.commonGitDir, path, typeof expectedHead === "string" ? expectedHead : null);
        discardedWork = await assertRecordedWork(git, path, input.discardedWork, consent);
        await git.removeWorktree(mutationRepository.commonGitDir, containedPath(root, path, `Cannot resume worktree removal ${path}`), force);
      }
      catch (error) { const reason = GroveError.is(error) && error.kind === "git" ? "git-failed" : GroveError.is(error) && "reason" in error.detail ? String(error.detail.reason) : GroveError.is(error) ? "stale-plan" : "git-failed"; recordStepFailure(record, step.id, "conflicted", reason, { error: String((error as Error).message ?? error), ...(GroveError.is(error) ? error.detail : {}) }); return { id: record.id, state: record.state, completed, problem: reason, evidence: step.error?.detail }; }
      recordCompleted(record, step.id, { path, registered: false, refsRetained: true, resumed: true, recordedWork: input.discardedWork ?? [], discardedWork }); completed.push(step.id); continue;
    }
    if (step.kind === "worktree-move") {
      const repositoryId = step.selector.repositoryId;
      const from = input.from;
      const to = input.to;
      const expectedHead = input.headOid;
      const commonGitDir = input.commonGitDir;
      if (typeof repositoryId !== "string" || typeof from !== "string" || typeof to !== "string" || typeof commonGitDir !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      if (!isLexicallyStrictlyContained(root, from) || !isLexicallyStrictlyContained(root, to)) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const snapshot = await observeWorkspace(loadWorkspaceAt(root), git); const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
      if (!repository || repository.problem || repository.commonGitDir !== commonGitDir) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedCommonGitDir: commonGitDir, observedCommonGitDir: repository?.commonGitDir ?? null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const atFrom = repository.worktrees.find((worktree) => worktree.path.utf8 === from); const atTo = repository.worktrees.find((worktree) => worktree.path.utf8 === to);
      if ((!atFrom && !atTo) || (atFrom && atTo) || (atFrom && typeof expectedHead === "string" && atFrom.headOid !== expectedHead) || (atFrom && existsSync(to))) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { sourcePresent: Boolean(atFrom), destinationPresent: Boolean(atTo) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      let renameDestinationIdentity: unknown = null;
      let renameDestinationRoot: string | null = null;
      let completedMovePaths: string[] = [];
      if (record.kind === "grove-rename" && typeof record.scope.newName === "string") {
        renameDestinationRoot = expandGrovePath(snapshot.layout, record.scope.newName);
        const preStateIdentity = typeof step.preState === "object" && step.preState !== null ? (step.preState as Record<string, unknown>).destinationRootIdentity : null;
        renameDestinationIdentity = preStateIdentity ?? completedRenameDestinationIdentity(record);
        if (!renameDestinationIdentity) {
          if (atTo) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { unboundDestination: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
          const preState = typeof step.preState === "object" && step.preState !== null ? step.preState as Record<string, unknown> : null;
          const ownsPendingReservation = step.classification === "pending" && preState?.destinationExpectedAbsent === true && preState.reservationToken === record.id;
          if (existsSync(renameDestinationRoot) && !ownsPendingReservation) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { destinationOccupied: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
          if (!existsSync(renameDestinationRoot)) {
            ensurePending(record, step, step.preState ?? { from, to, headOid: atFrom?.headOid ?? null, destinationExpectedAbsent: true, reservationToken: record.id });
            mkdirSync(dirname(renameDestinationRoot), { recursive: true }); mkdirSync(renameDestinationRoot);
          }
          try { assertDirectoryContainsOnlyRoots(renameDestinationRoot, []); }
          catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
          renameDestinationIdentity = captureDirectoryTarget(root, "active-grove", { grove: record.scope.newName }, renameDestinationRoot);
        }
        const bound = validateBoundDirectory(root, renameDestinationRoot, renameDestinationIdentity);
        if (!bound || !bound.present || bound.device !== bound.identity.device || bound.inode !== bound.identity.inode) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { destinationIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        completedMovePaths = record.steps.flatMap((candidate) => candidate.kind === "worktree-move" && candidate.classification === "completed" && typeof candidate.postState === "object" && candidate.postState !== null && typeof (candidate.postState as Record<string, unknown>).path === "string" ? [String((candidate.postState as Record<string, unknown>).path)] : []);
        try { assertDirectoryContainsOnlyRoots(renameDestinationRoot, [...completedMovePaths, ...(atTo ? [to] : [])]); }
        catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      }
      if (!atFrom && atTo && (typeof expectedHead !== "string" || atTo.headOid === expectedHead)) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true, ...(renameDestinationIdentity ? { destinationRootIdentity: renameDestinationIdentity } : {}) }); recordCompleted(record, step.id, { path: to, headOid: atTo.headOid, observedAfterCrash: true, ...(renameDestinationIdentity ? { destinationRootIdentity: renameDestinationIdentity } : {}) }); completed.push(step.id); continue; }
      if (!atFrom || atTo) { recordStepFailure(record, step.id, "conflicted", "stale-plan"); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      try {
        const sourceGrove = typeof step.selector.grove === "string" ? step.selector.grove : undefined;
        const destinationGrove = record.kind === "grove-rename" && typeof record.scope.newName === "string" ? record.scope.newName : sourceGrove;
        assertWorktreeMutationPath(snapshot, from, { allowObservedPath: from, ...(sourceGrove ? { groveName: sourceGrove } : {}) });
        assertWorktreeMutationPath(snapshot, to, destinationGrove ? { groveName: destinationGrove } : {});
        containedPath(root, from, "Cannot resume worktree move outside the workspace");
        containedPath(root, to, "Cannot resume worktree move outside the workspace");
        ensurePending(record, step, step.preState ?? { from, to, headOid: atFrom.headOid, ...(renameDestinationIdentity ? { destinationRootIdentity: renameDestinationIdentity } : {}) });
        mkdirSync(dirname(to), { recursive: true });
        // Re-observe and re-prove after creating the parent, immediately before Git moves it.
        const mutationSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
        const mutationFrom = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === from);
        const mutationTo = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === to);
        if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== commonGitDir || !mutationFrom || mutationTo || (typeof expectedHead === "string" && mutationFrom.headOid !== expectedHead)) throw new GroveError({ kind: "refused-conflict", what: `Cannot resume worktree move ${from}`, why: "the repository or worktree identity changed at the point of use", remedy: "Inspect the retained operation and reconcile explicitly." });
        assertWorktreeMutationPath(mutationSnapshot, from, { allowObservedPath: from, ...(sourceGrove ? { groveName: sourceGrove } : {}) });
        assertWorktreeMutationPath(mutationSnapshot, to, destinationGrove ? { groveName: destinationGrove } : {});
        await git.moveWorktree(
          mutationRepository.commonGitDir,
          containedPath(root, from, "Cannot resume worktree move outside the workspace"),
          containedPath(root, to, "Cannot resume worktree move outside the workspace"),
        );
      }
      catch (error) { const reason = GroveError.is(error) && error.kind !== "git" ? "stale-plan" : "git-failed"; recordStepFailure(record, step.id, "conflicted", reason, { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: reason }; }
      if (renameDestinationRoot && renameDestinationIdentity) {
        const bound = validateBoundDirectory(root, renameDestinationRoot, renameDestinationIdentity);
        try { if (!bound || !bound.present || bound.device !== bound.identity.device || bound.inode !== bound.identity.inode) throw new Error("destination identity changed"); assertDirectoryContainsOnlyRoots(renameDestinationRoot, [...completedMovePaths, to]); }
        catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      }
      recordCompleted(record, step.id, { path: to, headOid: atFrom.headOid, resumed: true, ...(renameDestinationIdentity ? { destinationRootIdentity: renameDestinationIdentity } : {}) }); completed.push(step.id); continue;
    }
    if (step.kind === "directory-move") {
      const from = input.from; const to = input.to;
      if (typeof from !== "string" || typeof to !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      if (!isLexicallyStrictlyContained(root, from) || !isLexicallyStrictlyContained(root, to)) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      let fromBound: ReturnType<typeof validateBoundDirectory>; let toBound: ReturnType<typeof validateBoundDirectory>;
      try {
        fromBound = validateBoundDirectory(root, from, pendingIdentity(step, "fromIdentity", input.fromIdentity));
        toBound = validateBoundDirectory(root, to, pendingIdentity(step, "toIdentity", input.toIdentity));
      } catch (error) {
        recordStepFailure(record, step.id, "conflicted", "stale-plan", { directoryBindingChanged: true, error: String((error as Error).message ?? error) });
        return { id: record.id, state: record.state, completed, problem: "stale-plan" };
      }
      if (!fromBound || !toBound) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { directoryBindingChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (fromBound.present && (!fromBound.identity.expectedPresent || fromBound.device !== fromBound.identity.device || fromBound.inode !== fromBound.identity.inode)) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { sourceIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (!fromBound.present && toBound.present) {
        const movedIdentity = fromBound.identity.expectedPresent && toBound.device === fromBound.identity.device && toBound.inode === fromBound.identity.inode;
        if (!movedIdentity) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { destinationIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { path: to, observedAfterCrash: true }); completed.push(step.id); continue;
      }
      if (!fromBound.present && !toBound.present && !fromBound.identity.expectedPresent && !toBound.identity.expectedPresent) {
        if (record.kind === "grove-restore") {
          try {
            const preflightSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
            const groveName = typeof record.scope.grove === "string" ? record.scope.grove : undefined;
            assertDestructiveMutationPath(preflightSnapshot, from, groveName ? { groveName } : {});
            assertDestructiveMutationPath(preflightSnapshot, to, groveName ? { groveName } : {});
            containedPath(root, from, "Cannot resume Grove restore outside the workspace");
            containedPath(root, to, "Cannot resume Grove restore outside the workspace");
            ensurePending(record, step, step.preState ?? { sourceAbsent: true });
            const pointOfUseSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
            assertDestructiveMutationPath(pointOfUseSnapshot, to, groveName ? { groveName } : {});
            mkdirSync(to, { recursive: true });
          }
          catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        }
        else ensurePending(record, step, step.preState ?? { sourceAbsent: true });
        recordCompleted(record, step.id, { path: record.kind === "grove-restore" ? to : null, createdEmpty: record.kind === "grove-restore", resumed: true }); completed.push(step.id); continue;
      }
      if (!fromBound.present || toBound.present) { recordStepFailure(record, step.id, "conflicted", "stale-plan"); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      try {
        const preflightSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        const groveName = typeof record.scope.grove === "string" ? record.scope.grove : undefined;
        assertDestructiveMutationPath(preflightSnapshot, from, { allowObservedPaths: recordedWorktreePaths(record), ...(groveName ? { groveName } : {}) });
        assertDestructiveMutationPath(preflightSnapshot, to, groveName ? { groveName } : {});
      }
      catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      ensurePending(record, step, step.preState ?? { from, to });
      try {
        containedPath(root, from, "Cannot resume directory move outside the workspace");
        containedPath(root, to, "Cannot resume directory move outside the workspace");
        mkdirSync(dirname(to), { recursive: true });
        const mutationSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        const groveName = typeof record.scope.grove === "string" ? record.scope.grove : undefined;
        assertDestructiveMutationPath(mutationSnapshot, from, { allowObservedPaths: recordedWorktreePaths(record), ...(groveName ? { groveName } : {}) });
        assertDestructiveMutationPath(mutationSnapshot, to, groveName ? { groveName } : {});
        assertRecordedLooseMove(from, recordedWorktreePaths(record), input.plannedLoose);
        moveContainedDirectory(
          containedPath(root, from, "Cannot resume directory move outside the workspace"),
          containedPath(root, to, "Cannot resume directory move outside the workspace"),
        );
      }
      catch (error) { const reason = GroveError.is(error) ? "stale-plan" : "io-failed"; recordStepFailure(record, step.id, "conflicted", reason, { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: reason }; }
      recordCompleted(record, step.id, { path: to, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "directory-merge") {
      const from = input.from; const to = input.to;
      if (typeof from !== "string" || typeof to !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const mergeRoots = Array.isArray(input.mergeRoots) && input.mergeRoots.every((path) => typeof path === "string") ? input.mergeRoots as string[] : null;
      // Observation only: an exact destination root is valid input to the owned-root classifier.
      if (!mergeRoots || mergeRoots.some((path) => !isSubpath(resolve(to), resolve(path)))) { recordStepFailure(record, step.id, "conflicted", "invalid-config", { mergeRoots: input.mergeRoots }); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const fromBound = validateBoundDirectory(root, from, pendingIdentity(step, "fromIdentity", input.fromIdentity));
      const plannedDestinationIdentity = step.classification === "planned" && record.kind === "grove-rename" ? completedRenameDestinationIdentity(record) : null;
      const toBound = validateBoundDirectory(root, to, pendingIdentity(step, "toIdentity", plannedDestinationIdentity ?? input.toIdentity));
      if (!fromBound || !toBound) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { directoryBindingChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (fromBound.present && (!fromBound.identity.expectedPresent || fromBound.device !== fromBound.identity.device || fromBound.inode !== fromBound.identity.inode)) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { sourceIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (toBound.present && toBound.identity.expectedPresent && (toBound.device !== toBound.identity.device || toBound.inode !== toBound.identity.inode)) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { destinationIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const completedWorktreeRoots = record.steps.flatMap((candidate) => candidate.kind === "worktree-move" && candidate.classification === "completed" && typeof candidate.postState === "object" && candidate.postState !== null && typeof (candidate.postState as Record<string, unknown>).path === "string" ? [String((candidate.postState as Record<string, unknown>).path)] : []);
      try {
        if (fromBound.present) assertDirectoryContainsOnlyRoots(from, mergeRoots.map((path) => join(from, relative(to, path))), []);
        if (toBound.present) assertDirectoryContainsOnlyRoots(to, [...completedWorktreeRoots, ...mergeRoots], completedWorktreeRoots);
      } catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (!fromBound.present && toBound.present) {
        const completedMerge = toBound.identity.expectedPresent || (fromBound.identity.expectedPresent && toBound.device === fromBound.identity.device && toBound.inode === fromBound.identity.inode);
        if (!completedMerge) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { destinationIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { path: to, sourcePresent: false, observedAfterCrash: true }); completed.push(step.id); continue;
      }
      if (fromBound.present && toBound.present && !toBound.identity.expectedPresent) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { destinationIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      try {
        const preflightSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        const sourceGrove = typeof record.scope.grove === "string" ? record.scope.grove : undefined;
        const destinationGrove = typeof record.scope.newName === "string" ? record.scope.newName : sourceGrove;
        assertDestructiveMutationPath(preflightSnapshot, from, { allowObservedPaths: recordedWorktreePaths(record), ...(sourceGrove ? { groveName: sourceGrove } : {}) });
        assertDestructiveMutationPath(preflightSnapshot, to, { allowObservedPaths: completedWorktreeRoots, ...(destinationGrove ? { groveName: destinationGrove } : {}) });
      }
      catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      ensurePending(record, step, step.preState ?? { from, to });
      try {
        // Persisting the pending boundary is itself observable. Rebind both directories and
        // repeat the exact-content proof so a concurrent writer cannot enter through that gap.
        const currentFrom = validateBoundDirectory(root, from, pendingIdentity(step, "fromIdentity", input.fromIdentity));
        const currentTo = validateBoundDirectory(root, to, pendingIdentity(step, "toIdentity", plannedDestinationIdentity ?? input.toIdentity));
        if (!currentFrom || !currentTo || !currentFrom.present || currentFrom.device !== fromBound.device || currentFrom.inode !== fromBound.inode || currentTo.present !== toBound.present || (currentTo.present && (currentTo.device !== toBound.device || currentTo.inode !== toBound.inode))) throw new GroveError({ kind: "refused-conflict", what: `Cannot resume directory merge ${from}`, why: "the source or destination identity changed while the pending boundary was persisted", remedy: "Inspect the retained operation and reconcile explicitly." });
        assertDirectoryContainsOnlyRoots(from, mergeRoots.map((path) => join(from, relative(to, path))), []);
        if (currentTo.present) assertDirectoryContainsOnlyRoots(to, [...completedWorktreeRoots, ...mergeRoots], completedWorktreeRoots);
        const mutationSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        const sourceGrove = typeof record.scope.grove === "string" ? record.scope.grove : undefined;
        const destinationGrove = typeof record.scope.newName === "string" ? record.scope.newName : sourceGrove;
        assertDestructiveMutationPath(mutationSnapshot, from, { allowObservedPaths: recordedWorktreePaths(record), ...(sourceGrove ? { groveName: sourceGrove } : {}) });
        assertDestructiveMutationPath(mutationSnapshot, to, { allowObservedPaths: completedWorktreeRoots, ...(destinationGrove ? { groveName: destinationGrove } : {}) });
        assertRecordedLooseMove(from, recordedWorktreePaths(record), input.plannedLoose);
        mergeDirectoryForward(
          containedPath(root, from, "Cannot resume directory merge outside the workspace"),
          containedPath(root, to, "Cannot resume directory merge outside the workspace"),
        );
      }
      catch (error) { recordStepFailure(record, step.id, "conflicted", GroveError.is(error) ? "stale-plan" : "io-failed", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: GroveError.is(error) ? "stale-plan" : "io-failed" }; }
      recordCompleted(record, step.id, { path: to, sourcePresent: false, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "directory-remove") {
      const path = input.path;
      const consent = recordedConsent(input);
      const force = consent === "all";
      const target = input.targetIdentity;
      const recordedLoose = readRecordedLooseConsent(input);
      if (typeof path !== "string" || typeof target !== "object" || target === null || recordedLoose === null) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const identity = target as Record<string, unknown>;
      const identitySelector = typeof identity.selector === "object" && identity.selector !== null ? identity.selector as Record<string, unknown> : null;
      if (identity.role !== "grove-content" || typeof identitySelector?.grove !== "string" || identitySelector.grove !== record.scope.grove || typeof identity.relativePath !== "string" || typeof identity.canonicalPath !== "string" || typeof identity.expectedPresent !== "boolean" || (identity.device !== null && typeof identity.device !== "number") || (identity.inode !== null && typeof identity.inode !== "number")) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const workspace = loadWorkspaceAt(root);
      const snapshot = await observeWorkspace(workspace, git);
      const metadata = loadCentralGroveMetadata(root, identitySelector.grove);
      const metadataStep = record.steps.find((candidate) => candidate.kind === "central-metadata-remove");
      const recordedMetadataIdentity = metadataStep && typeof stepInput(metadataStep).targetIdentity === "object" ? stepInput(metadataStep).targetIdentity as { expectedPresent?: unknown } : null;
      if (!metadata && (record.kind !== "grove-delete" || recordedMetadataIdentity?.expectedPresent !== false)) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { metadataMissing: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const expectedPath = resolveLayoutTarget(snapshot.layout, metadata?.manifest.state === "archived" ? expandArchivePath(snapshot.layout, identitySelector.grove) : expandGrovePath(snapshot.layout, identitySelector.grove));
      const currentRelative = relative(resolve(root), resolve(expectedPath));
      const currentPresent = existsSync(expectedPath);
      const currentCanonical = currentPresent ? realpathSync(expectedPath) : resolve(expectedPath);
      if (identity.relativePath !== currentRelative || identity.canonicalPath !== currentCanonical || resolve(path) !== identity.canonicalPath) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedPath, currentRelative, currentCanonical }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (!currentPresent) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { present: false, observedAfterCrash: true }); completed.push(step.id); continue; }
      const currentIdentity = lstatSync(expectedPath);
      if (identity.expectedPresent !== true || identity.device !== currentIdentity.dev || identity.inode !== currentIdentity.ino) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedPresence: identity.expectedPresent, observedPresence: true, expectedDevice: identity.device, observedDevice: currentIdentity.dev, expectedInode: identity.inode, observedInode: currentIdentity.ino }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      // Same accounting as lifecycle's delete: exempting the whole `trees/` subtree assumed every
      // entry inside it is a worktree already removed, which nothing enforces. On the resume path
      // the operation's own steps name the exact worktrees, so use those.
      const removedWorktrees = new Set(record.steps
        .filter((candidate) => candidate.kind === "worktree-remove")
        .flatMap((candidate) => { const value = (candidate.input as { path?: unknown } | undefined)?.path; return typeof value === "string" ? [resolve(value)] : []; }));
      try { assertDestructiveMutationPath(snapshot, expectedPath, { allowObservedPaths: [...removedWorktrees], groveName: identitySelector.grove }); }
      catch (error) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      ensurePending(record, step, step.preState ?? { path: expectedPath, present: true });
      let discardedLoose: string[] = [];
      const recordedLabels = recordedLoose.entries.map(looseEntryLabel);
      try {
        const pointOfUseSnapshot = await observeWorkspace(loadWorkspaceAt(root), git);
        assertDestructiveMutationPath(pointOfUseSnapshot, expectedPath, { allowObservedPaths: [...removedWorktrees], groveName: identitySelector.grove });
        // FR-023: consent is the recorded per-path set. Every Tree step already ran, so anything at a
        // Tree path is new content. A legacy record's names cover those exact paths only.
        const structuralDirectories = structuralTreeSlotPaths(pointOfUseSnapshot.layout, identitySelector.grove, pointOfUseSnapshot.repositories.flatMap((repository) => repository.registration ? [repository.registration.name] : []));
        const current = inventoryLooseContent(expectedPath, [...removedWorktrees], { accountedPresent: "inventory", structuralDirectories });
        const currentLoose = current.entries.map(looseEntryLabel);
        const added = force ? unconsentedLooseEntries(recordedLoose, current.entries) : current.entries;
        if (current.incomplete.length || added.length) {
          const addedLoose = added.map(looseEntryLabel);
          const rerun = `grove delete ${identitySelector.grove}${consent === "all" ? " --allow-destructive-all" : consent === "ignored" ? " --allow-destructive-git-ignored" : ""}`;
          const why = current.incomplete.length
            ? `loose Grove content cannot be itemized completely: ${current.incomplete.map((gap) => `${gap.path} (${gap.problem})`).join("; ")}`
            : recordedLoose.legacy && force
              ? `this delete was recorded by an earlier Grove version that consented to loose content by top-level name only, which gives no consent for: ${addedLoose.join(", ")}`
              : `loose content is not in the recorded consent: ${addedLoose.join(", ")}`;
          const detail = { why, remedy: `No loose content was removed. Move anything to keep out of ${expectedPath}, then run \`grove reconcile --abandon ${record.id}\` and \`${rerun}\` to plan and consent from current content.` };
          const evidence = { recordedLoose: recordedLabels, currentLoose, addedLoose, ...(current.incomplete.length ? { looseInventoryIncomplete: current.incomplete } : {}), ...(recordedLoose.legacy ? { legacyLooseConsent: true } : {}), ...detail };
          recordStepFailure(record, step.id, "conflicted", "stale-plan", evidence);
          return { id: record.id, state: record.state, completed, problem: "stale-plan", evidence, detail };
        }
        discardedLoose = currentLoose;
        removeContainedDirectory(containedPath(root, expectedPath, `Cannot resume directory removal ${expectedPath}`));
      }
      catch (error) { const reason = GroveError.is(error) ? "stale-plan" : "io-failed"; recordStepFailure(record, step.id, "conflicted", reason, { error: String((error as Error).message ?? error) }); return { id: record.id, state: record.state, completed, problem: reason }; }
      recordCompleted(record, step.id, { present: false, resumed: true, recordedLoose: recordedLabels, discardedLoose }); completed.push(step.id); continue;
    }
    if (step.kind === "central-metadata-remove") {
      const path = input.path;
      const target = input.targetIdentity;
      const identity = typeof target === "object" && target !== null ? target as Record<string, unknown> : null;
      const selector = identity && typeof identity.selector === "object" && identity.selector !== null ? identity.selector as Record<string, unknown> : null;
      if (typeof path !== "string" || !identity || identity.role !== "grove-metadata" || typeof selector?.grove !== "string" || selector.grove !== record.scope.grove || typeof identity.relativePath !== "string" || typeof identity.canonicalPath !== "string" || typeof identity.expectedPresent !== "boolean" || (identity.device !== null && typeof identity.device !== "number") || (identity.inode !== null && typeof identity.inode !== "number")) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const expectedPath = centralGroveManifest(root, selector.grove);
      const present = existsSync(expectedPath);
      const canonicalPath = present ? realpathSync(expectedPath) : resolve(expectedPath);
      if (resolve(path) !== resolve(expectedPath) || identity.relativePath !== relative(resolve(root), resolve(expectedPath)) || identity.canonicalPath !== canonicalPath) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { metadataBindingChanged: true, expectedPath }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (present) {
        const stat = lstatSync(expectedPath);
        if (identity.expectedPresent !== true || identity.device !== stat.dev || identity.inode !== stat.ino) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { metadataIdentityChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      }
      ensurePending(record, step, step.preState ?? { path: expectedPath, present });
      try { if (present) removeContainedFile(containedPath(root, expectedPath, `Cannot resume metadata removal ${expectedPath}`)); }
      catch (error) { return metadataStepFailure(record, step, completed, error); }
      recordCompleted(record, step.id, { present: false, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "central-metadata-update") {
      const groveName = record.scope.grove;
      if (typeof groveName !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      try {
        if (record.kind === "new-grove") {
          const current = loadCentralGroveMetadata(root, groveName);
          if (current) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { revision: current.meta.rev, state: current.manifest.state, observedAfterCrash: true }); completed.push(step.id); continue; }
          const path = input.path;
          if (typeof path !== "string" || existsSync(path) && !readdirSync(path).every((name) => name === "trees")) throw new Error("empty-Grove destination changed");
          ensurePending(record, step, step.preState ?? { metadataAbsent: true, pathAbsent: !existsSync(path) });
          mkdirSync(path, { recursive: true });
          const meta = await saveGroveManifest(root, newGroveManifest(groveName));
          recordCompleted(record, step.id, { revision: meta.rev, path, resumed: true }); completed.push(step.id); continue;
        }
        if (record.kind === "tree-remove") {
          const current = loadCentralGroveMetadata(root, groveName);
          const selector = typeof input.selector === "object" && input.selector !== null ? input.selector as { repositoryId?: unknown; tree?: unknown } : step.selector;
          if (typeof selector.repositoryId !== "string" || typeof selector.tree !== "string") throw new Error("tree removal lacks a stable advisory selector");
          if (!current) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { metadataAbsent: true, observedAfterCrash: true }); completed.push(step.id); continue; }
          const retainedSettings = current.manifest.treeSettings.filter((entry) => entry.selector.repositoryId !== selector.repositoryId || entry.selector.tree !== selector.tree);
          const retainedOrder = current.manifest.treeOrder.filter((entry) => entry.repositoryId !== selector.repositoryId || entry.tree !== selector.tree);
          if (retainedSettings.length === current.manifest.treeSettings.length && retainedOrder.length === current.manifest.treeOrder.length) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { revision: current.meta.rev, forgotten: true, observedAfterCrash: true }); completed.push(step.id); continue; }
          ensurePending(record, step, step.preState ?? { revision: current.meta.rev, selector });
          const meta = await saveGroveManifest(root, { ...current.manifest, treeSettings: retainedSettings, treeOrder: retainedOrder }, current.meta);
          recordCompleted(record, step.id, { revision: meta.rev, forgotten: true, resumed: true }); completed.push(step.id); continue;
        }
        if (record.kind === "grove-archive") {
          const current = loadCentralGroveMetadata(root, groveName);
          if (current?.manifest.state === "archived" && current.manifest.archiveSnapshot) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { revision: current.meta.rev, state: "archived", observedAfterCrash: true }); completed.push(step.id); continue; }
          const recipes = record.steps.filter((candidate) => candidate.kind === "worktree-remove").map((candidate) => stepInput(candidate) as unknown as ArchiveRecipe);
          const contentMove = record.steps.find((candidate) => candidate.kind === "directory-move");
          const archivePath = contentMove ? stepInput(contentMove).to : null;
          if (recipes.some((recipe) => !recipe.selector || typeof recipe.commonGitDir !== "string") || (archivePath !== null && typeof archivePath !== "string")) throw new Error("archive operation lacks an exact recovery recipe");
          const workspace = loadWorkspaceAt(root);
          const manifest = current?.manifest ?? newGroveManifest(groveName);
          ensurePending(record, step, step.preState ?? { revision: current?.meta.rev ?? null, state: manifest.state });
          const meta = await saveGroveManifest(root, { ...manifest, state: "archived", archiveSnapshot: { version: 1, archivedAt: record.createdAt, looseContentPath: typeof archivePath === "string" && existsSync(archivePath) ? archivePath : null, layoutRevision: String(workspace.meta.rev), recipes } }, current?.meta);
          recordCompleted(record, step.id, { revision: meta.rev, state: "archived", resumed: true }); completed.push(step.id); continue;
        }
        if (record.kind === "grove-restore") {
          const current = loadCentralGroveMetadata(root, groveName);
          if (!current) throw new Error("archived Grove metadata is missing");
          if (current.manifest.state === "active" && current.manifest.archiveSnapshot === null) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { revision: current.meta.rev, state: "active", observedAfterCrash: true }); completed.push(step.id); continue; }
          ensurePending(record, step, step.preState ?? { revision: current.meta.rev, state: current.manifest.state });
          const meta = await saveGroveManifest(root, { ...current.manifest, state: "active", archiveSnapshot: null }, current.meta);
          recordCompleted(record, step.id, { revision: meta.rev, state: "active", resumed: true }); completed.push(step.id); continue;
        }
        if (record.kind === "grove-rename") {
          const oldName = input.oldName;
          const newName = input.newName;
          if (typeof oldName !== "string" || typeof newName !== "string") throw new Error("rename operation lacks exact names");
          const oldMetadata = loadCentralGroveMetadata(root, oldName);
          const newMetadata = loadCentralGroveMetadata(root, newName);
          if (newMetadata && oldMetadata && newMetadata.manifest.id !== oldMetadata.manifest.id) throw new Error("rename destination metadata belongs to another Grove");
          ensurePending(record, step, step.preState ?? { oldName, newName, observedAfterCrash: newMetadata !== null });
          const persisted = typeof input.manifest === "object" && input.manifest !== null ? input.manifest as GroveManifest : newGroveManifest(oldName);
          const source = newMetadata?.manifest ?? oldMetadata?.manifest ?? persisted;
          if (!newMetadata) { const contentStep = record.steps.find((candidate) => candidate.kind === "directory-move" || candidate.kind === "directory-merge"); await saveGroveManifest(root, { ...source, name: newName, archiveSnapshot: source.archiveSnapshot ? { ...source.archiveSnapshot, looseContentPath: source.archiveSnapshot.looseContentPath ? String(contentStep ? stepInput(contentStep).to : source.archiveSnapshot.looseContentPath) : null } : null }); }
          if (oldMetadata && oldMetadata.path !== newMetadata?.path && existsSync(oldMetadata.path)) removeContainedFile(containedPath(root, oldMetadata.path, `Cannot resume metadata rename ${oldMetadata.path}`));
          const finalMetadata = loadCentralGroveMetadata(root, newName)!;
          recordCompleted(record, step.id, { revision: finalMetadata.meta.rev, name: newName, resumed: true }); completed.push(step.id); continue;
        }
        throw new Error(`unsupported metadata operation ${record.kind}`);
      } catch (error) {
        return metadataStepFailure(record, step, completed, error);
      }
    }
    if (step.kind === "repository-init-bare" && record.kind === "repo-add") {
      const anchor = input.anchor;
      const trunk = input.trunk;
      if (typeof anchor !== "string" || typeof trunk !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const workspace = loadWorkspaceAt(root); const alias = record.scope.repositoryAlias; const layout = compileLayout(root, workspace.config.layout);
      if (typeof alias !== "string" || expandRepositoryPath(layout, alias) !== anchor) { recordStepFailure(record, step.id, "conflicted", "stale-plan"); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      resolveLayoutTarget(layout, anchor);
      if (existsSync(anchor)) {
        const bare = await git.tryRun(anchor, ["rev-parse", "--is-bare-repository"]);
        const head = await git.tryRun(anchor, ["symbolic-ref", "HEAD"]);
        if (bare.exitCode !== 0 || bare.stdout.trim() !== "true" || head.exitCode !== 0 || head.stdout.trim() !== `refs/heads/${trunk}`) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { pathOccupied: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { anchor, bare: true, head: `refs/heads/${trunk}`, observedAfterCrash: true }); completed.push(step.id); continue;
      }
      ensurePending(record, step, step.preState ?? { targetAbsent: true }); resolveLayoutTarget(layout, anchor);
      mkdirSync(dirname(anchor), { recursive: true });
      const initialized = await git.tryRun(root, ["init", "--bare", `--initial-branch=${trunk}`, "--", anchor]);
      if (initialized.exitCode !== 0) { const detail = repoAddGitFailureDetail(record, step, initialized.exitCode); recordStepFailure(record, step.id, existsSync(anchor) ? "conflicted" : "recoverable-intermediate", "git-failed", detail); return { id: record.id, state: record.state, completed, problem: "git-failed", detail }; }
      recordCompleted(record, step.id, { anchor, bare: true, head: `refs/heads/${trunk}`, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "remote-add" && record.kind === "repo-add") {
      const initial = record.steps.find((candidate) => candidate.kind === "repository-init-bare");
      const anchor = initial ? stepInput(initial).anchor : null;
      const initialPostState = typeof initial?.postState === "object" && initial.postState !== null ? initial.postState as Record<string, unknown> : null;
      const genesisProof = initialPostState?.defaultGitTemplate === true ? initialPostState.genesisProof : null;
      const name = input.name;
      const remote = typeof record.secret === "object" && record.secret !== null ? (record.secret as { remote?: unknown }).remote : null;
      if (typeof anchor !== "string" || typeof name !== "string" || typeof remote !== "string" || !existsSync(anchor)) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const existing = await git.tryRun(anchor, ["remote", "get-url", "--", name]);
      if (existing.exitCode === 0) {
        if (existing.stdout.trim() !== remote) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { remoteChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { remote: name, observedAfterCrash: true, anchorContentProof: captureAcquisitionRemoteProof(anchor, genesisProof) }); completed.push(step.id); continue;
      }
      ensurePending(record, step, step.preState ?? { remoteAbsent: true });
      const pristineBeforeRemote = matchesAcquisitionGenesis(anchor, genesisProof);
      const added = await git.tryRun(anchor, ["remote", "add", "--", name, remote]);
      if (added.exitCode !== 0) { const detail = repoAddGitFailureDetail(record, step, added.exitCode); recordStepFailure(record, step.id, "recoverable-intermediate", "git-failed", detail); return { id: record.id, state: record.state, completed, problem: "git-failed", detail }; }
      recordCompleted(record, step.id, { remote: name, resumed: true, anchorContentProof: pristineBeforeRemote ? captureAcquisitionRemoteProof(anchor, genesisProof) : null }); completed.push(step.id); continue;
    }
    if (step.kind === "fetch" && record.kind === "repo-add") {
      const initial = record.steps.find((candidate) => candidate.kind === "repository-init-bare");
      const trunkStep = record.steps.find((candidate) => candidate.kind === "worktree-add" && candidate.id === "initial-trunk");
      const anchor = initial ? stepInput(initial).anchor : null;
      const trunk = trunkStep ? stepInput(trunkStep).branch : null;
      const expectedRemoteOid = input.expectedRemoteOid;
      const expectedGeneration = input.generation;
      const remote = typeof record.secret === "object" && record.secret !== null ? (record.secret as { remote?: unknown }).remote : null;
      if (typeof anchor !== "string" || typeof trunk !== "string" || typeof expectedRemoteOid !== "string" || typeof expectedGeneration !== "string" || typeof remote !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      if (!existsSync(anchor)) {
        const detail = { why: "the managed repository store is missing", remedy: `Run \`grove reconcile --abandon ${record.id}\` to close this conflicted operation before retrying the repository add.` };
        recordStepFailure(record, step.id, "conflicted", "stale-plan", { storeMissing: true, ...detail });
        return { id: record.id, state: record.state, completed, problem: "stale-plan", detail };
      }
      // Resolve the store first, then the workspace root immediately before its ls-remote. Both
      // Git contexts can have different conditional includes, and either config may change while
      // the local resolution of the other runs.
      let refusal: { why: string; remedy: string } | null;
      try { refusal = (await git.fetchDestinationRefusal(anchor, "origin")) ?? (await git.fetchDestinationRefusal(root, remote)); }
      catch {
        const detail = { why: "Git could not resolve the remote destination in the repository context", remedy: `Repair the repository's Git config, then run \`grove reconcile --operation ${record.id}\` again, or explicitly close this failed acquisition with \`grove reconcile --abandon ${record.id}\`.` };
        recordStepFailure(record, step.id, "recoverable-intermediate", "git-failed", { remoteResolutionFailed: true, ...detail });
        return { id: record.id, state: record.state, completed, problem: "git-failed", detail };
      }
      if (refusal) { recordStepFailure(record, step.id, "conflicted", "refused-policy", refusal); return { id: record.id, state: record.state, completed, problem: "refused-policy" }; }
      const current = await git.inspectRemote(root, remote, null);
      if (current.advertisementGeneration !== expectedGeneration) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedGeneration, actualGeneration: current.advertisementGeneration }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const tracking = await git.tryRun(anchor, ["rev-parse", "--verify", `refs/remotes/origin/${trunk}^{commit}`]);
      const local = await git.tryRun(anchor, ["rev-parse", "--verify", `refs/heads/${trunk}^{commit}`]);
      if (tracking.exitCode === 0 && local.exitCode === 0 && tracking.stdout.trim() === expectedRemoteOid && local.stdout.trim() === expectedRemoteOid) {
        ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { remote: "origin", trunk, oid: expectedRemoteOid, observedAfterCrash: true }); completed.push(step.id); continue;
      }
      // The root-context inspection above is itself a network call. Git config can change while
      // it runs, so resolve the store destination again just before the store's fetch.
      let fetchRefusal: { why: string; remedy: string } | null;
      try { fetchRefusal = await git.fetchDestinationRefusal(anchor, "origin"); }
      catch {
        const detail = { why: "Git could not resolve the remote destination in the repository context", remedy: `Repair the repository's Git config, then run \`grove reconcile --operation ${record.id}\` again, or explicitly close this failed acquisition with \`grove reconcile --abandon ${record.id}\`.` };
        recordStepFailure(record, step.id, "recoverable-intermediate", "git-failed", { remoteResolutionFailed: true, ...detail });
        return { id: record.id, state: record.state, completed, problem: "git-failed", detail };
      }
      if (fetchRefusal) { recordStepFailure(record, step.id, "conflicted", "refused-policy", fetchRefusal); return { id: record.id, state: record.state, completed, problem: "refused-policy" }; }
      ensurePending(record, step, step.preState ?? { generation: expectedGeneration, expectedRemoteOid });
      const fetched = await git.tryRun(anchor, ["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
      if (fetched.exitCode !== 0) { const detail = repoAddGitFailureDetail(record, step, fetched.exitCode); recordStepFailure(record, step.id, "recoverable-intermediate", "git-failed", detail); return { id: record.id, state: record.state, completed, problem: "git-failed", detail }; }
      const observed = await git.tryRun(anchor, ["rev-parse", "--verify", `refs/remotes/origin/${trunk}^{commit}`]);
      if (observed.exitCode !== 0 || observed.stdout.trim() !== expectedRemoteOid) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { observedOid: observed.stdout.trim() || null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      await git.run(anchor, ["update-ref", `refs/heads/${trunk}`, expectedRemoteOid], "Cannot recreate the planned local trunk ref");
      await git.run(anchor, ["symbolic-ref", "HEAD", `refs/heads/${trunk}`], "Cannot restore the planned bare HEAD");
      recordCompleted(record, step.id, { remote: "origin", trunk, oid: expectedRemoteOid, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "worktree-add" && record.kind === "repo-add" && step.id === "initial-trunk") {
      const initial = record.steps.find((candidate) => candidate.kind === "repository-init-bare");
      const anchor = initial ? stepInput(initial).anchor : null;
      const path = input.path;
      const branch = input.branch;
      const expectedRemoteOid = input.expectedRemoteOid;
      const unborn = input.unborn;
      if (typeof anchor !== "string" || typeof path !== "string" || typeof branch !== "string" || (expectedRemoteOid !== null && typeof expectedRemoteOid !== "string") || typeof unborn !== "boolean" || !existsSync(anchor)) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const workspace = loadWorkspaceAt(root); const alias = record.scope.repositoryAlias; const layout = compileLayout(root, workspace.config.layout);
      const trunkMatch = typeof path === "string" ? matchLayoutPath(layout, path) : null;
      if (typeof alias !== "string" || expandRepositoryPath(layout, alias) !== anchor || trunkMatch?.role !== "trunk" || !trunkMatch.trunk || !isValidTrunkAllocation(trunkMatch.trunk, branch, alias, Buffer.from(`refs/heads/${branch}`))) { recordStepFailure(record, step.id, "conflicted", "stale-plan"); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      resolveLayoutTarget(layout, anchor); resolveLayoutTarget(layout, path);
      if (existsSync(path)) {
        try {
          const identity = await git.inspectRepository(path);
          const head = await git.currentHead(path);
          const status = await porcelainStatus(git, path);
          const upstream = await git.upstream(path);
          const valid = identity.commonGitDir.canonicalUtf8 === (await git.inspectRepository(anchor)).commonGitDir.canonicalUtf8 && !status.problem && status.changes.length === 0 && head.branch?.utf8 === `refs/heads/${branch}` && (unborn ? head.unborn : head.oid === expectedRemoteOid && upstream?.utf8 === `refs/remotes/origin/${branch}`);
          if (valid) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { path, branch: `refs/heads/${branch}`, oid: head.oid, unborn: head.unborn, observedAfterCrash: true }); completed.push(step.id); continue; }
        } catch { /* occupied path is classified below */ }
        recordStepFailure(record, step.id, "conflicted", "stale-plan", { pathOccupied: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" };
      }
      ensurePending(record, step, step.preState ?? { pathAbsent: true, branch, oid: expectedRemoteOid, unborn });
      resolveLayoutTarget(layout, path);
      mkdirSync(dirname(path), { recursive: true });
      const added = await git.tryRun(anchor, unborn ? ["worktree", "add", "--orphan", "-b", branch, "--", path] : ["worktree", "add", "--", path, branch]);
      if (added.exitCode !== 0) { const detail = repoAddGitFailureDetail(record, step, added.exitCode); recordStepFailure(record, step.id, existsSync(path) ? "conflicted" : "recoverable-intermediate", "git-failed", detail); return { id: record.id, state: record.state, completed, problem: "git-failed", detail }; }
      if (!unborn) {
        const configured = await git.tryRun(path, ["branch", "--set-upstream-to", `origin/${branch}`, branch]);
        if (configured.exitCode !== 0) { const detail = repoAddGitFailureDetail(record, step, configured.exitCode); recordStepFailure(record, step.id, "recoverable-intermediate", "git-failed", { path, ...detail }); return { id: record.id, state: record.state, completed, problem: "git-failed", detail }; }
      }
      const identity = await git.inspectRepository(path).catch(() => null);
      const anchorIdentity = await git.inspectRepository(anchor).catch(() => null);
      const head = await git.currentHead(path).catch(() => null);
      const status = await porcelainStatus(git, path);
      const upstream = await git.upstream(path).catch(() => null);
      const valid = identity !== null && anchorIdentity !== null && identity.commonGitDir.canonicalUtf8 === anchorIdentity.commonGitDir.canonicalUtf8 && head !== null && !status.problem && status.changes.length === 0 && head.branch?.utf8 === `refs/heads/${branch}` && (unborn ? head.unborn : head.oid === expectedRemoteOid && upstream?.utf8 === `refs/remotes/origin/${branch}`);
      if (!valid) { recordStepFailure(record, step.id, "recoverable-intermediate", "stale-plan", { identity: identity?.commonGitDir.canonicalUtf8 ?? null, expectedIdentity: anchorIdentity?.commonGitDir.canonicalUtf8 ?? null, head, status, upstream: upstream?.utf8 ?? null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      recordCompleted(record, step.id, { path, branch: `refs/heads/${branch}`, oid: head.oid, unborn: head.unborn, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "restore-worktree" && record.kind === "grove-restore") {
      const repositoryId = step.selector.repositoryId;
      const path = input.path;
      const branch = input.branch;
      const oid = input.oid;
      // Ruling ②. `detach` is written explicitly by lifecycle.ts; a record written by an earlier
      // binary has no such key, and for those the old rule (branch === null means detached) is
      // exactly right — so the fallback is faithful rather than a guess.
      const detach = input.detach === true || (input.detach === undefined && input.branch === null);
      const commonGitDir = input.commonGitDir;
      if (typeof repositoryId !== "string" || typeof path !== "string" || (branch !== null && typeof branch !== "string") || typeof oid !== "string" || typeof commonGitDir !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const workspace = loadWorkspaceAt(root);
      const snapshot = await observeWorkspace(workspace, git);
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
      const registration = repository?.registration;
      const grove = step.selector.grove;
      const tree = step.selector.tree;
      if (!repository || !registration || repository.problem || repository.commonGitDir !== commonGitDir || typeof grove !== "string" || typeof tree !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const expectedPath = expandTreePath(snapshot.layout, grove, tree, registration.name);
      if (expectedPath !== path) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedPath, path }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      resolveLayoutTarget(snapshot.layout, path);
      const observed = repository.worktrees.find((worktree) => worktree.path.utf8 === path);
      if (observed) {
        // GATE 5 (no equivalent in lifecycle.ts). When detaching, the OID is the identity; the
        // branch must be null, not equal to the recorded branch.
        const expectedBranch = detach ? null : branch;
        if (observed.headOid === oid && (observed.branch?.utf8 ?? null) === expectedBranch && observed.dirty === false) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { path, branch, headOid: oid, observedAfterCrash: true }); completed.push(step.id); continue; }
        recordStepFailure(record, step.id, "conflicted", "stale-plan", { observedHead: observed.headOid, observedBranch: observed.branch?.utf8 ?? null, dirty: observed.dirty }); return { id: record.id, state: record.state, completed, problem: "stale-plan" };
      }
      if (existsSync(path)) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { pathOccupied: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      // GATE 6. A detached resume needs the OBJECT to exist; demanding the branch still point at it
      // is the very condition that made the branch move fatal.
      if (detach) {
        const object = await git.tryRun(commonGitDir, ["cat-file", "-e", `${oid}^{commit}`]);
        if (object.exitCode !== 0) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expected: oid, observed: null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      } else if (branch !== null) {
        const ref = await git.tryRun(commonGitDir, ["rev-parse", "--verify", `${branch}^{commit}`]);
        if (ref.exitCode !== 0 || ref.stdout.trim().toLowerCase() !== oid.toLowerCase()) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expected: oid, observed: ref.stdout.trim() || null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      }
      ensurePending(record, step, step.preState ?? { pathAbsent: true, branch, oid });
      resolveLayoutTarget(snapshot.layout, path);
      mkdirSync(dirname(path), { recursive: true });
      // GATE 7.
      const added = await git.tryRun(commonGitDir, detach ? ["worktree", "add", "--detach", "--", path, oid] : ["worktree", "add", "--", path, String(branch).replace(/^refs\/heads\//, "")]);
      if (added.exitCode !== 0) { recordStepFailure(record, step.id, "recoverable-intermediate", "git-failed", { stderr: added.stderr.trim().split("\n")[0] }); return { id: record.id, state: record.state, completed, problem: "git-failed" }; }
      const identity = await git.inspectRepository(path).catch(() => null);
      const head = await git.currentHead(path).catch(() => null);
      const status = await porcelainStatus(git, path);
      // GATE 8 — the same trap as gate 4, in the resume path.
      const headBranchOk = detach ? (head?.branch?.utf8 ?? null) === null : (head?.branch?.utf8 ?? null) === branch;
      if (!identity || identity.commonGitDir.canonicalUtf8 !== repository.commonGitDir || !head || head.oid !== oid || !headBranchOk || status.problem || status.changes.length > 0) { recordStepFailure(record, step.id, "recoverable-intermediate", "stale-plan", { identity: identity?.commonGitDir.canonicalUtf8 ?? null, head, status }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      recordCompleted(record, step.id, { path, branch, headOid: oid, detached: detach, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "worktree-add") {
      const repositoryId = step.selector.repositoryId;
      const workspace = loadWorkspaceAt(root);
      const registration = workspace.config.repositories.find((repo) => repo.id === repositoryId);
      if (!registration) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      if (record.kind === "trunk-add" && registration.location.kind === "linked") {
        recordStepFailure(record, step.id, "conflicted", "refused-policy", { location: "linked" });
        return { id: record.id, state: record.state, completed, problem: "refused-policy" };
      }
      const snapshot = await observeWorkspace(workspace, git);
      const repository = snapshot.repositories.find((repo) => repo.registration?.id === repositoryId);
      const path = input.path;
      const commonGitDir = input.commonGitDir;
      const branch = input.branch;
      const oid = input.oid;
      const mode = input.mode;
      const sourceRevision = input.sourceRevision ?? null;
      if (!repository || repository.problem || typeof commonGitDir !== "string" || repository.commonGitDir !== commonGitDir || typeof path !== "string" || typeof branch !== "string" || typeof oid !== "string" || typeof mode !== "string" || (sourceRevision !== null && typeof sourceRevision !== "string")) { const reason = repository && typeof commonGitDir === "string" && repository.commonGitDir !== commonGitDir ? "stale-plan" : "invalid-config"; recordStepFailure(record, step.id, "conflicted", reason, { expectedCommonGitDir: commonGitDir, observedCommonGitDir: repository?.commonGitDir ?? null }); return { id: record.id, state: record.state, completed, problem: reason }; }
      const trunkMatch = record.kind === "trunk-add" ? matchLayoutPath(snapshot.layout, path) : null;
      const expectedPath = record.kind === "trunk-add"
        ? trunkMatch?.role === "trunk" && trunkMatch.trunk && isValidTrunkAllocation(trunkMatch.trunk, branch, registration.name, Buffer.from(`refs/heads/${branch}`)) ? path : null
        : typeof step.selector.grove === "string" && typeof step.selector.tree === "string"
          ? expandTreePath(snapshot.layout, step.selector.grove, step.selector.tree, registration.name)
          : null;
      if (expectedPath !== path) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedPath, path }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      resolveLayoutTarget(snapshot.layout, path);
      if (typeof sourceRevision === "string") { const source = await git.tryRun(repository.commonGitDir, ["rev-parse", "--verify", "--end-of-options", `${sourceRevision}^{commit}`]); if (source.exitCode !== 0 || source.stdout.trim().toLowerCase() !== oid) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { sourceRevision, expectedOid: oid, observedOid: source.stdout.trim() || null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; } }
      const observed = repository.worktrees.find((worktree) => worktree.path.utf8 === path);
      if (observed) {
        if (observed.headOid === oid && observed.branch?.utf8 === `refs/heads/${branch}` && observed.dirty === false) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { path, branch, headOid: oid, observedAfterCrash: true }); completed.push(step.id); continue; }
        recordStepFailure(record, step.id, "conflicted", "stale-plan", { observedHead: observed.headOid, observedBranch: observed.branch?.utf8 ?? null, dirty: observed.dirty });
        return { id: record.id, state: record.state, completed, problem: "stale-plan" };
      }
      if (existsSync(path)) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { pathOccupied: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const branchOid = await git.tryRun(repository.commonGitDir, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
      const branchExists = branchOid.exitCode === 0;
      if (branchExists && branchOid.stdout.trim().toLowerCase() !== oid) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { branchOid: branchOid.stdout.trim() }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      if (!branchExists && mode === "existing") { recordStepFailure(record, step.id, "conflicted", "stale-plan", { branchMissing: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      ensurePending(record, step, step.preState ?? { pathAbsent: true, branch, oid, mode });
      resolveLayoutTarget(snapshot.layout, path);
      mkdirSync(dirname(path), { recursive: true });
      const add = await git.tryRun(repository.commonGitDir, branchExists ? ["worktree", "add", "--", path, branch] : ["worktree", "add", "-b", branch, "--", path, oid]);
      if (add.exitCode !== 0) { recordStepFailure(record, step.id, "conflicted", "git-failed", { stderr: add.stderr.trim().split("\n")[0] }); return { id: record.id, state: record.state, completed, problem: "git-failed" }; }
      const addedIdentity = await git.inspectRepository(path).catch(() => null);
      const addedHead = await git.currentHead(path).catch(() => null);
      const addedStatus = await porcelainStatus(git, path);
      if (!addedIdentity || addedIdentity.commonGitDir.canonicalUtf8 !== repository.commonGitDir || !addedHead || addedHead.oid !== oid || addedHead.branch?.utf8 !== `refs/heads/${branch}` || addedStatus.problem || addedStatus.changes.length > 0) { recordStepFailure(record, step.id, "recoverable-intermediate", "stale-plan", { identity: addedIdentity?.commonGitDir.canonicalUtf8 ?? null, head: addedHead, status: addedStatus }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      recordCompleted(record, step.id, { path, branch, headOid: oid, resumed: true });
      completed.push(step.id);
      continue;
    }
    if (step.kind === "set-upstream") {
      const repositoryId = step.selector.repositoryId;
      const path = step.selector.path;
      const commonGitDir = input.commonGitDir;
      const branch = input.branch;
      const upstream = input.upstream;
      const oid = input.oid;
      const upstreamOid = input.upstreamOid ?? oid;
      if (typeof repositoryId !== "string" || typeof path !== "string" || typeof commonGitDir !== "string" || typeof branch !== "string" || typeof upstream !== "string" || typeof oid !== "string" || typeof upstreamOid !== "string") { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const workspace = loadWorkspaceAt(root);
      const registration = workspace.config.repositories.find((candidate) => candidate.id === repositoryId);
      if (record.kind === "trunk-add" && registration?.location.kind === "linked") { recordStepFailure(record, step.id, "conflicted", "refused-policy", { location: "linked" }); return { id: record.id, state: record.state, completed, problem: "refused-policy" }; }
      const snapshot = await observeWorkspace(workspace, git);
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
      const identity = await git.inspectRepository(path).catch(() => null);
      if (!registration || !repository || repository.problem || repository.commonGitDir !== commonGitDir || identity?.commonGitDir.canonicalUtf8 !== commonGitDir) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedCommonGitDir: commonGitDir, observedCommonGitDir: repository?.commonGitDir ?? identity?.commonGitDir.canonicalUtf8 ?? null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const head = await git.currentHead(path).catch(() => null);
      const currentUpstreamOid = await git.tryRun(path, ["rev-parse", "--verify", "--end-of-options", `${upstream}^{commit}`]);
      if (!head || head.oid !== oid || currentUpstreamOid.exitCode !== 0 || currentUpstreamOid.stdout.trim().toLowerCase() !== upstreamOid) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { headOid: head?.oid ?? null, upstreamOid: currentUpstreamOid.stdout.trim() || null }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const current = await git.upstream(path);
      if (current?.utf8 === upstream) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { branch, upstream, observedAfterCrash: true }); completed.push(step.id); continue; }
      ensurePending(record, step, step.preState ?? { upstream: current?.utf8 ?? null });
      const configured = await git.tryRun(path, ["branch", "--set-upstream-to", upstream.replace(/^refs\/remotes\//, ""), branch]);
      if (configured.exitCode !== 0) { recordStepFailure(record, step.id, "conflicted", "git-failed"); return { id: record.id, state: record.state, completed, problem: "git-failed" }; }
      recordCompleted(record, step.id, { branch, upstream, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "workspace-config-update" && record.kind === "repo-add") {
      const workspace = loadWorkspaceAt(root);
      const initial = record.steps.find((candidate) => candidate.kind === "repository-init-bare");
      const trunkStep = record.steps.find((candidate) => candidate.kind === "worktree-add" && candidate.id === "initial-trunk");
      const destination = initial ? stepInput(initial).anchor : null;
      const trunk = initial ? stepInput(initial).trunk : null;
      const trunkPath = trunkStep ? stepInput(trunkStep).path : null;
      const expectedRevision = input.expectedRevision;
      const alias = record.scope.repositoryAlias;
      const repositoryId = record.scope.repositoryId;
      const layout = compileLayout(root, workspace.config.layout);
      const trunkMatch = typeof trunkPath === "string" ? matchLayoutPath(layout, trunkPath) : null;
      if (typeof alias !== "string" || typeof repositoryId !== "string" || typeof destination !== "string" || typeof trunk !== "string" || typeof trunkPath !== "string" || !Number.isSafeInteger(expectedRevision) || expandRepositoryPath(layout, alias) !== destination || trunkMatch?.role !== "trunk" || !existsSync(destination) || !existsSync(trunkPath)) { recordStepFailure(record, step.id, "conflicted", "stale-plan"); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const bare = await git.tryRun(destination, ["rev-parse", "--is-bare-repository"]);
      const trunkIdentity = await git.inspectRepository(trunkPath).catch(() => null);
      const anchorIdentity = await git.inspectRepository(destination).catch(() => null);
      if (bare.stdout.trim() !== "true" || !trunkIdentity || !anchorIdentity || trunkIdentity.commonGitDir.canonicalUtf8 !== anchorIdentity.commonGitDir.canonicalUtf8) { recordStepFailure(record, step.id, "conflicted", "stale-plan"); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const observed = await observeWorkspace(workspace, git);
      const conflicting = workspace.config.repositories.find((repo) => repo.id !== repositoryId && (caseFoldKey(repo.name) === caseFoldKey(alias) || (repo.location.kind === "managed" && expandRepositoryPath(layout, repo.name) === destination))) ?? observed.repositories.find((repo) => repo.registration?.id !== repositoryId && repo.worktrees.some((worktree) => worktree.path.utf8 === trunkPath))?.registration;
      if (conflicting) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { conflictingRepositoryId: conflicting.id }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      const existing = workspace.config.repositories.find((repo) => repo.id === repositoryId);
      if (existing) {
        if (existing.location.kind !== "managed" || existing.name !== alias || existing.trunk !== trunk) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { registrationChanged: true }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
        ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { repositoryId: existing.id, observedAfterCrash: true }); completed.push(step.id); continue;
      }
      const registration: RepositoryEntry = { id: repositoryId, name: alias, location: { kind: "managed" }, remote: "origin", trunk };
      ensurePending(record, step, step.preState ?? { revision: workspace.meta.rev, repositoryAbsent: true });
      const meta = await saveWorkspace(workspace, { ...workspace.config, repositories: [...workspace.config.repositories, registration] });
      recordCompleted(record, step.id, { revision: meta.rev, repositoryId: registration.id, resumed: true }); completed.push(step.id); continue;
    }
    if (step.kind === "workspace-config-update" && (record.kind === "repo-link" || record.kind === "repo-remove")) {
      const workspace = loadWorkspaceAt(root);
      const repositoryId = record.scope.repositoryId;
      const expectedRevision = input.expectedRevision;
      if (typeof repositoryId !== "string" || !Number.isSafeInteger(expectedRevision)) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
      const existing = workspace.config.repositories.find((repository) => repository.id === repositoryId);
      if ((record.kind === "repo-link" && existing) || (record.kind === "repo-remove" && !existing)) { ensurePending(record, step, step.preState ?? { observedAfterCrash: true }); recordCompleted(record, step.id, { repositoryId, observedAfterCrash: true }); completed.push(step.id); continue; }
      if (workspace.meta.rev !== expectedRevision) { recordStepFailure(record, step.id, "conflicted", "stale-plan", { expectedRevision, actualRevision: workspace.meta.rev }); return { id: record.id, state: record.state, completed, problem: "stale-plan" }; }
      ensurePending(record, step, step.preState ?? { revision: workspace.meta.rev });
      if (record.kind === "repo-link") {
        const registration = input.registration as RepositoryEntry | undefined;
        // The record is an UNCHECKED cast from disk: a pre-fix or tampered repo-link record still
        // carries an option-like remote, and resuming it would write that value into the config.
        const remoteInvalid = registration?.remote !== null && (typeof registration?.remote !== "string" || checkRemoteName(registration.remote) !== null);
        if (!registration || registration.id !== repositoryId || typeof registration.name !== "string" || remoteInvalid) { recordStepFailure(record, step.id, "conflicted", "invalid-config"); return { id: record.id, state: record.state, completed, problem: "invalid-config" }; }
        const meta = await saveWorkspace(workspace, { ...workspace.config, repositories: [...workspace.config.repositories, registration] });
        recordCompleted(record, step.id, { revision: meta.rev, repositoryId, resumed: true });
      } else {
        const meta = await saveWorkspace(workspace, { ...workspace.config, repositories: workspace.config.repositories.filter((repository) => repository.id !== repositoryId) });
        recordCompleted(record, step.id, { revision: meta.rev, repositoryId, resumed: true });
      }
      completed.push(step.id); continue;
    }
    recordStepFailure(record, step.id, "conflicted", "unsupported-step", { kind: step.kind });
    return { id: record.id, state: record.state, completed, problem: "stale-plan" };
  }
  return { id: record.id, state: record.state, completed, problem: null };
}

async function reconcileHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const selectedModes = [parsed.values.operation !== undefined, parsed.values["audit-only"], parsed.values.abandon !== undefined].filter(Boolean).length;
  if (selectedModes > 1) throw new GroveError({ kind: "invalid-input", what: "reconcile modes are mutually exclusive", why: "--operation, --audit-only, and --abandon cannot be combined", remedy: "Choose exactly one recovery mode." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const git = new Git(createGitRunner());
  const resumed: RecoveryResult[] = [];
  const abandoned: string[] = [];
  const removedAnchors: string[] = [];
  const retainedAnchors: string[] = [];
  const survivingArtifacts: AcquisitionArtifact[] = [];
  if (parsed.values.abandon) {
    const operation = findOperation(ws.root, parsed.values.abandon);
    if (!operation) throw new GroveError({ kind: "invalid-input", what: `No operation "${parsed.values.abandon}"`, why: "no exact durable record exists", remedy: "Run `grove reconcile` to list pending work." });
    if (!canAbandonOperation(operation)) abandonOperation(operation);
    // Decision B4. Remove the bare repository a FAILED acquisition left behind — an explicit user
    // action against a recorded target, not inference. Anything no record covers is reported by
    // `doctor`, never auto-removed: Principle IV forbids inferred cleanup.
    //
    // ORDER IS LOad-BEARING. This ran BEFORE `abandonOperation` and fired for any record of kind
    // `repo-add`, so abandoning a COMPLETED acquisition deleted a live bare repository — every ref
    // and object — and then exited 5 saying it had done nothing. `repo remove` is documented
    // unregister-only ("all Git state remains"), so that is a reachable, ordinary sequence:
    // repo add -> repo remove -> reconcile --abandon <that id>. Abandon eligibility must be
    // established FIRST, and the record must be a failure, not merely an acquisition.
    let anchorCleanup: { anchor: string; kind: "symlink" | "directory"; proof?: unknown; genesis?: unknown } | null = null;
    if (operation.kind === "repo-add") {
      const bare = operation.steps.find((step) => step.kind === "repository-init-bare");
      const anchor = (bare?.input as { anchor?: unknown } | undefined)?.anchor;
      const registered = ws.config.repositories.some((repository) => repository.location.kind === "managed"
        ? expandRepositoryPath(compileLayout(ws.root, ws.config.layout), repository.name) === anchor
        : repository.location.commonGitDir === anchor);
      // The path must be EXACTLY the repository-role path this operation's own alias expands to —
      // not merely "somewhere inside the workspace". `isSubpath(p, p)` is true, so the weaker
      // containment test would authorise `rm -rf` on the workspace root itself.
      const alias = operation.targets.find((target) => typeof target.selector.repositoryAlias === "string")?.selector.repositoryAlias;
      const expected = typeof alias === "string" ? expandRepositoryPath(compileLayout(ws.root, ws.config.layout), alias) : null;
      if (typeof anchor === "string"
        && !registered
        && expected !== null
        && resolve(anchor) === resolve(expected)
        && resolve(anchor) !== resolve(ws.root)
        && isStrictSubpath(resolve(ws.root), resolve(anchor))) {
        let anchorStat: ReturnType<typeof lstatSync> | null = null;
        try { anchorStat = lstatSync(anchor); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (anchorStat?.isSymbolicLink() && operation.state === "conflicted") {
          // Unlinking the entry preserves the target and retains the prior alias-reuse contract.
          anchorCleanup = { anchor, kind: "symlink" };
        } else if (anchorStat?.isSymbolicLink()) {
          throw new GroveError({ kind: "refused-conflict", what: `Cannot abandon repository acquisition ${operation.id}`, why: "a symbolic link replaced the recorded repository anchor", remedy: "Move the replacement link aside, then retry abandonment.", detail: { reason: "stale-plan", anchor } });
        } else if (anchorStat?.isDirectory()) {
          const completedIdentity = typeof bare?.postState === "object" && bare.postState !== null
            ? bare.postState as Record<string, unknown>
            : null;
          const remoteStep = operation.steps.find((step) => step.kind === "remote-add");
          const remotePostState = typeof remoteStep?.postState === "object" && remoteStep.postState !== null
            ? remoteStep.postState as Record<string, unknown>
            : null;
          const proof = completedIdentity?.defaultGitTemplate === true ? remotePostState?.anchorContentProof : null;
          const genesis = completedIdentity?.defaultGitTemplate === true ? completedIdentity.genesisProof : null;
          const recordedDevice = typeof completedIdentity?.device === "number" ? completedIdentity.device : null;
          const recordedInode = typeof completedIdentity?.inode === "number" ? completedIdentity.inode : null;
          if (!isGitDirectory(anchor)) throw new GroveError({
            kind: "refused-conflict",
            what: `Cannot remove failed repository anchor ${anchor}`,
            why: "the recorded path is now a user directory rather than a bare Git repository",
            remedy: "Move the replacement directory aside, then abandon the operation again.",
            detail: { reason: "stale-plan", anchor },
          });
          if (recordedDevice !== null && recordedInode !== null && (anchorStat.dev !== recordedDevice || anchorStat.ino !== recordedInode)) throw new GroveError({
            kind: "refused-conflict",
            what: `Cannot remove failed repository anchor ${anchor}`,
            why: "the bare repository directory identity changed after Grove created it",
            remedy: "Inspect the replacement and remove it explicitly if appropriate.",
            detail: { reason: "stale-plan", anchor, expected: { device: recordedDevice, inode: recordedInode }, observed: { device: anchorStat.dev, inode: anchorStat.ino } },
          });
          if (recordedDevice !== null && recordedInode !== null && await disposableAcquisitionAnchor(anchor, git, proof, genesis)) {
            anchorCleanup = { anchor, kind: "directory", proof, genesis };
          } else {
            retainedAnchors.push(anchor);
            survivingArtifacts.push(...await retainedAcquisitionArtifacts(anchor, git));
          }
        }
      }
    }
    if (anchorCleanup?.kind === "symlink") {
      removeContainedSymbolicLink(
        containedParentPath(ws.root, dirname(anchorCleanup.anchor), `Cannot abandon repository acquisition ${operation.id}`),
        basename(anchorCleanup.anchor),
      );
      removedAnchors.push(anchorCleanup.anchor);
    } else if (anchorCleanup?.kind === "directory") {
      const bare = operation.steps.find((step) => step.kind === "repository-init-bare");
      const completedIdentity = typeof bare?.postState === "object" && bare.postState !== null ? bare.postState as Record<string, unknown> : null;
      const recordedDevice = typeof completedIdentity?.device === "number" ? completedIdentity.device : null;
      const recordedInode = typeof completedIdentity?.inode === "number" ? completedIdentity.inode : null;
      const current = lstatSync(anchorCleanup.anchor);
      if (!current.isDirectory() || !isGitDirectory(anchorCleanup.anchor) || recordedDevice === null || recordedInode === null || current.dev !== recordedDevice || current.ino !== recordedInode || !await disposableAcquisitionAnchor(anchorCleanup.anchor, git, anchorCleanup.proof, anchorCleanup.genesis)) throw new GroveError({
        kind: "refused-conflict",
        what: `Cannot remove failed repository anchor ${anchorCleanup.anchor}`,
        why: "the anchor changed again before cleanup",
        remedy: "Inspect the replacement and retry abandon only after restoring the recorded bare repository anchor.",
        detail: { reason: "stale-plan", anchor: anchorCleanup.anchor },
      });
      removeContainedDirectory(containedPath(ws.root, anchorCleanup.anchor, `Cannot abandon repository acquisition ${operation.id}`));
      removedAnchors.push(anchorCleanup.anchor);
    }
    abandonOperation(operation); abandoned.push(operation.id);
  } else if (!parsed.values["audit-only"]) {
    const selected = parsed.values.operation ? [findOperation(ws.root, parsed.values.operation)].filter((value): value is OperationRecord => value !== null) : pendingOperations(ws.root);
    if (parsed.values.operation && selected.length === 0) throw new GroveError({ kind: "invalid-input", what: `No operation "${parsed.values.operation}"`, why: "no exact durable record exists", remedy: "Run `grove reconcile` to list pending work." });
    for (const operation of selected) {
      if (operation.kind === "sync-attempt") {
        closeInterruptedSyncAttempt(operation);
        resumed.push({ id: operation.id, state: "interrupted-observation", completed: [], problem: null });
      } else {
        resumed.push(await withOperationTargetLocks(ws.root, operation.targetLocks, `reconcile-${operation.id}`, async () => {
          assertTargetsAvailable(ws.root, operation.targetLocks, operation.id);
          const completedBefore = new Set(operation.steps.filter((step) => step.classification === "completed").map((step) => step.id));
          let recovery: RecoveryResult;
          try {
            recovery = await resumeOperation(ws.root, operation, git);
          } catch (error) {
            if (!GroveError.is(error) || error.kind !== "git") throw error;
            const step = operation.steps.find((candidate) => candidate.classification !== "completed" && candidate.classification !== "conflicted");
            if (!step) throw error;
            const exitCode = typeof error.detail.exitCode === "number" ? error.detail.exitCode : error.exitCode;
            const detail = operation.kind === "repo-add" ? repoAddGitFailureDetail(operation, step, exitCode) : {
              why: `Git exited ${exitCode} while resuming step ${step.id}`,
              remedy: `Correct the Git failure, then run \`grove reconcile --operation ${operation.id}\` again.`,
            };
            recordStepFailure(operation, step.id, "recoverable-intermediate", "git-failed", { resumeGitFailed: true, stepKind: step.kind, ...detail });
            const completed = operation.steps.filter((candidate) => candidate.classification === "completed" && !completedBefore.has(candidate.id)).map((candidate) => candidate.id);
            recovery = { id: operation.id, state: operation.state, completed, problem: "git-failed", detail };
          }
          return { ...recovery, discarded: destructionReceipts(operation, recovery.completed) };
        }));
      }
    }
  }
  const snapshot = await observeWorkspace(loadWorkspaceAt(ws.root), git);
  const operationScan = scanOperations(ws.root);
  const detail = { observedAt: snapshot.completedAt, auditOnly: parsed.values["audit-only"], resumed, abandoned, removedAnchors, retainedAnchors, survivingArtifacts, ...(retainedAnchors.length ? { remedy: "Inspect and move each retained repository anchor with native Git or the filesystem before reusing its path for a new acquisition." } : {}), operationErrors: operationScan.errors };
  const recoveryTargets = resumed.map((recovery) => ({ selector: { path: ws.root }, before: { operationId: recovery.id }, action: "resume-operation", after: recovery, reason: recovery.problem, ...(recovery.detail ? { detail: recovery.detail } : {}) }));
  const result = { ...completeResult("reconcile", recoveryTargets.length ? recoveryTargets : [{ selector: { path: ws.root }, before: null, action: "audit", after: detail, reason: null }], auditDiagnostics(ws.root, snapshot), detail), outcome: resumed.some((recovery) => recovery.problem) ? "partial" as const : "complete" as const };
  return ctx.emit.result(result, commandResultExit(result));
}

export function registerReconcile(): void {
  register({
    path: "reconcile",
    summary: "Resume pending structural operations, then audit observed Git state.",
    usage: "reconcile [--operation <id>] [--audit-only] [--abandon <id>]",
    args: [
      { name: "--operation <id>", desc: "Resume one exact pending structural operation." },
      { name: "--audit-only", desc: "Skip recovery and run the read-only conformance audit." },
      { name: "--abandon <id>", desc: "Close an eligible conflicted or failed acquisition operation without compensation." },
    ],
    note: "With no mode, resumes every eligible pending operation before the same audit used by doctor. Managed remote credentials from Git config require GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1 again on this invocation.",
    examples: ["grove reconcile", "grove reconcile --audit-only", "grove reconcile --operation 01K..."],
    handler: reconcileHandler,
    mutates: true,
  });
}
