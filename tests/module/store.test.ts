import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquire, scanStaleLocks, withLock } from "../../src/store/lock.ts";
import { readManifest, writeManifest } from "../../src/store/manifest.ts";
import { GroveError } from "../../src/errors.ts";
import { locksDir, workspaceConfig } from "../../src/paths/layout.ts";
import { tempDir, cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

function ws(): string {
  const root = tempDir("store");
  mkdirSync(locksDir(root), { recursive: true });
  return root;
}

test("O_EXCL lock: second acquire refuses while the first is held", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "x.lock");
  const held = await acquire(lockPath, { op: "first" });
  await assert.rejects(
    () => acquire(lockPath, { op: "second", timeoutMs: 50, staleMs: 10_000 }),
    (e) => GroveError.is(e) && (e as GroveError).kind === "refused-conflict",
  );
  held.release();
  // Now free.
  const again = await acquire(lockPath, { op: "third", timeoutMs: 50 });
  again.release();
});

test("withLock releases even when fn throws", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "y.lock");
  await assert.rejects(
    withLock(lockPath, { op: "boom" }, async () => {
      throw new Error("boom");
    }),
  );
  // Lock must be free now.
  const held = await acquire(lockPath, { timeoutMs: 50 });
  held.release();
});

test("a stale lock (dead pid) is reclaimed, a live one is not", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "z.lock");
  // Forge a holder record for a dead pid on this host.
  writeFileSync(
    lockPath,
    JSON.stringify({
      token: "old",
      pid: 2_147_483_600,
      host: hostname(),
      startedAt: 0,
      heartbeatAt: 0,
      op: "ghost",
    }),
  );
  const classified = scanStaleLocks(locksDir(root), { isPidAlive: () => false });
  assert.deepEqual(
    { count: classified.length, recovery: classified[0]?.recovery },
    { count: 1, recovery: "automatic" },
  );
  const held = await acquire(lockPath, { timeoutMs: 500, isPidAlive: () => false });
  assert.ok(held.token !== "old");
  held.release();
});

test("PROC-11: a reused live PID with a different process start is reported and reclaimed", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "reused.lock");
  // A crashed holder whose PID was later recycled by an unrelated live process:
  // pidAlive says true forever, but the heartbeat is frozen in the past.
  writeFileSync(
    lockPath,
    JSON.stringify({
      token: "old",
      pid: process.pid,
      host: hostname(),
      startedAt: 0,
      heartbeatAt: Date.now(),
      op: "ghost",
    }),
  );
  const stale = scanStaleLocks(locksDir(root));
  // Consolidated: reported, judged against the recorded process START (not just the PID), and the
  // new mutation proceeds. Four obligations previously rested on `assert.ok(held.token !== "old")`
  // — one boolean that observes only the last of them.
  const reclaimed = await acquire(lockPath, { timeoutMs: 500 });
  // ASSERT:PROC-11:A-REUSED-PID-WITH-A-DIFFERENT-START-IS-REPORTED-AND-THE-LOCK-IS-RECLAIMED
  assert.deepEqual(
    { reportedCount: stale.length, reason: /process start/.test(stale[0]!.reason), tokenReplaced: reclaimed.token !== "old" },
    { reportedCount: 1, reason: true, tokenReplaced: true },
  );
  reclaimed.release();
});

test("a lock held from another host is never auto-reclaimed, however stale", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "remote.lock");
  writeFileSync(
    lockPath,
    JSON.stringify({
      token: "remote",
      pid: 1234,
      host: "some-other-host.example",
      startedAt: 0,
      heartbeatAt: 0,
      op: "remote-op",
    }),
  );
  const classified = scanStaleLocks(locksDir(root), { staleMs: 10, isPidAlive: () => false });
  assert.deepEqual(
    { count: classified.length, recovery: classified[0]?.recovery },
    { count: 1, recovery: "manual" },
  );
  await assert.rejects(
    () => acquire(lockPath, { timeoutMs: 60, staleMs: 10, isPidAlive: () => false }),
    (e) => GroveError.is(e) && (e as GroveError).kind === "refused-conflict",
  );
});

test("a corrupt lock file is reclaimed once its mtime is stale", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "corrupt.lock");
  writeFileSync(lockPath, "not json {");
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(lockPath, old, old);
  const held = await acquire(lockPath, { timeoutMs: 500, staleMs: 100 });
  held.release();
});

test("withLock heartbeats keep a long-running holder fresh against same-host stale reclaim", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "hb.lock");
  await withLock(lockPath, { op: "long", staleMs: 100, heartbeatMs: 20 }, async () => {
    // The op outlives staleMs, as a huge repo / slow disk can.
    await new Promise((r) => setTimeout(r, 150));
    const rec = JSON.parse(readFileSync(lockPath, "utf8")) as { startedAt: number; heartbeatAt: number };
    assert.ok(rec.heartbeatAt > rec.startedAt, "the pump must have refreshed heartbeatAt");
    // A same-host waiter that sees the holder as alive AND fresh must refuse, not steal.
    await assert.rejects(
      () => acquire(lockPath, { timeoutMs: 40, staleMs: 100, isPidAlive: () => true }),
      (e) => GroveError.is(e) && (e as GroveError).kind === "refused-conflict",
    );
  });
});

