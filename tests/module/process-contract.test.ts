import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("V3CUT-01/PROC-07: the dependency and source scan excludes legacy ownership, runtime, desktop, daemon, RPC, socket-server, and service implementations", () => {
  const result = spawnSync("bash", ["scripts/legacy-scan.sh"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /no Bun API/);
  assert.match(result.stdout, /no server\/socket\/RPC/);
  assert.match(result.stdout, /no detached production processes/);
  // ASSERT:PROC-07:NO-BUN-API-ELECTRON-DAEMON-RPC-SOCKET-SERVER
  assert.match(result.stdout, /PROC-07 scan: PASSED/);
});
