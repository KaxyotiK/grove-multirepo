import { auditWorktree, makeDiagnostic, type Diagnostic } from "./conformance.ts";
import type { LoadedWorkspace } from "../config/workspace.ts";
import type { RepositoryEntry, TreeSelector } from "./types.ts";
import { compileLayout, compiledLayoutRoots, expandArchivePath, expandGrovePath, expandRepositoryPath, expandTreePath, expandTrunkPath, groveTreeRoot, matchLayoutPath, type CompiledLayout } from "../config/layout.ts";
import { Git, type RawWorktreeEntry, type RepositoryIdentity } from "../git/adapter.ts";
import { porcelainStatus } from "../git/worktree.ts";
import { scanCentralGroveMetadata } from "../config/grove-catalog.ts";
import { allocateDir, isValidTrunkAllocation, valueBytesJson, type NativePath, type RefName } from "./encoding.ts";
import { scanTemplateCandidates } from "../config/discovery.ts";
import { assertNoNestedGitOwnership, isStrictSubpath, isSubpath } from "../paths/fs.ts";
import { expectedBranch, expectedTreeName } from "../config/conventions.ts";
import { caseFoldKey } from "./validate.ts";
import { GroveError } from "../errors.ts";
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface RepositoryIndexInput { registration: { id: string; name: string } | null; commonGitDir: string }
export function indexRepositoriesByCommonDir(repositories: readonly RepositoryIndexInput[]): { index: Map<string, RepositoryIndexInput>; diagnostics: Diagnostic[] } {
  const grouped = new Map<string, RepositoryIndexInput[]>();
  for (const repo of repositories) grouped.set(repo.commonGitDir, [...(grouped.get(repo.commonGitDir) ?? []), repo]);
  const index = new Map<string, RepositoryIndexInput>();
  const diagnostics: Diagnostic[] = [];
  for (const [commonGitDir, matches] of grouped) {
    if (matches.length === 1) index.set(commonGitDir, matches[0] as RepositoryIndexInput);
    else diagnostics.push(makeDiagnostic({ code: "duplicate-repository-anchor", severity: "blocking", subject: { kind: "repository-anchor", commonGitDir }, facts: { repositoryIds: matches.map((r) => r.registration?.id ?? null).sort() }, summary: "Multiple repository registrations resolve to one Git common directory", remedy: "Remove or correct the duplicate repository registration." }));
  }
  return { index, diagnostics };
}

export type WorktreeRole = "managed-store" | "trunk" | "tree" | "external" | "unclassified";
export interface ObservedWorktree {
  path: NativePath;
  headOid: string | null;
  branch: RefName | null;
  upstream: RefName | null;
  bare: boolean;
  unborn: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  branchPresent: boolean | null;
  dirty: boolean | null;
  sequencer: { kind: string; path: string } | null;
  ahead: number | null;
  behind: number | null;
  role: WorktreeRole;
  /** Set when this out-of-workspace worktree's branch matches a Grove's derived Tree branch (③). */
  externalCollision: { grove: string; tree: string } | null;
  selector: TreeSelector | null;
  groveName: string | null;
  treeName: string | null;
  expectedPath: string | null;
}
export interface ObservedRepository {
  registration: RepositoryEntry | null;
  registrationStatus: "registered" | "unregistered";
  anchorPath: string;
  commonGitDir: string;
  gitDir: string;
  identity: RepositoryIdentity | null;
  worktrees: ObservedWorktree[];
  problem: string | null;
}
export interface ObservedGrove { name: string; trees: ObservedWorktree[]; metadata: ReturnType<typeof scanCentralGroveMetadata>["groves"][number] | null }
export interface ObservedWorkspace { startedAt: string; completedAt: string; workspace: LoadedWorkspace; layout: CompiledLayout; repositories: ObservedRepository[]; groves: ObservedGrove[]; diagnostics: Diagnostic[] }
type MutationPathOptions = { allowObservedPath?: string; allowObservedPaths?: readonly string[]; groveName?: string };

class UnresolvablePath extends Error {
  readonly path: string;
  constructor(path: string) { super(`Cannot resolve ${path}`); this.path = path; }
}

/** Resolve every existing prefix through native filesystem identity, preserving a missing tail. */
function physicalPath(value: string): string {
  let probe = resolve(value);
  const tail: string[] = [];
  for (;;) {
    try { return resolve(realpathSync.native(probe), ...tail); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw new UnresolvablePath(value);
      const parent = dirname(probe);
      if (parent === probe) return resolve(value);
      tail.unshift(basename(probe));
      probe = parent;
    }
  }
}

