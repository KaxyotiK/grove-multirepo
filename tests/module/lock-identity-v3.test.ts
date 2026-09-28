import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquire, scanStaleLocks } from "../../src/store/lock.ts";
import { tempDir, cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
const LOCAL_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_ID = "22222222-2222-4222-8222-222222222222";
function lockPath(): string { const dir = tempDir("lock-identity"); mkdirSync(dir, { recursive: true }); return join(dir, "owner.lock"); }
function oldRecord(host: string, machineId?: string): string {
  return JSON.stringify({ token: "old", pid: 2_147_483_600, host, startedAt: 0, heartbeatAt: Date.now(), op: "previous", ...(machineId ? { machineId } : {}) });
}
const local = { host: () => "renamed-host", machineId: () => LOCAL_ID, isPidAlive: () => false, timeoutMs: 50 };

test("V3LCK-01: hostname drift with the same hardware UUID reclaims a dead holder", async () => {
  const path = lockPath(); writeFileSync(path, oldRecord("old-host", LOCAL_ID));
  const classified = scanStaleLocks(join(path, ".."), local);
  assert.equal(classified[0]?.recovery, "automatic");
  const held = await acquire(path, local);
  assert.notEqual(held.token, "old");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).machineId, LOCAL_ID);
  held.release();
});

test("V3LCK-02: a different hardware UUID remains foreign with an equal hostname", async () => {
  const path = lockPath(); writeFileSync(path, oldRecord("renamed-host", FOREIGN_ID));
  assert.equal(scanStaleLocks(join(path, ".."), local)[0]?.recovery, "manual");
  await assert.rejects(() => acquire(path, local), /holds this lock/);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "old");
});

test("V3LCK-03: legacy records and unavailable hardware UUID use hostname comparison", async () => {
  const legacy = lockPath(); writeFileSync(legacy, oldRecord("renamed-host"));
  assert.equal(scanStaleLocks(join(legacy, ".."), local)[0]?.recovery, "automatic");
  (await acquire(legacy, local)).release();
  const unavailable = lockPath(); writeFileSync(unavailable, oldRecord("renamed-host", FOREIGN_ID));
  const fallback = { ...local, machineId: () => null };
  assert.equal(scanStaleLocks(join(unavailable, ".."), fallback)[0]?.recovery, "automatic");
  const held = await acquire(unavailable, fallback);
  assert.equal(JSON.parse(readFileSync(unavailable, "utf8")).machineId, undefined);
  held.release();
  const foreignLegacy = lockPath(); writeFileSync(foreignLegacy, oldRecord("old-host"));
  assert.equal(scanStaleLocks(join(foreignLegacy, ".."), local)[0]?.recovery, "manual");
});
