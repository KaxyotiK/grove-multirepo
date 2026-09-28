/**
 * Test executables (Git proxies, hooks, ssh stand-ins) are written once per content and reused.
 *
 * macOS vets every newly created executable on its first run (syspolicyd), and those checks queue
 * across the whole system. A suite that writes a fresh `git` shim per test and runs its files in
 * parallel stacks dozens of those first runs, and each one can take seconds: a 5-second Git-gate
 * wait then times out for reasons unrelated to the test. A file that has already run
 * once starts in milliseconds, and so does a hard link or symlink to it — measured on macOS, 40
 * concurrent first runs of fresh scripts took a median of 3.4 s (max 6.4 s) against 179 ms (max
 * 262 ms) through fresh hard links to one already-run script.
 *
 * So each distinct source is written to one content-addressed path that every test process shares
 * and that survives the run, and a test that needs the executable under a particular name (`git` in
 * a per-test PATH directory, `post-checkout` in a hooks directory) gets a hard link to it. Anything
 * that varies per test belongs in environment variables or a config file the script reads, never in
 * its source: a source that differs per test would be a new executable per test again.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/** Shared across test processes and runs, so a script vetted once stays vetted. */
const SHIM_ROOT = join(realpathSync(tmpdir()), "grove-test-shims");

/** Set to a file path to log every executable this kit creates (one line each), for measurement. */
const CREATION_LOG_ENV = "GROVE_TEST_SHIM_CREATION_LOG";

const warmed = new Map<string, string>();

function holds(path: string, source: string): boolean {
  try {
    return readFileSync(path, "utf8") === source;
  } catch {
    return false;
  }
}

/**
 * Run the file once, outside any timed wait, so its first-run assessment is never charged to a
 * test. It runs with no test configuration in an empty directory, where every script in this kit
 * fails fast or does nothing.
 */
function warm(path: string): void {
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), "grove-shim-warm-"));
  try {
    spawnSync(path, [], {
      cwd,
      env: { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter) },
      stdio: "ignore",
      timeout: 60_000,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Publish `source` at its content-addressed path unless some process already has: a temp file, then
 * a hard link, which never replaces a file another process published (and may be running).
 */
function publish(source: string, name: string, mode: number): string {
  const path = join(SHIM_ROOT, name);
  if (holds(path, source)) return path;
  mkdirSync(SHIM_ROOT, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, source, { flag: "wx" });
  chmodSync(temporary, mode);
  let published = true;
  try {
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Published concurrently: keep that one unless it is not this source (a stale, damaged file).
    if (holds(path, source)) published = false;
    else renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  const log = process.env[CREATION_LOG_ENV];
  if (published && log && mode & 0o111) appendFileSync(log, `${process.pid} ${path}\n`);
  return path;
}

const digestOf = (source: string): string => createHash("sha256").update(source).digest("hex").slice(0, 32);

/** The shared executable holding exactly `source`, created race-safely if no process has yet. */
export function sharedExecutable(source: string): string {
  const digest = digestOf(source);
  const known = warmed.get(digest);
  if (known) return known;
  const path = publish(source, digest, 0o755);
  warm(path);
  warmed.set(digest, path);
  return path;
}

/** A shared, non-executable file holding exactly `source` (a script an interpreter reads). */
export function sharedFile(source: string, extension: string): string {
  return publish(source, `${digestOf(source)}${extension}`, 0o644);
}

/**
 * Make `destination` run `source` without creating a new executable: a hard link to the shared
 * file, so the per-test name and directory a test needs are an ordinary regular file there (a
 * symlink where the temp directory spans filesystems). Returns `destination`.
 */
export function linkExecutable(destination: string, source: string): string {
  const shared = sharedExecutable(source);
  mkdirSync(dirname(destination), { recursive: true });
  try {
    linkSync(shared, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    symlinkSync(shared, destination);
  }
  return destination;
}

// ── Git PATH proxies ────────────────────────────────────────────────────────────
/**
 * The `git` every PATH proxy installs. Grove makes hundreds of Git calls per command and a proxy
 * cares about one argv, so starting Node for each call would put a full Node startup on every one
 * of them. This `sh` front end instead execs the real Git directly unless the argv is one the proxy
 * intercepts, and only then hands it to the proxy's Node script. Its per-proxy settings are sourced
 * from `proxy.conf` beside it (a file, not an executable), so this script is the same everywhere.
 */
const FRONT_END_SOURCE = `#!/bin/sh
# Git PATH proxy front end: see tests/testkit/shim.ts. Settings come from proxy.conf beside it.
. "\${0%/*}/proxy.conf" || exit 127
if [ -n "$proxy_argv_log" ]; then printf '%s\\0' "$#" "$@" >> "$proxy_argv_log" || exit 127; fi
if proxy_matches "$@"; then exec "$proxy_node" "$proxy_script" "$@"; fi
PATH=$proxy_original_path
export PATH
exec "$proxy_real_git" "$@"
`;

/** One sh word holding exactly `value`: single quotes take every byte literally except `'`. */
const shellWord = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export interface GitProxyOptions {
  /** The PATH the proxied Git (and anything it runs) sees: the PATH without this proxy. */
  originalPath: string;
  realGitPath: string;
  /** Exact argvs handed to `script`; every other call execs the real Git directly. */
  intercept?: readonly (readonly string[])[];
  /** Node (CommonJS) source run as `node <script> <argv...>` for an intercepted argv. */
  script?: string;
  /** Append every argv, as `<argc>\0<arg>\0...`, to this file (see `readArgvLog`). */
  argvLog?: string;
}

/** Install a `git` proxy in `proxyDir` (a hard link to the shared front end plus its proxy.conf). */
export function installGitProxy(proxyDir: string, options: GitProxyOptions): void {
  const intercept = options.intercept ?? [];
  if (intercept.length > 0 && options.script === undefined) throw new Error("an intercepting Git proxy needs a script");
  for (const argv of intercept) for (const value of argv) {
    if (value.includes("\0")) throw new Error("a Git argv cannot contain NUL");
  }
  const tests = intercept.map((argv) =>
    [`[ "$#" -eq ${argv.length} ]`, ...argv.map((value, index) => `[ "x\${${index + 1}}" = ${shellWord(`x${value}`)} ]`)].join(" && "));
  const conf = [
    `proxy_real_git=${shellWord(options.realGitPath)}`,
    `proxy_original_path=${shellWord(options.originalPath)}`,
    `proxy_node=${shellWord(process.execPath)}`,
    `proxy_script=${shellWord(options.script === undefined ? "" : sharedFile(options.script, ".cjs"))}`,
    `proxy_argv_log=${shellWord(options.argvLog ?? "")}`,
    "proxy_matches() {",
    ...tests.map((test) => `  ${test} && return 0`),
    "  return 1",
    "}",
    "",
  ].join("\n");
  mkdirSync(proxyDir, { recursive: true });
  writeFileSync(join(proxyDir, "proxy.conf"), conf);
  linkExecutable(join(proxyDir, "git"), FRONT_END_SOURCE);
}

/** Parse an `argvLog`: each record is its argc, then that many arguments, all NUL-terminated. */
export function readArgvLog(path: string): string[][] {
  const fields = readFileSync(path, "utf8").split("\0");
  fields.pop();
  const records: string[][] = [];
  for (let index = 0; index < fields.length;) {
    const count = Number(fields[index++]);
    if (!Number.isInteger(count) || count < 0 || index + count > fields.length) throw new Error(`malformed Git argv log ${path}`);
    records.push(fields.slice(index, index + count));
    index += count;
  }
  return records;
}