function resolvedWorktreeMutationConflict(
  layout: CompiledLayout,
  repositories: readonly ObservedRepository[],
  groveNames: readonly string[],
  candidate: string,
  options: MutationPathOptions & { protectOwnGroveRoot?: boolean } = {},
): { kind: "layout-root" | "grove-content-root" | "grove-tree-root" | "repository-anchor" | "trunk" | "worktree"; protectedPath: string } | null {
  const path = resolve(candidate);
  // Ownership follows filesystem identity, not spelling. Resolve existing prefixes so a layout
  // symlink cannot make a protected checkout look lexically unrelated to the directory that owns it.
  const contains = (owner: string, protectedPath: string): boolean => isSubpath(physicalPath(owner), physicalPath(protectedPath));
  const protectedRoots = [resolve(layout.workspaceRoot, ".grove"), ...compiledLayoutRoots(layout)];
  for (const protectedPath of protectedRoots) {
    if (contains(path, protectedPath)) return { kind: "layout-root", protectedPath };
  }
  for (const grove of groveNames) {
    if (grove === options.groveName) {
      const protectedPath = expandGrovePath(layout, grove);
      if (options.protectOwnGroveRoot && contains(path, protectedPath)) return { kind: "grove-content-root", protectedPath };
      continue;
    }
    const protectedPath = groveTreeRoot(layout, grove);
    if (contains(path, protectedPath)) return { kind: "grove-tree-root", protectedPath };
  }
  for (const repository of repositories) {
    if (repository.registration && contains(path, repository.anchorPath)) return { kind: "repository-anchor", protectedPath: repository.anchorPath };
  }
  const allowedObserved = new Set([...(options.allowObservedPaths ?? []), ...(options.allowObservedPath ? [options.allowObservedPath] : [])].map(physicalPath));
  for (const repository of repositories) for (const worktree of repository.worktrees) {
    const protectedPath = worktree.path.canonicalUtf8;
    if (protectedPath === null || allowedObserved.has(physicalPath(protectedPath))) continue;
    if (contains(path, protectedPath)) return { kind: worktree.role === "trunk" ? "trunk" : "worktree", protectedPath };
  }
  return null;
}

function worktreeMutationConflict(
  ...args: Parameters<typeof resolvedWorktreeMutationConflict>
): ReturnType<typeof resolvedWorktreeMutationConflict> | { kind: "unresolvable"; protectedPath: string; unresolvable: true } {
  try { return resolvedWorktreeMutationConflict(...args); }
  catch (error) {
    if (error instanceof UnresolvablePath) return { kind: "unresolvable", protectedPath: error.path, unresolvable: true };
    throw error;
  }
}

/** Refuse a Git worktree remove/move endpoint that owns workspace structure or another checkout. */
export function assertWorktreeMutationPath(
  snapshot: ObservedWorkspace,
  candidate: string,
  options: MutationPathOptions = {},
): void {
  const conflict = worktreeMutationConflict(snapshot.layout, snapshot.repositories, snapshot.groves.map((grove) => grove.name), candidate, options);
  if (conflict) throw new GroveError({
    kind: "refused-conflict", what: `Cannot mutate path ${candidate}`,
    why: `it equals or contains protected ${conflict.kind} ${conflict.protectedPath}`,
    remedy: "Retry from fresh observed state after moving the target to an isolated layout path.",
    detail: { reason: "stale-plan", candidate: resolve(candidate), protectedKind: conflict.kind, protectedPath: conflict.protectedPath, ...(conflict.kind === "unresolvable" ? { unresolvable: true } : {}) },
  });
  const allowed = new Set([...(options.allowObservedPaths ?? []), ...(options.allowObservedPath ? [options.allowObservedPath] : [])].map(physicalPath));
  const observedRoots = snapshot.repositories.flatMap((repository) => repository.worktrees)
    .map((worktree) => worktree.path.canonicalUtf8)
    .filter((path): path is string => path !== null && allowed.has(physicalPath(path)));
  assertNoNestedGitOwnership(candidate, observedRoots);
}

/** Apply the same ownership rule before direct filesystem directory destruction or movement. */
export const assertDestructiveMutationPath = assertWorktreeMutationPath;

type WorktreeClassification = Pick<ObservedWorktree, "role" | "selector" | "groveName" | "treeName" | "expectedPath">;

