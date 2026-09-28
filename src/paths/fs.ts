/**
 * Path predicates and containment (§8.7). The pure predicates never touch the filesystem;
 * `resolveContained` additionally real-paths both sides so a symlink cannot escape the scope.
 *
 * Ported from the pinned source `fs-paths.ts` (isSubpath/relPath), plus the containment resolver
 * §8.7 requires.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { nativePathFromBytes } from "../model/encoding.ts";
import { recognizeGitCheckout, recognizeGitDirectory } from "../git/native-recognition.ts";

/**
 * Find Git identities nested inside a directory that a structural action would remove or move.
 * Native Buffer paths matter here: an undecodable parent name must not make its `.git` invisible.
 * The caller may exempt only the `.git` entry at an already observed worktree root; its descendants
 * are still inspected for independently owned repositories and submodules.
 */
export function assertNoNestedGitOwnership(root: string, observedWorktreeRoots: readonly string[] = []): void {
  const found: Array<{ path: string; rawPathBase64?: string }> = [];
  const ambiguous: Array<{ path: string; rawPathBase64?: string; problem: string }> = [];
  const rootBytes = Buffer.from(resolve(root));
  const entryPath = (parent: Buffer, name: Buffer) => Buffer.concat([parent, Buffer.from("/"), name]);
  const describe = (path: Buffer) => {
    const native = nativePathFromBytes(path);
    return { path: native.utf8 ?? native.display, ...(native.utf8 === null ? { rawPathBase64: path.toString("base64") } : {}) };
  };
  const inspectFailure = (path: Buffer, error: unknown): never => {
    throw new GroveError({ kind: "refused-conflict", what: `Cannot inspect nested Git ownership in ${root}`, why: `filesystem inspection failed at ${describe(path).path}: ${String((error as Error).message ?? error)}`, remedy: "Inspect the directory and retry from fresh observed state.", detail: { reason: "stale-plan" } });
  };
  const lstat = (path: Buffer, allowMissing = false) => {
    try { return lstatSync(path, { bigint: true }); }
    catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return inspectFailure(path, error);
    }
  };
  // Exempt a worktree's own marker by the directory's device/inode, never by an alias spelling
  // or a lossy UTF-8 decoding. lstat does not follow an outward symlink offered as an exemption.
  const exempt = observedWorktreeRoots.flatMap((path) => {
    const stat = lstat(Buffer.from(resolve(path)), true);
    return stat?.isDirectory() && !stat.isSymbolicLink() ? [{ device: stat.dev, inode: stat.ino }] : [];
  });
  const scan = (directory: Buffer, isRoot = false): void => {
    const directoryStat = lstat(directory, isRoot);
    if (directoryStat === null) return;
    if (directoryStat.isSymbolicLink()) { ambiguous.push({ ...describe(directory), problem: "the structural target is a symbolic link" }); return; }
    if (!directoryStat.isDirectory()) return;
    let names: Buffer[];
    try { names = readdirSync(directory, { encoding: "buffer" }).sort(Buffer.compare); }
    catch (error) { return inspectFailure(directory, error); }
    // Ask the filesystem for Git's marker spelling. On case-insensitive APFS this finds `.GIT`
    // by the same lookup Git performs; on a case-sensitive volume it does not invent an alias.
    const marker = lstat(entryPath(directory, Buffer.from(".git")), true);
    const isExempt = exempt.some((rootIdentity) => rootIdentity.device === directoryStat.dev && rootIdentity.inode === directoryStat.ino);
    if (marker) {
      if (marker.isSymbolicLink() || (!marker.isFile() && !marker.isDirectory())) ambiguous.push({ ...describe(directory), problem: "the Git marker is a symbolic link or unsupported file type" });
      else if (!isExempt) {
        const native = nativePathFromBytes(directory);
        if (native.utf8 === null) ambiguous.push({ ...describe(directory), problem: "native path cannot be passed to Git without losing bytes" });
        else {
          const recognized = recognizeGitCheckout(native.utf8);
          if (recognized.recognized) found.push(describe(directory));
          else ambiguous.push({ ...describe(directory), problem: `Git cannot verify the marked directory: ${recognized.problem ?? "unknown error"}` });
        }
      }
    }
    // Bare repositories have no `.git` marker. Probe candidate administrative entries through
    // native lookup as well, then let Git decide whether they form a repository. Failed or unsafe
    // probes remain ambiguous and block; a decoy is never misreported as a confirmed Git owner.
    const head = lstat(entryPath(directory, Buffer.from("HEAD")), true);
    const objects = lstat(entryPath(directory, Buffer.from("objects")), true);
    const refs = lstat(entryPath(directory, Buffer.from("refs")), true);
    const config = lstat(entryPath(directory, Buffer.from("config")), true);
    if (!marker && head && (objects || refs || config)) {
      if ([head, objects, refs, config].some((stat) => stat?.isSymbolicLink())) ambiguous.push({ ...describe(directory), problem: "bare Git administrative entry is a symbolic link" });
      else if (!head.isFile() || !objects?.isDirectory() || !refs?.isDirectory()) ambiguous.push({ ...describe(directory), problem: "bare Git administrative entries are incomplete or unsupported" });
      else {
        const native = nativePathFromBytes(directory);
        if (native.utf8 === null) ambiguous.push({ ...describe(directory), problem: "native path cannot be passed to Git without losing bytes" });
        else {
          const recognized = recognizeGitDirectory(native.utf8);
          if (recognized.recognized) found.push(describe(directory));
          else ambiguous.push({ ...describe(directory), problem: `Git cannot verify the bare-shaped directory: ${recognized.problem ?? "unknown error"}` });
        }
      }
      return;
    }
    for (const name of names) {
      const child = entryPath(directory, name);
      const stat = lstat(child);
      if (marker && stat && stat.dev === marker.dev && stat.ino === marker.ino) continue;
      if (stat?.isDirectory() && !stat.isSymbolicLink()) scan(child);
    }
  };
  scan(rootBytes, true);
  if (found.length || ambiguous.length) throw new GroveError({
    kind: "refused-conflict", what: `Cannot mutate path ${root}`,
    why: [...(found.length ? [`independent Git repository or submodule identity exists at: ${found.map((item) => item.path).join(", ")}`] : []), ...(ambiguous.length ? [`Git-like metadata cannot be verified at: ${ambiguous.map((item) => item.path).join(", ")}`] : [])].join("; "),
    remedy: "Inspect or repair the named Git identity with native Git before retrying; destructive flags do not authorize it.",
    detail: { reason: "stale-plan", nestedGitOwners: found, ambiguousGitMarkers: ambiguous },
  });
}

