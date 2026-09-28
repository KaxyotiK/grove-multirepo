/**
 * Output envelope (§8.1). With `--json`, stdout carries exactly one JSON value (success or
 * error); otherwise human text. Progress always goes to stderr. Errors always state what failed,
 * why, and the next action (§9).
 */
import { GroveError, exitCodeFor } from "./errors.ts";
import { renderHumanHelp, type HelpDocument } from "./help.ts";
import { visibleControl } from "./model/control.ts";
import { redactRemote } from "./model/result.ts";
import { checkRemoteCredentials } from "./model/validate.ts";

/** Output capabilities available to registered command handlers. */
export interface CommandEmitter {
  readonly json: boolean;
  setJson(on: boolean): void;
  /** Emit one success value and return its exit code (0). */
  ok(value: unknown): number;
  /** Emit an error (any thrown value) and return its exit code. */
  fail(err: unknown): number;
  /** Emit a versioned result while returning its independently classified exit code. */
  result(value: unknown, exitCode: number): number;
}

/** CLI-owned output capabilities, including the explicit help presentation path. */
export interface Emitter extends CommandEmitter {
  /** Emit one registry-derived help document using the selected format. */
  help(value: HelpDocument): number;
}

function label(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return words.length === 0 ? key : `${words[0]!.toUpperCase()}${words.slice(1)}`;
}

function scalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value !== "string") return String(value);
  const visible = visibleControl(value);
  if (value.length > 0 && value.trim() === value) return visible;
  return JSON.stringify(visible);
}

function linesFor(value: unknown, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${prefix}${scalar(value)}`];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    return value.flatMap((item) => {
      const child = linesFor(item, indent + 2);
      if (child.length === 1) return [`${prefix}- ${child[0]!.slice(indent + 2)}`];
      return [`${prefix}-`, ...child];
    });
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [`${prefix}{}`];
  return entries.flatMap(([key, item]) => {
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      return [`${prefix}${label(key)}: ${scalar(item)}`];
    }
    if (Array.isArray(item) && item.length === 0) return [`${prefix}${label(key)}: []`];
    if (!Array.isArray(item) && Object.keys(item as Record<string, unknown>).length === 0) return [`${prefix}${label(key)}: {}`];
    return [`${prefix}${label(key)}:`, ...linesFor(item, indent + 2)];
  });
}

/**
 * Render the exact JSON-compatible value in a deterministic readable form. Normalizing through
 * JSON first makes omission/null coercion identical to machine mode; command-specific projections
 * cannot discard fields because this traversal owns every structured human result.
 */
export function renderHuman(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Command output must be JSON-serializable");
  const normalized = JSON.parse(encoded) as unknown;
  if (typeof normalized === "string") return normalized;
  return linesFor(normalized, 0).join("\n");
}

function writeValue(value: unknown, asJson: boolean, stream: NodeJS.WriteStream): void {
  const text = asJson ? JSON.stringify(value) : renderHuman(value);
  if (text === undefined) throw new TypeError("Command output must be JSON-serializable");
  stream.write(`${text}\n`);
}

function writeHelp(value: HelpDocument, asJson: boolean, stream: NodeJS.WriteStream): void {
  const text = asJson ? JSON.stringify(value) : renderHumanHelp(value, stream.columns || 100);
  stream.write(`${text}\n`);
}

/** Error text can quote an argv value in `what`, `why`, or nested machine detail. Redact that
 * value everywhere in the envelope, without changing ordinary successful SSH output. */
function redactErrorArgv(value: unknown): unknown {
  const sensitive = new Set<string>();
  const carriesRemoteSecret = (candidate: string): boolean =>
    candidate.length > 0 && (checkRemoteCredentials(candidate) !== null || (candidate.includes(":") && redactRemote(candidate) !== candidate));
  for (const arg of process.argv.slice(2)) {
    const candidates = [arg, arg.startsWith("--") ? arg.slice(2) : arg];
    const equals = arg.indexOf("=");
    if (equals >= 0) candidates.push(arg.slice(equals + 1));
    if (candidates.some(carriesRemoteSecret)) {
      sensitive.add(arg);
      for (const candidate of candidates) if (carriesRemoteSecret(candidate)) sensitive.add(candidate);
    }
  }
  const tokens = [...sensitive].sort((a, b) => b.length - a.length);
  const visit = (entry: unknown): unknown => {
    if (typeof entry === "string") return tokens.reduce((text, token) => text.replaceAll(token, "<redacted-remote>"), entry);
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === "object") return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, visit(item)]));
    return entry;
  };
  return visit(value);
}

export function createEmitter(json: boolean): Emitter {
  let asJson = json;
  return {
    get json() { return asJson; },
    setJson(on) { asJson = on; },
    ok(value) {
      writeValue(value, asJson, process.stdout);
      return 0;
    },
    help(value) {
      writeHelp(value, asJson, process.stdout);
      return 0;
    },
    fail(err) {
      if (GroveError.is(err)) {
        writeValue(redactErrorArgv(err.toJSON()), asJson, asJson ? process.stdout : process.stderr);
        return err.exitCode;
      }
      const message = err instanceof Error ? err.message : String(err);
      const envelope = { error: { kind: "internal", what: "Unexpected failure", why: message, exitCode: 1 } };
      writeValue(redactErrorArgv(envelope), asJson, asJson ? process.stdout : process.stderr);
      return exitCodeFor(err);
    },
    result(value, exitCode) {
      writeValue(value, asJson, process.stdout);
      return exitCode;
    },
  };
}

/**
 * Resolve once everything already written to `stream` has been handed to the operating system.
 *
 * Node writes to a pipe asynchronously on macOS, so a write larger than the pipe buffer is still
 * queued when the command returns. Writable streams complete writes in order, so the callback of an
 * empty write runs only after every earlier write has completed. A consumer that closed its end
 * (EPIPE) can receive nothing more; that settles the wait instead of surfacing as an uncaught stream
 * error, and the command's own exit code stands. The listener stays attached until exit because a
 * failed write reports to its callback before the stream emits `error`.
 */
function drained(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || stream.writableEnded) {
      resolve();
      return;
    }
    stream.on("error", () => resolve());
    stream.write("", () => resolve());
  });
}

/** Wait until stdout and stderr have delivered every result, error, and progress line (V3OUT-04). */
export async function flushOutput(): Promise<void> {
  await Promise.all([drained(process.stdout), drained(process.stderr)]);
}
