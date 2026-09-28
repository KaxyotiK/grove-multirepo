/**
 * Deterministic, test-only Git fault boundary for §11 ARCH-07/ARCH-11.
 *
 * A `git` proxy is prepended to one spawned process's PATH. It delegates one exact argv to the
 * real Git executable, writes a sentinel only after Git succeeds, then blocks before Grove can
 * observe the child exit. The caller can therefore inspect the real post-mutation state and kill
 * the whole detached process group in the post-mutation/pre-acknowledgement window.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { installGitProxy, readArgvLog } from "./shim.ts";
import { tempDir } from "./tmp.ts";
import { BOUNDARY_READY_TIMEOUT_MS } from "./timeouts.ts";

const CONFIG_ENV = "GROVE_TEST_GIT_FAULT_CONFIG";

export type SentinelTiming = "before" | "after";

export interface GitFaultBoundaryOptions {
  exactGitArgs: string[];
  timeoutMs?: number;
  /** `before` exists only for negative controls proving the effect assertion is load-bearing. */
  sentinelTiming?: SentinelTiming;
}

export interface GitFaultRecord {
  args: string[];
  cwd: string;
  pid: number;
  timing: SentinelTiming;
  realGitExitCode: number | null;
}

interface ProxyConfig {
  exactGitArgs: string[];
  originalPath: string;
  realGitPath: string;
  sentinelPath: string;
  sentinelTiming: SentinelTiming;
}

export interface GitFaultBoundary {
  configPath: string;
  exactGitArgs: string[];
  proxyDir: string;
  sentinelPath: string;
  timeoutMs: number;
  env: Record<string, string>;
  dispose(): void;
}

export interface FaultProcess {
  child: ChildProcess;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderr(): string;
  stdout(): string;
}

function findExecutable(name: string, pathValue = process.env.PATH ?? ""): string {
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`Cannot find executable ${name} on PATH`);
}

const PROXY_SOURCE = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { readFileSync, renameSync, writeFileSync } = require("node:fs");

