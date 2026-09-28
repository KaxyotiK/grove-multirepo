#!/usr/bin/env node
/**
 * The scriptable fake agent — lets `agent run` be tested deterministically: a real agent is
 * slow, non-deterministic, and cannot be made to exit on cue.
 *
 * Driven by a tiny step language, passed as one argument or in `GROVE_FAKE_SCRIPT`, steps
 * separated by `|`:
 *
 *   out:<text>     write text to stdout, followed by a newline
 *   err:<text>     write text to stderr, followed by a newline
 *   raw:<text>     write text to stdout with NO newline
 *   sleep:<ms>     wait
 *   ignore:<SIG>   stop dying to a signal (SIGTERM→SIGKILL escalation tests)
 *   hang           never finish (the caller must kill it)
 *   exit:<code>    exit with that status
 *
 * There are no agent signals or hooks: Grove runs agents as plain foreground children (§8.8).
 */

export interface Step {
  op: "out" | "err" | "raw" | "sleep" | "ignore" | "hang" | "exit";
  arg: string;
}

const OPS = ["out", "err", "raw", "sleep", "ignore", "hang", "exit"] as const;

export function parseScript(text: string): Step[] {
  const steps: Step[] = [];
  for (const piece of text.split("|")) {
    const s = piece.trim();
    if (s.length === 0) continue;
    const colon = s.indexOf(":");
    const op = (colon >= 0 ? s.slice(0, colon) : s) as Step["op"];
    const arg = colon >= 0 ? s.slice(colon + 1) : "";
    if (!(OPS as readonly string[]).includes(op)) {
      throw new Error(`fake-agent: unknown step \`${op}\` in \`${s}\``);
    }
    steps.push({ op, arg });
  }
  return steps;
}

export interface RunHooks {
  write: (text: string) => void;
  writeErr: (text: string) => void;
  sleep: (ms: number) => Promise<void>;
  ignore: (sig: string) => void;
  exit: (code: number) => never;
}

export async function runScript(steps: Step[], hooks: RunHooks): Promise<void> {
  for (const step of steps) {
    switch (step.op) {
      case "out":
        hooks.write(`${step.arg}\n`);
        break;
      case "err":
        hooks.writeErr(`${step.arg}\n`);
        break;
      case "raw":
        hooks.write(step.arg);
        break;
      case "sleep":
        await hooks.sleep(Number(step.arg));
        break;
      case "ignore":
        hooks.ignore(step.arg);
        break;
      case "hang":
        await new Promise<never>(() => {});
        break;
      case "exit":
        hooks.exit(Number(step.arg));
    }
  }
}

/** The path to this file, so a test can spawn it as a real command. */
export const FAKE_AGENT_PATH = fileURLToPath(import.meta.url);

/** An agent-definition-shaped record (command + args) that runs `script`. */
export const fakeAgent = (script: string) => ({
  command: process.execPath,
  args: [FAKE_AGENT_PATH, script],
});

import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// ── entry point ────────────────────────────────────────────────────────────
if (process.argv[1] === FAKE_AGENT_PATH) {
  const script = process.argv[2] ?? process.env.GROVE_FAKE_SCRIPT ?? "";
  await runScript(parseScript(script), {
    write: (t) => void process.stdout.write(t),
    writeErr: (t) => void process.stderr.write(t),
    sleep: (ms) => delay(ms),
    ignore: (sig) => process.on(sig as NodeJS.Signals, () => {}),
    exit: (code) => process.exit(code),
  });
  process.exit(0);
}
