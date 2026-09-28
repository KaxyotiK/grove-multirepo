/**
 * Workspace discovery (§2). Rewritten from the pinned source's global-resolution model:
 *   - the marker is EXACTLY the file `.grove/config.json` (a `.grove/` directory alone is not
 *     enough);
 *   - precedence is `--workspace <path>` first, then an upward walk from cwd;
 *   - NO environment variable selects a workspace — an inherited `GROVE_ROOT` has no effect;
 *   - realpath normalisation so comparisons against Git output (which reports realpaths) hold;
 *   - the nearest marker wins; nothing is skipped or scanned in siblings/descendants.
 *
 * A malformed/unsupported nearest config is not detected here — discovery finds the nearest
 * marker; loading (config/workspace.ts) validates it and refuses rather than binding to an
 * ancestor.
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { workspaceConfig } from "../paths/layout.ts";

/** Normalise through symlinks so comparisons against git output hold. */
export function normalisePath(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p); // does not exist yet — resolve is the best we can do
  }
}

/** True iff `dir` holds the exact marker file `.grove/config.json`. */
export function isWorkspaceRoot(dir: string): boolean {
  try {
    return statSync(workspaceConfig(dir)).isFile();
  } catch {
    return false;
  }
}

export interface DiscoverOptions {
  cwd: string;
  /** The value of --workspace, if given. */
  workspace?: string | undefined;
}

/**
 * Resolve the workspace root. `--workspace` wins; otherwise walk upward from cwd for the nearest
 * `.grove/config.json`. Refuses (exit 8) when none is found or when an explicit `--workspace`
 * does not hold the marker.
 */
export function discoverWorkspace(opts: DiscoverOptions): string {
  if (opts.workspace !== undefined) {
    const root = normalisePath(opts.workspace);
    if (!isWorkspaceRoot(root)) {
      throw new GroveError({
        kind: "config",
        what: `--workspace ${opts.workspace} is not a Grove workspace`,
        why: "it does not contain a .grove/config.json marker",
        remedy: "Point --workspace at a directory created by `grove init`.",
        detail: { workspace: opts.workspace, expected: ".grove/config.json" },
      });
    }
    return root;
  }

  let dir = normalisePath(opts.cwd);
  for (;;) {
    if (isWorkspaceRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new GroveError({
    kind: "config",
    what: `No Grove workspace found from ${opts.cwd}.`,
    why: "no .grove/config.json was found here or in any parent directory",
    remedy: "Run `grove init` in the workspace root, or `grove init <path>`.",
    detail: { cwd: opts.cwd, expected: "<workspace>/.grove/config.json" },
  });
}

/** For callers that must degrade rather than fail. */
export function tryDiscoverWorkspace(opts: DiscoverOptions): string | null {
  try {
    return discoverWorkspace(opts);
  } catch {
    return null;
  }
}

/** Enumerate only the finite depth described by a compiled template. */
export function scanTemplateCandidates(root: string, template: string): string[] {
  let current = [root];
  for (const segment of template.split("/")) {
    const token = /^\{[^{}]+\}$/.test(segment);
    const next: string[] = [];
    for (const parent of current) {
      if (!token) {
        const candidate = resolve(parent, segment);
        try { if (statSync(candidate).isDirectory()) next.push(candidate); } catch { /* absent */ }
      } else {
        try {
          for (const entry of readdirSync(parent, { withFileTypes: true }))
            if (entry.isDirectory()) next.push(resolve(parent, entry.name));
        } catch { /* absent */ }
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current.sort();
}
