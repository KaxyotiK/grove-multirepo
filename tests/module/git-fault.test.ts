import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  createGitFaultBoundary,
  killAndReapFaultProcess,
  processGroupAlive,
  spawnFaultProcess,
  waitForGitFault,
} from "../testkit/git-fault.ts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { installGitProxy, readArgvLog, sharedExecutable } from "../testkit/shim.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

test("007 harness: a non-matching Git argv delegates and exits without a sentinel", async () => {
  const boundary = createGitFaultBoundary({ exactGitArgs: ["status", "--porcelain"] });
  const child = spawnFaultProcess("git", ["--version"], {
    cwd: tempDir("git-fault-nonmatch"),
    env: { ...process.env, ...boundary.env },
  });
  try {
    const result = await child.closed;
    assert.equal(result.code, 0, child.stderr());
    assert.match(child.stdout(), /^git version /);
    await assert.rejects(() => waitForGitFault({ ...boundary, timeoutMs: 30 }), /Timed out/);
  } finally {
    boundary.dispose();
  }
});

test("007 harness: an exact argv delegates, signals after Git, then the whole group is killed and reaped", async () => {
  const boundary = createGitFaultBoundary({ exactGitArgs: ["--version"] });
  const child = spawnFaultProcess("git", ["--version"], {
    cwd: tempDir("git-fault-match"),
    env: { ...process.env, ...boundary.env },
  });
  const pid = child.child.pid;
  assert.ok(pid !== undefined);
  try {
    const record = await waitForGitFault(boundary, child);
    assert.equal(record.timing, "after");
    assert.equal(record.realGitExitCode, 0);
    assert.equal(processGroupAlive(pid), true);
  } finally {
    try {
      await killAndReapFaultProcess(child);
    } finally {
      boundary.dispose();
    }
    assert.equal(processGroupAlive(pid), false);
  }
  assert.match(child.stdout(), /^git version /, "the real Git output was delegated before blocking");
});

test("007 harness: a missed exact boundary times out precisely", async () => {
  const boundary = createGitFaultBoundary({ exactGitArgs: ["never", "matches"], timeoutMs: 40 });
  const started = Date.now();
  try {
    await assert.rejects(() => waitForGitFault(boundary), /Timed out after 40ms/);
    assert.ok(Date.now() - started >= 40, "the wait did not fail before its declared bound");
  } finally {
    boundary.dispose();
  }
});

test("007 harness negative mode: a before sentinel proves no real Git acknowledgement occurred", async () => {
  const boundary = createGitFaultBoundary({ exactGitArgs: ["--version"], sentinelTiming: "before" });
  const child = spawnFaultProcess("git", ["--version"], {
    cwd: tempDir("git-fault-before"),
    env: { ...process.env, ...boundary.env },
  });
  try {
    const record = await waitForGitFault(boundary, child);
    assert.equal(record.timing, "before");
    assert.equal(record.realGitExitCode, null);
    assert.equal(child.stdout(), "", "the real Git process never ran before the sentinel");
  } finally {
    try {
      await killAndReapFaultProcess(child);
    } finally {
      boundary.dispose();
    }
  }
});

// The PATH proxies' sh front end execs the real Git for every argv it does not intercept, so its
// comparison has to be exact for any bytes Grove could pass: quoting, globs, test operators, lines.
const AWKWARD = ["", " ", "a b", "it's", "\"q\"", "$HOME", "`id`", "*", "-n", "!", "(", ")", "=", "\\", "x\ny", "--", "-", "é"];

test("007 harness: the Git proxy front end intercepts exactly its argv and passes every other one through", () => {
  const dir = join(tempDir("git-proxy-exact"), "bin");
  const exact = ["fetch", ...AWKWARD];
  // Both sides print which one ran and the argv they received, NUL-separated.
  installGitProxy(dir, {
    originalPath: process.env.PATH ?? "",
    realGitPath: sharedExecutable("#!/bin/sh\nprintf '%s\\0' real \"$@\"\n"),
    intercept: [exact, ["only"]],
    script: 'process.stdout.write(["intercepted", ...process.argv.slice(2)].map((value) => value + "\\0").join(""));\n',
  });
  const run = (args: string[]) => spawnSync(join(dir, "git"), args, { encoding: "utf8" }).stdout;
  const seen = (by: string, args: string[]) => [by, ...args].map((value) => `${value}\0`).join("");
  assert.equal(run(exact), seen("intercepted", exact));
  assert.equal(run(["only"]), seen("intercepted", ["only"]));
  // Near misses reach the real Git with their argv intact: a prefix, an extension, one changed byte.
  const nearMisses = [exact.slice(0, -1), [...exact, ""], exact.map((value, index) => (index === 3 ? "a  b" : value)), exact.map((value, index) => (index === 1 ? "x" : value)), ["only", ""], ["Only"], []];
  for (const argv of nearMisses) assert.equal(run(argv), seen("real", argv));
});

test("007 harness: the Git argv log records every argument byte-exactly", () => {
  const base = tempDir("git-proxy-log");
  const log = join(base, "argv.log");
  installGitProxy(join(base, "bin"), { originalPath: process.env.PATH ?? "", realGitPath: "/usr/bin/true", argvLog: log });
  const calls = [[], [""], AWKWARD, ["status", "--porcelain"]];
  for (const argv of calls) assert.equal(spawnSync(join(base, "bin", "git"), argv).status, 0);
  assert.deepEqual(readArgvLog(log), calls);
});
