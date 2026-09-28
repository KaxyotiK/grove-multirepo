/**
 * V3OUT-04: a result is written in full before the process exits, whatever consumes it.
 *
 * Node writes to a pipe asynchronously on macOS. An entry point that calls `process.exit()` as soon
 * as the command returns ends the process while the tail of a large write is still queued, so a
 * machine consumer reading through a pipe received exactly one pipe buffer (65,536 bytes) of an
 * otherwise complete result, with the command's own exit code. Redirecting to a file hid the defect
 * because file writes are synchronous.
 *
 * Every case here spawns the built CLI with stdout and stderr as pipes and reads both to EOF, so the
 * witness observes what a `| jq` or an agent harness observes. The payloads are sized well past the
 * pipe buffer so a truncation cannot be mistaken for a short but valid result.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const PIPE_BUFFER = 64 * 1024;
const ENTRY_COUNT = 2500;

interface PipedRun {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
}

/**
 * Run the built CLI with both output streams as pipes, reading each to EOF before resolving. With
 * `hangUpStdout`, the reader instead closes stdout after its first chunk, as `| head -c N` does.
 */
function groveThroughPipes(fx: Fixture, args: string[], opts: { hangUpStdout?: boolean } = {}): Promise<PipedRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: fx.root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/nonexistent-should-be-ignored" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (opts.hangUpStdout) child.stdout.destroy();
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    // 'close' fires only after the process has exited AND both pipes reached EOF.
    child.on("close", (status, signal) => resolve({ status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

/** Parse, or fail with the evidence a truncation leaves: the byte count and the final bytes. */
function parseWhole(stream: Buffer, label: string): any {
  const text = stream.toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    assert.fail(`${label} is not one complete JSON value (${stream.length} bytes; tail ${JSON.stringify(text.slice(-40))}): ${(error as Error).message}`);
  }
}

/** A workspace whose root holds one directory of long, individually identifiable file names. */
function workspaceWithLargeDirectory(): { fx: Fixture; names: string[] } {
  const fx = makeFixture();
  const init = fx.grove(["init"]);
  assert.equal(init.status, 0, init.stderr);
  const dir = join(fx.root, "bulk");
  mkdirSync(dir);
  const names = Array.from({ length: ENTRY_COUNT }, (_, i) => `entry-${String(i).padStart(5, "0")}-${"n".repeat(96)}.txt`);
  for (const name of names) writeFileSync(join(dir, name), "");
  return { fx, names: [...names].sort((a, b) => a.localeCompare(b)) };
}

/** An unknown command naming a long, position-identifiable argument; its error quotes it twice. */
const LONG_ARGUMENT = Array.from({ length: 30000 }, (_, i) => `s${i}`).join("-");

test("V3OUT-04: a --json result larger than the pipe buffer arrives complete through a pipe, with exit 0 and its progress events", async () => {
  const { fx, names } = workspaceWithLargeDirectory();
  const run = await groveThroughPipes(fx, ["--json", "--progress=json", "file", "ls", "bulk"]);
  assert.equal(run.signal, null);
  const result = parseWhole(run.stdout, "file ls --json stdout");
  assert.ok(run.stdout.length > 4 * PIPE_BUFFER, `expected a result well past the pipe buffer, got ${run.stdout.length} bytes`);
  assert.equal(run.status, 0, run.stderr.toString("utf8"));
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.outcome, "complete");
  assert.deepEqual(result.detail.entries.map((entry: { name: string }) => entry.name), names);
  // Progress is unchanged: the command still opens and closes on stderr, and the close carries the
  // exit the process actually reported.
  const events = run.stderr.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events, [
    { event: "command-start", command: "file ls" },
    { event: "command-end", command: "file ls", exitCode: 0 },
  ]);
});

test("V3OUT-04: a --json error envelope larger than the pipe buffer arrives complete through a pipe with its nonzero exit", async () => {
  const fx = makeFixture();
  const run = await groveThroughPipes(fx, ["--json", LONG_ARGUMENT]);
  assert.equal(run.signal, null);
  const envelope = parseWhole(run.stdout, "unknown-command --json stdout");
  assert.ok(run.stdout.length > 4 * PIPE_BUFFER, `expected an envelope well past the pipe buffer, got ${run.stdout.length} bytes`);
  assert.equal(run.status, 2);
  assert.equal(envelope.error.kind, "invalid-input");
  assert.equal(envelope.error.exitCode, 2);
  assert.equal(envelope.error.detail.command, LONG_ARGUMENT);
  assert.equal(run.stderr.length, 0);
});

test("V3OUT-04: human-mode stdout larger than the pipe buffer arrives complete through a pipe", async () => {
  const { fx, names } = workspaceWithLargeDirectory();
  const listing = await groveThroughPipes(fx, ["file", "ls", "bulk"]);
  assert.equal(listing.signal, null);
  const text = listing.stdout.toString("utf8");
  assert.ok(text.endsWith("\n"), `human stdout is cut short (${listing.stdout.length} bytes; tail ${JSON.stringify(text.slice(-40))})`);
  assert.ok(listing.stdout.length > 4 * PIPE_BUFFER, `expected human output well past the pipe buffer, got ${listing.stdout.length} bytes`);
  for (const name of [names[0]!, names[names.length - 1]!]) assert.ok(text.includes(name), `human stdout is missing ${name}`);
  assert.equal(listing.status, 0, listing.stderr.toString("utf8"));
});

test("V3OUT-04: a human-mode refusal larger than the pipe buffer arrives complete on stderr through a pipe with its nonzero exit", async () => {
  // Human-mode errors go to stderr, so the drain has to cover that stream as well as stdout.
  const fx = makeFixture();
  const refusal = await groveThroughPipes(fx, [LONG_ARGUMENT]);
  assert.equal(refusal.signal, null);
  const stderr = refusal.stderr.toString("utf8");
  assert.ok(stderr.endsWith("\n"), `human stderr is cut short (${refusal.stderr.length} bytes; tail ${JSON.stringify(stderr.slice(-40))})`);
  assert.ok(refusal.stderr.length > 4 * PIPE_BUFFER, `expected stderr well past the pipe buffer, got ${refusal.stderr.length} bytes`);
  assert.ok(stderr.includes(`Unknown command '${LONG_ARGUMENT}'`), "human stderr does not carry the complete refusal");
  assert.equal(refusal.status, 2);
  assert.equal(refusal.stdout.length, 0);
});

test("V3OUT-04 control: a consumer that closes the pipe early gets the command's own exit and no stream error", async () => {
  // Waiting for delivery must not turn a departed reader (EPIPE) into an uncaught stream error, a
  // stack trace, or a different exit code.
  const fx = makeFixture();
  const run = await groveThroughPipes(fx, ["--json", LONG_ARGUMENT], { hangUpStdout: true });
  assert.equal(run.signal, null);
  assert.ok(run.stdout.length < 4 * PIPE_BUFFER, `the reader hung up, yet received ${run.stdout.length} bytes`);
  assert.equal(run.stderr.toString("utf8"), "");
  assert.equal(run.status, 2);
});
