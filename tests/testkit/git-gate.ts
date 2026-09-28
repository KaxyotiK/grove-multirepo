/** Releasable/failing exact-argv Git proxy for process and rollback scenarios. */
import { accessSync, constants, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { FaultProcess } from "./git-fault.ts";
import { installGitProxy } from "./shim.ts";
import { tempDir } from "./tmp.ts";

const CONFIG_ENV = "GROVE_TEST_GIT_GATE_CONFIG";

export interface GitGate {
  sentinelPath: string;
  releasePath: string;
  env: Record<string, string>;
  timeoutMs: number;
  release(): void;
  dispose(): void;
}

function findExecutable(name: string, pathValue: string): string {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // next PATH entry
    }
  }
  throw new Error(`Cannot find executable ${name}`);
}

const PROXY_SOURCE = `#!/usr/bin/env node
const { existsSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const config = JSON.parse(readFileSync(process.env.${CONFIG_ENV}, "utf8"));
const args = process.argv.slice(2);
const matches = config.exactGitArgs.some((candidate) => args.length === candidate.length && args.every((value, index) => value === candidate[index]));
if (matches) {
  const temporary = config.sentinelPath + "." + process.pid + ".tmp";
  writeFileSync(temporary, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + "\\n", { flag: "wx" });
  renameSync(temporary, config.sentinelPath);
  if (config.failExitCode !== null) process.exit(config.failExitCode);
  while (!existsSync(config.releasePath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
}
const result = spawnSync(config.realGitPath, args, { cwd: process.cwd(), env: { ...process.env, PATH: config.originalPath }, encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) { process.stderr.write(String(result.error.message || result.error) + "\\n"); process.exit(128); }
process.exit(result.status == null ? 128 : result.status);
`;

export function createGitGate(exactGitArgs: readonly string[] | readonly (readonly string[])[], options: { failExitCode?: number; timeoutMs?: number } = {}): GitGate {
  const base = tempDir("git-gate");
  const proxyDir = join(base, "bin");
  const configPath = join(base, "config.json");
  const sentinelPath = join(base, "sentinel.json");
  const releasePath = join(base, "release");
  const originalPath = process.env.PATH ?? "";
  const intercept = (Array.isArray(exactGitArgs[0]) ? exactGitArgs : [exactGitArgs]) as readonly (readonly string[])[];
  const realGitPath = findExecutable("git", originalPath);
  installGitProxy(proxyDir, { originalPath, realGitPath, intercept, script: PROXY_SOURCE });
  writeFileSync(configPath, `${JSON.stringify({
    exactGitArgs: intercept,
    originalPath,
    realGitPath,
    sentinelPath,
    releasePath,
    failExitCode: options.failExitCode ?? null,
  }, null, 2)}\n`);
  return {
    sentinelPath,
    releasePath,
    timeoutMs: options.timeoutMs ?? 5_000,
    env: { PATH: `${proxyDir}${delimiter}${originalPath}`, [CONFIG_ENV]: configPath },
    release: () => writeFileSync(releasePath, "release\n"),
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForGitGate(gate: GitGate, processUnderTest?: FaultProcess): Promise<{ args: string[]; cwd: string; pid: number }> {
  const deadline = Date.now() + gate.timeoutMs;
  for (;;) {
    if (existsSync(gate.sentinelPath)) return JSON.parse(readFileSync(gate.sentinelPath, "utf8"));
    if (processUnderTest && (processUnderTest.child.exitCode !== null || processUnderTest.child.signalCode !== null)) {
      const result = await processUnderTest.closed;
      throw new Error(`Process exited before Git gate (code=${result.code}, signal=${result.signal ?? "none"})\n${processUnderTest.stderr()}`);
    }
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Git gate");
    await delay(10);
  }
}