const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
declare const containedPathBrand: unique symbol;
declare const containedParentPathBrand: unique symbol;

/**
 * A canonical path proved to be strictly beneath a caller-supplied root.
 *
 * Design boundary: raw strings may be observed freely, but directory-destructive helpers accept
 * only this opaque type. The sole public constructor realpaths the root and deepest existing target
 * ancestor, then requires that canonical result to retain the caller's lexical identity below the
 * real root. Equality with the root, lexical escapes, and every below-root symlink traversal cannot
 * acquire the brand. The brand is deliberately erased at runtime; the proved lexical path under
 * the real root is the value operated on.
 */
export type ContainedPath = string & { readonly [containedPathBrand]: true };
/** A canonical path proved to be at or below a root, only for naming one strict child entry. */
export type ContainedParentPath = string & { readonly [containedParentPathBrand]: true };

/** Is `child` inside `parent`? Equal paths count as inside. */
/**
 * Containment, **reflexively**: `isSubpath(p, p)` is `true`.
 *
 * That is correct for membership questions ("is this worktree inside the workspace?") and WRONG as
 * the guard on a destructive operation. Three separate `rm -rf`/`renameSync` sites used it to mean
 * "the recorded path is somewhere inside the workspace", which silently authorised operating on the
 * workspace ROOT itself — verified to delete an entire workspace from one hand-edited advisory
 * metadata key.
 *
 * **For a destructive guard, do not use this.** Re-derive the expected path and compare exactly
 * (see `expandArchivePath`/`expandRepositoryPath` callers), or use `isStrictSubpath` when a
 * descendant is genuinely what you mean. `reconcile.ts`'s directory-remove replay is the model: it
 * checks relative path, canonical path, device and inode before touching anything.
 */