function classifyRaw(raw: RawWorktreeEntry, registration: RepositoryEntry | null, anchorPath: string, layout: CompiledLayout): WorktreeClassification {
  if (raw.path.canonicalUtf8 === null) return { role: "external", selector: null, groveName: null, treeName: null, expectedPath: null };
  if (registration?.location.kind === "managed" && raw.bare && anchorPath === raw.path.canonicalUtf8) {
    return { role: "managed-store", selector: null, groveName: null, treeName: null, expectedPath: anchorPath };
  }
  const match = matchLayoutPath(layout, raw.path.canonicalUtf8);
  if (registration?.location.kind === "managed" && match?.role === "trunk" && match.trunk && raw.branch?.utf8?.startsWith("refs/heads/")) {
    const branch = raw.branch.utf8.slice("refs/heads/".length);
    if (isValidTrunkAllocation(match.trunk, branch, registration.name, raw.branch.raw)) {
      // The registered Git worktree path is the live fact. Valid deterministic and historical
      // suffix allocations remain conforming in place rather than being recomputed.
      return { role: "trunk", selector: null, groveName: null, treeName: null, expectedPath: raw.path.canonicalUtf8 };
    }
    const expectedAllocation = allocateDir({ branch, repo: registration.name, canonicalFullRef: raw.branch.raw, taken: new Set() });
    return { role: "trunk", selector: null, groveName: null, treeName: null, expectedPath: expandTrunkPath(layout, expectedAllocation) };
  }
  if (registration?.location.kind === "managed" && match?.role === "trunk" && match.trunk && raw.branch === null) {
    return { role: "trunk", selector: null, groveName: null, treeName: null, expectedPath: raw.path.canonicalUtf8 };
  }
  if (match?.role === "tree" && match.grove && match.tree) {
    if (registration) {
      // Issue #18: a `{repo}` segment is a claim about ownership that Git decides. The owner is the
      // registration whose `git worktree list` reported this entry, so a Tree sitting in another
      // repository's slot is misplaced; its conforming path keeps the observed Grove and Tree names.
      // A case variant can name the same directory on a case-insensitive volume, but on a
      // case-sensitive volume its path is distinct from the owner's configured slot.
      const ownerPath = expandTreePath(layout, match.grove, match.tree, registration.name);
      let sameDirectory = raw.path.canonicalUtf8 === ownerPath;
      if (!sameDirectory) {
        try {
          const current = statSync(raw.path.canonicalUtf8);
          const owner = statSync(ownerPath);
          sameDirectory = current.dev === owner.dev && current.ino === owner.ino;
        } catch { /* A missing owner slot is distinct. */ }
      }
      const expectedPath = match.repo !== undefined && !sameDirectory ? ownerPath : raw.path.canonicalUtf8;
      return { role: "tree", selector: { repositoryId: registration.id, tree: match.tree }, groveName: match.grove, treeName: match.tree, expectedPath };
    }
    return { role: "unclassified", selector: null, groveName: match.grove, treeName: match.tree, expectedPath: raw.path.canonicalUtf8 };
  }
  return { role: "external", selector: null, groveName: null, treeName: null, expectedPath: null };
}

function activeGroveNames(layout: CompiledLayout, catalog: ReturnType<typeof scanCentralGroveMetadata>): string[] {
  const names = new Set(catalog.groves.filter((entry) => entry.state === "active").map((entry) => entry.name));
  for (const path of scanTemplateCandidates(layout.workspaceRoot, layout.config.groves)) {
    const match = matchLayoutPath(layout, path);
    if (match?.role === "grove" && match.grove) names.add(match.grove);
  }
  return [...names].sort();
}

/**
 * Grove-position directories that hold at least one Tree-position directory.
 *
 * Existence alone is deliberately NOT enough. `git worktree remove` deletes the Tree directory but
 * leaves `groves/<name>/trees/` behind as an empty husk, and treating that husk as a Grove would
 * resurrect something the user just removed with native Git — the opposite of "Git owns live state".
 * A directory holding real checkouts is a different thing: it is content in layout position that
 * Grove must not pretend is absent.
 */
/** Archive-position directories on disk, whatever the advisory records claim. */
function archiveDirectories(layout: CompiledLayout): Set<string> {
  const names = new Set<string>();
  for (const path of scanTemplateCandidates(layout.workspaceRoot, layout.config.archives)) {
    const match = matchLayoutPath(layout, path);
    if (match?.role === "archive" && match.grove) names.add(match.grove);
  }
  return names;
}

function populatedGroveDirectories(layout: CompiledLayout): Set<string> {
  const names = new Set<string>();
  for (const path of scanTemplateCandidates(layout.workspaceRoot, layout.config.trees)) {
    const match = matchLayoutPath(layout, path);
    if (match?.role === "tree" && match.grove) names.add(match.grove);
  }
  return names;
}

/** True when the branch matches a Grove's derived Tree branch but the worktree is out of layout. */
function isExternalNameCollision(
  raw: RawWorktreeEntry,
  registration: RepositoryEntry,
  ws: LoadedWorkspace,
  layout: CompiledLayout,
  groveNames: readonly string[],
): { grove: string; tree: string } | null {
  const branch = raw.branch?.utf8;
  if (raw.path.canonicalUtf8 === null || !branch) return null;
  // Observation only: the workspace root itself is internal, so reflexive membership is correct.
  if (isSubpath(layout.workspaceRoot, raw.path.canonicalUtf8)) return null;
  for (const grove of groveNames) {
    const tree = expectedTreeName(ws.config.conventions, { grove, repo: registration.name });
    const expected = `refs/heads/${expectedBranch(ws.config.conventions, { branchPrefix: ws.config.defaults.branchPrefix ?? "", grove, repo: registration.name, tree })}`;
    if (branch === expected) return { grove, tree };
  }
  return null;
}