test("manifest write is atomic and readable back with its revision", async () => {
  const root = ws();
  const path = workspaceConfig(root);
  mkdirSync(join(root, ".grove"), { recursive: true });
  const meta = await writeManifest(path, { kind: "workspace", _rev: 0, name: "x" }, { workspace: root });
  assert.equal(meta.rev, 1);
  const read = readManifest<{ name: string; _rev: number }>(path);
  assert.equal(read.value.name, "x");
  assert.equal(read.meta.rev, 1);
  // The file ends with a trailing newline and is valid JSON.
  assert.ok(readFileSync(path, "utf8").endsWith("}\n"));
});

test("CAS: a stale expected revision is refused", async () => {
  const root = ws();
  const path = workspaceConfig(root);
  mkdirSync(join(root, ".grove"), { recursive: true });
  const m1 = await writeManifest(path, { name: "a", _rev: 0 }, { workspace: root });
  // A concurrent writer advances the revision.
  await writeManifest(path, { name: "b", _rev: 0 }, { workspace: root, expected: m1 });
  // Our write with the now-stale meta must be refused.
  await assert.rejects(
    () => writeManifest(path, { name: "c", _rev: 0 }, { workspace: root, expected: m1 }),
    (e) => GroveError.is(e) && (e as GroveError).kind === "refused-conflict",
  );
});

test("first write refuses when the file already exists", async () => {
  const root = ws();
  const path = workspaceConfig(root);
  mkdirSync(join(root, ".grove"), { recursive: true });
  await writeManifest(path, { name: "a", _rev: 0 }, { workspace: root });
  await assert.rejects(
    () => writeManifest(path, { name: "b", _rev: 0 }, { workspace: root }),
    (e) => GroveError.is(e) && (e as GroveError).kind === "refused-conflict",
  );
});

test("reading malformed JSON is a config error, never a silent default", () => {
  const root = ws();
  const path = workspaceConfig(root);
  mkdirSync(join(root, ".grove"), { recursive: true });
  writeFileSync(path, "{ not json");
  assert.throws(
    () => readManifest(path),
    (e) => GroveError.is(e) && (e as GroveError).kind === "config",
  );
});

/**
 * safety.md: "A mutation blocked by a held lock waits up to 5 seconds for release, then exits `4`."
 *
 * The reclaim branch `continue`d before the deadline check, so a lock that WAS reclaimable but
 * whose `.steal` intent marker already existed spun until the marker aged out at `staleMs` rather
 * than refusing at `timeoutMs`. An orphaned marker is reachable in practice: `acquire`'s `finally`
 * unlinks it, but a SIGKILL between `openSync(intent)` and that `finally` leaves it behind, and
 * this project's own e2e suite kills grove process groups routinely.
 */
test("V3OPS-06: acquire honours timeoutMs when the lock is reclaimable but a steal marker is contended", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "contended.lock");
  writeFileSync(lockPath, JSON.stringify({ token: "dead", pid: 999_999, host: hostname(), startedAt: 0, heartbeatAt: Date.now(), op: "dead-op" }));
  // A fresh orphan marker: far younger than staleMs, so it is never aged out during the wait.
  writeFileSync(`${lockPath}.steal`, "orphan");

  const started = Date.now();
  let kind: string | null = null;
  try { (await acquire(lockPath, { timeoutMs: 200, staleMs: 60_000, isPidAlive: () => false })).release(); }
  catch (e) { kind = GroveError.is(e) ? (e as GroveError).kind : "unexpected"; }
  const elapsed = Date.now() - started;

  assert.deepEqual(
    { kind, withinBudget: elapsed < 5_000, notImmediate: elapsed >= 200 },
    { kind: "refused-conflict", withinBudget: true, notImmediate: true },
    `refused after ${elapsed}ms`,
  );
});

test("an aged steal marker is a distinct automatic audit finding while a fresh marker is not", () => {
  const root = ws();
  const aged = join(locksDir(root), "aged.lock.steal");
  const fresh = join(locksDir(root), "fresh.lock.steal");
  const temporary = join(locksDir(root), ".lock-write.tmp");
  writeFileSync(aged, "old-stealer");
  writeFileSync(fresh, "live-stealer");
  writeFileSync(temporary, "temporary");
  const old = (Date.now() - 60_000) / 1_000;
  utimesSync(aged, old, old);

  const findings = scanStaleLocks(locksDir(root), { staleMs: 30_000 }) as unknown as Array<Record<string, unknown>>;
  assert.deepEqual(findings, [{
    kind: "orphaned-steal-marker",
    file: "aged.lock.steal",
    lock: "aged.lock",
    lockState: "absent",
    reason: "steal marker has not been touched past the stale window",
    recovery: "automatic",
  }]);
});