export function isSubpath(parent: string, child: string): boolean {
  const p = norm(parent);
  const c = norm(child);
  if (p === c) return true;
  return c.startsWith(p.endsWith("/") ? p : `${p}/`);
}

/** Containment excluding the parent itself. Use this when "inside" must not mean "is". */
export function isStrictSubpath(parent: string, child: string): boolean {
  return norm(parent) !== norm(child) && isSubpath(parent, child);
}
/**
 * Relative path from `from` to `to`. Bounded by segment count so two absolute paths with no
 * common ancestor terminate rather than looping.
 */
export function relPath(from: string, to: string): string {
  const a = norm(from).split("/").filter(Boolean);
  const b = norm(to).split("/").filter(Boolean);
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i++;
  const up = a.length - i;
  const down = b.slice(i);
  if (up === 0 && down.length === 0) return ".";
  return [...Array.from({ length: up }, () => ".."), ...down].join("/");
}

/**
 * Forward-only, idempotent directory merge used when worktrees already created the destination
 * Grove root. Existing destination entries are never overwritten and source removal is only via
 * non-recursive `rmdir`, after every entry has moved.
 */
function mergeDirectoryForwardUnchecked(from: string, to: string): void {
  if (!existsSync(from)) {
    if (existsSync(to)) return;
    throw new GroveError({ kind: "refused-conflict", what: `Cannot move missing directory ${from}`, why: "neither source nor destination exists", remedy: "Inspect the retained operation before resuming." });
  }
  if (!existsSync(to)) { mkdirSync(dirname(to), { recursive: true }); renameSync(from, to); return; }
  if (!lstatSync(from).isDirectory() || !lstatSync(to).isDirectory()) throw new GroveError({ kind: "refused-conflict", what: `Cannot merge ${from} into ${to}`, why: "one path is not a directory", remedy: "Move the conflicting path and resume the operation." });
  for (const name of readdirSync(from).sort()) {
    const source = join(from, name); const destination = join(to, name);
    if (!existsSync(destination)) { renameSync(source, destination); continue; }
    if (lstatSync(source).isDirectory() && lstatSync(destination).isDirectory()) { mergeDirectoryForwardUnchecked(source, destination); continue; }
    throw new GroveError({ kind: "refused-conflict", what: `Cannot merge Grove content ${source}`, why: `${destination} is already occupied`, remedy: "Move the conflicting path and resume the operation." });
  }
  rmdirSync(from);
}

/** Move a directory only after both endpoints have proved strict containment. */
export function moveContainedDirectory(from: ContainedPath, to: ContainedPath): void {
  renameSync(from, to);
}

/** Recursively remove a directory only after its path has proved strict containment. */
export function removeContainedDirectory(path: ContainedPath): void {
  rmSync(path, { recursive: true, force: true });
}

/** Remove one proved, non-symlink file without exposing raw `unlinkSync` to command modules. */
export function removeContainedFile(path: ContainedPath): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new GroveError({ kind: "refused-conflict", what: `Cannot remove file ${path}`, why: "the proved entry is no longer a plain file", remedy: "Retry from fresh observed state." });
  unlinkSync(path);
}

/** Unlink one named symlink below a proved parent; the target is never followed. */
export function removeContainedSymbolicLink(parent: ContainedParentPath, name: string): void {
  if (name === "" || name === "." || name === ".." || basename(name) !== name) throw new GroveError({ kind: "invalid-input", what: `Cannot unlink ${name}`, why: "the entry name is not one path component", remedy: "Use the exact recorded entry name." });
  const path = join(parent, name);
  if (!lstatSync(path).isSymbolicLink()) throw new GroveError({ kind: "refused-conflict", what: `Cannot unlink ${path}`, why: "the entry is no longer a symbolic link", remedy: "Retry from fresh observed state." });
  unlinkSync(path);
}

/** Merge directories only after both roots have proved strict containment. */
export function mergeDirectoryForward(from: ContainedPath, to: ContainedPath): void {
  mergeDirectoryForwardUnchecked(from, to);
}

