/**
 * File commands (§8.7): `file ls`, `file read`. Read-only, path-contained: paths are relative to
 * the selected workspace/Grove/Tree scope; absolute paths and resolved escapes are refused.
 *
 * Extracted from the pinned source's bounded listing/reading; UI response shaping removed.
 */
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { GroveError } from "../errors.ts";
import { resolveContained } from "../paths/fs.ts";
import { groveDir } from "../paths/layout.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { visibleControl } from "../model/control.ts";
import { register, type CommandContext } from "./registry.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { observeWorkspace, type ObservedWorkspace } from "../model/observed.ts";
import { expandGrovePath } from "../config/layout.ts";
import { completeResult, commandResultExit, type ResultSelector } from "../model/result.ts";
import type { Diagnostic } from "../model/conformance.ts";
import { parseCommand } from "./args.ts";
import { scanOperations } from "../store/operation.ts";

const MAX_READ_BYTES = 4 * 1024 * 1024;

function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

type FileIdentity = { dev: number; ino: number };

/** Device/inode of the workspace's `.grove` directory, or null when it does not exist. */
function groveStateIdentity(workspaceRoot: string): FileIdentity | null {
  try {
    const stat = statSync(groveDir(workspaceRoot));
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
}

/** Whether `path` is the workspace's `.grove` directory itself. A final symlink is not followed. */
function isGroveState(path: string, groveState: FileIdentity | null): boolean {
  if (groveState === null) return false;
  try {
    const stat = lstatSync(path);
    return stat.dev === groveState.dev && stat.ino === groveState.ino;
  } catch {
    return false;
  }
}

/**
 * Issue #11 / `V3SEC-04`. `.grove/` is Grove's internal state, not workspace content, and a
 * resumable operation record there retains an unredacted remote.
 *
 * `.grove` is recognised by device/inode, not path text: `realpathSync` keeps the caller's spelling,
 * so `.GROVE/…` on a case-insensitive volume would slip past a prefix check. `resolved` comes from
 * `resolveContained`, so its existing part is already symlink-free and each ancestor can be compared
 * with `lstat`; a missing tail simply never matches.
 *
 * The walk runs to the filesystem root rather than stopping at the scope root: the scope root may
 * not have been through `realpath`, so comparing the two strings could stop early. `.grove` is a
 * child of the workspace root, so the extra ancestors cost a few `lstat` calls and never match.
 *
 * Handlers call this before their own `stat`/`readdir`/read, so a missing file inside `.grove` is
 * refused as excluded rather than reported as missing.
 */
function refuseGroveState(workspaceRoot: string, resolved: string, rel: string, what: string): void {
  const groveState = groveStateIdentity(workspaceRoot);
  for (let probe = resolved; ; probe = dirname(probe)) {
    if (isGroveState(probe, groveState)) {
      throw new GroveError({
        kind: "invalid-input",
        what,
        why: `"${rel}" is inside Grove's internal state directory (.grove), which is not part of the file surface`,
        remedy: "List or read workspace content instead; use `grove doctor` to inspect Grove's own state.",
        detail: { path: rel },
      });
    }
    if (dirname(probe) === probe) return;
  }
}

type RepositoryStore = FileIdentity & { repository: string | null };

/**
 * Whether `path` still looks like a Git directory: `objects/` and `refs/` directories beside a `HEAD`
 * that is a regular file or a symlink. This errs wider than Git's `is_git_directory`: Git's
 * `validate_headref` accepts a HEAD symlink into `refs/` even when its target is missing (as
 * `core.preferSymlinkRefs` plus `pack-refs --all` leaves it), so HEAD is checked with `lstat` and never
 * followed. Erring wider only keeps a directory off the file surface.
 */
export function isGitDirectory(path: string): boolean {
  try {
    const head = lstatSync(join(path, "HEAD"));
    return (head.isFile() || head.isSymbolicLink()) && statSync(join(path, "objects")).isDirectory() && statSync(join(path, "refs")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `V3SEC-06`. Git keeps a remote URL verbatim in a repository's own config, so a credential added
 * by hand (`git remote set-url` inside `repos/<repo>`) would be printed by `file read`. Every
 * repository Git directory Grove knows at this workspace is therefore off the file surface:
 *
 * - each registered repository's store, observed at its expanded `layout.repositories` path for a
 *   managed repository (any template, not only `repos/{repo}`) and at its recorded common directory
 *   for a linked one, plus each unregistered repository observed through a Tree;
 * - the anchor of every recorded `repo add`, finished or not, which is the one store Grove created
 *   that may be registered nowhere — but only while that path is still a Git directory. Records are
 *   never deleted, so an anchor later replaced by an ordinary checkout (remove, delete, clone, link)
 *   must become readable again; a structural test works for records written before this rule, which
 *   carry no identity of the store they created.
 *
 * A Git directory Grove never registered or created (a clone a user drops into the workspace) is not
 * covered: the file surface is not a secret scanner. Identities are taken with `stat`, so a store
 * reached through a symlink is still recognised; missing paths are skipped.
 */
function repositoryStores(snapshot: ObservedWorkspace): RepositoryStore[] {
  const candidates: Array<{ path: string; repository: string | null }> = [];
  for (const repository of snapshot.repositories) {
    const name = repository.registration?.name ?? null;
    candidates.push({ path: repository.anchorPath, repository: name }, { path: repository.commonGitDir, repository: name });
  }
  const operations = scanOperations(snapshot.workspace.root);
  for (const record of operations.records) {
    if (record.kind !== "repo-add") continue;
    const input = record.steps.find((step) => step.kind === "repository-init-bare")?.input as { anchor?: unknown } | undefined;
    if (typeof input?.anchor === "string" && isGitDirectory(input.anchor)) candidates.push({ path: input.anchor, repository: record.scope.repositoryAlias ?? null });
  }
  // Fail closed: a record that no longer loads may still be a `repo add` whose store exists. Recover
  // every `"anchor"` string its raw text still holds; the Git-directory test above bounds the effect.
  for (const { file } of operations.errors) {
    let raw = "";
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    for (const match of raw.matchAll(/"anchor"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      let anchor: unknown;
      try { anchor = JSON.parse(match[1]!); } catch { continue; }
      if (typeof anchor === "string" && isAbsolute(anchor) && isGitDirectory(anchor)) candidates.push({ path: anchor, repository: null });
    }
  }
  const stores: RepositoryStore[] = [];
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate.path);
      if (stat.isDirectory()) stores.push({ dev: stat.dev, ino: stat.ino, repository: candidate.repository });
    } catch { /* not on disk: nothing to reach */ }
  }
  return stores;
}

/** The repository store `path` itself is, if any. A final symlink is not followed. */
function storeAt(path: string, stores: readonly RepositoryStore[]): RepositoryStore | null {
  if (stores.length === 0) return null;
  try {
    const stat = lstatSync(path);
    return stores.find((store) => store.dev === stat.dev && store.ino === stat.ino) ?? null;
  } catch {
    return null;
  }
}

/** Refuse a path on or inside a repository store, by the same ancestor walk as `refuseGroveState`. */
function refuseRepositoryStore(stores: readonly RepositoryStore[], resolved: string, rel: string, what: string): void {
  for (let probe = resolved; ; probe = dirname(probe)) {
    const store = storeAt(probe, stores);
    if (store) {
      throw new GroveError({
        kind: "invalid-input",
        what,
        why: `"${rel}" is inside ${store.repository ? `repository "${store.repository}"'s` : "a repository's"} Git directory, which is not part of the file surface`,
        remedy: "Read code from a trunk or a Tree instead; inspect repository state with `grove repo status` or native Git.",
        detail: { path: rel },
      });
    }
    if (dirname(probe) === probe) return;
  }
}

async function scopeRoot(ctx: CommandContext, groveRef?: string, treeRef?: string): Promise<{ root: string; workspaceRoot: string; stores: RepositoryStore[]; selector: ResultSelector; diagnostics: Diagnostic[] }> {
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, new Git(createGitRunner()));
  const stores = repositoryStores(snapshot);
  if (!groveRef) {
    if (treeRef) throw new GroveError({ kind: "invalid-input", what: "--tree requires --grove", why: "a Tree is selected within a Grove", remedy: "Pass --grove <grove> --tree <tree>." });
    return { root: ws.root, workspaceRoot: ws.root, stores, selector: { path: ws.root }, diagnostics: snapshot.diagnostics };
  }
  const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
  if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${groveRef}"`, why: "no observed or advisory Grove matches", remedy: "Run `grove ls`." });
  if (!treeRef) return { root: expandGrovePath(snapshot.layout, grove.name), workspaceRoot: ws.root, stores, selector: { grove: grove.name }, diagnostics: snapshot.diagnostics };
  const trees = grove.trees.filter((tree) => tree.treeName === treeRef || tree.selector?.tree === treeRef || `${tree.selector?.repositoryId}/${tree.treeName}` === treeRef);
  if (trees.length !== 1 || trees[0]?.path.utf8 === null) throw new GroveError({ kind: "invalid-input", what: `No addressable Tree "${treeRef}"`, why: trees.length === 0 ? "the selector matches no observed Tree" : "the selector is ambiguous or has a non-UTF-8 path", remedy: "Run `grove tree ls`." });
  const tree = trees[0]!;
  return { root: tree.path.utf8 as string, workspaceRoot: ws.root, stores, selector: { repositoryId: tree.selector?.repositoryId, grove: grove.name, tree: tree.treeName ?? undefined, path: tree.path.utf8 as string }, diagnostics: snapshot.diagnostics };
}

async function lsHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const scope = await scopeRoot(ctx, parsed.values.grove, parsed.values.tree);
  const root = scope.root;
  const rel = parsed.positionals[0] ?? ".";
  const dir = resolveContained(root, rel, "Cannot list that path");
  refuseGroveState(scope.workspaceRoot, dir, rel, "Cannot list that path");
  refuseRepositoryStore(scope.stores, dir, rel, "Cannot list that path");
  const groveState = groveStateIdentity(scope.workspaceRoot);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((d) => !isGroveState(join(dir, d.name), groveState) && storeAt(join(dir, d.name), scope.stores) === null).map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : d.isSymbolicLink() ? "symlink" : "file" }));
  } catch (e) {
    throw new GroveError({ kind: "io", what: `Cannot list ${rel}`, why: (e as NodeJS.ErrnoException).code ?? String(e), remedy: "Check the path exists and is a directory.", detail: { path: rel } });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  // Filenames are untrusted, repo-borne data: escape control/bidi bytes so a crafted name cannot
  // inject terminal escape sequences into the human-mode listing. The --json name stays verbatim.
  const after = { path: rel, entries };
  const result = completeResult("file ls", [{ selector: scope.selector, before: null, action: "list", after, reason: null }], scope.diagnostics, after);
  return ctx.emit.result(result, commandResultExit(result));
}

