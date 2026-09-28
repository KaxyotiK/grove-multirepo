/**
 * Grove lifecycle with §8.5.1 work-safety: `archive`, `restore`, `delete`, `rename`, `configure`.
 *
 * archive/restore/rename/delete use versioned forward operations resumed by `grove reconcile`.
 * Destructive permission is explicit and scoped to the listed work classes. Lifecycle operations retain every
 * Git ref; explicit branch deletion remains a native Git action.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { assertRecordedWork, assertWorktreeHeadRetained, consentAllows, destructiveConsent, porcelainStatus, type ChangeEntry, type DestructiveConsent } from "../git/worktree.ts";
import { assertGroveName } from "../model/validate.ts";
import { caseFoldKey } from "../model/encoding.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { newGroveManifest, saveGroveManifest } from "../config/grove.ts";
import { assertDestructiveMutationPath, assertWorktreeMutationPath, observeWorkspace } from "../model/observed.ts";
import { commandResultExit, completeResult, type ResultTarget } from "../model/result.ts";
import { compileLayout, expandArchivePath, expandGrovePath, expandTreePath, matchLayoutPath, resolveLayoutTarget, structuralTreeSlotPaths } from "../config/layout.ts";
import { scanTemplateCandidates } from "../config/discovery.ts";
import { centralGroveManifest } from "../paths/layout.ts";
import { assertDirectoryContainsOnlyRoots, collectDirectoryMergeRoots, containedPath, inventoryLooseContent, looseEntryLabel, mergeDirectoryForward, moveContainedDirectory, persistedLooseInventory, removeContainedDirectory, removeContainedFile, unaccountedEntries, unconsentedLooseEntries, type LooseInventory } from "../paths/fs.ts";
import { assertTargetsAvailable, beginOperation, captureDirectoryTarget, pendingOperationRemedy, pendingOperations, recordCompleted, recordPending, recordStepFailure, scanOperations, withOperationTargetLocks } from "../store/operation.ts";
import type { ArchiveRecipe, GroveManifest } from "../model/types.ts";
import { planLifecycleRemoval } from "../model/plan.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";

const git = () => new Git(createGitRunner());
const mutationFailureReason = (error: unknown): "stale-plan" | "git-failed" => GroveError.is(error) && error.kind !== "git" ? "stale-plan" : "git-failed";
// json-results-v1 exit table: a filesystem/IO failure is `io-failed` (exit 7), whether it arrives as a
// raw Node error or as Grove's own `io` error (for example a manifest write refused by EACCES).
const stepFailureReason = (error: unknown): "stale-plan" | "git-failed" | "io-failed" => !GroveError.is(error) || error.kind === "io" ? "io-failed" : error.kind === "git" ? "git-failed" : "stale-plan";

/**
 * A metadata step fails only after the destructive steps completed. It stays resumable
 * (`recoverable-intermediate`): once the cause is fixed, `reconcile` finishes it forward and
 * rechecks its own point-of-use conditions, exactly as it does after a crash at the same step.
 */
function metadataStepRemedy(operationId: string, command: "archive" | "delete"): string {
  return `Correct the cause, then run \`grove reconcile --operation ${operationId}\` (or \`grove reconcile\`) to finish the ${command}; the removals listed above are already done and are not repeated.`;
}

/**
 * Ruling ④ on a partial run: the user must learn what completed steps already destroyed, not only
 * which step failed. The receipt is the point-of-use set, re-read immediately before removal; files
 * that vanished before then are not in it, and nothing is listed for a step that did not complete.
 */
function treeRemovalReceipt(groveName: string, recipe: ArchiveRecipe, recordedWork: readonly ChangeEntry[], discardedWork: readonly ChangeEntry[]): { postState: Record<string, unknown>; target: ResultTarget } {
  const path = String(recipe.priorPath);
  const postState = { path, registered: false, refsRetained: true, recordedWork: [...recordedWork], discardedWork: [...discardedWork] };
  return { postState, target: { selector: { repositoryId: recipe.selector.repositoryId, grove: groveName, tree: recipe.selector.tree, path }, before: recipe, action: "worktree-remove", after: postState, reason: null } };
}

/** A partial result lists every completed target with its receipt beside the failing target. */
function partialResult(command: string, completed: readonly ResultTarget[], failing: ResultTarget, diagnostics: Parameters<typeof completeResult>[2], operationId: string) {
  return { ...completeResult(command, [...completed, failing], diagnostics), outcome: "partial" as const, operationId };
}