test("acquire removes an aged steal marker after an uncontended lock creation", async () => {
  const root = ws();
  const lockPath = join(locksDir(root), "uncontended.lock");
  const markerPath = `${lockPath}.steal`;
  const now = 1_800_000_000_000;
  const staleMs = 30_000;
  writeFileSync(markerPath, "orphaned-stealer");
  utimesSync(markerPath, new Date(now - staleMs - 1), new Date(now - staleMs - 1));

  const held = await acquire(lockPath, { now: () => now, staleMs, timeoutMs: 50 });

  assert.equal(existsSync(markerPath), false);
  held.release();
});

test("acquire preserves exactly-stale and fresher markers after uncontended lock creation", async () => {
  const root = ws();
  const now = 1_800_000_000_000;
  const staleMs = 30_000;
  const cases = [
    { name: "boundary", age: staleMs },
    { name: "fresher", age: staleMs - 1 },
  ];

  for (const item of cases) {
    const lockPath = join(locksDir(root), `${item.name}.lock`);
    const markerPath = `${lockPath}.steal`;
    writeFileSync(markerPath, `${item.name}-stealer`);
    utimesSync(markerPath, new Date(now - item.age), new Date(now - item.age));

    const held = await acquire(lockPath, { now: () => now, staleMs, timeoutMs: 50 });
    assert.equal(existsSync(markerPath), true, `${item.name} marker must survive acquisition`);
    held.release();
  }
});

test("a fresh steal marker is a remedy-changing fact on a reclaimable same-host lock", () => {
  const root = ws();
  const lockPath = join(locksDir(root), "blocked-reclaim.lock");
  const now = 1_800_000_000_000;
  const staleMs = 30_000;
  writeFileSync(lockPath, JSON.stringify({
    token: "dead",
    pid: 999_999,
    host: hostname(),
    startedAt: 0,
    heartbeatAt: now,
    op: "dead-op",
  }));
  const markerPath = `${lockPath}.steal`;
  writeFileSync(markerPath, "active-or-interrupted-stealer");
  utimesSync(markerPath, new Date(now), new Date(now));

  assert.deepEqual(scanStaleLocks(locksDir(root), {
    now: () => now,
    staleMs,
    isPidAlive: () => false,
  }), [{
    kind: "stale-lock",
    file: "blocked-reclaim.lock",
    holder: {
      token: "dead",
      pid: 999_999,
      host: hostname(),
      startedAt: 0,
      heartbeatAt: now,
      op: "dead-op",
    },
    reason: "holder pid 999999 and recorded process start no longer identify a live process",
    recovery: "automatic",
    stealMarker: "fresh",
  }]);
});

test("the marker boundary stays fresh beside an aged unreadable lock and staleMs plus one is orphaned", () => {
  const root = ws();
  const now = 1_800_000_000_000;
  const staleMs = 30_000;
  const unreadableLock = join(locksDir(root), "unreadable.lock");
  const boundaryMarker = `${unreadableLock}.steal`;
  const orphanMarker = join(locksDir(root), "past-boundary.lock.steal");
  writeFileSync(unreadableLock, "not json {");
  writeFileSync(boundaryMarker, "boundary-stealer");
  writeFileSync(orphanMarker, "orphaned-stealer");
  utimesSync(unreadableLock, new Date(now - staleMs - 1), new Date(now - staleMs - 1));
  utimesSync(boundaryMarker, new Date(now - staleMs), new Date(now - staleMs));
  utimesSync(orphanMarker, new Date(now - staleMs - 1), new Date(now - staleMs - 1));

  const findings = scanStaleLocks(locksDir(root), { now: () => now, staleMs });
  const unreadable = findings.find((finding) => finding.kind === "stale-lock" && finding.file === "unreadable.lock");

  assert.deepEqual({
    exactBoundaryIsOrphan: findings.some(
      (finding) => finding.kind === "orphaned-steal-marker" && finding.file === "unreadable.lock.steal",
    ),
    pastBoundaryIsOrphan: findings.some(
      (finding) => finding.kind === "orphaned-steal-marker" && finding.file === "past-boundary.lock.steal",
    ),
    unreadableRecovery: unreadable?.recovery,
    unreadableStealMarker: unreadable?.kind === "stale-lock" ? unreadable.stealMarker : undefined,
  }, {
    exactBoundaryIsOrphan: false,
    pastBoundaryIsOrphan: true,
    unreadableRecovery: "automatic",
    unreadableStealMarker: "fresh",
  });
});