function inferMisplacedTree(
  raw: RawWorktreeEntry,
  registration: RepositoryEntry,
  ws: LoadedWorkspace,
  layout: CompiledLayout,
  groveNames: readonly string[],
): WorktreeClassification | null {
  const branch = raw.branch?.utf8;
  if (raw.path.canonicalUtf8 === null || branch === null || branch === undefined) return null;
  // Ruling ③: membership is LAYOUT POSITION, not a name match. This inference exists to recognise a
  // Tree that moved WITHIN the workspace (`git worktree move`), which must keep working. It used to
  // match on the derived branch name alone, so a worktree anywhere on disk — a user's unrelated
  // checkout that happened to be on branch `pricing-fix` — was claimed as a Tree, offered
  // relocation INTO the workspace, and selected for mutating operations. Outside the workspace root
  // it is somebody else's worktree; observe and report it, never select it. The workspace root is
  // also excluded: this classification selects worktrees for mutating operations, so membership
  // must be strict even though the general observation predicate is intentionally reflexive. A
  // later whole-workspace pass additionally rejects ancestors of layout roots and peer worktrees,
  // because strict workspace containment alone says nothing about what a candidate contains.
  if (!isStrictSubpath(layout.workspaceRoot, raw.path.canonicalUtf8)) return null;
  const candidates: WorktreeClassification[] = [];
  for (const grove of groveNames) {
    const tree = expectedTreeName(ws.config.conventions, { grove, repo: registration.name });
    const expected = `refs/heads/${expectedBranch(ws.config.conventions, {
      branchPrefix: ws.config.defaults.branchPrefix ?? "",
      grove,
      repo: registration.name,
      tree,
    })}`;
    if (branch !== expected) continue;
    candidates.push({
      role: "tree",
      selector: { repositoryId: registration.id, tree },
      groveName: grove,
      treeName: tree,
      expectedPath: expandTreePath(layout, grove, tree, registration.name),
    });
  }
  const unique = new Map(candidates.map((candidate) => [`${candidate.groveName}\0${candidate.treeName}\0${candidate.expectedPath}`, candidate]));
  return unique.size === 1 ? [...unique.values()][0] as WorktreeClassification : null;
}

async function observeWorktrees(
  ws: LoadedWorkspace,
  registration: RepositoryEntry | null,
  anchorPath: string,
  commonGitDir: string,
  git: Git,
  layout: CompiledLayout,
  groveNames: readonly string[],
  worktreeFacts: "full" | "identity" = "full",
): Promise<ObservedWorktree[]> {
  const raw = await git.listWorktreesRaw(commonGitDir);
  const worktrees: ObservedWorktree[] = [];
  for (const entry of raw) {
    let upstream: RefName | null = null, dirty: boolean | null = null, sequencer: { kind: string; path: string } | null = null, ahead: number | null = null, behind: number | null = null;
    if (worktreeFacts === "full" && entry.path.canonicalUtf8 !== null && !entry.bare && !entry.prunable) {
      const path = entry.path.canonicalUtf8;
      upstream = await git.upstream(path);
      const status = await porcelainStatus(git, path); dirty = status.problem ? null : status.changes.length > 0;
      sequencer = await git.sequencerState(path);
      if (upstream) { try { const counts = await git.aheadBehind(path, upstream); ahead = counts.ahead; behind = counts.behind; } catch { /* observation remains partial */ } }
    }
    const direct = classifyRaw(entry, registration, anchorPath, layout);
    const role = direct.role === "external" && registration
      ? inferMisplacedTree(entry, registration, ws, layout, groveNames) ?? direct
      : direct;
    const externalCollision = role.role === "external" && registration
      ? isExternalNameCollision(entry, registration, ws, layout, groveNames)
      : null;
    const branchPresent = entry.branch?.utf8 && !entry.prunable ? (await git.refOid(commonGitDir, entry.branch)) !== null : entry.branch ? null : null;
    worktrees.push({ externalCollision, path: entry.path, headOid: entry.head, branch: entry.branch, branchPresent, upstream, bare: entry.bare, unborn: entry.branch !== null && entry.head === null, detached: entry.branch === null && entry.head !== null && !entry.bare, locked: entry.locked, prunable: entry.prunable, dirty, sequencer, ahead, behind, ...role });
  }
  return worktrees;
}

