/**
 * `grove init [path] [--name <name>] [--nested]` (§7).
 *
 * Creates the workspace scaffolding and publishes the `.grove/config.json` marker atomically as
 * the LAST step, so a partial init leaves no marker (discovery finds nothing) and is safe to
 * retry. Byte-for-byte idempotent when repeated at the same workspace root.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { createIdGenerator } from "../model/ids.ts";
import { assertGroveName } from "../model/validate.ts";
import { writeManifest } from "../store/manifest.ts";
import { SCHEMA_VERSION, type WorkspaceConfig } from "../model/types.ts";
import { normalisePath, isWorkspaceRoot } from "../config/discovery.ts";
import { loadWorkspaceAt } from "../config/workspace.ts";
import { DEFAULT_LAYOUT, compileLayout, type LayoutConfig } from "../config/layout.ts";
import { DEFAULT_CONVENTIONS } from "../config/conventions.ts";
import { workspaceConfig, groveDir, locksDir, operationsDir, centralGrovesDir } from "../paths/layout.ts";
import { completeResult } from "../model/result.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";

function staticTemplateRoot(root: string, template: string): string {
  const segments: string[] = [];
  for (const segment of template.split("/")) {
    if (/^\{.+\}$/.test(segment)) break;
    segments.push(segment);
  }
  return resolve(root, ...segments);
}

function ensureWorkspaceDirs(root: string, layout: LayoutConfig): void {
  try {
    for (const path of [
      groveDir(root),
      locksDir(root),
      operationsDir(root),
      centralGrovesDir(root),
      ...Object.values(layout).map((template) => staticTemplateRoot(root, template)),
    ]) mkdirSync(path, { recursive: true });
    const gi = join(groveDir(root), ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, "locks/\noperations/\n");
  } catch (error) {
    throw new GroveError({ kind: "io", what: `Cannot create the workspace layout at ${root}`, why: (error as NodeJS.ErrnoException).code ?? String((error as Error).message ?? error), remedy: "Check the directory is writable and the disk is not full.", detail: { root }, cause: error });
  }
}

function conflictingDir(path: string): boolean {
  // A path that exists but is not a directory conflicts with the layout Grove needs.
  try {
    return existsSync(path) && !statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function occupiedLayoutDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

async function initHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const target = normalisePath(parsed.positionals[0] ?? ctx.cwd);
  const name = parsed.values.name ?? basename(target);
  assertGroveName(name);

  // Already a workspace at this exact root → idempotent: ensure dirs, do not rewrite config.
  if (isWorkspaceRoot(target)) {
    const existing = loadWorkspaceAt(target);
    ensureWorkspaceDirs(target, existing.config.layout);
    const detail = { workspace: target, name: existing.config.name, created: false };
    const result = completeResult("init", [{ selector: { path: target }, before: detail, action: "initialize", after: detail, reason: null }], [], detail);
    return ctx.emit.result(result, 0);
  }

  // A `.grove/config.json` that exists but is not a file, or a malformed one, refuses via load.
  if (existsSync(workspaceConfig(target)) && !statSync(workspaceConfig(target)).isFile()) {
    throw new GroveError({
      kind: "config",
      what: `Cannot initialize ${target}`,
      why: ".grove/config.json exists but is not a file",
      remedy: "Remove the conflicting path and retry.",
      detail: { target },
    });
  }

  // Refuse when an ancestor is already a workspace unless --nested is explicit.
  if (!parsed.values.nested) {
    let dir = dirname(target);
    for (;;) {
      if (isWorkspaceRoot(dir)) {
        throw new GroveError({
          kind: "refused-policy",
          what: `Cannot initialize ${target}`,
          why: `an ancestor workspace already exists at ${dir}`,
          remedy: "Pass --nested to create a nested workspace, or choose a different location.",
          detail: { target, ancestor: dir },
        });
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Refuse conflicting non-directory paths where the layout needs directories.
  const layout = DEFAULT_LAYOUT;
  const conflicts: Array<readonly [string, string]> = Object.entries(layout).map(([label, template]) => [label, staticTemplateRoot(target, template)] as const);
  for (const [label, path] of conflicts) {
    if (conflictingDir(path)) {
      throw new GroveError({
        kind: "refused-policy",
        what: `Cannot initialize ${target}`,
        why: `${label} exists but is not a directory`,
        remedy: "Remove or rename the conflicting path and retry.",
        detail: { target, path },
      });
    }
    if (occupiedLayoutDir(path)) {
      throw new GroveError({
        kind: "refused-policy",
        what: `Cannot initialize ${target}`,
        why: `${label} already contains data at ${path}`,
        remedy: "Choose an empty workspace path or move the existing data aside; Grove never adopts an unregistered layout implicitly.",
        detail: { target, path },
      });
    }
  }

  // Build the scaffolding, then publish the config marker atomically LAST.
  ensureWorkspaceDirs(target, layout);
  const ids = createIdGenerator();
  compileLayout(target, layout);
  const config: WorkspaceConfig = {
    kind: "workspace",
    schemaVersion: SCHEMA_VERSION,
    _rev: 0,
    id: ids.ulid(),
    name,
    layout,
    conventions: DEFAULT_CONVENTIONS,
    defaults: { syncStrategy: "ff-only" },
    agents: {},
    repositories: [],
  };
  await writeManifest(workspaceConfig(target), config, { workspace: target });
  const detail = { workspace: target, name, created: true };
  const result = completeResult("init", [{ selector: { path: target }, before: null, action: "initialize", after: detail, reason: null }], [], detail);
  return ctx.emit.result(result, 0);
}

export function registerInit(): void {
  register({
    path: "init",
    summary: "Create a Grove workspace.",
    usage: "init [path] [--name <name>] [--nested]",
    args: [
      { name: "<path>", desc: "Where to create the workspace (default: the current directory)." },
      { name: "--name <name>", desc: "Workspace name (default: the directory name)." },
      { name: "--nested", desc: "Permit creating a workspace inside an existing one." },
    ],
    note: "Writes schema v3 and compiled repository/trunk/Grove/archive roots. Idempotent at an existing root; refuses nesting unless --nested.",
    examples: [
      "grove init                          # initialize a workspace in the current directory",
      'grove init ~/work/acme --name acme  # create a workspace at ~/work/acme, named "acme"',
    ],
    handler: initHandler,
    workspaceIndependent: true,
  });
}
