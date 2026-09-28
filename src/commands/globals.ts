/**
 * The one scanner for global options (§8.1: `--workspace`, `--json`, `--progress=json`, `--help`,
 * `--version`), used at two different precisions by the two places that need it.
 *
 * Globals may appear ANYWHERE in argv — the contract lists them with no positional constraint, and
 * README.md:36 promises `--json` on any command. The only hard question is whether a global-looking
 * token is really a global or the VALUE of the option in front of it:
 *
 *     grove agent add a cmd --arg --json     # --json is --arg's value
 *     grove delete doomed --allow-destructive-all --json     # --json is a global; --allow-destructive-all is a boolean
 *
 * Nothing but the command's own option schema separates those two. `cli.ts` first scans the raw
 * argv conservatively only to resolve the command, then scans that SAME untouched argv with the
 * real schema. The second result is definitive; filtered output from the first pass is never fed
 * into it. `parseCommand` retains a defensive scan for direct handler contexts.
 *
 * That split is the whole point: the previous single-pass version assumed every non-global option
 * consumed the next token, so every global written after a BOOLEAN flag was mis-read as its value
 * and then rejected by `parseArgs` as an unknown option. `grove delete x --allow-destructive-all --json` exited 2.
 */
import type { ParseArgsConfig } from "node:util";
import { GroveError } from "../errors.ts";
import type { GlobalOptions } from "./registry.ts";

type Options = NonNullable<ParseArgsConfig["options"]>;

export type GlobalOptionKind = "workspace" | "json" | "progress-json" | "version" | "help";

export interface GlobalOptionDefinition {
  kind: GlobalOptionKind;
  /** Exact accepted tokens; attached value forms use `attachedPrefix` instead. */
  flags: readonly string[];
  attachedPrefix?: string;
  help: { option: string; description: string };
  /** Long spellings offered by shell completion; values may intentionally be prefixes. */
  completion: readonly string[];
}

/** One source for accepted globals, terminal/JSON help facts, and completion spellings. */
export const GLOBAL_OPTION_DEFINITIONS: readonly GlobalOptionDefinition[] = [
  {
    kind: "workspace",
    flags: ["--workspace"],
    attachedPrefix: "--workspace=",
    help: { option: "--workspace <path>", description: "Select an exact workspace instead of cwd discovery." },
    completion: ["--workspace"],
  },
  {
    kind: "json",
    flags: ["--json"],
    help: { option: "--json", description: "Emit one stable JSON success or error value." },
    completion: ["--json"],
  },
  {
    kind: "progress-json",
    flags: ["--progress=json"],
    help: { option: "--progress=json", description: "Emit NDJSON progress on stderr." },
    completion: ["--progress"],
  },
  {
    kind: "version",
    flags: ["--version", "-V"],
    help: { option: "--version, -V", description: "Print the installed version." },
    completion: ["--version"],
  },
  {
    kind: "help",
    flags: ["--help", "-h"],
    help: { option: "--help, -h", description: "Show help." },
    completion: ["--help"],
  },
];

interface GlobalOptionMatch {
  definition: GlobalOptionDefinition;
  attachedValue?: string;
}

function matchGlobalOption(token: string): GlobalOptionMatch | undefined {
  for (const definition of GLOBAL_OPTION_DEFINITIONS) {
    if (definition.flags.includes(token)) return { definition };
    if (definition.attachedPrefix && token.startsWith(definition.attachedPrefix)) {
      return { definition, attachedValue: token.slice(definition.attachedPrefix.length) };
    }
  }
  return undefined;
}

/** What a scan found. `rest` is argv with every recognised global removed. */
export interface GlobalScan {
  globals: GlobalOptions;
  rest: string[];
  help: boolean;
  version: boolean;
  /** True when `--workspace` was written at all — a `--workspace` with no command is meaningless. */
  workspaceGiven: boolean;
}

/** A tolerant scan lets the CLI choose the correct emitter before reporting malformed globals. */
export interface GlobalScanResult {
  scan: GlobalScan;
  error?: GroveError;
}
/** Recognized globals never belong to a preceding command option unless pending-value owns them. */
function isGlobalFlag(token: string): boolean {
  return matchGlobalOption(token) !== undefined;
}