/** Refuse any entry outside exact operation-owned roots without inspecting inside those roots. */
export function assertDirectoryContainsOnlyRoots(root: string, ownedRoots: readonly string[], opaqueRoots: readonly string[] = ownedRoots): void {
  const absoluteRoot = resolve(root);
  const owned = ownedRoots.map((path) => resolve(path));
  const opaque = new Set(opaqueRoots.map((path) => resolve(path)));
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const entry = join(directory, name);
      if (owned.some((path) => path === entry)) {
        if (opaque.has(entry) || !lstatSync(entry).isDirectory() || readdirSync(entry).length === 0) continue;
        // Observation only: equality identifies an exact owned root; ancestry identifies its shell.
        if (owned.some((path) => path !== entry && isSubpath(entry, path))) { visit(entry); continue; }
      }
      if (!owned.some((path) => isSubpath(entry, path))) throw new GroveError({ kind: "refused-conflict", what: `Rename destination ${root} changed`, why: `${entry} is not an operation-created worktree path`, remedy: "Move the unrelated destination content and reconcile explicitly.", detail: { reason: "stale-plan", entry } });
      const stat = lstatSync(entry);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new GroveError({ kind: "refused-conflict", what: `Rename destination ${root} changed`, why: `${entry} is not a plain ancestor directory`, remedy: "Move the unrelated destination content and reconcile explicitly.", detail: { reason: "stale-plan", entry } });
      visit(entry);
    }
  };
  visit(absoluteRoot);
}

/** Capture exact destination roots for content that a later forward merge may legitimately move. */
export function collectDirectoryMergeRoots(from: string, to: string, excludedRoots: readonly string[] = []): string[] {
  const excluded = excludedRoots.map((path) => resolve(path));
  const roots: string[] = [];
  const visit = (source: string, destination: string): boolean => {
    if (excluded.some((path) => path === resolve(source))) return false;
    const stat = lstatSync(source);
    if (!stat.isDirectory() || stat.isSymbolicLink()) { roots.push(resolve(destination)); return true; }
    const entries = readdirSync(source).sort();
    if (entries.length === 0) { roots.push(resolve(destination)); return true; }
    let retained = false;
    for (const name of entries) retained = visit(join(source, name), join(destination, name)) || retained;
    if (!retained) roots.push(resolve(destination));
    return true;
  };
  if (existsSync(from)) for (const name of readdirSync(from).sort()) visit(join(from, name), join(to, name));
  return roots.sort();
}

/**
 * Resolve `rel` (relative to `root`) to an absolute path that is provably inside `root` after
 * real-path resolution. Absolute inputs and resolved escapes are refused (§8.7).
 */
/**
 * Entries under `root` that no path in `accounted` explains.
 *
 * Both callers previously hardcoded the literal segment `trees` and descended exactly one level,
 * which is the default `layout.trees` template written into code. `layout.trees` is a first-class
 * configurable (`config/layout.ts` ALLOWED.trees) that need not contain a `trees` segment and need
 * not be one level deep, so under `groves/{grove}/{tree}` every Tree was reported as loose content
 * and `delete` refused at exit 5, while under `groves/{grove}/trees/{repo}/{tree}` the intermediate
 * `{repo}` directory was reported loose. Forcing past that refusal then itemized live Tree
 * worktrees as discarded loose content, inverting ruling ④'s promise.
 *
 * Derive the structure from the accounted paths themselves rather than from any template: an entry
 * that IS an accounted path is exempt, an entry that is a strict ancestor of one is a structural
 * directory to descend into, and anything else is loose. No accounted paths means nothing is
 * exempt. Unreadable directories are reported loose, as before.
 *
 * Termination: a descent happens only into a STRICT ancestor of an accounted path, so each level
 * consumes one more segment of some accounted path. Depth is therefore bounded by the deepest
 * accounted path, and a symlink cycle under `root` cannot extend it.
 */