export async function observeRepository(ws: LoadedWorkspace, registration: RepositoryEntry, git: Git, layout = compileLayout(ws.root, ws.config.layout), groveNames: readonly string[] = [], worktreeFacts: "full" | "identity" = "full"): Promise<ObservedRepository> {
  const anchorPath = registration.location.kind === "managed" ? expandRepositoryPath(layout, registration.name) : registration.location.commonGitDir;
  const anchor = anchorPath;
  try {
    const identity = await git.inspectRepository(anchor);
    const commonGitDir = identity.commonGitDir.canonicalUtf8 as string;
    const worktrees = await observeWorktrees(ws, registration, anchorPath, commonGitDir, git, layout, groveNames, worktreeFacts);
    return { registration, registrationStatus: "registered", anchorPath, commonGitDir, gitDir: identity.gitDir.canonicalUtf8 as string, identity, worktrees, problem: null };
  } catch (error) {
    return { registration, registrationStatus: "registered", anchorPath, commonGitDir: anchor, gitDir: anchor, identity: null, worktrees: [], problem: String((error as Error).message ?? error) };
  }
}

async function observeUnregisteredRepository(ws: LoadedWorkspace, anchor: string, git: Git, layout: CompiledLayout, worktreeFacts: "full" | "identity" = "full"): Promise<ObservedRepository> {
  try {
    const identity = await git.inspectRepository(anchor);
    const commonGitDir = identity.commonGitDir.canonicalUtf8 as string;
    const worktrees = await observeWorktrees(ws, null, anchor, commonGitDir, git, layout, [], worktreeFacts);
    return { registration: null, registrationStatus: "unregistered", anchorPath: commonGitDir, commonGitDir, gitDir: identity.gitDir.canonicalUtf8 as string, identity, worktrees, problem: null };
  } catch (error) {
    return { registration: null, registrationStatus: "unregistered", anchorPath: anchor, commonGitDir: anchor, gitDir: anchor, identity: null, worktrees: [], problem: String((error as Error).message ?? error) };
  }
}

