/**
 * Workspace commands (§8.3): `status`, `config get`, `config set`, `reconcile`.
 *
 * `config set` changes settings only — `name`, `defaults`, `agents`, `layout`, `conventions` — via
 * compare-and-swap. The structural `repositories` array is read-only to it and changes only through
 * the §8.4 commands.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { requireWorkspace, saveWorkspace, validateWorkspaceConfig, validateWorkspaceConfigChange } from "../config/workspace.ts";
import { assertGroveName } from "../model/validate.ts";
import type { WorkspaceConfig } from "../model/types.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { observeWorkspace, observedGroveDetail, observedRepositoryDetail } from "../model/observed.ts";
import { commandResultExit, completeResult } from "../model/result.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";

async function statusHandler(ctx: CommandContext): Promise<number> {
  parseCommand(ctx); // reject unknown flags/positionals consistently
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, new Git(createGitRunner()));
  const detail = {
    workspace: ws.root,
    id: ws.config.id,
    name: ws.config.name,
    rev: ws.meta.rev,
    observedAt: snapshot.completedAt,
    repositories: snapshot.repositories.map(observedRepositoryDetail),
    groves: snapshot.groves.map(observedGroveDetail),
    conformance: {
      total: snapshot.diagnostics.length,
      policy: snapshot.diagnostics.filter((diagnostic) => diagnostic.severity === "policy").length,
      blocking: snapshot.diagnostics.filter((diagnostic) => diagnostic.severity === "blocking").length,
    },
  };
  const result = completeResult("status", [{ selector: { path: ws.root }, before: null, action: "observe", after: detail, reason: null }], snapshot.diagnostics, detail);
  return ctx.emit.result(result, commandResultExit(result));
}

function configGetHandler(ctx: CommandContext): number {
  parseCommand(ctx); // reject unknown flags/positionals consistently
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  return ctx.emit.ok(ws.config);
}

function hasEntries(path: string): boolean { try { return readdirSync(path).length > 0; } catch { return false; } }
function staticLayoutRoot(workspaceRoot: string, template: string): string {
  const segments = template.split("/");
  const token = segments.findIndex((segment) => segment.startsWith("{"));
  return resolve(workspaceRoot, ...segments.slice(0, token < 0 ? segments.length : token));
}

/** A plain JSON object — not null, not an array. Arrays and scalars replace wholesale. */
function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * P5.1 (ledger V-1). The documented `config set` grammar: **keyed objects merge by key, `null`
 * removes a key, arrays replace wholesale.**
 *
 * The implementation shallow-replaced instead, so `--values '{"defaults":{"agent":"codex"}}'`
 * silently deleted `branchPrefix` and `syncStrategy`. Nothing reported the loss: the command
 * exited 0 and said it had set the value it was asked to set. That is silent data loss in the file
 * Grove treats as authoritative.
 */
