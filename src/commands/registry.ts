/**
 * The command registry (§8.1). Commands register here; help and completion are generated from
 * this table, never hand-listed. The surface has exactly two layers: bare verbs (act on Groves
 * or the workspace) and noun families (`repo`/`trunk`/`tree`/`agent`/`config`/`file`).
 */
import type { ParseArgsConfig } from "node:util";
import type { CommandEmitter } from "../output.ts";

export type CommandOptions = NonNullable<ParseArgsConfig["options"]>;

export interface GlobalOptions {
  workspace: string | undefined;
  json: boolean;
  progressJson: boolean;
}

export interface CommandContext {
  globals: GlobalOptions;
  /** Arguments after the resolved command path. */
  argv: string[];
  emit: CommandEmitter;
  /** The current working directory (discovery starts here unless --workspace is given). */
  cwd: string;
  /** The resolved command. Carries the declared surface that `parseCommand` enforces (§8.1). */
  spec: CommandSpec;
}

export type CommandHandler = (ctx: CommandContext) => Promise<number> | number;

/** One positional or option in a command's help. `name` starting with `-` renders under Options. */
export interface HelpArg {
  name: string;
  desc: string;
}

export interface CommandSpec {
  /** Space-separated command path, e.g. "init" or "repo add". */
  path: string;
  /** One line for the command list and the first line of `<command> --help`. */
  summary: string;
  /**
   * Exact invocation syntax, WITHOUT the leading `grove ` (added when rendered), e.g.
   * "new <name> [--repo <repo>]...". Falls back to `<path> [args]` when omitted.
   */
  usage?: string;
  /**
   * Positionals and options, in display order — each a terse one-liner (`<name>` / `--flag <v>`
   * paired with a short description). Rendered as aligned Arguments/Options blocks under the
   * summary. Keep it short; the conceptual model and help vocabulary are in README.md (Concepts; Writing help text).
   */
  args?: HelpArg[];
  /** The sole runtime option schema. Handlers consume it through `parseCommand(ctx)`. */
  options: CommandOptions;
  /** Runtime positional bounds. `usage` is display text and is never parsed for enforcement. */
  positionals: Arity;
  /** Forward tokens following a literal `--` instead of parsing them as Grove arguments. */
  forwardsExtras?: boolean;
  /** Durable/Git mutation: must run under the mutation discipline and pass PROC-13 cleanup. */
  mutates?: boolean;
  /** At most ONE short line under the args (e.g. a "prefer X" steer). Not a paragraph. */
  note?: string;
  /**
   * Concrete example invocations, each optionally paired with a `# comment`. Rendered verbatim
   * under an "Examples:" heading. Write the full command line WITHOUT the leading `grove ` when it
   * is the command itself — include `grove ` so copy-paste works. Keep to 1–3 per command.
   */
  examples?: string[];
  handler: CommandHandler;
  /**
   * true for commands that do not require an existing workspace (init, completion, help).
   * ENFORCED, not documentation: `requireWorkspace` refuses to run for a command declared
   * independent, so the flag and the behaviour cannot disagree.
   */
  workspaceIndependent?: boolean;
}

/** Inclusive runtime positional bounds. `max` is `Infinity` for a variadic tail. */
export interface Arity {
  min: number;
  max: number;
}

/**
 * Split a usage remainder into top-level tokens, keeping bracketed groups whole so that
 * `[--branch <repo>=<branch>]...` is one token rather than two half-tokens.
 */
function usageTokens(rest: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of rest) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Derive documented positional arity for CMD-16's test-time drift audit. Production parsing uses
 * `spec.positionals` and never interprets this display text. `<x>` is required,
 * `[x]`/`[<x>]` optional, and a `...` suffix makes
 * the tail unbounded. Anything whose first character is `-` is option material, not a positional:
 * a bracketed group carries its own value, while a bare `--opt` consumes a following `<value>`.
 *
 * Keeping this independent is deliberate: a mismatched usage line and runtime schema must fail the
 * audit instead of sharing one derivation that can only agree with itself.
 */