export function unaccountedEntries(root: string, accounted: readonly string[]): string[] {
  const canonical = accounted.map((path) => resolve(path));
  const exact = new Set(canonical);
  const loose: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    // The root itself is the caller's to have; only a descent that fails degrades to "loose",
    // matching the previous behaviour where an unreadable `trees` (a file, say) was reported.
    let entries: string[];
    if (prefix === "") entries = readdirSync(directory);
    else { try { entries = readdirSync(directory); } catch { loose.push(prefix.slice(0, -1)); return; } }
    for (const entry of entries) {
      const absolute = resolve(directory, entry);
      if (exact.has(absolute)) continue;
      if (canonical.some((path) => isStrictSubpath(absolute, path))) { walk(absolute, `${prefix}${entry}/`); continue; }
      loose.push(`${prefix}${entry}`);
    }
  };
  walk(root, "");
  return loose.sort();
}

/** Type of one inventoried loose entry, from `lstat`: a symlink is never followed. */
export type LooseEntryType = "file" | "directory" | "symlink" | "other";
/** One loose path relative to the content root. `rawPathBase64` is set when it is not UTF-8. */
export interface LooseEntry { path: string; type: LooseEntryType; rawPathBase64?: string }
export interface LooseInventoryGap { path: string; rawPathBase64?: string; problem: string }
/**
 * Every loose path below a Grove content root, recursively, with its type. `incomplete` names
 * each place the walk could not enumerate; an incomplete inventory proves no consent.
 */
export interface LooseInventory { entries: LooseEntry[]; incomplete: LooseInventoryGap[] }

/** Bound on one inventory. Past it the inventory is incomplete and destruction refuses. */
export const LOOSE_INVENTORY_LIMITS = { maxEntries: 10_000, maxDepth: 64 } as const;

export interface LooseInventoryOptions {
  /**
   * `exempt` (plan time): an exact accounted path is a live Tree whose work is consented
   * separately, so it is skipped. `inventory` (point of use, after those Trees were removed): a
   * path present again at an accounted position is new loose content and is inventoried.
   */
  accountedPresent?: "exempt" | "inventory";
  maxEntries?: number;
  maxDepth?: number;
}

/** Receipt spelling: directories end with `/`, as Git itemizes an untracked directory. */
export function looseEntryLabel(entry: Pick<LooseEntry, "path"> & { type: LooseEntryType | null }): string {
  return entry.type === "directory" ? `${entry.path}/` : entry.path;
}

const looseEntryKey = (entry: { path: string; rawPathBase64?: string }): string =>
  entry.rawPathBase64 === undefined ? `utf8:${entry.path}` : `raw:${entry.rawPathBase64}`;

/**
 * Inventory the loose content under `root`: everything that no `accounted` Tree path explains,
 * listed per path (files, symlinks, and directories, including every descendant).
 *
 * Structure is derived from the accounted paths exactly as in `unaccountedEntries`: a strict
 * ancestor of an accounted path is a structural directory to descend through and is not itself
 * loose. Every other entry is loose; a loose directory is descended so later additions inside it
 * are new paths rather than members of a consented name.
 *
 * Traversal rules (FR-023A): names are read as native bytes; `lstat` never follows a symlink,
 * and a symlink is recorded as one entry and never descended. A directory carrying a Git marker
 * (found by native lookup, so volume case aliases match) or bare-repository administrative
 * entries is not descended: it belongs to another owner, and the nested-Git guard names it.
 * Such a directory, an unreadable directory, and the entry/depth bounds all make the inventory
 * incomplete. This is a pathname/type inventory; it does not fingerprint file contents.
 */
