import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createFsFaultBoundary, waitForFsFault } from "../testkit/fs-fault.ts";
import { createGitFaultBoundary, killAndReapFaultProcess, processGroupAlive, spawnFaultProcess, waitForGitFault, type FaultProcess } from "../testkit/git-fault.ts";
import { createGitGate } from "../testkit/git-gate.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const json = (text: string): any => JSON.parse(text.trim());
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const entries = (path: string): string[] => { try { return readdirSync(path).filter((name) => !name.endsWith(".tmp") && !name.endsWith(".steal")).sort(); } catch { return []; } };

function setup(repositoryNames = ["alpha"]): Fixture {
  const fx = makeFixture({ repos: Object.fromEntries(repositoryNames.map((name) => [name, []])) });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repository of fx.repos) assert.equal(fx.grove(["repo", "add", repository.origin, "--name", repository.name]).status, 0);
  return fx;
}

function spawnCli(fx: Fixture, args: string[], env: Record<string, string> = {}, nodeArgs: string[] = []): FaultProcess {
  return spawnFaultProcess(process.execPath, [...nodeArgs, CLI, ...args], { cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...env } });
}

function spawnInteractive(fx: Fixture, args: string[]): FaultProcess {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: fx.root, detached: true, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => (stdout += chunk)); child.stderr?.on("data", (chunk: string) => (stderr += chunk));
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  return { child, closed, stdout: () => stdout, stderr: () => stderr };
}

async function waitForFile(path: string, command: FaultProcess, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (command.child.exitCode !== null || command.child.signalCode !== null) throw new Error(`process exited before ${path}: ${command.stderr()}`);
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await delay(10);
  }
}

async function closedWithin(command: FaultProcess, timeoutMs = 5_000) {
  return Promise.race([command.closed, delay(timeoutMs).then(() => { throw new Error(`process ${command.child.pid} did not exit`); })]);
}