/** Identity mode is for point-of-use ownership checks only; callers must check selected work separately. */
export async function observeWorkspace(ws: LoadedWorkspace, git: Git, options: { worktreeFacts?: "full" | "identity" } = {}): Promise<ObservedWorkspace> {
  const startedAt = new Date().toISOString();
  const layout = compileLayout(ws.root, ws.config.layout);
  const catalog = scanCentralGroveMetadata(ws.root);
  const groveNames = activeGroveNames(layout, catalog);
  const repositories: ObservedRepository[] = [];
  for (const registration of ws.config.repositories) repositories.push(await observeRepository(ws, registration, git, layout, groveNames, options.worktreeFacts));
  const diagnostics: Diagnostic[] = [];
  const indexed = indexRepositoriesByCommonDir(repositories.filter((r) => r.problem === null).map((r) => ({ registration: r.registration, commonGitDir: r.commonGitDir })));
  diagnostics.push(...indexed.diagnostics);
  const duplicateCommonDirs = new Set(indexed.diagnostics
    .filter((diagnostic) => diagnostic.code === "duplicate-repository-anchor")
    .map((diagnostic) => (diagnostic.subject as { commonGitDir?: string }).commonGitDir)
    .filter((value): value is string => typeof value === "string"));
  for (const repository of repositories) {
    if (duplicateCommonDirs.has(repository.commonGitDir)) repository.problem = "duplicate canonical Git common directory";
  }
  const knownCommonDirs = new Set(indexed.index.keys());
  for (const candidate of scanCandidateTreeDirectories(layout)) {
    const identity = await git.inspectRepository(candidate.path).catch(() => null);
    const commonGitDir = identity?.commonGitDir.canonicalUtf8;
    if (!commonGitDir || knownCommonDirs.has(commonGitDir)) continue;
    const repository = await observeUnregisteredRepository(ws, candidate.path, git, layout, options.worktreeFacts);
    repositories.push(repository);
    knownCommonDirs.add(commonGitDir);
    diagnostics.push(makeDiagnostic({
      code: "unregistered-repository",
      severity: "policy",
      subject: { kind: "repository-anchor", commonGitDir },
      facts: { candidatePath: candidate.path, grove: candidate.grove, tree: candidate.tree },
      summary: "A worktree under Grove layout belongs to an unregistered repository",
      remedy: "Register its canonical repository with `grove repo link`, or move it outside Grove layout.",
    }));
  }
  // Misplaced-Tree inference is mutation selection, not mere observation. A candidate may be
  // strictly below the workspace and still be an ancestor of compiled layout, `.grove`, or another
  // checkout. Demote only inferred Trees (not direct Tree-layout matches) once every repository's
  // worktrees are known, so cross-repository descendants participate in the decision.
  for (const repository of repositories) for (const worktree of repository.worktrees) {
    const candidate = worktree.path.canonicalUtf8;
    if (worktree.role !== "tree" || candidate === null || matchLayoutPath(layout, candidate)?.role === "tree") continue;
    const conflict = worktreeMutationConflict(layout, repositories, groveNames, candidate, {
      allowObservedPath: candidate,
      groveName: worktree.groveName ?? undefined,
      protectOwnGroveRoot: true,
    });
    if (!conflict) continue;
    diagnostics.push(makeDiagnostic({
      code: "unsafe-tree-location",
      severity: "blocking",
      subject: { kind: "worktree", repositoryId: repository.registration?.id ?? "unregistered", ...(worktree.groveName ? { grove: worktree.groveName } : {}), ...(worktree.treeName ? { tree: worktree.treeName } : {}) },
      facts: { currentPath: candidate, protectedKind: conflict.kind, protectedPath: conflict.protectedPath, ...(conflict.kind === "unresolvable" ? { unresolvable: true } : {}) },
      summary: "Worktree was not inferred as a Tree because its directory owns protected workspace content",
      remedy: "Move the worktree to an isolated Tree path with native Git, then rerun `grove doctor`.",
    }));
    worktree.role = "external";
    worktree.selector = null;
    worktree.groveName = null;
    worktree.treeName = null;
    worktree.expectedPath = null;
  }
  for (const repo of repositories) {
    if (repo.problem) diagnostics.push(makeDiagnostic({ code: "missing-repository", severity: "blocking", subject: { kind: "repository", repositoryId: repo.registration?.id }, facts: { anchor: repo.commonGitDir, problem: repo.problem }, summary: "Configured repository cannot be observed", remedy: "Repair or unregister the repository." }));
    for (const worktree of repo.worktrees) {
      diagnostics.push(...auditWorktree({
        repositoryId: repo.registration?.id ?? "unregistered",
        ...(worktree.groveName ? { grove: worktree.groveName } : {}),
        ...(worktree.treeName ? { tree: worktree.treeName } : {}),
        currentPath: worktree.path,
        expectedPath: worktree.expectedPath,
        branch: worktree.branch,
        ...(worktree.role === "tree" && worktree.groveName && worktree.treeName && repo.registration ? {
          expectedBranch: expectedBranch(ws.config.conventions, {
            branchPrefix: ws.config.defaults.branchPrefix ?? "",
            grove: worktree.groveName,
            repo: repo.registration.name,
            tree: worktree.treeName,
          }),
        } : {}),
        detached: worktree.detached,
        unborn: worktree.unborn,
        prunable: worktree.prunable,
        branchPresent: worktree.branchPresent,
      }));
    }
  }
  for (const error of catalog.errors) diagnostics.push(makeDiagnostic({ code: "invalid-central-metadata", severity: "blocking", subject: { kind: "grove-metadata", path: error.path }, facts: { why: error.why }, summary: "Central Grove metadata cannot be loaded", remedy: "Repair or remove the advisory metadata file; Git state remains authoritative." }));
  const byName = new Map<string, ObservedGrove>();
  for (const repo of repositories) for (const tree of repo.worktrees.filter((w) => w.role === "tree" && w.groveName)) { const name = tree.groveName as string; const grove = byName.get(name) ?? { name, trees: [], metadata: catalog.groves.find((m) => m.name === name) ?? null }; grove.trees.push(tree); byName.set(name, grove); }
  for (const metadata of catalog.groves) if (!byName.has(metadata.name)) byName.set(metadata.name, { name: metadata.name, trees: [], metadata });
  // A Grove directory sitting in layout position is a Grove, even when no registered worktree and
  // no advisory record points at it (ruling ③: membership is layout position; Principle I: observe
  // from Git and the filesystem, do not infer from a record). Before this, renaming `groves/<name>/`
  // out of band made the directory INVISIBLE while `ls`/`show` kept reporting the old name against a
  // path that no longer existed — Grove asserting a stale record was still true, which is the exact
  // guessing "Observe, Diagnose, Never Guess" forbids. RECON-05 required the new name all along.
  // Ruling ③: report the collision rather than only excluding it. A worktree that vanishes from
  // Grove's view with no explanation is worse than one that is named and explicitly not selected.
  for (const repo of repositories) for (const worktree of repo.worktrees) {
    if (!worktree.externalCollision) continue;
    diagnostics.push(makeDiagnostic({
      code: "external-name-collision",
      severity: "info",
      subject: { kind: "worktree", path: worktree.path.display },
      facts: { grove: worktree.externalCollision.grove, tree: worktree.externalCollision.tree, repositoryAlias: repo.registration?.name ?? null },
      summary: "A worktree outside the workspace uses a Grove's derived Tree branch",
      remedy: "No action is required; it is observed but never selected for a Grove operation or offered relocation.",
    }));
  }
  for (const name of archiveDirectories(layout)) {
    const record = catalog.groves.find((entry) => entry.name === name);
    if (record && record.state === "archived") continue;
    diagnostics.push(makeDiagnostic({
      code: "orphaned-archive",
      severity: "policy",
      subject: { kind: "grove", grove: name },
      facts: { path: expandArchivePath(layout, name), hasRecord: record !== undefined, recordedState: record?.state ?? null },
      summary: "An archive directory has no matching archived-Grove record",
      remedy: "Restore the advisory record, or move the directory out of the archive layout; its content is untouched.",
    }));
  }
  for (const name of populatedGroveDirectories(layout)) {
    if (byName.has(name)) continue;
    byName.set(name, { name, trees: [], metadata: catalog.groves.find((m) => m.name === name) ?? null });
    diagnostics.push(makeDiagnostic({
      code: "unregistered-grove",
      severity: "policy",
      subject: { kind: "grove", grove: name },
      facts: { path: expandGrovePath(layout, name) },
      summary: "A Grove directory has no advisory record and no observed Tree worktree",
      remedy: "Recreate the Trees explicitly, or remove the directory; Git state remains authoritative.",
    }));
  }
  const hasAgent = (name: string): boolean => Object.prototype.hasOwnProperty.call(ws.config.agents, name);
  if (ws.config.defaults.agent && !hasAgent(ws.config.defaults.agent)) diagnostics.push(makeDiagnostic({
    code: "stale-agent-preference",
    severity: "policy",
    subject: { kind: "workspace", workspaceId: ws.config.id },
    facts: { agent: ws.config.defaults.agent, source: "workspace-default" },
    summary: "An advisory agent preference names an undefined agent",
    remedy: `Add agent ${ws.config.defaults.agent}, or clear defaults.agent in workspace configuration.`,
  }));
  for (const grove of byName.values()) {
    if (!grove.metadata) continue;
    const manifest = grove.metadata.manifest;
    if (manifest.defaultAgent && !hasAgent(manifest.defaultAgent)) diagnostics.push(makeDiagnostic({
      code: "stale-agent-preference",
      severity: "policy",
      subject: { kind: "grove", grove: grove.name, groveId: manifest.id },
      facts: { agent: manifest.defaultAgent, source: "grove-default" },
      summary: "An advisory agent preference names an undefined agent",
      remedy: `Add agent ${manifest.defaultAgent}, or clear this Grove's default agent.`,
    }));
    for (const setting of manifest.treeSettings) if (setting.defaultAgent && !hasAgent(setting.defaultAgent)) diagnostics.push(makeDiagnostic({
      code: "stale-agent-preference",
      severity: "policy",
      subject: { kind: "tree-selector", grove: grove.name, groveId: manifest.id, repositoryId: setting.selector.repositoryId, tree: setting.selector.tree },
      facts: { agent: setting.defaultAgent, source: "tree-default" },
      summary: "An advisory agent preference names an undefined agent",
      remedy: `Add agent ${setting.defaultAgent}, or clear this Tree's default agent.`,
    }));
    const observed = new Set(grove.trees.flatMap((tree) => tree.selector ? [`${tree.selector.repositoryId}\0${tree.selector.tree}`] : []));
    const sources = new Map<string, Set<string>>();
    for (const selector of grove.metadata.manifest.treeOrder) {
      const key = `${selector.repositoryId}\0${selector.tree}`;
      const entry = sources.get(key) ?? new Set<string>(); entry.add("treeOrder"); sources.set(key, entry);
    }
    for (const setting of grove.metadata.manifest.treeSettings) {
      const key = `${setting.selector.repositoryId}\0${setting.selector.tree}`;
      const entry = sources.get(key) ?? new Set<string>(); entry.add("treeSettings"); sources.set(key, entry);
    }
    for (const [key, sourceSet] of sources) {
      if (observed.has(key)) continue;
      const [repositoryId, tree] = key.split("\0") as [string, string];
      diagnostics.push(makeDiagnostic({
        code: "stale-metadata",
        severity: "policy",
        subject: { kind: "tree-selector", groveId: grove.metadata.manifest.id, repositoryId, tree },
        facts: { sources: [...sourceSet].sort() },
        summary: "Advisory Tree metadata has no observed worktree target",
        remedy: "Restore the worktree, or run `grove tree remove <grove> <tree> --forget-settings` to forget the stale Tree settings/order entry.",
      }));
    }
    const order = new Map(manifest.treeOrder.map((selector, index) => [`${selector.repositoryId}\0${selector.tree}`, index]));
    grove.trees.sort((left, right) => {
      const leftKey = left.selector ? `${left.selector.repositoryId}\0${left.selector.tree}` : `\uffff${left.path.display}`;
      const rightKey = right.selector ? `${right.selector.repositoryId}\0${right.selector.tree}` : `\uffff${right.path.display}`;
      const leftRank = order.get(leftKey);
      const rightRank = order.get(rightKey);
      if (leftRank !== undefined || rightRank !== undefined) return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
      return leftKey.localeCompare(rightKey);
    });
  }
  return { startedAt, completedAt: new Date().toISOString(), workspace: ws, layout, repositories, groves: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), diagnostics };
}