const configPath = process.env.${CONFIG_ENV};
if (!configPath) {
  process.stderr.write("git fault proxy has no config\\n");
  process.exit(127);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const args = process.argv.slice(2);
const matches = args.length === config.exactGitArgs.length && args.every((value, index) => value === config.exactGitArgs[index]);

function signalAndBlock(realGitExitCode) {
  const record = JSON.stringify({
    args,
    cwd: process.cwd(),
    pid: process.pid,
    timing: config.sentinelTiming,
    realGitExitCode,
  }) + "\\n";
  const temporary = config.sentinelPath + "." + process.pid + ".tmp";
  writeFileSync(temporary, record, { flag: "wx" });
  renameSync(temporary, config.sentinelPath);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

if (matches && config.sentinelTiming === "before") signalAndBlock(null);

const result = spawnSync(config.realGitPath, args, {
  cwd: process.cwd(),
  env: { ...process.env, PATH: config.originalPath },
  encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  process.stderr.write(String(result.error.message || result.error) + "\\n");
  process.exit(128);
}
const exitCode = result.status == null ? 128 : result.status;
if (matches && exitCode === 0 && config.sentinelTiming === "after") signalAndBlock(exitCode);
process.exit(exitCode);
`;

export function createGitFaultBoundary(options: GitFaultBoundaryOptions): GitFaultBoundary {
  if (options.exactGitArgs.length === 0) throw new Error("A Git fault boundary needs exact argv");
  const timeoutMs = options.timeoutMs ?? BOUNDARY_READY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Git fault timeout must be positive");

  const base = tempDir("git-fault");
  const proxyDir = join(base, "bin");
  const sentinelPath = join(base, "boundary.json");
  const configPath = join(base, "config.json");
  const originalPath = process.env.PATH ?? "";

  const config: ProxyConfig = {
    exactGitArgs: [...options.exactGitArgs],
    originalPath,
    realGitPath: findExecutable("git", originalPath),
    sentinelPath,
    sentinelTiming: options.sentinelTiming ?? "after",
  };
  installGitProxy(proxyDir, { originalPath, realGitPath: config.realGitPath, intercept: [config.exactGitArgs], script: PROXY_SOURCE });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    configPath,
    exactGitArgs: config.exactGitArgs,
    proxyDir,
    sentinelPath,
    timeoutMs,
    env: { PATH: `${proxyDir}${delimiter}${originalPath}`, [CONFIG_ENV]: configPath },
    dispose(): void {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export function spawnFaultProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): FaultProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => (stdout += chunk));
  child.stderr?.on("data", (chunk: string) => (stderr += chunk));
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { child, closed, stdout: () => stdout, stderr: () => stderr };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForGitFault(boundary: GitFaultBoundary, processUnderTest?: FaultProcess): Promise<GitFaultRecord> {
  const deadline = Date.now() + boundary.timeoutMs;
  for (;;) {
    if (existsSync(boundary.sentinelPath)) {
      const record = JSON.parse(readFileSync(boundary.sentinelPath, "utf8")) as GitFaultRecord;
      if (JSON.stringify(record.args) !== JSON.stringify(boundary.exactGitArgs)) {
        throw new Error(`Git fault sentinel recorded the wrong argv: ${JSON.stringify(record.args)}`);
      }
      return record;
    }
    const observed = processUnderTest;
    if (observed && (observed.child.exitCode !== null || observed.child.signalCode !== null)) {
      const result = await observed.closed;
      throw new Error(
        `Process exited before the Git fault boundary (code=${result.code}, signal=${result.signal ?? "none"})\n` +
          `${observed.stderr()}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${boundary.timeoutMs}ms waiting for exact Git argv ${JSON.stringify(boundary.exactGitArgs)}`);
    }
    await delay(10);
  }
}

export function processGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function killAndReapFaultProcess(processUnderTest: FaultProcess, timeoutMs = 2_000): Promise<void> {
  const pid = processUnderTest.child.pid;
  if (pid === undefined) throw new Error("Fault process has no pid");
  if (processGroupAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const result = await Promise.race([
    processUnderTest.closed.then(() => "closed" as const),
    delay(timeoutMs).then(() => "timeout" as const),
  ]);
  if (result === "timeout") throw new Error(`Timed out reaping fault process group ${pid}`);
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pid) && Date.now() < deadline) await delay(10);
  if (processGroupAlive(pid)) throw new Error(`Fault process group ${pid} is still alive after SIGKILL`);
}

// ── argv recorder ──────────────────────────────────────────────────────────────
/**
 * The same PATH-proxy mechanism used as a passive observer: every `git` argv one spawned Grove
 * process builds is appended to a log (by the proxy's sh front end, so no call starts Node), then
 * delegated verbatim to the real Git. It exists so an
 * argv-safety witness can assert on what Grove actually put on the command line WITHOUT a
 * production hook (007-crash-recovery-tests-SC-004 forbids one).
 */
const RECORDER_ENV = "GROVE_TEST_GIT_ARGV_LOG";

export interface GitArgvRecorder {
  logPath: string;
  proxyDir: string;
  env: Record<string, string>;
  /** Every recorded argv, in invocation order. */
  argv(): string[][];
  dispose(): void;
}

const REWRITER_ENV = "GROVE_TEST_GIT_REWRITE_CONFIG";

const REWRITER_SOURCE = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const config = JSON.parse(process.env.${REWRITER_ENV});
let args = process.argv.slice(2);
const sameArgv = config.match.length === args.length && config.match.every((value, index) => value === args[index]);
if (sameArgv) args = config.replacement.slice();
const result = spawnSync(process.env.GROVE_TEST_REAL_GIT, args, {
  cwd: process.cwd(),
  env: { ...process.env, PATH: process.env.GROVE_TEST_ORIGINAL_PATH },
  encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  process.stderr.write(String(result.error.message || result.error) + "\\n");
  process.exit(128);
}
process.exit(result.status === null ? 129 : result.status);
`;

/**
 * A PATH proxy that REWRITES one exact git argv into another before running real git.
 *
 * The failing gate (`createGitGate`) can only make a command fail. Restore's gates 4 and 8 fire on
 * a command that SUCCEEDS but produces the wrong HEAD shape — a `worktree add --detach` that ends
 * up attached — so nothing in the kit could reach them, and both were confirmed deletable with the
 * whole suite green. This closes that.
 *
 * Test-only, like the rest of this file: it lives entirely in a PATH shim and there is no
 * production hook (`007-crash-recovery-tests-SC-004`, enforced by `legacy-scan.sh`).
 */
export interface GitArgvRewriter { proxyDir: string; env: Record<string, string>; dispose(): void }

export function createGitArgvRewriter(match: readonly string[], replacement: readonly string[]): GitArgvRewriter {
  const base = tempDir("git-rewrite");
  const proxyDir = join(base, "bin");
  const originalPath = process.env.PATH ?? "";
  const realGitPath = findExecutable("git", originalPath);
  installGitProxy(proxyDir, { originalPath, realGitPath, intercept: [match], script: REWRITER_SOURCE });
  return {
    proxyDir,
    env: {
      PATH: `${proxyDir}${delimiter}${originalPath}`,
      [REWRITER_ENV]: JSON.stringify({ match, replacement }),
      GROVE_TEST_REAL_GIT: realGitPath,
      GROVE_TEST_ORIGINAL_PATH: originalPath,
    },
    dispose(): void { rmSync(base, { recursive: true, force: true }); },
  };
}

export function createGitArgvRecorder(): GitArgvRecorder {
  const base = tempDir("git-argv");
  const proxyDir = join(base, "bin");
  const logPath = join(base, "argv.log");
  const originalPath = process.env.PATH ?? "";
  writeFileSync(logPath, "");
  installGitProxy(proxyDir, { originalPath, realGitPath: findExecutable("git", originalPath), argvLog: logPath });

  return {
    logPath,
    proxyDir,
    env: {
      PATH: `${proxyDir}${delimiter}${originalPath}`,
      [RECORDER_ENV]: logPath,
    },
    argv(): string[][] {
      return readArgvLog(logPath);
    },
    dispose(): void {
      rmSync(base, { recursive: true, force: true });
    },
  };
}