export function usageArity(spec: CommandSpec): Arity {
  const usage = spec.usage;
  // No declared usage means no declared surface; refuse to invent bounds for it.
  if (usage === undefined) return { min: 0, max: Infinity };
  const rest = usage.startsWith(spec.path) ? usage.slice(spec.path.length) : usage;
  let min = 0;
  let max = 0;
  const toks = usageTokens(rest);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i] as string;
    const bracketed = tok.startsWith("[");
    const inner = bracketed ? tok.slice(1, tok.lastIndexOf("]")) : tok.replace(/\.{3}$/, "");
    if (inner.startsWith("-")) {
      if (!bracketed && (toks[i + 1] ?? "").startsWith("<")) i++;
      continue;
    }
    if (tok.endsWith("...")) {
      max = Infinity;
      if (!bracketed) min++;
      continue;
    }
    max++;
    if (!bracketed) min++;
  }
  return { min, max };
}

/** Compile the documented option grammar into the registry-owned runtime descriptors. */
function optionsFromUsage(usage: string | undefined): CommandOptions {
  const options: CommandOptions = {};
  if (!usage) return options;
  const matches = [...usage.matchAll(/--([a-z][a-z0-9-]*)(?:\s+<[^>]+>(?:=<[^>]+>)?)?(\]\.{3}|\.{3})?/g)];
  for (const match of matches) {
    const name = match[1] as string;
    const takesValue = /\s+</.test(match[0]);
    const multiple = Boolean(match[2]);
    options[name] = takesValue
      ? { type: "string", ...(multiple ? { multiple: true, default: [] } : {}) }
      : { type: "boolean", default: false };
  }
  return options;
}

const registry = new Map<string, CommandSpec>();

export type CommandSpecInput = Omit<CommandSpec, "options" | "positionals"> & Partial<Pick<CommandSpec, "options" | "positionals">>;

export function register(input: CommandSpecInput): void {
  const provisional = { ...input, options: input.options ?? optionsFromUsage(input.usage) };
  const spec: CommandSpec = { ...provisional, positionals: input.positionals ?? usageArity(provisional as CommandSpec) };
  const { min, max } = spec.positionals;
  if (!Number.isInteger(min) || min < 0 || (!(Number.isInteger(max) && max >= min) && max !== Infinity)) {
    throw new Error(`Invalid positional schema for grove ${spec.path}: ${min}..${max}`);
  }
  for (const name of Object.keys(spec.options)) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`Invalid option name "${name}" in grove ${spec.path}; schemas use kebab-case names without --`);
    }
  }
  if (registry.has(spec.path)) throw new Error(`Command already registered: grove ${spec.path}`);
  registry.set(spec.path, spec);
}

export function all(): CommandSpec[] {
  return [...registry.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** The noun-family prefixes (`repo`, `trunk`, …) — every first word that has subcommands. */
export function familyNames(): string[] {
  const fams = new Set<string>();
  for (const spec of registry.values()) {
    const parts = spec.path.split(" ");
    if (parts.length === 2) fams.add(parts[0] as string);
  }
  return [...fams].sort();
}

/** Every command under a noun family (`repo` → `repo add`, `repo ls`, …), path-sorted. */
export function inFamily(family: string): CommandSpec[] {
  return [...registry.values()]
    .filter((s) => s.path.startsWith(`${family} `))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Resolve a command from leading tokens. Two-token noun-family commands (`repo add`) win over a
 * one-token match; returns the spec and the number of tokens it consumed.
 */
export function resolve(tokens: string[]): { spec: CommandSpec; consumed: number } | undefined {
  if (tokens.length >= 2) {
    const two = registry.get(`${tokens[0]} ${tokens[1]}`);
    if (two) return { spec: two, consumed: 2 };
  }
  if (tokens.length >= 1) {
    const one = registry.get(tokens[0] as string);
    if (one) return { spec: one, consumed: 1 };
  }
  return undefined;
}