export interface CandidateWorktree { path: string; grove: string; tree: string; repo?: string }
export function scanCandidateTreeDirectories(layout: CompiledLayout): CandidateWorktree[] {
  return scanTemplateCandidates(layout.workspaceRoot, layout.config.trees).flatMap((path) => {
    const match = matchLayoutPath(layout, path);
    return match?.role === "tree" && match.grove && match.tree ? [{ path, grove: match.grove, tree: match.tree, ...(match.repo ? { repo: match.repo } : {}) }] : [];
  });
}

export const observedGroves = (snapshot: ObservedWorkspace): ObservedGrove[] => snapshot.groves;
export function observedTrunkAllocationNames(snapshot: ObservedWorkspace): string[] {
  const names = new Set<string>();
  for (const repository of snapshot.repositories) for (const worktree of repository.worktrees) {
    if (worktree.path.canonicalUtf8 === null) continue;
    const match = matchLayoutPath(snapshot.layout, worktree.path.canonicalUtf8);
    if (match?.role === "trunk" && match.trunk) names.add(match.trunk);
  }
  return [...names].sort();
}
export function resolveObservedGrove(snapshot: ObservedWorkspace, ref: string): ObservedGrove { const found = snapshot.groves.find((g) => g.name === ref || g.metadata?.manifest.id === ref); if (!found) throw new Error(`No observed Grove ${ref}`); return found; }
export function resolveObservedTree(grove: ObservedGrove, selector: string): ObservedWorktree { const found = grove.trees.filter((tree) => tree.treeName === selector || `${tree.selector?.repositoryId}/${tree.treeName}` === selector); if (found.length !== 1) throw new Error(found.length === 0 ? `No observed Tree ${selector}` : `Ambiguous observed Tree ${selector}`); return found[0] as ObservedWorktree; }
export function treeContainingPath(snapshot: ObservedWorkspace, cwd: string): ObservedWorktree | null { const canonical = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd; return snapshot.repositories.flatMap((r) => r.worktrees).filter((w) => w.path.canonicalUtf8 && (canonical === w.path.canonicalUtf8 || canonical.startsWith(`${w.path.canonicalUtf8}/`))).sort((a, b) => (b.path.canonicalUtf8?.length ?? 0) - (a.path.canonicalUtf8?.length ?? 0))[0] ?? null; }

