/** Deterministic pre-rename crash boundary for atomic manifest writes (PROC-05). */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FaultProcess } from "./git-fault.ts";
import { tempDir } from "./tmp.ts";
import { BOUNDARY_READY_TIMEOUT_MS } from "./timeouts.ts";

const CONFIG_ENV = "GROVE_TEST_FS_FAULT_CONFIG";

export interface FsFaultBoundary {
  preloadPath: string;
  sentinelPath: string;
  targetPath: string;
  timeoutMs: number;
  env: Record<string, string>;
  dispose(): void;
}

export interface FsFaultRecord {
  from: string;
  to: string;
  pid: number;
}

const PRELOAD_SOURCE = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const config = JSON.parse(fs.readFileSync(process.env.${CONFIG_ENV}, "utf8"));
const originalRename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (String(to) === config.targetPath && /^\\..*\\.tmp\\./.test(String(from).split("/").pop())) {
    const record = JSON.stringify({ from: String(from), to: String(to), pid: process.pid }) + "\\n";
    const temporary = config.sentinelPath + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, record, { flag: "wx" });
    originalRename(temporary, config.sentinelPath);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
  return originalRename(from, to);
};
syncBuiltinESMExports();
`;

export function createFsFaultBoundary(targetPath: string, timeoutMs = BOUNDARY_READY_TIMEOUT_MS): FsFaultBoundary {
  const base = tempDir("fs-fault");
  const preloadPath = join(base, "preload.mjs");
  const configPath = join(base, "config.json");
  const sentinelPath = join(base, "boundary.json");
  mkdirSync(base, { recursive: true });
  writeFileSync(preloadPath, PRELOAD_SOURCE);
  chmodSync(preloadPath, 0o644);
  writeFileSync(configPath, `${JSON.stringify({ targetPath, sentinelPath }, null, 2)}\n`);
  return {
    preloadPath,
    sentinelPath,
    targetPath,
    timeoutMs,
    env: { [CONFIG_ENV]: configPath },
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForFsFault(boundary: FsFaultBoundary, processUnderTest: FaultProcess): Promise<FsFaultRecord> {
  const deadline = Date.now() + boundary.timeoutMs;
  for (;;) {
    if (existsSync(boundary.sentinelPath)) {
      const record = JSON.parse(readFileSync(boundary.sentinelPath, "utf8")) as FsFaultRecord;
      if (record.to !== boundary.targetPath) throw new Error(`filesystem boundary targeted ${record.to}`);
      return record;
    }
    if (processUnderTest.child.exitCode !== null || processUnderTest.child.signalCode !== null) {
      const result = await processUnderTest.closed;
      throw new Error(`Process exited before the filesystem boundary (code=${result.code}, signal=${result.signal ?? "none"})\n${processUnderTest.stderr()}`);
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the pre-rename boundary at ${boundary.targetPath}`);
    await delay(10);
  }
}