export function inventoryLooseContent(root: string, accounted: readonly string[], options: LooseInventoryOptions = {}): LooseInventory {
  const accountedPresent = options.accountedPresent ?? "exempt";
  const maxEntries = options.maxEntries ?? LOOSE_INVENTORY_LIMITS.maxEntries;
  const maxDepth = options.maxDepth ?? LOOSE_INVENTORY_LIMITS.maxDepth;
  const canonical = accounted.map((path) => resolve(path));
  const exact = new Set(canonical);
  const entries: Array<LooseEntry & { raw: Buffer }> = [];
  const incomplete: LooseInventoryGap[] = [];
  const relativeJoin = (parent: Buffer, name: Buffer): Buffer => parent.length ? Buffer.concat([parent, Buffer.from("/"), name]) : name;
  const describe = (relativePath: Buffer): { path: string; rawPathBase64?: string } => {
    if (relativePath.length === 0) return { path: "." };
    const native = nativePathFromBytes(relativePath);
    return native.utf8 !== null ? { path: native.utf8 } : { path: native.display, rawPathBase64: relativePath.toString("base64") };
  };
  const gap = (relativePath: Buffer, problem: string): void => { incomplete.push({ ...describe(relativePath), problem }); };
  class LimitReached extends Error {}
  const lstat = (path: Buffer) => {
    try { return lstatSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const gitOwned = (directory: Buffer): string | null => {
    const probe = (name: string) => lstat(Buffer.concat([directory, Buffer.from(`/${name}`)]));
    if (probe(".git")) return "Git metadata marks another owner; the nested-Git guard decides it";
    const head = probe("HEAD");
    if (head && (probe("objects") || probe("refs") || probe("config"))) return "bare-repository administrative entries mark another owner; the nested-Git guard decides it";
    return null;
  };
  const visit = (absolute: Buffer, relativePath: Buffer, depth: number, structural: boolean): void => {
    let owner: string | null;
    try { owner = gitOwned(absolute); }
    catch (error) { gap(relativePath, `cannot inspect: ${String((error as Error).message ?? error)}`); return; }
    if (owner) { gap(relativePath, owner); return; }
    let names: Buffer[];
    try { names = readdirSync(absolute, { encoding: "buffer" }).sort(Buffer.compare); }
    catch (error) { gap(relativePath, `cannot enumerate: ${String((error as Error).message ?? error)}`); return; }
    for (const name of names) {
      const child = Buffer.concat([absolute, Buffer.from("/"), name]);
      const relativeChild = relativeJoin(relativePath, name);
      let stat: ReturnType<typeof lstat>;
      try { stat = lstat(child); }
      catch (error) { gap(relativeChild, `cannot inspect: ${String((error as Error).message ?? error)}`); continue; }
      if (stat === null) continue; // vanished between listing and inspection: nothing to consent to
      const realDirectory = stat.isDirectory() && !stat.isSymbolicLink();
      if (structural) {
        const nativeChild = nativePathFromBytes(child).utf8;
        const childPath = nativeChild === null ? null : resolve(nativeChild);
        if (childPath !== null && exact.has(childPath) && accountedPresent === "exempt") continue;
        if (childPath !== null && !exact.has(childPath) && realDirectory && canonical.some((path) => isStrictSubpath(childPath, path))) {
          if (depth + 1 > maxDepth) { gap(relativeChild, `deeper than ${maxDepth} levels`); continue; }
          visit(child, relativeChild, depth + 1, true);
          continue;
        }
      }
      if (entries.length >= maxEntries) { gap(relativeChild, `more than ${maxEntries} loose entries`); throw new LimitReached(); }
      const type: LooseEntryType = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
      entries.push({ ...describe(relativeChild), type, raw: relativeChild });
      if (!realDirectory) continue;
      if (depth + 1 > maxDepth) { gap(relativeChild, `deeper than ${maxDepth} levels`); continue; }
      visit(child, relativeChild, depth + 1, false);
    }
  };
  try { visit(Buffer.from(resolve(root)), Buffer.alloc(0), 0, true); }
  catch (error) { if (!(error instanceof LimitReached)) throw error; }
  return {
    entries: entries.sort((a, b) => Buffer.compare(a.raw, b.raw)).map(({ raw: _raw, ...entry }) => entry),
    incomplete,
  };
}

/** A recorded loose-consent set. `type: null` marks a pre-inventory name whose type was never recorded. */
export interface RecordedLooseConsent { entries: Array<{ path: string; type: LooseEntryType | null; rawPathBase64?: string }>; legacy: boolean }

/**
 * Current loose entries that the recorded consent does not cover. Consent is per path: a
 * recorded directory covers only the directory entry, never a descendant absent from the record.
 * A recorded type must match the current type; a legacy name without a type matches that exact
 * path only. Recorded paths that vanished are not an objection (they are simply not discarded).
 */
export function unconsentedLooseEntries(recorded: RecordedLooseConsent, current: readonly LooseEntry[]): LooseEntry[] {
  const known = new Map(recorded.entries.map((entry) => [looseEntryKey(entry), entry.type]));
  return current.filter((entry) => {
    const key = looseEntryKey(entry);
    if (!known.has(key)) return true;
    const type = known.get(key);
    return type !== null && type !== entry.type;
  });
}

const LOOSE_TYPES: readonly LooseEntryType[] = ["file", "directory", "symlink", "other"];

/** The durable, versioned form of a plan-time loose inventory stored in a destructive step. */
export function persistedLooseInventory(inventory: LooseInventory): { version: 1; entries: LooseEntry[] } {
  if (inventory.incomplete.length) throw new GroveError({ kind: "refused-precondition", what: "Cannot record consent for loose Grove content", why: "the loose inventory is incomplete", remedy: "Inspect the listed paths and retry from fresh state." });
  return { version: 1, entries: inventory.entries.map((entry) => ({ ...entry })) };
}

/**
 * Read the loose consent a destructive step recorded. A versioned `looseInventory` is per path.
 * A record written before that inventory existed carries only `discardedLoose` names: each name
 * consents to exactly that path, never to anything below it, so a legacy directory name cannot
 * cover its current descendants and no inventory is reconstructed from current content.
 * Returns null when the recorded inventory is malformed.
 */
export function readRecordedLooseConsent(input: Record<string, unknown>): RecordedLooseConsent | null {
  if ("looseInventory" in input) {
    const value = input.looseInventory as { version?: unknown; entries?: unknown } | null;
    if (typeof value !== "object" || value === null || value.version !== 1 || !Array.isArray(value.entries)) return null;
    const entries: RecordedLooseConsent["entries"] = [];
    for (const raw of value.entries as unknown[]) {
      const entry = raw as Record<string, unknown> | null;
      if (typeof entry !== "object" || entry === null || typeof entry.path !== "string" || !LOOSE_TYPES.includes(entry.type as LooseEntryType) || (entry.rawPathBase64 !== undefined && typeof entry.rawPathBase64 !== "string")) return null;
      entries.push({ path: entry.path, type: entry.type as LooseEntryType, ...(typeof entry.rawPathBase64 === "string" ? { rawPathBase64: entry.rawPathBase64 } : {}) });
    }
    return { entries, legacy: false };
  }
  const names = Array.isArray(input.discardedLoose) ? input.discardedLoose.filter((entry): entry is string => typeof entry === "string") : [];
  return { entries: names.map((path) => ({ path, type: null })), legacy: true };
}

export function resolveContained(root: string, rel: string, what: string): string {
  if (rel.includes("\u0000")) {
    throw new GroveError({
      kind: "invalid-input",
      what,
      why: "the path contains a null byte",
      remedy: "Use a path without control characters.",
      detail: { root },
    });
  }
  if (isAbsolute(rel)) {
    throw new GroveError({
      kind: "invalid-input",
      what,
      why: `"${rel}" is an absolute path`,
      remedy: "Use a path relative to the selected scope.",
      detail: { root, rel },
    });
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    // A missing scope root (e.g. an archived Grove's torn-down worktree, or out-of-band drift)
    // is a clean precondition failure, not an internal crash (§9).
    throw new GroveError({
      kind: "io",
      what,
      why: `the scope root does not exist: ${root}`,
      remedy: "The worktree may be missing or archived — run `grove reconcile`.",
      detail: { root, rel },
    });
  }
  const target = resolve(realRoot, rel);
  // Resolve the deepest existing ancestor so a not-yet-created path is still containment-checked.
  let probe = target;
  let real: string;
  for (;;) {
    try {
      real = realpathSync(probe);
      break;
    } catch {
      const parent = resolve(probe, "..");
      if (parent === probe) {
        real = target;
        break;
      }
      probe = parent;
    }
  }
  const resolved = probe === target ? real : resolve(real, relPath(probe, target));
  // General read/creation containment is intentionally reflexive; destructive callers need the brand.
  if (!isSubpath(realRoot, resolved)) {
    throw new GroveError({
      kind: "invalid-input",
      what,
      why: `"${rel}" resolves outside the permitted scope`,
      remedy: "Use a path that stays within the selected Grove/Tree/workspace.",
      detail: { root: realRoot, rel, resolved },
    });
  }
  return resolved;
}

/**
 * Prove that an absolute candidate resolves strictly beneath `root` and return its canonical path.
 * Missing leaf segments are allowed; their deepest existing ancestor is realpathed by
 * `resolveContained` before the strict check is applied.
 */
function proveContainedPath(root: string, candidate: string, what: string, strict: boolean): string {
  if (!isAbsolute(candidate)) {
    throw new GroveError({
      kind: "invalid-input",
      what,
      why: `"${candidate}" is not an absolute path`,
      remedy: "Use an absolute path strictly inside the selected workspace.",
      detail: { root, candidate },
    });
  }
  const relativeCandidate = relative(resolve(root), resolve(candidate));
  let realRoot: string;
  try { realRoot = realpathSync(root); }
  catch (error) {
    throw new GroveError({ kind: "io", what, why: `the permitted root cannot be resolved: ${root}`, remedy: "Restore the workspace directory and retry from fresh observed state.", detail: { root, candidate, code: (error as NodeJS.ErrnoException).code ?? null }, cause: error });
  }
  // `realpath` alone cannot distinguish a missing leaf from a dangling symlink: both fail and make
  // the resolver climb to an existing ancestor. Inspect every existing below-root component with
  // `lstat` first so a dangling link, or a missing path beneath one, can never acquire the brand.
  let component = realRoot;
  for (const segment of relativeCandidate.split("/").filter((value) => value !== "" && value !== ".")) {
    component = join(component, segment);
    try {
      if (lstatSync(component).isSymbolicLink()) {
        throw new GroveError({
          kind: "invalid-input",
          what,
          why: `"${candidate}" traverses a symlink inside the permitted scope`,
          remedy: "Use a direct path with no symlink components below the selected workspace.",
          detail: { root: realRoot, candidate, component },
        });
      }
    } catch (error) {
      if (GroveError.is(error)) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw new GroveError({
        kind: "invalid-input",
        what,
        why: `"${candidate}" cannot be traversed as a directory path`,
        remedy: "Use a direct path whose existing parent components are directories.",
        detail: { root: realRoot, candidate, component, code: (error as NodeJS.ErrnoException).code ?? null },
        cause: error,
      });
    }
  }
  const resolved = resolveContained(root, relativeCandidate, what);
  // Preserve the caller's below-root path identity while allowing the root itself to have a
  // canonical spelling (for example macOS /var -> /private/var). A difference here means the
  // candidate or one of its components below the root is a symlink, which destructive operations
  // must never follow even when its target happens to remain inside the same root.
  const lexical = resolve(join(realRoot, relativeCandidate));
  if (resolved !== lexical) {
    throw new GroveError({
      kind: "invalid-input",
      what,
      why: `"${candidate}" traverses a symlink inside the permitted scope`,
      remedy: "Use a direct path with no symlink components below the selected workspace.",
      detail: { root: realRoot, candidate, lexical, resolved },
    });
  }
  if (strict ? !isStrictSubpath(realRoot, resolved) : !isSubpath(realRoot, resolved)) {
    throw new GroveError({
      kind: "invalid-input",
      what,
      why: `"${candidate}" does not resolve ${strict ? "strictly " : ""}inside the permitted scope`,
      remedy: strict ? "Use a path below the selected workspace, not the workspace root itself." : "Use a path at or below the selected workspace.",
      detail: { root: realRoot, candidate, resolved },
    });
  }
  return lexical;
}

export function containedPath(root: string, candidate: string, what: string): ContainedPath {
  return proveContainedPath(root, candidate, what, true) as ContainedPath;
}

/** Prove a parent at or below root; only the symlink-entry unlink helper accepts this brand. */
export function containedParentPath(root: string, candidate: string, what: string): ContainedParentPath {
  return proveContainedPath(root, candidate, what, false) as ContainedParentPath;
}