export function observedWorktreeDetail(worktree: ObservedWorktree): Record<string, unknown> {
  return {
    path: valueBytesJson(worktree.path),
    headOid: worktree.headOid,
    branch: worktree.branch ? valueBytesJson(worktree.branch) : null,
    upstream: worktree.upstream ? valueBytesJson(worktree.upstream) : null,
    role: worktree.role,
    grove: worktree.groveName,
    tree: worktree.treeName,
    detached: worktree.detached,
    unborn: worktree.unborn,
    locked: worktree.locked,
    prunable: worktree.prunable,
    branchPresent: worktree.branchPresent,
    dirty: worktree.dirty,
    ahead: worktree.ahead,
    behind: worktree.behind,
    sequencer: worktree.sequencer?.kind ?? null,
  };
}

export function observedRepositoryDetail(repository: ObservedRepository): Record<string, unknown> {
  return {
    id: repository.registration?.id ?? null,
    name: repository.registration?.name ?? null,
    status: repository.registrationStatus,
    commonGitDir: repository.commonGitDir,
    anchorPath: repository.anchorPath,
    preferredRemote: repository.registration?.remote ?? null,
    preferredTrunk: repository.registration?.trunk ?? null,
    problem: repository.problem,
    worktrees: repository.worktrees.map(observedWorktreeDetail),
  };
}

export function observedGroveDetail(grove: ObservedGrove): Record<string, unknown> {
  return {
    name: grove.name,
    id: grove.metadata?.manifest.id ?? null,
    state: grove.metadata?.state ?? "active",
    metadata: grove.metadata ? {
      defaultAgent: grove.metadata.manifest.defaultAgent,
      defaultBase: grove.metadata.manifest.defaultBase,
    } : null,
    trees: grove.trees.map(observedWorktreeDetail),
  };
}
