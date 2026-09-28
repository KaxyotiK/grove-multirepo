/**
 * The one argument-parsing entry point for command handlers (§8.1).
 *
 * Handlers MUST NOT call `node:util.parseArgs` directly. Every handler that did read only the
 * leading positionals it cared about, so surplus tokens vanished silently — `grove delete doomed
 * unexpected-extra --allow-destructive-all` deleted `doomed` at exit 0, and `grove new hotfix api` silently
 * produced an empty Grove. Routing every handler through here makes the arity check
 * unavoidable-by-construction rather than a discipline each handler has to remember; the
 * `parse-discipline` scan test fails the build if a handler bypasses it.
 *
 * Option definitions, positional bounds, and extras forwarding come exclusively from `ctx.spec`.
 * The usage line is display text; CMD-16 audits it independently against the runtime schema.
 */
import { parseArgs } from "node:util";
import { GroveError } from "../errors.ts";
import { enableProgress } from "../progress.ts";
import { extractGlobals } from "./globals.ts";
import type { CommandContext, CommandOptions } from "./registry.ts";

/**
 * A global that ends the command before its handler does any work (`--help`, `--version`).
 *
 * `cli.ts` normally intercepts both before dispatch through the same schema-aware scan. This signal
 * remains a defensive boundary for handlers invoked through a direct context, so those invocations
 * still return to the CLI-owned presentation path rather than rendering independently.
 */
export class EarlyExit extends Error {
  readonly which: "help" | "version";
  constructor(which: "help" | "version") {
    super(which);
    this.which = which;
  }
  static is(e: unknown): e is EarlyExit {
    return e instanceof EarlyExit;
  }
}

export type ParsedValue = string | boolean | string[] | boolean[] | undefined;
export type ParsedValues = Record<string, any>;

export interface ParsedCommand {
  values: ParsedValues;
  positionals: string[];
  /** Tokens after a literal `--`, for commands that forward extras (§8.8). Empty otherwise. */
  extras: string[];
}

function wrongValue(name: string, expected: string, value: Exclude<ParsedValue, undefined>): never {
  throw new Error(`Option schema defect for --${name}: expected ${expected}, parsed ${Array.isArray(value) ? "an array" : typeof value}`);
}

/** Narrow one optional string option without recreating its schema in the handler. */
export function stringValue(values: ParsedValues, name: string): string | undefined {
  const value = values[name];
  if (value === undefined || typeof value === "string") return value;
  return wrongValue(name, "a string", value);
}

/** Narrow one optional boolean option without recreating its schema in the handler. */
export function booleanValue(values: ParsedValues, name: string): boolean | undefined {
  const value = values[name];
  if (value === undefined || typeof value === "boolean") return value;
  return wrongValue(name, "a boolean", value);
}

/** Narrow a repeatable string option; an omitted option is the empty list. */
export function stringListValue(values: ParsedValues, name: string): string[] {
  const value = values[name];
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  return wrongValue(name, "an array of strings", value);
}

/** Render the declared bounds the way a user would state them ("exactly 2", "at most 1"). */
function describeArity(min: number, max: number): string {
  if (max === Infinity) return min === 0 ? "any number of arguments" : `at least ${min} argument${min === 1 ? "" : "s"}`;
  if (min === max) return `exactly ${min} argument${min === 1 ? "" : "s"}`;
  if (min === 0) return `at most ${max} argument${max === 1 ? "" : "s"}`;
  return `${min} to ${max} arguments`;
}

/**
 * Parse one command's arguments and enforce its registered runtime positional schema.
 *
 * `forwardsExtras` splits at the first literal `--` before parsing, so the forwarded tokens are
 * neither parsed as options nor counted as positionals (`agent run … -- <extra-args>...`).
 * Without it, `--` tokens fall through to `parseArgs`, which appends them to `positionals`.
 */
export function parseCommand(ctx: CommandContext): ParsedCommand {
  const options: CommandOptions = ctx.spec.options;
  const forwardsExtras = ctx.spec.forwardsExtras ?? false;
  let args = ctx.argv;
  let extras: string[] = [];
  if (forwardsExtras) {
    const dd = args.indexOf("--");
    if (dd >= 0) {
      extras = args.slice(dd + 1);
      args = args.slice(0, dd);
    }
  }
  // Globals can sit anywhere, including straight after one of THIS command's boolean flags — a
  // position `cli.ts` cannot judge, because only `options` says whether the preceding token takes a
  // value. Settle them here and strip them, BEFORE parseArgs gets the chance to reject a global it
  // was never told about. Nothing has been emitted yet, so a `--json` found this late still governs
  // every byte this command writes, including the arity refusal below.
  const scan = extractGlobals(args, options);
  if (scan.globals.json) {
    ctx.globals.json = true;
    ctx.emit.setJson(true);
  }
  if (scan.globals.progressJson) {
    ctx.globals.progressJson = true;
    enableProgress(true);
  }
  if (scan.workspaceGiven) ctx.globals.workspace = scan.globals.workspace;
  // Checked after output globals are applied. Version precedes help, matching public CLI dispatch.
  if (scan.version) throw new EarlyExit("version");
  if (scan.help) throw new EarlyExit("help");
  args = scan.rest;

  const parsed = parseArgs({ args, allowPositionals: true, options });
  const positionals = parsed.positionals as string[];

  // Only the upper bound is enforced here. A MISSING required positional is already refused by the
  // handler with a message that names the specific thing that is missing and why it is needed
  // ("a Grove needs a name — it is the Grove's handle…"); a generic "expected 1 argument" would be
  // strictly worse. Surplus tokens have no such tailored owner, which is why they went unnoticed.
  const { min, max } = ctx.spec.positionals;
  if (positionals.length > max) {
    const surplus = positionals.slice(max);
    throw new GroveError({
      kind: "invalid-input",
      what: `grove ${ctx.spec.path} takes ${describeArity(min, max)}`,
      why: `${surplus.length} extra argument${surplus.length === 1 ? " was" : "s were"} given: ${surplus.map((s) => JSON.stringify(s)).join(", ")}`,
      remedy: `Run \`grove ${ctx.spec.path} --help\` for the exact syntax.`,
      detail: { command: ctx.spec.path, surplus, expected: { min, max: max === Infinity ? null : max } },
    });
  }

  return { values: parsed.values as ParsedValues, positionals, extras };
}