async function readHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const path = parsed.positionals[0];
  if (!path) throw new GroveError({ kind: "invalid-input", what: "file read requires <path>", why: "no path given", remedy: "Pass a path relative to the selected scope." });
  const scope = await scopeRoot(ctx, parsed.values.grove, parsed.values.tree);
  const root = scope.root;
  const file = resolveContained(root, path, "Cannot read that path");
  refuseGroveState(scope.workspaceRoot, file, path, "Cannot read that path");
  refuseRepositoryStore(scope.stores, file, path, "Cannot read that path");
  // A missing/unreadable file is a routine precondition failure (io, exit 7), not an internal
  // crash (exit 1) — and the raw fs error would leak the absolute path. `file ls` already does this.
  let stat;
  try {
    stat = statSync(file);
  } catch (e) {
    throw new GroveError({ kind: "io", what: `Cannot read ${path}`, why: (e as NodeJS.ErrnoException).code ?? String(e), remedy: "Check the path exists and is readable.", detail: { path } });
  }
  if (!stat.isFile()) throw new GroveError({ kind: "invalid-input", what: `Cannot read ${path}`, why: "the path is not a regular file", remedy: "Point at a file, or use `grove file ls`." });
  if (stat.size > MAX_READ_BYTES) {
    throw new GroveError({
      kind: "refused-precondition",
      what: `Cannot read ${path}`,
      why: `the file is ${stat.size} bytes, above the ${MAX_READ_BYTES}-byte limit for \`file read\``,
      remedy: "Read it with your own tooling; `file read` returns whole files only and never a truncated prefix.",
      detail: { path, size: stat.size, limit: MAX_READ_BYTES },
    });
  }
  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch (e) {
    throw new GroveError({ kind: "io", what: `Cannot read ${path}`, why: (e as NodeJS.ErrnoException).code ?? String(e), remedy: "Check the file is readable.", detail: { path } });
  }
  if (isBinary(raw)) {
    throw new GroveError({
      kind: "invalid-input",
      what: `Cannot read ${path}`,
      why: "the file is binary, and `file read` returns text",
      remedy: "Use `grove file ls` to inspect it, or read it with your own tooling.",
      detail: { path, size: stat.size },
    });
  }
  const content = raw.toString("utf8");
  const after = { path, content };
  const result = completeResult("file read", [{ selector: scope.selector, before: null, action: "read", after, reason: null }], scope.diagnostics, after);
  return ctx.emit.result(result, commandResultExit(result));
}