/**
 * Does `token` consume the NEXT argv token as its value?
 *
 * With no schema the answer is unknowable, so it is "yes" — the conservative direction, because it
 * leaves the following token in place for the schema-aware pass rather than stealing it here.
 */
function consumesValue(token: string, options: Options | undefined): boolean {
  if (!token.startsWith("-") || token === "--" || token === "-") return false;
  if (token.startsWith("--") && token.includes("=")) return false; // value already attached
  if (isGlobalFlag(token)) return false;
  if (options === undefined) return true;
  const entry = token.startsWith("--")
    ? options[token.slice(2)]
    : Object.values(options).find((o) => o !== undefined && "short" in o && o.short === token.slice(1));
  // An option the schema does not declare is about to be rejected by parseArgs by name. Treating it
  // as value-less means that rejection is the error the user sees, rather than a confusing one
  // about the token that happened to follow it.
  return entry !== undefined && entry.type === "string";
}

/**
 * Extract globals from `args`, returning them and the tokens that are not globals.
 *
 * Pass `options` to decide ambiguous positions precisely; omit it when the schema is not yet known.
 * Nothing at or after a literal `--` is examined — those are forwarded extras (§8.1/§8.8), and
 * `grove agent run x -- --json` must hand `--json` to the agent, not to grove.
 */
export function scanGlobals(args: string[], options?: Options): GlobalScanResult {
  const globals: GlobalOptions = { workspace: undefined, json: false, progressJson: false };
  let help = false;
  let version = false;
  let workspaceGiven = false;
  let error: GroveError | undefined;
  const rest: string[] = [];
  // True when the CURRENT token was claimed as the value of the option before it. Tracked
  // left-to-right rather than by looking backwards, so a value that itself looks like an option
  // (`--arg --tree`) cannot go on to claim the token after it.
  let pendingValue = false;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") break; // forwarded extras: hand the rest through untouched
    if (pendingValue) {
      pendingValue = false;
      rest.push(a);
      continue;
    }
    const matched = matchGlobalOption(a);
    if (matched?.definition.kind === "json") {
      globals.json = true;
      continue;
    }
    if (matched?.definition.kind === "progress-json") {
      globals.progressJson = true;
      continue;
    }
    if (matched?.definition.kind === "workspace" && matched.attachedValue !== undefined) {
      globals.workspace = matched.attachedValue;
      workspaceGiven = true;
      continue;
    }
    if (matched?.definition.kind === "workspace") {
      // Requires a value. `grove --workspace status` used to swallow the command as the path and
      // exit 0 having done nothing the user asked; a path that looks like an option is refused
      // outright rather than guessed at (use `--workspace=<path>` for one starting with '-').
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        error ??= new GroveError({
          kind: "invalid-input",
          what: "--workspace requires a path",
          why: value === undefined ? "no value followed --workspace" : `the next token "${value}" is an option, not a path`,
          remedy: "Pass the workspace root: `--workspace <path>`, or `--workspace=<path>` for a path beginning with '-'.",
        });
        // Keep scanning without consuming the option-looking token so output globals written after
        // the error still select their promised envelope. The CLI reports the first scan error.
        continue;
      }
      globals.workspace = value;
      workspaceGiven = true;
      i++;
      continue;
    }
    if (matched?.definition.kind === "help") {
      help = true;
      continue;
    }
    if (matched?.definition.kind === "version") {
      version = true;
      continue;
    }
    rest.push(a);
    pendingValue = consumesValue(a, options);
  }
  // Everything from the `--` onward belongs to the command, separator included.
  rest.push(...args.slice(i));
  return { scan: { globals, rest, help, version, workspaceGiven }, ...(error ? { error } : {}) };
}

/** Strict scanner used by command parsing and direct callers. */
export function extractGlobals(args: string[], options?: Options): GlobalScan {
  const result = scanGlobals(args, options);
  if (result.error) throw result.error;
  return result.scan;
}
