import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import { CLI, makeFixture, managedTrunkPath, type Fixture } from "../testkit/fixture.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { killAndReapFaultProcess, processGroupAlive, spawnFaultProcess } from "../testkit/git-fault.ts";
import { linkExecutable } from "../testkit/shim.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

// Issue #22. A local path given to `repo add` is resolved against the directory the command ran
// in, once, before preflight (cli-surface-v3.md `repo add`; V3ACQ-02). Remote URLs and scp-like
// remotes keep the V3SEC-05 handling unchanged.

const json = (value: string): any => JSON.parse(value);
const storeUrl = (fx: Fixture, name: string): string | null => {
  const store = join(fx.root, "repos", name);
  return existsSync(store) ? execFileSync("git", ["-C", store, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim() : null;
};
const operations = (fx: Fixture): string[] => {
  const dir = join(fx.root, ".grove", "operations");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
};
const registered = (fx: Fixture): string[] =>
  json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.map((repo: any) => repo.name);

function initialized(): { fx: Fixture; origin: string } {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  return { fx, origin: realpathSync(fx.repos[0]!.origin) };
}

function assertAdded(fx: Fixture, run: { status: number; stdout: string; stderr: string }, url: string): void {
  assert.deepEqual(
    { status: run.status, outcome: run.stdout ? json(run.stdout).outcome : null, url: storeUrl(fx, "alpha"), trunk: existsSync(join(managedTrunkPath(fx, "alpha"), "README.md")), pending: operations(fx).map((file) => json(readFileSync(join(fx.root, ".grove", "operations", file), "utf8")).state).filter((state) => state !== "completed"), registered: registered(fx) },
    { status: 0, outcome: "complete", url, trunk: true, pending: [], registered: ["alpha"] },
    run.stdout + run.stderr,
  );
}

test("V3ACQ-02: a relative local path from the workspace root is resolved against that directory", () => {
  const { fx, origin } = initialized();
  const rel = relative(fx.root, origin);
  assert.ok(rel.startsWith(".."), rel);
  assertAdded(fx, fx.grove(["--json", "repo", "add", rel, "--name", "alpha"]), origin);
});

test("V3ACQ-02: a relative local path from a workspace subdirectory is resolved against that subdirectory", () => {
  const { fx, origin } = initialized();
  const cwd = join(fx.root, "groves");
  assert.ok(existsSync(cwd));
  assertAdded(fx, fx.grove(["--json", "repo", "add", relative(cwd, origin), "--name", "alpha"], { cwd }), origin);
});

test("V3ACQ-02: a relative file:// URL is resolved against the invocation directory", () => {
  const { fx, origin } = initialized();
  assertAdded(fx, fx.grove(["--json", "repo", "add", `file://${relative(fx.root, origin)}`, "--name", "alpha"]), `file://${origin}`);
});

test("V3ACQ-02: a relative local path that does not exist is refused as invalid-input before any mutation", () => {
  const { fx } = initialized();
  const before = readFileSync(join(fx.root, ".grove", "config.json"), "utf8");
  for (const [mode, args] of [["json", ["--json"]], ["human", []]] as const) {
    const run = fx.grove([...args, "repo", "add", "../missing-origin.git", "--name", "alpha"]);
    const error = mode === "json" ? json(run.stdout).error : null;
    assert.deepEqual(
      { status: run.status, kind: error?.kind ?? "human", remedy: mode === "json" ? typeof error.remedy === "string" && error.remedy.length > 0 : /Remedy|remedy|Pass|Use/.test(run.stderr + run.stdout), store: existsSync(join(fx.root, "repos", "alpha")), trunks: readdirSync(join(fx.root, "trunks")), operations: operations(fx), config: readFileSync(join(fx.root, ".grove", "config.json"), "utf8") === before },
      { status: 2, kind: mode === "json" ? "invalid-input" : "human", remedy: true, store: false, trunks: [], operations: [], config: true },
      run.stdout + run.stderr,
    );
    assert.match(run.stdout + run.stderr, /missing-origin\.git/);
  }
});

test("V3ACQ-02: an interrupted add of a relative path resumes from another directory against the resolved path", async () => {
  const { fx, origin } = initialized();
  // A generous wait: the gate itself is the proof point, and a loaded host must not time it out.
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  const command = spawnFaultProcess(process.execPath, [CLI, "repo", "add", relative(fx.root, origin), "--name", "alpha"], {
    cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env },
  });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  const [file] = operations(fx);
  assert.ok(file);
  const id = file.slice(0, -5);
  assert.equal(json(readFileSync(join(fx.root, ".grove", "operations", file), "utf8")).secret?.remote, origin);
  const resumed = fx.grove(["--json", "reconcile", "--operation", id], { cwd: join(fx.root, "trunks") });
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  assert.equal(storeUrl(fx, "alpha"), origin);
  assert.deepEqual(registered(fx), ["alpha"]);
});

test("V3ACQ-02 control: an absolute local path is recorded exactly as given", () => {
  const { fx, origin } = initialized();
  assertAdded(fx, fx.grove(["--json", "repo", "add", origin, "--name", "alpha"], { cwd: join(fx.root, "groves") }), origin);
});

test("V3ACQ-02 control: a file:// URL with a host before an absolute path is used as written", () => {
  // Git ignores the host of a file:// URL, so this form already works and must not be resolved.
  const { fx, origin } = initialized();
  const url = `file://${hostname()}${origin}`;
  assertAdded(fx, fx.grove(["--json", "repo", "add", url, "--name", "alpha"]), url);
});

test("V3ACQ-02 control: an scp-like remote is not treated as a local path", () => {
  const { fx, origin } = initialized();
  // Serve the scp-like remote through a local ssh stand-in: the store must record it verbatim.
  const ssh = linkExecutable(join(fx.home, "local-ssh"), "#!/bin/sh\nfor last; do :; done\nexec sh -c \"$last\"\n");
  const scp = `git@localhost:${origin}`;
  assertAdded(fx, fx.grove(["--json", "repo", "add", scp, "--name", "alpha"], { env: { GIT_SSH_COMMAND: ssh, GIT_SSH_VARIANT: "simple" } }), scp);

  // A relative-looking scp-like path reaches ssh unchanged and is never refused as a missing path.
  const log = join(fx.home, "ssh.log");
  const recorder = linkExecutable(join(fx.home, "recording-ssh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "$GROVE_TEST_SSH_LOG"\nexit 1\n`);
  const run = fx.grove(["--json", "repo", "add", "example.invalid:org/beta.git", "--name", "beta"], { env: { GIT_SSH_COMMAND: recorder, GIT_SSH_VARIANT: "simple", GROVE_TEST_SSH_LOG: log } });
  const seen = existsSync(log) ? readFileSync(log, "utf8") : "";
  assert.notEqual(run.status, 0);
  assert.notEqual(json(run.stdout).error?.kind, "invalid-input", run.stdout);
  assert.match(seen, /^example\.invalid$/m);
  assert.match(seen, /'org\/beta\.git'/);
  assert.equal(existsSync(join(fx.root, "repos", "beta")), false);
  assert.equal(existsSync(join(dirname(fx.root), "org")), false);
});