/**
 * Keys that mutate an object's prototype rather than its data. `config set --values` feeds
 * user-supplied JSON straight into a recursive merge, so these must be refused BEFORE assignment.
 *
 * Top-level ones were already refused by the settable-key check, but a NESTED
 * `{"defaults":{"__proto__":{...}}}` reached the merge, set a prototype, wrote nothing (JSON
 * serialises own properties only) and bumped the revision — a silent no-op write, the same defect
 * P5.2 fixed for `[]`.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function mergePatch(base: unknown, patch: unknown): unknown {
  if (!plainObject(base) || !plainObject(patch)) return patch;
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new GroveError({
        kind: "invalid-input",
        what: `config set cannot use the key "${key}"`,
        why: "it changes an object's prototype rather than its data",
        remedy: "Remove that key from --values.",
        detail: { key },
      });
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];               // explicit removal
    else if (plainObject(value) && plainObject(next[key])) next[key] = mergePatch(next[key], value);
    else next[key] = value;                             // arrays and scalars replace
  }
  return next;
}

async function configSetHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  if (!parsed.values.values) {
    throw new GroveError({
      kind: "invalid-input",
      what: "config set requires --values",
      why: "no --values <json> was given",
      remedy: 'Pass the settings to change, e.g. --values \'{"name":"finance"}\'.',
    });
  }
  let parsedPatch: unknown;
  try {
    parsedPatch = JSON.parse(parsed.values.values) as unknown;
  } catch (e) {
    throw new GroveError({
      kind: "invalid-input",
      what: "config set --values is not valid JSON",
      why: String((e as Error).message ?? e),
      remedy: "Provide a JSON object of settings to change.",
    });
  }
  // P5.2 (ledger V-2). `Object.keys(null)` threw a raw TypeError -> exit 1, which the exit-code
  // contract reserves for INTERNAL faults, not user input. `[]` was worse: it passed every check
  // and wrote a successful, revision-bumping no-op. Refuse the shape first, with exit 2.
  if (!plainObject(parsedPatch)) {
    throw new GroveError({
      kind: "invalid-input",
      what: "config set --values must be a JSON object",
      why: `the value parsed as ${Array.isArray(parsedPatch) ? "an array" : parsedPatch === null ? "null" : typeof parsedPatch}`,
      remedy: 'Pass an object of settings to change, e.g. --values \'{"defaults":{"agent":"codex"}}\'.',
      detail: { received: Array.isArray(parsedPatch) ? "array" : parsedPatch === null ? "null" : typeof parsedPatch },
    });
  }
  const patch: Record<string, unknown> = parsedPatch;
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const settable = new Set(["name", "layout", "conventions", "defaults", "agents"]);
  for (const key of Object.keys(patch)) {
    if (!settable.has(key)) {
      throw new GroveError({
        kind: "refused-policy",
        what: `config set cannot change "${key}"`,
        why: "repository registrations are changed only by repository commands; config updates never move Git worktrees or loose content",
        remedy: "Remove that key, or use the repository/trunk commands.",
        detail: { key },
      });
    }
  }

  if (parsed.values.expect !== undefined && Number(parsed.values.expect) !== ws.meta.rev) {
    throw new GroveError({
      kind: "refused-conflict",
      what: "config set was refused",
      why: `expected revision ${parsed.values.expect}, but the workspace is at revision ${ws.meta.rev}`,
      remedy: "Re-read `grove config get` and retry with the current --expect.",
      detail: { expected: parsed.values.expect, actual: ws.meta.rev },
    });
  }

  const next = mergePatch(ws.config, patch) as WorkspaceConfig;
  // Validate the MERGED config before persisting: a wrong-typed value (e.g. `name:123`) would
  // otherwise be written, then fail validation on the next load — bricking every command that
  // loads the workspace (config get, status, and config set itself). A rejected write leaves disk
  // untouched. Surfaced as invalid-input (the input is bad), not config (the file is still fine).
  try {
    // Enforce the same name grammar `init` enforces — otherwise the init-guaranteed-valid name
    // could be made empty/`-x`/`a/b`/overlong/control-char after the fact.
    if ("name" in patch) assertGroveName(next.name);
    {
      validateWorkspaceConfig(ws.path, next);
      validateWorkspaceConfigChange(ws.config, next, {
        hasGroveLooseContent: ws.config.layout.groves !== next.layout.groves && hasEntries(staticLayoutRoot(ws.root, ws.config.layout.groves)),
        hasArchiveLooseContent: ws.config.layout.archives !== next.layout.archives && hasEntries(staticLayoutRoot(ws.root, ws.config.layout.archives)),
      });
    }
  } catch (e) {
    throw new GroveError({
      kind: "invalid-input",
      what: "config set was refused",
      why: e instanceof GroveError ? e.why : String((e as Error).message ?? e),
      remedy: e instanceof GroveError
        ? e.remedy
        : "Provide settable values of the correct type (name: string; defaults, agents: object).",
      detail: { rejected: Object.keys(patch) },
    });
  }
  const meta = await saveWorkspace(ws, next);
  return ctx.emit.ok({ workspace: ws.root, rev: meta.rev });
}

export function registerWorkspace(): void {
  register({
    path: "status",
    summary: "Show workspace identity, config, repositories, and Groves.",
    usage: "status",
    examples: ["grove status"],
    handler: statusHandler,
  });
  register({
    path: "config get",
    summary: "Print the validated workspace configuration.",
    usage: "config get",
    examples: ["grove config get"],
    handler: configGetHandler,
  });
  register({
    path: "config set",
    summary: "Update workspace config via compare-and-swap.",
    usage: "config set --values <json> [--expect <revision>]",
    args: [
      { name: "--values <json>", desc: "JSON object of settings to merge (name, layout, conventions, defaults, agents); required." },
      { name: "--expect <revision>", desc: "Revision from `config get` (_rev); the write is refused if it moved. Optional." },
    ],
    note: "Settable: name, layout, conventions, defaults, agents. Keyed objects merge, `null` removes a key, arrays replace wholesale. Repositories change via `grove repo`/`grove trunk`, not here.",
    examples: [
      `grove config set --values '{"name":"finance"}' --expect 3  # rename the workspace, but only if it is still at revision 3`,
      `grove config set --values '{"name":"finance"}'             # rename the workspace without a revision guard`,
    ],
    handler: configSetHandler,
    mutates: true,
  });
}