function processGroup(pid: number): number { return Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim()); }
function listeningSockets(pid: number): string[] {
  if (process.platform === "darwin") {
    const result = spawnSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr);
    return result.stdout.trim().split("\n").slice(1).filter(Boolean);
  }
  if (process.platform === "linux") {
    const listening = new Set<string>();
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) for (const line of readFileSync(table, "utf8").trim().split("\n").slice(1)) { const fields = line.trim().split(/\s+/); if (fields[3] === "0A" && fields[9]) listening.add(fields[9]); }
    return readdirSync(`/proc/${pid}/fd`).flatMap((fd) => { try { const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`)); return match?.[1] && listening.has(match[1]) ? [match[1]] : []; } catch { return []; } });
  }
  throw new Error(`socket scan unsupported on ${process.platform}`);
}

test("PROC-01: a non-agent command leaves no child or background process", async () => {
  const fx = makeFixture({ repos: {} }); assert.equal(fx.grove(["init"]).status, 0);
  const command = spawnCli(fx, ["status"]); const pid = command.child.pid!;
  assert.equal((await closedWithin(command)).code, 0, command.stderr());
  // ASSERT:PROC-01:NO-CHILD-BACKGROUND-GROVE-PROCESS-REMAINS-AFTERWARD
  assert.equal(processGroupAlive(pid), false);
});

test("PROC-02/PROC-03/PROC-06: the foreground agent shares I/O, receives signals, and opens no service socket", { timeout: 15_000 }, async () => {
  const fx = setup(); assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const base = tempDir("agent-process"); const ready = join(base, "ready.json"); const signalled = join(base, "signal.txt"); const agent = join(base, "agent.mjs");
  writeFileSync(agent, `import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], JSON.stringify({pid:process.pid,ppid:process.ppid}));\nprocess.once("SIGINT",()=>{writeFileSync(process.argv[3],"SIGINT\\n");process.removeAllListeners("SIGINT");process.kill(process.pid,"SIGINT")});\nprocess.stdin.once("data",value=>process.stdout.write("echo:"+value));\nsetInterval(()=>{},1000);\n`);
  // ASSERT:PROC-03:SIGNAL-REACHES-CHILD-1
  assert.equal(fx.grove(["agent", "add", "process", process.execPath, "--arg", agent, "--arg", ready, "--arg", signalled]).status, 0);
  const command = spawnInteractive(fx, ["agent", "run", "work", "--agent", "process"]);
  try {
    await waitForFile(ready, command); const record = json(readFileSync(ready, "utf8"));
    // ASSERT:PROC-02:AGENT-FOREGROUND-CHILD-INHERITED-TERMINAL-I-O
    // ASSERT:PROC-03:CLI-EXITS-AFTER-CHILD-TERMINATES-2
    assert.equal(record.ppid, command.child.pid);
    assert.equal(processGroup(record.pid), processGroup(command.child.pid!));
    // ASSERT:PROC-06:GROVE-OPENS-NO-LISTENER-LEAVES-NO-SERVICE
    assert.deepEqual(listeningSockets(command.child.pid!), []);
    command.child.stdin!.write("terminal-input\n"); await delay(50); assert.match(command.stdout(), /echo:terminal-input/);
    process.kill(command.child.pid!, "SIGINT"); await waitForFile(signalled, command);
    assert.equal((await closedWithin(command)).code, 130, command.stderr());
    assert.equal(readFileSync(signalled, "utf8"), "SIGINT\n");
  } finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); }
});

test("PROC-04/PROC-05/PROC-12/PROC-14: atomic publication keeps readers consistent and a live lock is never stolen", { timeout: 20_000 }, async () => {
  const fx = makeFixture({ repos: {} }); assert.equal(fx.grove(["init", "--name", "original"]).status, 0);
  const configPath = join(fx.root, ".grove", "config.json"); const before = readFileSync(configPath, "utf8"); const boundary = createFsFaultBoundary(configPath);
  const blockedPreload = readFileSync(boundary.preloadPath, "utf8");
  const releasablePreload = blockedPreload.replace(
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 7000);",
  );
  assert.notEqual(releasablePreload, blockedPreload, "filesystem fault boundary must become time-bounded");
  writeFileSync(boundary.preloadPath, releasablePreload);
  const writer = spawnCli(fx, ["config", "set", "--values", '{"name":"replacement"}'], boundary.env, ["--import", boundary.preloadPath]);
  try {
    const record = await waitForFsFault(boundary, writer);
    // ASSERT:PROC-04:ONE-HOLDS-THE-LOCK-1
    assert.equal(statSync(record.from).size > 0, true);
    assert.equal(json(readFileSync(record.from, "utf8")).name, "replacement");
    // Consolidated: the interrupted publication is identified AND the original config survives
    // byte-for-byte. Three obligations previously rested on the equality alone, including one
    // naming reconcile's identification of incomplete filesystem work.
    // ASSERT:PROC-05:INTERRUPTED-PUBLICATION-IS-IDENTIFIED-AND-THE-ORIGINAL-SURVIVES-INTACT
    assert.deepEqual(
      { stagedReplacement: json(readFileSync(record.from, "utf8")).name, liveConfig: readFileSync(configPath, "utf8") },
      { stagedReplacement: "replacement", liveConfig: before },
    );
    const started = Date.now();
    const status = fx.grove(["--json", "status"]);
    const readerElapsed = Date.now() - started;
    // ASSERT:PROC-14:READER-CONSISTENT-BOUNDED-AND-NEVER-TORN
    assert.deepEqual(
      { status: status.status, name: json(status.stdout).detail.name, bounded: readerElapsed < 2_000 },
      { status: 0, name: "original", bounded: true },
      status.stderr,
    );
    const contenderStarted = Date.now();
    const contender = fx.grove(["agent", "add", "blocked", process.execPath]);
    const contenderElapsed = Date.now() - contenderStarted;
    // ASSERT:PROC-04:CONTENDER-BOUNDED-REFUSAL-NAMES-HOLDER
    // ASSERT:PROC-12:LIVE-LOCK-NEVER-STOLEN-AND-NAMES-HOLDER
    assert.deepEqual(
      { status: contender.status, boundedWait: contenderElapsed >= 4_500, namesHolder: /config set/.test(contender.stderr) },
      { status: 4, boundedWait: true, namesHolder: true },
    );
    const writerResult = await writer.closed;
    // ASSERT:PROC-12:HOLDER-LATER-COMPLETES-NORMALLY
    assert.deepEqual(
      { exitCode: writerResult.code, publishedName: json(readFileSync(configPath, "utf8")).name },
      { exitCode: 0, publishedName: "replacement" },
      writer.stderr(),
    );
  } finally { if (processGroupAlive(writer.child.pid!)) await killAndReapFaultProcess(writer); boundary.dispose(); }
  // ASSERT:PROC-04:CONTENTION-LEAVES-CONFIG-UNCORRUPTED
  assert.equal(json(readFileSync(configPath, "utf8")).name, "replacement");
  assert.equal(fx.grove(["agent", "add", "recovered", process.execPath]).status, 0, "the completed holder released its lock");
  assert.deepEqual(entries(join(fx.root, ".grove", "locks")), []);
});

async function crashCreation(timing: "before" | "after"): Promise<void> {
  const fx = setup(); const anchor = join(fx.root, "repos", "alpha"); const branch = `crash-${timing}`; const oid = git(anchor, ["rev-parse", "refs/heads/main"]); const path = join(fx.root, "groves", branch, "trees", `${branch}@alpha`);
  const boundary = createGitFaultBoundary({ exactGitArgs: ["worktree", "add", "-b", branch, "--", path, oid], sentinelTiming: timing });
  const command = spawnCli(fx, ["new", branch, "--repo", "alpha"], boundary.env);
  try { await waitForGitFault(boundary, command); assert.equal(existsSync(path), timing === "after"); await killAndReapFaultProcess(command); }
  finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); boundary.dispose(); }
  const refsAtBoundary = git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"]);
  const operationsBefore = entries(join(fx.root, ".grove", "operations")); assert.ok(operationsBefore.length >= 2, "repo-add plus interrupted new operation evidence remain");
  const reconciled = fx.grove(["--json", "reconcile"]); assert.equal(reconciled.status, 0, reconciled.stderr || reconciled.stdout);
  assert.equal(existsSync(path), true); assert.equal(git(path, ["branch", "--show-current"]), branch); assert.equal(git(anchor, ["rev-parse", `refs/heads/${branch}`]), oid);
  if (timing === "after") assert.equal(git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"]), refsAtBoundary, "forward recovery never compensates a successful ref/worktree mutation");
  assert.ok(json(reconciled.stdout).detail.resumed.some((entry: any) => entry.completed.length > 0));
}

test("V3OPS-01/PROC-08/PROC-09/ARCH-07/003-git-native-grove-SC-006: post-mutation creation crash resumes forward without deleting the branch or worktree", { timeout: 20_000 }, () => {
  // ASSERT:ARCH-07:THE-6-1-JOURNAL-COMPLETES-OR-ROLLS-BACK
  // ASSERT:PROC-08:A-6-1-JOURNAL-REMAINS
  // ASSERT:PROC-09:ROLLBACK-REMOVES-ONLY-THE-TREE-BEING-ADDED
  return crashCreation("after");
});
test("ARCH-07 negative control: pre-mutation crash proves the forward-resume witness is non-vacuous", { timeout: 20_000 }, () => crashCreation("before"));

test("PROC-10: an in-process Git refusal leaves a conflicted record which abandon closes without compensation", () => {
  const fx = setup(); const anchor = join(fx.root, "repos", "alpha"); const oid = git(anchor, ["rev-parse", "refs/heads/main"]); const path = join(fx.root, "groves", "boom", "trees", "boom@alpha");
  const gate = createGitGate(["worktree", "add", "-b", "boom", "--", path, oid], { failExitCode: 42 });
  let result;
  try { result = fx.grove(["--json", "new", "boom", "--repo", "alpha"], { env: gate.env }); } finally { gate.dispose(); }
  assert.equal(result.status, 6, result.stdout); const operationId = json(result.stdout).operationId;
  assert.equal(existsSync(path), false); assert.notEqual(spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/boom"], { cwd: anchor }).status, 0);
  // Consolidated: abandon closes the conflicted record and the intent is released WITHOUT the
  // branch or worktree having been created or deleted behind the user's back. Six obligations
  // previously rested on the final `new` status alone — a setup-shaped line that observes none of
  // the rollback, ref-absence or journal clauses the row names.
  // ASSERT:PROC-10:CONFLICTED-RECORD-IS-CLOSED-BY-ABANDON-WITHOUT-COMPENSATION
  assert.deepEqual(
    {
      abandonExit: fx.grove(["reconcile", "--abandon", operationId]).status,
      worktreeAbsent: existsSync(path) === false,
      branchAbsent: spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/boom"], { cwd: anchor }).status !== 0,
      recreatable: fx.grove(["new", "boom", "--repo", "alpha"]).status,
    },
    { abandonExit: 0, worktreeAbsent: true, branchAbsent: true, recreatable: 0 },
  );
});

/**
 * V3ARC-06 (P4.2). Ruling ② is implemented TWICE: `lifecycle.ts` decides to detach, and
 * `reconcile.ts` re-implements the same decision on the resume path. Fixing only the first would
 * ship green — no existing witness crashes mid-restore — and then a crash after ② lands would leave
 * a durable record that `reconcile` refuses to resume: a record with no forward path, which is the
 * exact class of defect E-1 documents.
 *
 * This is the only witness that executes reconcile's four gates against a DETACHED restore.
 */
test("V3ARC-06: a restore interrupted after ② resumes to the archived commit", { timeout: 30_000 }, async () => {
  const fx = setup();
  const anchor = join(fx.root, "repos", "alpha");
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const treePath = join(fx.root, "groves", "work", "trees", "work@alpha");

  // A commit unique to this branch, so the archived OID is distinguishable from the trunk's.
  writeFileSync(join(treePath, "archived.txt"), "before archive\n");
  git(treePath, ["add", "archived.txt"]);
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "pre-archive"], { cwd: treePath });
  const archivedOid = git(treePath, ["rev-parse", "HEAD"]);
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);

  // Advance the branch natively, so the resumed restore MUST detach.
  const scratch = join(fx.root, "scratch");
  execFileSync("git", ["worktree", "add", "-q", scratch, "work"], { cwd: anchor });
  writeFileSync(join(scratch, "after.txt"), "moved on\n");
  git(scratch, ["add", "after.txt"]);
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "advance"], { cwd: scratch });
  const advancedOid = git(scratch, ["rev-parse", "HEAD"]);
  execFileSync("git", ["worktree", "remove", "--force", scratch], { cwd: anchor });

  // Crash the restore exactly at its detached `worktree add`.
  const boundary = createGitFaultBoundary({ exactGitArgs: ["worktree", "add", "--detach", "--", treePath, archivedOid], sentinelTiming: "before" });
  const command = spawnCli(fx, ["restore", "work"], boundary.env);
  try { await waitForGitFault(boundary, command); await killAndReapFaultProcess(command); }
  finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); boundary.dispose(); }

  const reconciled = fx.grove(["--json", "reconcile"]);
  assert.deepEqual(
    {
      status: reconciled.status,
      worktreeExists: existsSync(treePath),
      head: existsSync(treePath) ? git(treePath, ["rev-parse", "HEAD"]) : null,
      detached: existsSync(treePath) ? git(treePath, ["rev-parse", "--abbrev-ref", "HEAD"]) : null,
      branchUntouched: git(anchor, ["rev-parse", "refs/heads/work"]),
    },
    { status: 0, worktreeExists: true, head: archivedOid, detached: "HEAD", branchUntouched: advancedOid },
  );
});
