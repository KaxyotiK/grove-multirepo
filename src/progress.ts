/**
 * NDJSON progress on stderr (§8.1 `--progress=json`).
 *
 * Progress is a process-global sink, not a per-value return, so the switch lives here rather than
 * being threaded through every call. `--json` keeps stdout to exactly one value; progress never
 * touches stdout, so the two compose (§8.1).
 *
 * The event vocabulary is derived from durable forward-operation steps. A `step` event therefore
 * names work that reconcile can observe and resume; a `work` event covers non-structural activity
 * such as remote inspection or fetch.
 */
export type ProgressEvent =
  | { event: "command-start"; command: string }
  | { event: "command-end"; command: string; exitCode: number }
  | { event: "step"; step: string; detail: Record<string, unknown> }
  | { event: "work"; what: string; target: string };

let enabled = false;

/** Turn NDJSON progress on. Called once by `cli.ts` from the parsed globals. */
export function enableProgress(on: boolean): void {
  enabled = on;
}

/** Emit one NDJSON progress line on stderr. A no-op unless `--progress=json` was given. */
export function progress(event: ProgressEvent): void {
  if (!enabled) return;
  process.stderr.write(`${JSON.stringify(event)}\n`);
}