export function registerFiles(): void {
  register({
    path: "file ls",
    summary: "List one contained directory level.",
    usage: "file ls [<path>] [--grove <grove>] [--tree <tree>]",
    args: [
      { name: "<path>", desc: "Directory relative to the scope (default: the scope root)." },
      { name: "--grove <grove>", desc: "Scope to a Grove (default: the workspace root)." },
      { name: "--tree <tree>", desc: "Scope to one Tree's worktree (requires --grove)." },
    ],
    note: "Absolute paths and any path resolving outside the scope are refused.",
    examples: [
      "grove file ls                                                 # list the workspace root",
      "grove file ls src --grove pricing-fix --tree pricing-fix@web  # list src/ in that Tree's worktree",
    ],
    handler: lsHandler,
  });
  register({
    path: "file read",
    summary: "Read one contained text file.",
    usage: "file read <path> [--grove <grove>] [--tree <tree>]",
    args: [
      { name: "<path>", desc: "File relative to the scope." },
      { name: "--grove <grove>", desc: "Scope to a Grove (default: the workspace root)." },
      { name: "--tree <tree>", desc: "Scope to one Tree's worktree (requires --grove)." },
    ],
    note: "Absolute paths and any path resolving outside the scope are refused.",
    examples: [
      "grove file read README.md                                             # read from the workspace root",
      "grove file read README.md --grove pricing-fix --tree pricing-fix@web  # read from that Tree's worktree",
    ],
    handler: readHandler,
  });
}