async function lifecycleContext(ctx: CommandContext, ref: string | undefined, allowAbandonedDelete = false) {
  if (!ref) throw new GroveError({ kind: "invalid-input", what: "a Grove is required", why: "no <grove> was given", remedy: "Run `grove ls`, then pass one exact Grove name or id." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const g = git();
  const snapshot = await observeWorkspace(ws, g);
  const matches = snapshot.groves.filter((candidate) => candidate.name === ref || candidate.metadata?.manifest.id === ref);
  if (matches.length !== 1) {
    if (allowAbandonedDelete && matches.length === 0) {
      const path = resolveLayoutTarget(snapshot.layout, expandGrovePath(snapshot.layout, ref));
      if (existsSync(path) && !existsSync(centralGroveManifest(ws.root, ref))) {
        const current = captureDirectoryTarget(ws.root, "grove-content", { grove: ref }, path);
        const abandonedDelete = scanOperations(ws.root).records.reverse().find((record) => {
          if (record.kind !== "grove-delete" || record.state !== "abandoned" || record.scope.grove !== ref) return false;
          const content = record.steps.find((step) => step.kind === "directory-remove");
          const input = content?.input as { path?: unknown; targetIdentity?: { device?: unknown; inode?: unknown; expectedPresent?: unknown } } | undefined;
          return input?.path === path && input.targetIdentity?.expectedPresent === true && input.targetIdentity.device === current.device && input.targetIdentity.inode === current.inode;
        });
        if (abandonedDelete) return { ws, g, snapshot, grove: { name: ref, trees: [], metadata: null }, abandonedDelete };
      }
    }
    const pending = matches.length === 0 ? pendingOperations(ws.root).find((record) => record.scope.grove === ref || record.scope.newName === ref) : null;
    if (pending) throw new GroveError({ kind: "refused-conflict", what: `Grove "${ref}" has a pending operation`, why: `operation ${pending.id} (${pending.kind}, ${pending.state}) owns the target`, remedy: pendingOperationRemedy(pending), detail: { operationId: pending.id, kind: pending.kind, state: pending.state } });
    throw new GroveError({ kind: "invalid-input", what: `No unique Grove "${ref}"`, why: `${matches.length} observed/advisory Groves match`, remedy: "Run `grove ls`." });
  }
  return { ws, g, snapshot, grove: matches[0]!, abandonedDelete: null };
}

function groveManifest(grove: Awaited<ReturnType<typeof lifecycleContext>>["grove"]): GroveManifest {
  return grove.metadata?.manifest ?? newGroveManifest(grove.name);
}

function archiveRecipe(snapshot: Awaited<ReturnType<typeof lifecycleContext>>["snapshot"], tree: Awaited<ReturnType<typeof lifecycleContext>>["grove"]["trees"][number]): ArchiveRecipe {
  const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
  if (!repository?.registration || !tree.selector || tree.path.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot snapshot the Tree", why: "its registered repository, selector, or native path is not addressable", remedy: "Run `grove doctor` and repair blocking diagnostics." });
  return { selector: tree.selector, repositoryAlias: repository.registration.name, commonGitDir: repository.commonGitDir, branch: tree.branch?.utf8 ?? null, headOid: tree.headOid, priorPath: tree.path.utf8 };
}

function recipeTargetLocks(recipe: ArchiveRecipe): string[] {
  const branch = typeof recipe.branch === "string" ? recipe.branch.replace(/^refs\/heads\//, "") : null;
  return [`worktree:${resolve(String(recipe.priorPath))}`, ...(branch ? [`repository:${recipe.selector.repositoryId}:branch:${branch}`] : [])];
}

async function refuseUnsafe(
  g: Git,
  snapshot: Awaited<ReturnType<typeof lifecycleContext>>["snapshot"],
  trees: Awaited<ReturnType<typeof lifecycleContext>>["grove"]["trees"],
  consent: DestructiveConsent,
  loose: readonly string[] = [],
): Promise<void> {
  const blockers: string[] = [];
  const itemized: { tree: string; path: string }[] = [];
  for (const tree of trees) {
    const label = tree.treeName ?? tree.path.display;
    if (tree.path.utf8 === null || tree.dirty === null) blockers.push(`${label}: state cannot be determined`);
    else {
      const status = await porcelainStatus(g, tree.path.utf8);
      if (status.problem) blockers.push(`${label}: ${status.problem}`);
      else {
        for (const change of status.changes) itemized.push({ tree: label, path: change.path });
        const denied = status.changes.filter((entry) => !consentAllows(entry, consent)).map((entry) => entry.path).sort();
        if (denied.length) blockers.push(`${label}: uncommitted ${denied.length === 1 ? "file" : "files"} ${denied.join(", ")}`);
      }
    }
    if (consent === "none" && tree.sequencer) blockers.push(`${label}: ${tree.sequencer.kind} sequencer is active`);
    if (consent === "none" && tree.locked) blockers.push(`${label}: native worktree is locked`);
    if (tree.detached && tree.headOid) {
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
      if (!repository || !(await g.isCommitReachableFromRef(repository.commonGitDir, tree.headOid))) blockers.push(`${label}: detached HEAD ${tree.headOid} is unreachable from refs`);
    }
    const decision = planLifecycleRemoval({ path: tree.path.display, headOid: tree.headOid, dirty: tree.dirty, sequencer: tree.sequencer !== null, detached: tree.detached, reachable: tree.detached && tree.headOid ? !blockers.some((blocker) => blocker.startsWith(`${label}: detached`)) : null, allowDestructive: consent !== "none" });
    if (decision.reason && !blockers.some((blocker) => blocker.startsWith(`${label}:`))) blockers.push(`${label}: ${decision.reason}`);
  }
  if (consent !== "all" && loose.length) blockers.push(`loose Grove content would be removed: ${[...loose].sort().join(", ")}`);
  if (blockers.length) throw new GroveError({ kind: "refused-precondition", what: "The Grove is not safe to remove", why: blockers.join("; "), detail: { uncommitted: itemized, loose: [...loose].sort() }, remedy: "Resolve the listed state or create a durable ref for detached work; --allow-destructive-all covers itemized working and loose content, while --allow-destructive-git-ignored covers only ignored files." });
}

/**
 * Ruling ④: a destructive run MUST itemize what it destroys — on the refusal AND on the forced run.
 *
 * The JSON result already carried `discardedWork`; the human line said only "all refs were
 * retained", which is true and useless — the refs were never at risk, and the files that WERE
 * destroyed went unmentioned. That is also a ⑦ violation: the two modes must carry identical facts.
 */
function renderDiscarded(
  discarded: ReadonlyArray<{ tree: string; changes: ReadonlyArray<{ path: string }> }>,
  loose: readonly string[],
): string {
  const lines = discarded.map((item) => `  discarded in ${item.tree}: ${item.changes.map((change) => change.path).sort().join(", ")}`);
  // Loose content is PRESERVED by archive (the directory is moved, not emptied) and destroyed by
  // delete. That asymmetry is real, so only delete passes a non-empty list here.
  if (loose.length) lines.push(`  discarded loose content: ${[...loose].sort().join(", ")}`);
  return lines.length ? `\n${lines.join("\n")}` : "";
}

/**
 * Ruling ② and B1/B2. Archive promises restorability to an exact commit, so it must refuse when it
 * cannot keep that promise.
 *
 * A retained ref is NOT a durability guarantee: v3 explicitly sanctions `git branch -D` as a native
 * action, and the managed bare repository is local-only. If the commit exists nowhere but this
 * machine, the archive can be silently emptied later.
 *
 * B2: the remote is OBSERVED FROM GIT rather than read from Grove's advisory record (Principle I).
 * Most linked repositories have a real remote Grove simply never recorded, and exempting them
 * outright would silently archive unpushed work -- the exact loss ④ exists to prevent.
 *
 * Accepted limitation (ruling ②): this reads refs/remotes/*, so it is accurate only as of the last
 * fetch. A branch pushed from another machine reads as unpushed. A false refusal is cheap and
 * correctable with --allow-unpushed; a false ACCEPTANCE silently breaks the restore promise.
 */
async function refuseUndurable(
  g: Git,
  snapshot: Awaited<ReturnType<typeof lifecycleContext>>["snapshot"],
  trees: Awaited<ReturnType<typeof lifecycleContext>>["grove"]["trees"],
  allowUnpushed: boolean,
): Promise<void> {
  const unborn: string[] = [];
  const unpushed: string[] = [];
  const noRemote: string[] = [];
  for (const tree of trees) {
    const label = tree.treeName ?? tree.path.display;
    // B1: an unborn HEAD has no commit to restore TO. Archiving it and discovering that only at
    // restore is a trap; refusing destroys nothing, because there is no committed work yet.
    if (tree.unborn || tree.headOid === null) { unborn.push(label); continue; }
    if (allowUnpushed) continue;
    const branch = tree.branch?.utf8?.replace(/^refs\/heads\//, "") ?? null;
    const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
    if (!repository) continue;
    const remotes = await g.listRemotes(repository.commonGitDir);
    if (remotes.length === 0) { noRemote.push(label); continue; }
    let pushed = false;
    if (branch === null) {
      // A DETACHED tree is the strongest durability risk, not an exemption: it has no ref of its
      // own, so once the worktree is removed the commit is reachable from nothing this archive
      // controls. `refuseUnsafe` already refuses one that no ref contains at all; this asks the
      // separate question ② actually cares about — has it left this machine?
      const contained = await g.tryRun(repository.commonGitDir, ["for-each-ref", "--format=%(refname)", "--contains", tree.headOid as string, "refs/remotes"]);
      pushed = contained.exitCode === 0 && contained.stdout.trim() !== "";
      if (!pushed) unpushed.push(`${label} (detached at ${String(tree.headOid).slice(0, 12)})`);
      continue;
    }
    // CONTAINMENT, not existence. Asking `show-ref refs/remotes/<remote>/<branch>` only answers
    // "was this branch ever pushed", so the gate accepted every commit made after the first push —
    // which is the normal way of working, making it inert exactly when it matters. The detached
    // path below already asked the right question; the attached path is the common one.
    //
    // Also: `remoteBranchExists` runs `assertBranchName`, Grove's CREATION-time grammar, against a
    // branch OBSERVED from Git. An adopted branch that Git allows but Grove would not mint (a
    // SHA-like name, say) made `archive` exit 2 about an argument the user never supplied. Querying
    // by OID sidesteps that entirely.
    const contained = await g.tryRun(repository.commonGitDir, ["for-each-ref", "--format=%(refname)", "--contains", tree.headOid as string, "refs/remotes"]);
    pushed = contained.exitCode === 0 && contained.stdout.trim() !== "";
    if (!pushed) unpushed.push(`${label} (${branch})`);
  }
  if (unborn.length) {
    throw new GroveError({
      kind: "refused-precondition",
      what: "Cannot archive a Tree whose HEAD is unborn",
      why: `no commit exists yet in: ${unborn.join(", ")}`,
      remedy: "Make an initial commit, or use `grove delete` if the work is not wanted.",
      detail: { unborn },
    });
  }
  if (noRemote.length) {
    throw new GroveError({
      kind: "refused-precondition",
      what: "Cannot verify that this work is pushed",
      why: `the repository has no Git remote, so there is nowhere the commit could have been pushed: ${noRemote.join(", ")}`,
      remedy: "Add a remote and push, or pass --allow-unpushed to archive local-only work.",
      detail: { noRemote },
    });
  }
  if (unpushed.length) {
    throw new GroveError({
      kind: "refused-precondition",
      what: "Cannot archive unpushed work",
      why: `no remote-tracking ref carries: ${unpushed.join(", ")}`,
      remedy: "Push the branch, or pass --allow-unpushed to archive it anyway.",
      detail: { unpushed },
    });
  }
}

async function archiveHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  {
    const { ws, g, snapshot, grove } = await lifecycleContext(ctx, parsed.positionals[0]);
    if (grove.metadata?.state === "archived") throw new GroveError({ kind: "refused-precondition", what: `Cannot archive "${grove.name}"`, why: "it is already archived", remedy: "Restore or delete it instead." });
    const activePath = expandGrovePath(snapshot.layout, grove.name);
    const unavailable = snapshot.repositories.filter((repository) => repository.registration && repository.problem);
    const observedPaths = new Set(snapshot.repositories.flatMap((repository) => repository.worktrees.flatMap((tree) => tree.path.utf8 ? [resolve(tree.path.utf8)] : [])));
    const unobservedTreePaths = unavailable.length ? scanTemplateCandidates(snapshot.layout.workspaceRoot, snapshot.layout.config.trees)
      .filter((path) => matchLayoutPath(snapshot.layout, path)?.grove === grove.name && !observedPaths.has(resolve(path)))
      .filter((path) => { try { lstatSync(join(path, ".git")); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; } }) : [];
    if (unobservedTreePaths.length) {
      // A failed Git inspection yields zero observed Trees, which does not prove that the Grove
      // contains none. Itemize everything the directory move could carry, without treating the
      // filesystem positions as proof of Git membership or following symlinks.
      const atRisk: string[] = [];
      const incomplete: Array<{ path: string; problem: string }> = [];
      const walk = (directory: string, depth: number): void => {
        if (depth > 64) { incomplete.push({ path: relative(ws.root, directory), problem: "deeper than 64 levels" }); return; }
        if (atRisk.length >= 10_000) { incomplete.push({ path: relative(ws.root, directory), problem: "more than 10000 entries" }); return; }
        let entries: Dirent<string>[];
        try { entries = readdirSync(directory, { withFileTypes: true }); }
        catch { incomplete.push({ path: relative(ws.root, directory), problem: "cannot enumerate" }); return; }
        for (const entry of entries) {
          if (atRisk.length >= 10_000) { incomplete.push({ path: relative(ws.root, join(directory, entry.name)), problem: "more than 10000 entries" }); break; }
          if (entry.name === ".git") continue;
          const path = join(directory, entry.name);
          atRisk.push(relative(snapshot.layout.workspaceRoot, path));
          if (entry.isDirectory()) walk(path, depth + 1);
        }
      };
      if (existsSync(activePath)) walk(activePath, 0);
      const sample = atRisk.slice(0, 10).join(", ") || "unknown";
      const omitted = atRisk.length > 10 ? ` (+${atRisk.length - 10} more listed in detail)` : "";
      const gap = incomplete.length ? `; itemization incomplete at ${incomplete.length} path(s)` : "";
      throw new GroveError({ kind: "refused-precondition", what: `Cannot archive "${grove.name}"`, why: `repository inspection failed and Git-marked Tree positions cannot be accounted for: ${unobservedTreePaths.map((path) => relative(ws.root, path)).join(", ")}; content at risk: ${sample}${omitted}${gap}`, remedy: "Restore access to the listed repositories, run `grove doctor`, then retry archive.", detail: { repositories: unavailable.map((repository) => ({ repositoryId: repository.registration!.id, repositoryAlias: repository.registration!.name, problem: repository.problem })), unobservedTreePaths, atRisk, incomplete } });
    }
    await refuseUnsafe(g, snapshot, grove.trees, destructiveConsent(parsed.values));
    await refuseUndurable(g, snapshot, grove.trees, parsed.values["allow-unpushed"] === true);
    const discardedWork: Array<{ repositoryId: string; repositoryAlias: string; tree: string; changes: Array<{ status: string; path: string }> }> = [];
    if (destructiveConsent(parsed.values) !== "none") for (const tree of grove.trees) {
      if (!tree.dirty || tree.path.utf8 === null || !tree.selector?.repositoryId) continue;
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
      const status = await porcelainStatus(g, tree.path.utf8);
      if (repository?.registration && !status.problem && status.changes.length) discardedWork.push({ repositoryId: repository.registration.id, repositoryAlias: repository.registration.name, tree: tree.treeName ?? tree.path.display, changes: status.changes });
    }
    resolveLayoutTarget(snapshot.layout, activePath);
    const archivePath = resolveLayoutTarget(snapshot.layout, expandArchivePath(snapshot.layout, grove.name));
    // This Grove's own pending operation explains an existing archive path far better than the path
    // does: the archive may hold the only copy of its loose content, so never suggest deleting it.
    assertTargetsAvailable(ws.root, [`grove:${grove.name}`]);
    if (existsSync(archivePath)) throw new GroveError({ kind: "refused-conflict", what: `Cannot archive "${grove.name}"`, why: `${archivePath} already exists`, remedy: "Inspect the existing archive path; it may hold the only copy of loose content. Restore or move it before archiving again." });
    const recipes = grove.trees.map((tree) => archiveRecipe(snapshot, tree));
    for (const recipe of recipes) {
      const path = String(recipe.priorPath);
      containedPath(ws.root, path, `Cannot archive "${grove.name}"`);
      assertWorktreeMutationPath(snapshot, path, { allowObservedPath: path, groveName: grove.name });
    }
    const recipePaths = recipes.map((recipe) => String(recipe.priorPath));
    assertDestructiveMutationPath(snapshot, activePath, { allowObservedPaths: recipePaths, groveName: grove.name });
    assertDestructiveMutationPath(snapshot, archivePath, { groveName: grove.name });
    const targetLocks = [...new Set([`grove:${grove.name}`, ...recipes.flatMap(recipeTargetLocks)])].sort();
    return withOperationTargetLocks(ws.root, targetLocks, "archive", async () => {
      assertTargetsAvailable(ws.root, targetLocks);
      resolveLayoutTarget(snapshot.layout, activePath);
      resolveLayoutTarget(snapshot.layout, archivePath);
      const plannedLoose = looseEntries(activePath, recipePaths);
      const operation = beginOperation(ws.root, { kind: "grove-archive", scope: { grove: grove.name }, targetLocks, targets: [
        ...recipes.map((recipe, index) => ({ selector: { repositoryId: recipe.selector.repositoryId, grove: grove.name, tree: recipe.selector.tree, path: String(recipe.priorPath) }, steps: [{ id: `remove-${index}`, kind: "worktree-remove", input: { ...recipe, path: String(recipe.priorPath), discardedWork: discardedWork.find(item => item.repositoryId === recipe.selector.repositoryId && item.tree === recipe.selector.tree)?.changes ?? [], consent: destructiveConsent(parsed.values) } }] })),
        { selector: { grove: grove.name }, steps: [{ id: "archive-content", kind: "directory-move", input: { from: activePath, to: archivePath, plannedLoose } }, { id: "archive-metadata", kind: "central-metadata-update", input: { state: "archived" } }] },
      ] });
      const completedTargets: ResultTarget[] = [];
      for (let index = 0; index < recipes.length; index++) {
        const recipe = recipes[index]!;
        const path = String(recipe.priorPath);
        let recorded: ChangeEntry[] = [];
        let actual: ChangeEntry[] = [];
        recordPending(operation, `remove-${index}`, { path, headOid: recipe.headOid, branch: recipe.branch });
        try {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === recipe.selector.repositoryId);
          const mutationWorktree = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === path);
          if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== recipe.commonGitDir || !mutationWorktree || mutationWorktree.headOid !== recipe.headOid) throw new GroveError({ kind: "refused-conflict", what: `Cannot archive "${grove.name}"`, why: "a repository or worktree identity changed at the point of use", remedy: "Retry from fresh observed state." });
          await assertWorktreeHeadRetained(g, recipe.commonGitDir, path, recipe.headOid);
          assertWorktreeMutationPath(mutationSnapshot, path, { allowObservedPath: path, groveName: grove.name });
          const receipt = discardedWork.find(item => item.repositoryId === recipe.selector.repositoryId && item.tree === recipe.selector.tree);
          recorded = receipt?.changes ?? [];
          actual = await assertRecordedWork(g, String(recipe.priorPath), recorded, destructiveConsent(parsed.values));
          if (receipt) receipt.changes = actual;
          await g.removeWorktree(recipe.commonGitDir, containedPath(ws.root, path, `Cannot archive "${grove.name}"`), destructiveConsent(parsed.values) !== "none");
        }
        catch (error) { const reason = mutationFailureReason(error); recordStepFailure(operation, `remove-${index}`, "conflicted", reason, { error: String((error as Error).message ?? error) }); const result = partialResult("archive", completedTargets, { selector: { grove: grove.name, path }, before: recipe, action: "worktree-remove", after: null, reason }, snapshot.diagnostics, operation.id); return ctx.emit.result(result, commandResultExit(result)); }
        const completion = treeRemovalReceipt(grove.name, recipe, recorded, actual);
        recordCompleted(operation, `remove-${index}`, completion.postState);
        completedTargets.push(completion.target);
      }
      try {
        recordPending(operation, "archive-content", { from: activePath, to: archivePath, sourcePresent: existsSync(activePath), fromIdentity: captureDirectoryTarget(ws.root, "active-grove", { grove: grove.name }, activePath), toIdentity: captureDirectoryTarget(ws.root, "archive-grove", { grove: grove.name }, archivePath) });
        resolveLayoutTarget(snapshot.layout, activePath); resolveLayoutTarget(snapshot.layout, archivePath);
        if (existsSync(activePath)) {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          assertDestructiveMutationPath(mutationSnapshot, activePath, { allowObservedPaths: recipePaths, groveName: grove.name });
          assertDestructiveMutationPath(mutationSnapshot, archivePath, { groveName: grove.name });
          mkdirSync(dirname(archivePath), { recursive: true });
          assertPlannedLoose(activePath, recipePaths, plannedLoose);
          moveContainedDirectory(
            containedPath(ws.root, activePath, `Cannot archive "${grove.name}"`),
            containedPath(ws.root, archivePath, `Cannot archive "${grove.name}"`),
          );
        }
      }
      catch (error) {
        recordStepFailure(operation, "archive-content", "conflicted", "stale-plan", { error: String((error as Error).message ?? error) });
        return ctx.emit.result(partialResult("archive", completedTargets, { selector: { grove: grove.name, path: activePath }, before: null, action: "directory-move", after: null, reason: "stale-plan" }, snapshot.diagnostics, operation.id), 4);
      }
      const archivedContent = { archivedPath: existsSync(archivePath) ? archivePath : null };
      recordCompleted(operation, "archive-content", archivedContent);
      completedTargets.push({ selector: { grove: grove.name, path: activePath }, before: null, action: "directory-move", after: archivedContent, reason: null });
      const manifest = groveManifest(grove);
      recordPending(operation, "archive-metadata", { revision: grove.metadata?.meta.rev ?? null, state: manifest.state });
      const next: GroveManifest = { ...manifest, state: "archived", archiveSnapshot: { version: 1, archivedAt: new Date().toISOString(), looseContentPath: existsSync(archivePath) ? archivePath : null, layoutRevision: String(ws.meta.rev), recipes } };
      let meta: Awaited<ReturnType<typeof saveGroveManifest>>;
      try { meta = await saveGroveManifest(ws.root, next, grove.metadata?.meta); }
      catch (error) {
        const reason = stepFailureReason(error);
        const why = String((error as Error).message ?? error);
        recordStepFailure(operation, "archive-metadata", "recoverable-intermediate", reason, { error: why });
        const result = partialResult("archive", completedTargets, { selector: { grove: grove.name, path: centralGroveManifest(ws.root, manifest.name) }, before: null, action: "central-metadata-update", after: null, reason, detail: { why, remedy: metadataStepRemedy(operation.id, "archive") } }, snapshot.diagnostics, operation.id);
        return ctx.emit.result(result, commandResultExit(result));
      }
      recordCompleted(operation, "archive-metadata", { revision: meta.rev, state: "archived" });
      const after = { grove: grove.name, state: "archived", archivePath: next.archiveSnapshot?.looseContentPath, recipes: recipes.length, refsRetained: true, discardedWork: discardedWork.filter(item => item.changes.length) };
      const result = { ...completeResult("archive", [{ selector: { grove: grove.name }, before: { state: "active", trees: recipes.length }, action: "archive", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
      // Loose content is PRESERVED by archive (the directory is moved, not emptied) and destroyed
      // by delete. That asymmetry is real and must be visible, not inferred.
      return ctx.emit.result(result, 0);
    });
  }
}

async function restoreHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  {
    const { ws, g, snapshot, grove } = await lifecycleContext(ctx, parsed.positionals[0]);
    const manifest = groveManifest(grove);
    const archive = manifest.archiveSnapshot;
    if (manifest.state !== "archived" || !archive) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore "${grove.name}"`, why: "it has no archived restoration snapshot", remedy: "Only an explicitly archived Grove can be restored." });
    const activePath = expandGrovePath(snapshot.layout, grove.name);
    resolveLayoutTarget(snapshot.layout, activePath);
    const compiledArchivePath = expandArchivePath(snapshot.layout, grove.name);
    const recordedArchivePath = typeof archive.looseContentPath === "string" ? archive.looseContentPath : null;
    // Same advisory key, same weakness as delete: containment admits the workspace root, and this
    // one feeds `renameSync` — moving the workspace elsewhere is destruction too. The compiled
    // archive path is right here, so compare against it.
    if (recordedArchivePath && (!isAbsolute(recordedArchivePath) || resolve(recordedArchivePath) !== resolve(compiledArchivePath))) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore "${grove.name}"`, why: "the archived loose-content path is outside the workspace", remedy: "Repair the advisory archive snapshot before restoring." });
    // Same defect as delete/rename below, and the worst instance: restore takes NO destructive
    // flag, so a symlink at the archive layout path relocated an unrelated in-workspace directory
    // into the Grove at exit 0. `resolveContained` returns the REALPATH and only checks
    // containment; `resolveLayoutTarget` refuses when lexical and canonical differ, which is
    // config-v3's symlink-safety guarantee. The exact-path guard above is lexical and passes
    // straight through the symlink, and an archived Grove always has `looseContentPath` set — so
    // the unsafe branch was the normal path.
    const archivePath = resolveLayoutTarget(snapshot.layout, compiledArchivePath);
    if (existsSync(activePath)) throw new GroveError({ kind: "refused-conflict", what: `Cannot restore "${grove.name}"`, why: `${activePath} is occupied`, remedy: "Move the conflicting content and retry." });
    // An archived Grove's loose content — files that were NEVER in Git — exists only in the archive
    // directory. If that directory is gone, restore cannot reconstitute it, and proceeding
    // silently manufactured an empty Grove, reported `outcome: "complete"` at exit 0, and then
    // cleared `archiveSnapshot` — destroying the only record the content had ever existed.
    // Refuse instead: the Trees are rebuildable from Git, the loose content is not.
    if (!existsSync(archivePath)) throw new GroveError({
      kind: "refused-precondition",
      what: `Cannot restore "${grove.name}"`,
      why: `its archived content directory ${archivePath} is missing, so any loose files it held cannot be reconstituted`,
      remedy: "Restore the archive directory from a backup, or delete the Grove record explicitly with `grove delete` if the content is genuinely gone.",
      detail: { archivePath },
    });
    const recipes = archive.recipes;
    const latest = parsed.values.latest === true;
    const bindRecipes = async (currentSnapshot: typeof snapshot) => Promise.all(recipes.map(async (recipe) => {
      const repository = currentSnapshot.repositories.find((candidate) => candidate.registration?.id === recipe.selector.repositoryId);
      if (!repository?.registration || repository.problem) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore Tree ${recipe.selector.tree}`, why: "its archived repository identity is not currently registered and healthy", remedy: "Re-register the exact retained repository or repair the archive snapshot before restoring.", detail: { reason: "stale-plan", repositoryId: recipe.selector.repositoryId } });
      const recordedIdentity = await g.inspectRepository(recipe.commonGitDir).catch(() => null);
      if (!recordedIdentity || recordedIdentity.commonGitDir.canonicalUtf8 !== repository.commonGitDir) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore Tree ${recipe.selector.tree}`, why: "its archived common Git directory no longer matches the registered repository", remedy: "Repair the stable repository binding before restoring.", detail: { reason: "stale-plan", repositoryId: recipe.selector.repositoryId } });
      const path = expandTreePath(currentSnapshot.layout, grove.name, recipe.selector.tree, repository.registration.name);
      resolveLayoutTarget(currentSnapshot.layout, path);
      const branch = typeof recipe.branch === "string" ? recipe.branch : null;
      const oid = recipe.headOid;
      if (oid === null) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore Tree ${recipe.selector.tree}`, why: "its archived HEAD was unborn", remedy: "Recreate this Tree explicitly from a revision.", detail: { reason: "stale-plan", repositoryId: recipe.selector.repositoryId } });
      // GATE 1 (ruling ②). Restore reconstitutes the commit recorded AT ARCHIVE TIME. A branch that
      // advanced natively since the archive is the ordinary case this feature exists to serve, not
      // an error — the old code refused it as "stale", which made a moved branch unrestorable.
      //
      // `--latest` opts into the current tip instead. Otherwise, when the branch has moved we bind
      // to the archived OID and DETACH: attaching the branch would silently restore the wrong
      // commit, which is worse than refusing.
      const branchOid = branch === null ? null : (await g.tryRun(repository.commonGitDir, ["rev-parse", "--verify", `${branch}^{commit}`])).stdout.trim().toLowerCase() || null;
      if (latest) {
        if (branch === null) throw new GroveError({ kind: "invalid-input", what: `Cannot restore Tree ${recipe.selector.tree} with --latest`, why: "it was archived with a detached HEAD, so there is no branch tip to follow", remedy: "Restore without --latest to reconstitute the archived commit.", detail: { reason: "no-branch", repositoryId: recipe.selector.repositoryId } });
        if (branchOid === null) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore Tree ${recipe.selector.tree} with --latest`, why: `branch ${branch} no longer exists`, remedy: "Restore without --latest to reconstitute the archived commit, or recreate the branch.", detail: { reason: "stale-plan", repositoryId: recipe.selector.repositoryId } });
        return { recipe, repository, path, branch, oid: branchOid, detach: false, movedFrom: null };
      }
      // The archived OBJECT must still exist; that is the only thing restore genuinely requires.
      const object = await g.tryRun(repository.commonGitDir, ["cat-file", "-e", `${oid}^{commit}`]);
      if (object.exitCode !== 0) throw new GroveError({ kind: "refused-precondition", what: `Cannot restore Tree ${recipe.selector.tree}`, why: `the archived commit ${oid} no longer exists in the repository`, remedy: "Recover the object (for example from a remote or reflog), or create the Tree explicitly.", detail: { reason: "stale-plan", repositoryId: recipe.selector.repositoryId, expectedOid: oid } });
      const detach = branch === null || branchOid !== oid.toLowerCase();
      return { recipe, repository, path, branch, oid, detach, movedFrom: detach && branch !== null ? branchOid : null };
    }));
    const planned = await bindRecipes(snapshot);
    assertDestructiveMutationPath(snapshot, archivePath, { groveName: grove.name });
    assertDestructiveMutationPath(snapshot, activePath, { groveName: grove.name });
    const targetLocks = [...new Set(["grove:" + grove.name, ...planned.flatMap(({ recipe, path, branch }) => [
      `worktree:${resolve(path)}`,
      ...(branch === null ? [] : [`repository:${recipe.selector.repositoryId}:branch:${branch.replace(/^refs\/heads\//, "")}`]),
    ])])].sort();
    return withOperationTargetLocks(ws.root, targetLocks, "restore", async () => {
      assertTargetsAvailable(ws.root, targetLocks);
      resolveLayoutTarget(snapshot.layout, activePath);
      const rebound = await bindRecipes(await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g));
      if (rebound.some((value, index) => value.path !== planned[index]?.path || value.repository.commonGitDir !== planned[index]?.repository.commonGitDir)) throw new GroveError({ kind: "refused-conflict", what: `Cannot restore "${grove.name}"`, why: "a registered repository binding changed after planning", remedy: "Retry from fresh observed state.", detail: { reason: "stale-plan" } });
      const operation = beginOperation(ws.root, { kind: "grove-restore", scope: { grove: grove.name }, targetLocks, targets: [
        { selector: { grove: grove.name }, steps: [{ id: "restore-content", kind: "directory-move", input: { from: archivePath, to: activePath } }] },
        ...rebound.map(({ recipe, repository, path, branch, oid, detach }, index) => {
          // `branch` is retained for reporting and for the resume-path identity check; `detach`
          // carries the decision explicitly. Writing `branch: null` instead would work for the
          // resume path but destroy the information the result and gate 5 both need, and would
          // silently reinterpret records written by the current binary.
          return { selector: { repositoryId: recipe.selector.repositoryId, grove: grove.name, tree: recipe.selector.tree, path }, steps: [{ id: `restore-${index}`, kind: "restore-worktree", input: { commonGitDir: repository.commonGitDir, path, branch, oid, detach } }] };
        }),
        { selector: { grove: grove.name }, steps: [{ id: "restore-metadata", kind: "central-metadata-update", input: { state: "active" } }] },
      ] });
      try {
        recordPending(operation, "restore-content", { from: archivePath, to: activePath, archivePresent: existsSync(archivePath), fromIdentity: captureDirectoryTarget(ws.root, "archive-grove", { grove: grove.name }, archivePath), toIdentity: captureDirectoryTarget(ws.root, "active-grove", { grove: grove.name }, activePath) });
        resolveLayoutTarget(snapshot.layout, activePath);
        if (existsSync(archivePath)) {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          assertDestructiveMutationPath(mutationSnapshot, archivePath, { groveName: grove.name });
          assertDestructiveMutationPath(mutationSnapshot, activePath, { groveName: grove.name });
          mkdirSync(dirname(activePath), { recursive: true });
          moveContainedDirectory(
            containedPath(ws.root, archivePath, `Cannot restore "${grove.name}"`),
            containedPath(ws.root, activePath, `Cannot restore "${grove.name}"`),
          );
        }
        else mkdirSync(activePath, { recursive: true });
      }
      catch (error) {
        recordStepFailure(operation, "restore-content", "conflicted", "stale-plan", { error: String((error as Error).message ?? error) });
        return ctx.emit.result({ ...completeResult("restore", [{ selector: { grove: grove.name, path: archivePath }, before: null, action: "directory-move", after: null, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial", operationId: operation.id }, 4);
      }
      recordCompleted(operation, "restore-content", { activePath });
      for (let index = 0; index < rebound.length; index++) {
        const { recipe, repository, path, branch, oid, detach } = rebound[index]!;
        resolveLayoutTarget(snapshot.layout, path);
        if (existsSync(path)) { recordStepFailure(operation, `restore-${index}`, "conflicted", "stale-plan", { pathOccupied: true }); const result = { ...completeResult("restore", [{ selector: { repositoryId: recipe.selector.repositoryId, grove: grove.name, tree: recipe.selector.tree, path }, before: null, action: "worktree-add", after: null, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial" as const, operationId: operation.id }; return ctx.emit.result(result, commandResultExit(result)); }
        // GATE 2. When detaching, the branch is irrelevant — verify the OBJECT still exists. The
        // old check demanded the branch still point at the archived OID, which is exactly the
        // condition a detached restore exists to handle.
        if (detach) {
          const object = await g.tryRun(repository.commonGitDir, ["cat-file", "-e", `${oid}^{commit}`]);
          if (object.exitCode !== 0) { recordStepFailure(operation, `restore-${index}`, "conflicted", "stale-plan", { expected: oid, observed: null }); const result = { ...completeResult("restore", [{ selector: { repositoryId: recipe.selector.repositoryId, grove: grove.name, tree: recipe.selector.tree, path }, before: null, action: "restore-worktree", after: null, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial" as const, operationId: operation.id }; return ctx.emit.result(result, commandResultExit(result)); }
        } else if (branch) {
          const current = await g.tryRun(repository.commonGitDir, ["rev-parse", "--verify", `${branch}^{commit}`]);
          if (current.exitCode !== 0 || current.stdout.trim().toLowerCase() !== oid.toLowerCase()) { recordStepFailure(operation, `restore-${index}`, "conflicted", "stale-plan", { expected: oid, observed: current.stdout.trim() || null }); return ctx.emit.result({ ...completeResult("restore", [{ selector: { grove: grove.name, path }, before: null, action: "worktree-add", after: null, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial", operationId: operation.id }, 4); }
        }
        recordPending(operation, `restore-${index}`, { pathAbsent: true, branch, headOid: oid });
        resolveLayoutTarget(snapshot.layout, path);
        mkdirSync(dirname(path), { recursive: true });
        // GATE 3.
        const added = await g.tryRun(repository.commonGitDir, detach ? ["worktree", "add", "--detach", "--", path, oid] : ["worktree", "add", "--", path, branch!.replace(/^refs\/heads\//, "")]);
        if (added.exitCode !== 0) { recordStepFailure(operation, `restore-${index}`, "conflicted", "git-failed", { stderr: added.stderr.trim().split("\n")[0] }); return ctx.emit.result({ ...completeResult("restore", [{ selector: { grove: grove.name, path }, before: null, action: "worktree-add", after: null, reason: "git-failed" }], snapshot.diagnostics), outcome: "partial", operationId: operation.id }, 6); }
        const finalIdentity = await g.inspectRepository(path).catch(() => null);
        const finalHead = await g.currentHead(path).catch(() => null);
        const finalStatus = await porcelainStatus(g, path);
        // GATE 4 — the trap. A detached restore makes finalHead.branch null by design, and the old
        // equality against `branch` fired the "Restore is partial" recoverable-intermediate path
        // even with gates 1-3 fixed. The OID is the thing that must match; the branch must be null
        // when detaching and equal to the recorded branch otherwise.
        const headBranchOk = detach ? (finalHead?.branch?.utf8 ?? null) === null : (finalHead?.branch?.utf8 ?? null) === branch;
        if (!finalIdentity || finalIdentity.commonGitDir.canonicalUtf8 !== repository.commonGitDir || !finalHead || finalHead.oid !== oid || !headBranchOk || finalStatus.problem || finalStatus.changes.length > 0) {
          recordStepFailure(operation, `restore-${index}`, "recoverable-intermediate", "stale-plan", { identity: finalIdentity?.commonGitDir.canonicalUtf8 ?? null, head: finalHead, status: finalStatus });
          const result = { ...completeResult("restore", [{ selector: { repositoryId: recipe.selector.repositoryId, grove: grove.name, tree: recipe.selector.tree, path }, before: null, action: "verify-worktree", after: { path, headOid: finalHead?.oid ?? null, branch: finalHead?.branch?.utf8 ?? null, dirty: finalStatus.changes.length > 0 }, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial" as const, operationId: operation.id };
          return ctx.emit.result(result, commandResultExit(result));
        }
        recordCompleted(operation, `restore-${index}`, { path, branch, headOid: oid });
      }
      recordPending(operation, "restore-metadata", { revision: grove.metadata?.meta.rev ?? null, state: manifest.state });
      let meta: Awaited<ReturnType<typeof saveGroveManifest>>;
      try { meta = await saveGroveManifest(ws.root, { ...manifest, state: "active", archiveSnapshot: null }, grove.metadata?.meta); }
      catch (error) {
        const why = String((error as Error).message ?? error);
        recordStepFailure(operation, "restore-metadata", "recoverable-intermediate", stepFailureReason(error), { error: why });
        throw new GroveError({ kind: "io", what: `Restore metadata for ${grove.name} was not saved`, why, remedy: `Correct the cause, then run \`grove reconcile --operation ${operation.id}\` to finish the restore.`, detail: { operationId: operation.id } });
      }
      recordCompleted(operation, "restore-metadata", { revision: meta.rev, state: "active" });
      const detached = rebound.filter((entry) => entry.detach && entry.branch !== null).map((entry) => ({ tree: entry.recipe.selector.tree, branch: entry.branch, archivedOid: entry.oid, branchNowAt: entry.movedFrom }));
      const after = { grove: grove.name, state: "active", trees: recipes.length, restoredAt: latest ? "branch-tip" : "archived-commit", detached };
      const result = { ...completeResult("restore", [{ selector: { grove: grove.name }, before: { state: "archived" }, action: "restore", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
      // A moved branch is reported, never refused (ruling ②). Leaving the user on a detached HEAD
      // without saying so would be the same information gap ⑦ forbids.
      const note = detached.length === 0 ? "" : `\n${detached.map((entry) => {
        const where = entry.branchNowAt === null || entry.branchNowAt === undefined
          ? `branch ${entry.branch} no longer exists`
          : `branch ${entry.branch} has since moved to ${entry.branchNowAt.slice(0, 12)}`;
        return `  ${entry.tree}: detached at archived commit ${entry.archivedOid.slice(0, 12)}; ${where}`;
      }).join("\n")}`;
      return ctx.emit.result(result, 0);
    });
  }
}

/**
 * Loose entries a Grove directory holds — content that is NOT one of the Tree worktrees this
 * operation is removing.
 *
 * The previous rule exempted the whole `trees/` subtree on the assumption that everything inside it
 * is a worktree the `worktree-remove` steps already handled. Nothing enforced that. A user
 * directory at `groves/<name>/trees/<anything>` was therefore destroyed by an UNFORCED `delete` at
 * exit 0, with the machine result affirmatively reporting `discardedLoose: []`. That is precisely
 * the loss ruling ④ exists to prevent, and `rename` already preserves such content
 * (lifecycle-v3 asserts it), so delete was also inconsistent with its sibling.
 *
 * Exempt the exact Tree paths instead. A Grove with zero observed Trees exempts nothing.
 * The literal `trees` segment is likewise not the mechanism — `layout.trees` is configurable, so
 * the structure is derived from the Tree paths themselves. See `unaccountedEntries`.
 */
function assertPlannedLoose(path: string, treePaths: readonly string[], recorded: readonly string[]): void {
  const current = looseEntries(path, treePaths);
  if (current.some(entry => !recorded.includes(entry))) throw new GroveError({ kind: "refused-conflict", what: `Cannot move content ${path}`, why: "loose content appeared after planning", remedy: "Inspect the retained content and retry from fresh state.", detail: { reason: "stale-plan", recordedLoose: recorded, currentLoose: current } });
}

/**
 * Top-level loose names, used only where content is MOVED (archive, rename): movement preserves
 * everything below a name, including later additions. Deletion never uses this; it consents to a
 * recursive per-path inventory instead (`inventoryLooseContent`, FR-023).
 */
function looseEntries(contentPath: string, treePaths: readonly string[]): string[] {
  return unaccountedEntries(contentPath, treePaths);
}

/** Refuse before any durable plan when loose content cannot be itemized completely. */
function assertCompleteLooseInventory(inventory: LooseInventory, what: string): void {
  if (inventory.incomplete.length === 0) return;
  throw new GroveError({
    kind: "refused-precondition", what,
    why: `loose Grove content cannot be itemized completely: ${inventory.incomplete.map((gap) => `${gap.path} (${gap.problem})`).join("; ")}`,
    remedy: "Make the listed content readable, or move or remove it with native tools, then retry; destructive consent covers only content Grove can itemize.",
    detail: { loose: inventory.entries.map(looseEntryLabel), looseInventoryIncomplete: inventory.incomplete },
  });
}

async function deleteHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  {
    const { ws, g, snapshot, grove, abandonedDelete } = await lifecycleContext(ctx, parsed.positionals[0], true);
    if (abandonedDelete) {
      const path = resolveLayoutTarget(snapshot.layout, expandGrovePath(snapshot.layout, grove.name));
      const scaffoldOnly = () => {
        const structuralDirectories = structuralTreeSlotPaths(snapshot.layout, grove.name, snapshot.repositories.flatMap((repository) => repository.registration ? [repository.registration.name] : []));
        const inventory = inventoryLooseContent(path, [], { structuralDirectories });
        return inventory.entries.length === 0 && inventory.incomplete.length === 0;
      };
      if (scaffoldOnly()) {
        return withOperationTargetLocks(ws.root, [`grove:${grove.name}`], "delete-abandoned-scaffold", async () => {
          assertTargetsAvailable(ws.root, [`grove:${grove.name}`]);
          const content = abandonedDelete.steps.find((step) => step.kind === "directory-remove");
          const input = content?.input as { targetIdentity?: { device?: unknown; inode?: unknown } } | undefined;
          const current = captureDirectoryTarget(ws.root, "grove-content", { grove: grove.name }, path);
          if (current.device !== input?.targetIdentity?.device || current.inode !== input.targetIdentity.inode) throw new GroveError({ kind: "refused-conflict", what: `Cannot finish delete ${grove.name}`, why: "the Grove directory was replaced after the abandoned operation", remedy: "Inspect the current directory before retrying." });
          if (!scaffoldOnly()) throw new GroveError({ kind: "refused-conflict", what: `Cannot finish delete ${grove.name}`, why: "new content appeared", remedy: "Retry from fresh observed state." });
          removeContainedDirectory(containedPath(ws.root, path, `Cannot finish delete ${grove.name}`));
          const after = { grove: grove.name, deleted: true, refsRetained: true, abandonedOperationId: abandonedDelete.id };
          return ctx.emit.result(completeResult("delete", [{ selector: { grove: grove.name, path }, before: { abandonedOperationId: abandonedDelete.id }, action: "remove-empty-scaffold", after, reason: null }], snapshot.diagnostics, after), 0);
        });
      }
    }
    const manifest = groveManifest(grove);
    const recordedContent = manifest.state === "archived" && typeof manifest.archiveSnapshot?.looseContentPath === "string" ? manifest.archiveSnapshot.looseContentPath : null;
    // `archiveSnapshot.looseContentPath` is ADVISORY metadata — the constitution explicitly invites
    // users to repair or remove it, so it is attacker- and accident-shaped input to an `rm -rf`.
    //
    // Containment alone is not enough: `isSubpath(p, p)` is true, so "inside the workspace" admits
    // the workspace ROOT itself. Verified — pointing this key at the root deleted the entire
    // workspace at exit 0. Archive always writes exactly the archive-role path for the Grove, and
    // `rename` keeps it that way, so require exactly that.
    const expectedArchive = expandArchivePath(snapshot.layout, manifest.name);
    if (recordedContent && (!isAbsolute(recordedContent) || resolve(recordedContent) !== resolve(expectedArchive))) throw new GroveError({ kind: "refused-precondition", what: `Cannot delete ${grove.name}`, why: "the archived loose-content path is outside the workspace", remedy: "Repair the advisory archive snapshot first." });
    // The exact-path guard above has already proven the recorded path EQUALS the compiled archive
    // path, so the record contributes nothing to path selection — and selecting through it was a
    // hole. `resolveContained` returns the REALPATH and only checks containment, while
    // `resolveLayoutTarget` additionally refuses when lexical and canonical differ, which is
    // config-v3's stated symlink-safety guarantee. An archived Grove always has
    // `looseContentPath` set, so the containment branch was the NORMAL path and the symlink check
    // was never reached; the exact-path guards are lexical and pass straight through a symlink.
    //
    // Demonstrated before this fix, with archives/<name> replaced by a symlink to an unrelated
    // in-workspace directory: delete --allow-destructive-all destroyed it, rename moved it, and
    // restore moved it into the Grove WITH NO DESTRUCTIVE FLAG — all at exit 0.
    const contentPath = resolveLayoutTarget(snapshot.layout, manifest.state === "archived" ? expandArchivePath(snapshot.layout, grove.name) : expandGrovePath(snapshot.layout, grove.name));
    // FR-023: loose content is inventoried recursively, per path. Consent to a directory name would
    // otherwise extend to anything later added inside it, because the removal below is recursive.
    const planInventory: LooseInventory = existsSync(contentPath)
      ? inventoryLooseContent(contentPath, grove.trees.flatMap((tree) => tree.path.utf8 === null ? [] : [tree.path.utf8]), { structuralDirectories: structuralTreeSlotPaths(snapshot.layout, grove.name, snapshot.repositories.flatMap((repository) => repository.registration ? [repository.registration.name] : [])) })
      : { entries: [], incomplete: [] };
    const looseAtRisk = planInventory.entries.map(looseEntryLabel);
    // Collect both risk classes before refusing. Sequential throws hid loose files whenever a
    // dirty Tree was encountered first, even though one forced delete would destroy both.
    await refuseUnsafe(g, snapshot, grove.trees, destructiveConsent(parsed.values), looseAtRisk);
    // Ruling ④: itemize before destroying. Delete discards BOTH uncommitted files and loose Grove
    // content that was never in Git at all — the second kind exists in exactly one place, so naming
    // it is the difference between a user knowing what they lost and not.
    const discardedWork: Array<{ repositoryId: string; repositoryAlias: string; tree: string; changes: Array<{ status: string; path: string }> }> = [];
    if (destructiveConsent(parsed.values) !== "none") for (const tree of grove.trees) {
      if (!tree.dirty || tree.path.utf8 === null || !tree.selector?.repositoryId) continue;
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
      const status = await porcelainStatus(g, tree.path.utf8);
      if (repository?.registration && !status.problem && status.changes.length) discardedWork.push({ repositoryId: repository.registration.id, repositoryAlias: repository.registration.name, tree: tree.treeName ?? tree.path.display, changes: status.changes });
    }
    // Only `--allow-destructive-all` consents to loose content, and only to these exact paths.
    const consentedLoose = destructiveConsent(parsed.values) === "all" ? planInventory.entries : [];
    const consentedLabels = consentedLoose.map(looseEntryLabel);
    // A receipt names only what was removed: it stays empty unless the content step removes it.
    let discardedLoose: string[] = [];
    const targets = grove.trees.map((tree) => archiveRecipe(snapshot, tree));
    for (const recipe of targets) {
      const path = String(recipe.priorPath);
      containedPath(ws.root, path, `Cannot delete ${grove.name}`);
      assertWorktreeMutationPath(snapshot, path, { allowObservedPath: path, groveName: grove.name });
    }
    const targetPaths = targets.map((recipe) => String(recipe.priorPath));
    assertDestructiveMutationPath(snapshot, contentPath, { allowObservedPaths: targetPaths, groveName: grove.name });
    // After the nested-Git guard, so an independently owned checkout is named as such.
    assertCompleteLooseInventory(planInventory, `Cannot delete ${grove.name}`);
    const looseInventory = persistedLooseInventory({ entries: consentedLoose, incomplete: [] });
    const targetLocks = [...new Set([`grove:${grove.name}`, ...targets.flatMap(recipeTargetLocks)])].sort();
    return withOperationTargetLocks(ws.root, targetLocks, "delete", async () => {
      assertTargetsAvailable(ws.root, targetLocks);
      if (!recordedContent) resolveLayoutTarget(snapshot.layout, contentPath);
      const operation = beginOperation(ws.root, { kind: "grove-delete", scope: { grove: grove.name }, targetLocks, targets: [
        ...targets.map((recipe, index) => ({ selector: { repositoryId: recipe.selector.repositoryId, grove: grove.name, tree: recipe.selector.tree, path: String(recipe.priorPath) }, steps: [{ id: `remove-${index}`, kind: "worktree-remove", input: { ...recipe, path: String(recipe.priorPath), discardedWork: discardedWork.find(item => item.repositoryId === recipe.selector.repositoryId && item.tree === recipe.selector.tree)?.changes ?? [], consent: destructiveConsent(parsed.values) } }] })),
        { selector: { grove: grove.name }, steps: [{ id: "delete-content", kind: "directory-remove", input: { path: contentPath, looseInventory, consent: destructiveConsent(parsed.values) } }, { id: "delete-metadata", kind: "central-metadata-remove", input: { path: centralGroveManifest(ws.root, manifest.name) } }] },
      ] });
      const completedTargets: ResultTarget[] = [];
      for (let index = 0; index < targets.length; index++) {
        const recipe = targets[index]!;
        let recorded: ChangeEntry[] = [];
        let actual: ChangeEntry[] = [];
        recordPending(operation, `remove-${index}`, { path: recipe.priorPath, headOid: recipe.headOid, branch: recipe.branch });
        try {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === recipe.selector.repositoryId);
          const mutationWorktree = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === recipe.priorPath);
          if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== recipe.commonGitDir || !mutationWorktree || mutationWorktree.headOid !== recipe.headOid) throw new GroveError({ kind: "refused-conflict", what: `Cannot delete ${grove.name}`, why: "a repository or worktree identity changed at the point of use", remedy: "Retry from fresh observed state." });
          await assertWorktreeHeadRetained(g, recipe.commonGitDir, String(recipe.priorPath), recipe.headOid);
          assertWorktreeMutationPath(mutationSnapshot, String(recipe.priorPath), { allowObservedPath: String(recipe.priorPath), groveName: grove.name });
          const receipt = discardedWork.find(item => item.repositoryId === recipe.selector.repositoryId && item.tree === recipe.selector.tree);
          recorded = receipt?.changes ?? [];
          actual = await assertRecordedWork(g, String(recipe.priorPath), recorded, destructiveConsent(parsed.values));
          if (receipt) receipt.changes = actual;
          await g.removeWorktree(recipe.commonGitDir, containedPath(ws.root, String(recipe.priorPath), `Cannot delete ${grove.name}`), destructiveConsent(parsed.values) !== "none");
        }
        catch (error) { const reason = mutationFailureReason(error); recordStepFailure(operation, `remove-${index}`, "conflicted", reason, { error: String((error as Error).message ?? error) }); const result = partialResult("delete", completedTargets, { selector: { grove: grove.name, path: String(recipe.priorPath) }, before: recipe, action: "worktree-remove", after: null, reason }, snapshot.diagnostics, operation.id); return ctx.emit.result(result, commandResultExit(result)); }
        const completion = treeRemovalReceipt(grove.name, recipe, recorded, actual);
        recordCompleted(operation, `remove-${index}`, completion.postState);
        completedTargets.push(completion.target);
      }
      recordPending(operation, "delete-content", { path: contentPath, present: existsSync(contentPath) });
      if (existsSync(contentPath)) {
        try {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          assertDestructiveMutationPath(mutationSnapshot, contentPath, { allowObservedPaths: targetPaths, groveName: grove.name });
          // The Trees are gone now, so anything at a Tree path is new content, not an exemption.
          const current = inventoryLooseContent(contentPath, targetPaths, { accountedPresent: "inventory", structuralDirectories: structuralTreeSlotPaths(snapshot.layout, grove.name, snapshot.repositories.flatMap((repository) => repository.registration ? [repository.registration.name] : [])) });
          const remaining = current.entries.map(looseEntryLabel);
          const refuseLoose = (facts: Record<string, unknown>, why: string) => {
            recordStepFailure(operation, "delete-content", "conflicted", "stale-plan", facts);
            const consent = destructiveConsent(parsed.values);
            const rerun = `grove delete ${grove.name}${consent === "all" ? " --allow-destructive-all" : consent === "ignored" ? " --allow-destructive-git-ignored" : ""}`;
            const remedy = `No loose content was removed. Move anything to keep out of ${contentPath}, then run \`grove reconcile --abandon ${operation.id}\` and \`${rerun}\` to plan and consent from current content.`;
            const result = partialResult("delete", completedTargets, { selector: { grove: grove.name, path: contentPath }, before: facts, action: "directory-remove", after: null, reason: "stale-plan", detail: { why, remedy } }, snapshot.diagnostics, operation.id);
            return ctx.emit.result(result, commandResultExit(result));
          };
          if (current.incomplete.length) return refuseLoose({ recordedLoose: consentedLabels, currentLoose: remaining, looseInventoryIncomplete: current.incomplete }, "loose Grove content cannot be itemized completely at the point of use");
          if (remaining.length && destructiveConsent(parsed.values) !== "all") return refuseLoose({ looseEntries: remaining, recordedLoose: [], currentLoose: remaining, addedLoose: remaining }, "loose Grove content appeared without consent");
          const addedLoose = unconsentedLooseEntries({ entries: consentedLoose, legacy: false }, current.entries).map(looseEntryLabel);
          if (addedLoose.length) return refuseLoose({ looseEntries: addedLoose, addedAfterPreflight: true, recordedLoose: consentedLabels, currentLoose: remaining, addedLoose }, `loose content appeared after the destructive plan was recorded: ${addedLoose.join(", ")}`);
          discardedLoose = remaining;
          removeContainedDirectory(containedPath(ws.root, contentPath, `Cannot delete ${grove.name}`));
        }
        catch (error) {
          recordStepFailure(operation, "delete-content", "conflicted", "stale-plan", { error: String((error as Error).message ?? error) });
          return ctx.emit.result(partialResult("delete", completedTargets, { selector: { grove: grove.name, path: contentPath }, before: null, action: "directory-remove", after: null, reason: "stale-plan" }, snapshot.diagnostics, operation.id), 4);
        }
      }
      const contentReceipt = { present: false, recordedLoose: consentedLabels, discardedLoose };
      recordCompleted(operation, "delete-content", contentReceipt);
      completedTargets.push({ selector: { grove: grove.name, path: contentPath }, before: null, action: "directory-remove", after: contentReceipt, reason: null });
      const metadataPath = centralGroveManifest(ws.root, manifest.name);
      recordPending(operation, "delete-metadata", { revision: grove.metadata?.meta.rev ?? null, present: grove.metadata !== null });
      try { if (grove.metadata && existsSync(metadataPath)) removeContainedFile(containedPath(ws.root, metadataPath, `Cannot delete ${grove.name} metadata`)); }
      catch (error) {
        const reason = stepFailureReason(error);
        const why = String((error as Error).message ?? error);
        recordStepFailure(operation, "delete-metadata", "recoverable-intermediate", reason, { error: why });
        const result = partialResult("delete", completedTargets, { selector: { grove: grove.name, path: metadataPath }, before: null, action: "central-metadata-remove", after: null, reason, detail: { why, remedy: metadataStepRemedy(operation.id, "delete") } }, snapshot.diagnostics, operation.id);
        return ctx.emit.result(result, commandResultExit(result));
      }
      recordCompleted(operation, "delete-metadata", { present: false });
      const after = { grove: grove.name, deleted: true, refsRetained: true, discardedWork: discardedWork.filter(item => item.changes.length), discardedLoose };
      const result = { ...completeResult("delete", [{ selector: { grove: grove.name }, before: { state: manifest.state, trees: targets.length }, action: "delete", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
      return ctx.emit.result(result, 0);
    });
  }
}

async function renameHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ref = parsed.positionals[0];
  const newName = parsed.positionals[1];
  if (!ref || !newName) throw new GroveError({ kind: "invalid-input", what: "rename requires <grove> <name>", why: "missing positional arguments", remedy: "Use `grove rename <grove> <name>`." });
  assertGroveName(newName);
  {
    const { ws, g, snapshot, grove } = await lifecycleContext(ctx, ref);
    if (snapshot.groves.some((candidate) => candidate !== grove && caseFoldKey(candidate.name) === caseFoldKey(newName))) throw new GroveError({ kind: "refused-conflict", what: `Cannot rename to "${newName}"`, why: "another active or advisory Grove holds that case-folded name", remedy: "Choose another name." });
    const manifest = groveManifest(grove);
    const recordedOldRoot = manifest.state === "archived" && typeof manifest.archiveSnapshot?.looseContentPath === "string" ? manifest.archiveSnapshot.looseContentPath : null;
    // Third instance of the same pattern. An archived Grove's recorded root must be exactly the
    // archive-role path for its CURRENT name; anything else is drift or tampering, not a rename.
    if (recordedOldRoot && (!isAbsolute(recordedOldRoot) || resolve(recordedOldRoot) !== resolve(expandArchivePath(snapshot.layout, manifest.name)))) throw new GroveError({ kind: "refused-precondition", what: `Cannot rename ${grove.name}`, why: "the archived loose-content path is outside the workspace", remedy: "Repair the advisory archive snapshot first." });
    // The exact-path guard above has already proven the recorded path EQUALS the compiled archive
    // path, so the record contributes nothing to path selection — and selecting through it was a
    // hole. `resolveContained` returns the REALPATH and only checks containment, while
    // `resolveLayoutTarget` additionally refuses when lexical and canonical differ, which is
    // config-v3's stated symlink-safety guarantee. An archived Grove always has
    // `looseContentPath` set, so the containment branch was the NORMAL path and the symlink check
    // was never reached; the exact-path guards are lexical and pass straight through a symlink.
    //
    // Demonstrated before this fix, with archives/<name> replaced by a symlink to an unrelated
    // in-workspace directory: delete --allow-destructive-all destroyed it, rename moved it, and
    // restore moved it into the Grove WITH NO DESTRUCTIVE FLAG — all at exit 0.
    const oldRoot = resolveLayoutTarget(snapshot.layout, manifest.state === "archived" ? expandArchivePath(snapshot.layout, grove.name) : expandGrovePath(snapshot.layout, grove.name));
    const newRoot = resolveLayoutTarget(snapshot.layout, manifest.state === "archived" ? expandArchivePath(snapshot.layout, newName) : expandGrovePath(snapshot.layout, newName));
    if (existsSync(newRoot) && oldRoot !== newRoot) throw new GroveError({ kind: "refused-conflict", what: `Cannot rename to "${newName}"`, why: `${newRoot} is occupied`, remedy: "Move the conflicting path and retry." });
    const targetLocks = [...new Set([`grove:${grove.name}`, `grove:${newName}`, ...grove.trees.flatMap((tree) => {
      if (!tree.path.utf8 || !tree.selector?.repositoryId) return [];
      const branch = tree.branch?.utf8?.replace(/^refs\/heads\//, "") ?? null;
      return [`worktree:${resolve(tree.path.utf8)}`, ...(branch ? [`repository:${tree.selector.repositoryId}:branch:${branch}`] : [])];
    })])].sort();
    const plannedMergeRoots = manifest.state === "active" ? collectDirectoryMergeRoots(oldRoot, newRoot, grove.trees.flatMap((tree) => tree.path.utf8 ? [tree.path.utf8] : [])) : [];
    return withOperationTargetLocks(ws.root, targetLocks, "rename", async () => {
      assertTargetsAvailable(ws.root, targetLocks);
      resolveLayoutTarget(snapshot.layout, newRoot);
      if (manifest.state === "active") for (const tree of grove.trees) {
        const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
        if (!repository?.registration || tree.path.utf8 === null || !tree.treeName) continue;
        const to = resolveLayoutTarget(snapshot.layout, expandTreePath(snapshot.layout, newName, tree.treeName, repository.registration.name));
        containedPath(ws.root, tree.path.utf8, `Cannot rename ${grove.name}`);
        containedPath(ws.root, to, `Cannot rename ${grove.name}`);
        assertWorktreeMutationPath(snapshot, tree.path.utf8, { allowObservedPath: tree.path.utf8, groveName: grove.name });
        assertWorktreeMutationPath(snapshot, to, { groveName: newName });
      }
      const observedTreePaths = grove.trees.flatMap((tree) => tree.path.utf8 ? [tree.path.utf8] : []);
      assertDestructiveMutationPath(snapshot, oldRoot, { allowObservedPaths: observedTreePaths, groveName: grove.name });
      assertDestructiveMutationPath(snapshot, newRoot, { groveName: newName });
      const plannedLoose = looseEntries(oldRoot, observedTreePaths);
      const operation = beginOperation(ws.root, { kind: "grove-rename", scope: { grove: grove.name, newName }, targetLocks, targets: [
        ...grove.trees.map((tree, index) => { const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId); return { selector: { repositoryId: tree.selector?.repositoryId ?? "", grove: grove.name, tree: tree.treeName ?? "", path: tree.path.utf8 ?? "" }, steps: [{ id: `move-${index}`, kind: "worktree-move", input: { from: tree.path.utf8, to: tree.treeName && tree.selector ? expandTreePath(snapshot.layout, newName, tree.treeName, repository?.registration?.name ?? tree.selector.repositoryId) : null, headOid: tree.headOid, commonGitDir: repository?.commonGitDir ?? null } }] }; }),
        { selector: { grove: grove.name }, steps: [{ id: "move-content", kind: manifest.state === "archived" ? "directory-move" : "directory-merge", input: { from: oldRoot, to: newRoot, plannedLoose, ...(manifest.state === "active" ? { mergeRoots: plannedMergeRoots } : {}) } }, { id: "rename-metadata", kind: "central-metadata-update", input: { oldName: grove.name, newName, manifest } }] },
      ] });
      const movedPaths: string[] = [];
      if (manifest.state === "active") {
        if (existsSync(newRoot)) { recordStepFailure(operation, "move-content", "conflicted", "stale-plan", { destinationOccupied: true }); return ctx.emit.result({ ...completeResult("rename", [{ selector: { grove: grove.name, path: newRoot }, before: null, action: "reserve-destination", after: null, reason: "stale-plan" }], snapshot.diagnostics), outcome: "blocked", operationId: operation.id }, 4); }
        mkdirSync(dirname(newRoot), { recursive: true });
        mkdirSync(newRoot);
        const destinationRootIdentity = captureDirectoryTarget(ws.root, "active-grove", { grove: newName }, newRoot);
        for (let index = 0; index < grove.trees.length; index++) {
          const tree = grove.trees[index]!;
          const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
          if (!repository?.registration || tree.path.utf8 === null || !tree.treeName) { recordStepFailure(operation, `move-${index}`, "conflicted", "invalid-config"); return ctx.emit.result({ ...completeResult("rename", [{ selector: { grove: grove.name }, before: null, action: "worktree-move", after: null, reason: "invalid-config" }], snapshot.diagnostics), outcome: "blocked", operationId: operation.id }, 8); }
          const to = expandTreePath(snapshot.layout, newName, tree.treeName, repository.registration.name);
          resolveLayoutTarget(snapshot.layout, to);
          recordPending(operation, `move-${index}`, { from: tree.path.utf8, to, headOid: tree.headOid, destinationRootIdentity });
          resolveLayoutTarget(snapshot.layout, to);
          mkdirSync(dirname(to), { recursive: true });
          try {
            const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
            const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
            const mutationWorktree = mutationRepository?.worktrees.find(candidate => candidate.path.utf8 === tree.path.utf8);
            if (!mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== repository.commonGitDir || !mutationWorktree || mutationWorktree.headOid !== tree.headOid) throw new GroveError({ kind: "refused-conflict", what: `Cannot rename ${grove.name}`, why: "the registered repository binding changed after planning", remedy: "Retry from fresh observed state." });
            await assertWorktreeHeadRetained(g, mutationRepository.commonGitDir, tree.path.utf8, tree.headOid);
            assertWorktreeMutationPath(mutationSnapshot, tree.path.utf8, { allowObservedPath: tree.path.utf8, groveName: grove.name });
            assertWorktreeMutationPath(mutationSnapshot, to, { groveName: newName });
            await g.moveWorktree(
              repository.commonGitDir,
              containedPath(ws.root, tree.path.utf8, `Cannot rename ${grove.name}`),
              containedPath(ws.root, to, `Cannot rename ${grove.name}`),
            );
          }
          catch (error) { const reason = mutationFailureReason(error); recordStepFailure(operation, `move-${index}`, "conflicted", reason, { error: String((error as Error).message ?? error) }); return ctx.emit.result({ ...completeResult("rename", [{ selector: { grove: grove.name, path: tree.path.utf8 }, before: null, action: "worktree-move", after: null, reason }], snapshot.diagnostics), outcome: "partial", operationId: operation.id }, reason === "stale-plan" ? 4 : 6); }
          const rebound = captureDirectoryTarget(ws.root, "active-grove", { grove: newName }, newRoot);
          movedPaths.push(to);
          try { if (rebound.device !== destinationRootIdentity.device || rebound.inode !== destinationRootIdentity.inode) throw new Error("destination identity changed"); assertDirectoryContainsOnlyRoots(newRoot, movedPaths); }
          catch (error) { recordStepFailure(operation, `move-${index}`, "conflicted", "stale-plan", { error: String((error as Error).message ?? error) }); return ctx.emit.result({ ...completeResult("rename", [{ selector: { grove: grove.name, path: newRoot }, before: null, action: "verify-destination", after: { moved: movedPaths }, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial", operationId: operation.id }, 4); }
          recordCompleted(operation, `move-${index}`, { path: to, headOid: tree.headOid, destinationRootIdentity });
        }
      }
      try {
        recordPending(operation, "move-content", { from: oldRoot, to: newRoot, sourcePresent: existsSync(oldRoot), fromIdentity: captureDirectoryTarget(ws.root, manifest.state === "archived" ? "archive-grove" : "active-grove", { grove: grove.name }, oldRoot), toIdentity: captureDirectoryTarget(ws.root, manifest.state === "archived" ? "archive-grove" : "active-grove", { grove: newName }, newRoot), ...(manifest.state === "active" ? { mergeRoots: plannedMergeRoots } : {}) });
        resolveLayoutTarget(snapshot.layout, newRoot);
        if (manifest.state === "archived" && existsSync(oldRoot)) {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          assertDestructiveMutationPath(mutationSnapshot, oldRoot, { allowObservedPaths: observedTreePaths, groveName: grove.name });
          assertDestructiveMutationPath(mutationSnapshot, newRoot, { groveName: newName });
          mkdirSync(dirname(newRoot), { recursive: true });
          assertPlannedLoose(oldRoot, observedTreePaths, plannedLoose);
          moveContainedDirectory(
            containedPath(ws.root, oldRoot, `Cannot rename ${grove.name}`),
            containedPath(ws.root, newRoot, `Cannot rename ${grove.name}`),
          );
        }
        else {
          const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), g);
          assertDestructiveMutationPath(mutationSnapshot, oldRoot, { allowObservedPaths: observedTreePaths, groveName: grove.name });
          // The worktrees moved by the preceding typed steps are now observed beneath the new
          // Grove root. They are the exact intended merge inputs, not foreign ownership.
          assertDestructiveMutationPath(mutationSnapshot, newRoot, { allowObservedPaths: movedPaths, groveName: newName });
          assertDirectoryContainsOnlyRoots(oldRoot, plannedMergeRoots.map((path) => join(oldRoot, relative(newRoot, path))), []);
          assertDirectoryContainsOnlyRoots(newRoot, [...movedPaths, ...plannedMergeRoots], movedPaths);
          assertPlannedLoose(oldRoot, observedTreePaths, plannedLoose);
          mergeDirectoryForward(
            containedPath(ws.root, oldRoot, `Cannot rename ${grove.name}`),
            containedPath(ws.root, newRoot, `Cannot rename ${grove.name}`),
          );
        }
      }
      catch (error) {
        recordStepFailure(operation, "move-content", "conflicted", "stale-plan", { error: String((error as Error).message ?? error) });
        return ctx.emit.result({ ...completeResult("rename", [{ selector: { grove: grove.name, path: oldRoot }, before: null, action: manifest.state === "archived" ? "directory-move" : "directory-merge", after: null, reason: "stale-plan" }], snapshot.diagnostics), outcome: "partial", operationId: operation.id }, 4);
      }
      recordCompleted(operation, "move-content", { path: newRoot });
      recordPending(operation, "rename-metadata", { revision: grove.metadata?.meta.rev ?? null, oldName: grove.name, newName });
      const next = { ...manifest, name: newName, archiveSnapshot: manifest.archiveSnapshot ? { ...manifest.archiveSnapshot, looseContentPath: manifest.archiveSnapshot.looseContentPath ? newRoot : null } : null };
      let meta: Awaited<ReturnType<typeof saveGroveManifest>>;
      try { meta = await saveGroveManifest(ws.root, next); }
      catch (error) {
        const why = String((error as Error).message ?? error);
        recordStepFailure(operation, "rename-metadata", "recoverable-intermediate", stepFailureReason(error), { error: why });
        throw new GroveError({ kind: "io", what: `Rename metadata for ${grove.name} was not saved`, why, remedy: `Correct the cause, then run \`grove reconcile --operation ${operation.id}\` to finish the rename.`, detail: { operationId: operation.id } });
      }
      if (grove.metadata && grove.name !== newName && existsSync(centralGroveManifest(ws.root, grove.name))) removeContainedFile(containedPath(ws.root, centralGroveManifest(ws.root, grove.name), `Cannot rename ${grove.name} metadata`));
      recordCompleted(operation, "rename-metadata", { revision: meta.rev, name: newName });
      const after = { id: next.id, name: newName, from: grove.name, state: next.state, path: newRoot };
      const result = { ...completeResult("rename", [{ selector: { grove: grove.name }, before: { name: grove.name, path: oldRoot }, action: "rename", after, reason: null }], snapshot.diagnostics, after), operationId: operation.id };
      return ctx.emit.result(result, 0);
    });
  }
}

async function configureHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ref = parsed.positionals[0];
  if (!ref) throw new GroveError({ kind: "invalid-input", what: "configure requires <grove>", why: "no Grove was supplied", remedy: "Run `grove ls`." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const grove = snapshot.groves.find((candidate) => candidate.name === ref || candidate.metadata?.manifest.id === ref);
  if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${ref}"`, why: "no observed or advisory Grove matches", remedy: "Run `grove ls`." });
  const manifest = grove.metadata?.manifest ?? newGroveManifest(grove.name);
  let changed = grove.metadata === null;
  const next = { ...manifest };
  if (parsed.values["clear-default-agent"]) { next.defaultAgent = null; changed = true; }
  else if (parsed.values["default-agent"] !== undefined) { next.defaultAgent = parsed.values["default-agent"]; changed = true; }
  if (parsed.values["clear-default-base"]) { next.defaultBase = null; changed = true; }
  else if (parsed.values["default-base"] !== undefined) {
    // P5.3 (ledger V-4). Principle V: revision inputs are validated BEFORE use. This was accepted
    // unvalidated, so `configure` exited 0, `doctor` reported the workspace clean, and the failure
    // surfaced much later as `commits` failing on every Tree at once. The deferred failure IS the
    // defect: it separates the mistake from its report by an arbitrary amount of time.
    const base = String(parsed.values["default-base"]);
    const resolvable: string[] = [];
    for (const tree of grove.trees) {
      const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
      if (!repository) continue;
      const probe = await git().tryRun(repository.commonGitDir, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
      if (probe.exitCode === 0) resolvable.push(repository.registration?.name ?? repository.commonGitDir);
    }
    if (grove.trees.length > 0 && resolvable.length === 0) {
      throw new GroveError({
        kind: "refused-precondition",
        what: `Cannot set the default base to "${base}"`,
        why: "it does not resolve to a commit in any repository this Grove has a Tree in",
        remedy: "Use an existing branch, tag, or commit — check with `git rev-parse` in the repository.",
        detail: { base, repositories: grove.trees.length },
      });
    }
    next.defaultBase = parsed.values["default-base"];
    changed = true;
  }
  if (changed) await saveGroveManifest(ws.root, next, grove.metadata?.meta);
  const after = { grove: grove.name, defaultAgent: next.defaultAgent, defaultBase: next.defaultBase, changed };
  const result = completeResult("configure", [{ selector: { grove: grove.name }, before: { defaultAgent: manifest.defaultAgent, defaultBase: manifest.defaultBase }, action: "configure", after, reason: null }], snapshot.diagnostics, after);
  return ctx.emit.result(result, 0);
}

export function registerLifecycle(): void {
  register({
    path: "archive",
    summary: "Archive an active Grove (work-safe).",
    usage: "archive <grove> [--allow-destructive-all | --allow-destructive-git-ignored] [--allow-unpushed]",
    args: [
      { name: "<grove>", desc: "Active Grove to archive." },
      { name: "--allow-destructive-all", desc: "Discard uncommitted files and archive anyway. You will lose that work." },
      { name: "--allow-destructive-git-ignored", desc: "Discard only itemized Git-ignored files." },
      { name: "--allow-unpushed", desc: "Archive even though the branch is not pushed to a remote." },
    ],
    note: "Removes observed worktrees while retaining every ref and records an advisory restore snapshot. Interrupted structural steps remain forward-recoverable through reconcile.",
    examples: [
      "grove archive pricing-fix          # tear down worktrees; keep branches for later restore",
      "grove archive pricing-fix --allow-destructive-all  # archive even with uncommitted files, discarding them",
      "grove archive pricing-fix --allow-unpushed     # archive even though the branch is not pushed",
    ],
    handler: archiveHandler,
    mutates: true,
  });
  register({
    path: "restore",
    summary: "Restore an archived Grove to active.",
    usage: "restore <grove> [--latest]",
    args: [
      { name: "<grove>", desc: "Archived Grove to restore (refused if an active Grove holds its name)." },
      { name: "--latest", desc: "Check out the branch's current tip instead of the commit recorded at archive time." },
    ],
    note: "Restores the exact commit recorded at archive time. If the branch has advanced since, the Tree is restored DETACHED at that commit and the move is reported — it is not an error. Pass --latest to follow the branch tip instead. Interrupted structural steps remain visible to reconcile.",
    examples: [
      "grove restore pricing-fix           # rebuild at the exact commits that were archived",
      "grove restore pricing-fix --latest  # rebuild at each branch's current tip instead",
    ],
    handler: restoreHandler,
    mutates: true,
  });
  register({
    path: "delete",
    summary: "Permanently delete a Grove.",
    usage: "delete <grove> [--allow-destructive-all | --allow-destructive-git-ignored]",
    args: [
      { name: "<grove>", desc: "Grove to delete (active or archived)." },
      { name: "--allow-destructive-all", desc: "Discard uncommitted files AND loose files that were never in Git, then delete. You will lose that work permanently." },
      { name: "--allow-destructive-git-ignored", desc: "Discard only itemized Git-ignored files; loose Grove content still blocks deletion." },
    ],
    note: "Removes worktrees and loose Grove content but retains every Git ref. Branch deletion remains a native Git action.",
    examples: [
      "grove delete pricing-fix          # remove Grove worktrees and content; retain all refs",
      "grove delete pricing-fix --allow-destructive-all  # delete even with uncommitted/unpushed/loose content, discarding it",
    ],
    handler: deleteHandler,
    mutates: true,
  });
  register({
    path: "rename",
    summary: "Rename a Grove without changing identity.",
    usage: "rename <grove> <name>",
    args: [
      { name: "<grove>", desc: "Grove to rename." },
      { name: "<name>", desc: "New name (refused if held by any active or archived Grove)." },
    ],
    note: "Identity (the manifest id) and branches never change; only the directory and worktrees move. An interrupted rename is resumed by `grove reconcile`.",
    examples: ["grove rename pricing-fix pricing-hotfix  # keep the same id and branches under a new name"],
    handler: renameHandler,
    mutates: true,
  });
  register({
    path: "configure",
    summary: "Change Grove-owned settings.",
    usage: "configure <grove> [--default-agent <agent>|--clear-default-agent] [--default-base <branch>|--clear-default-base]",
    args: [
      { name: "<grove>", desc: "Grove to configure." },
      { name: "--default-agent <agent>", desc: "Set the default agent for `grove agent` in this Grove." },
      { name: "--clear-default-agent", desc: "Clear the Grove's default agent." },
      { name: "--default-base <branch>", desc: "Set the default comparison base for review/diff." },
      { name: "--clear-default-base", desc: "Clear the default base (Trees fall back to their repo trunk)." },
    ],
    note: "If both an option and its --clear- pair are passed, the clear wins.",
    examples: [
      "grove configure pricing-fix --default-agent claude --default-base main  # set both defaults",
      "grove configure pricing-fix --clear-default-base                        # drop the base; fall back to trunk",
    ],
    handler: configureHandler,
    mutates: true,
  });
}
