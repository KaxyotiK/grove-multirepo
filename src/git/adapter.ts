/**
 * The git adapter (injectable, so tests substitute the runner with no other changes). Every ref
 * that reaches an argv is validated first — an agent naming a branch `--force` would otherwise
 * pass a flag to git.
 *
 * Ported from the pinned source: the legacy Bun spawn API → `node:child_process`. The daemon's noninteractive
 * Git environment is dropped except `GIT_TERMINAL_PROMPT=0` (fail a prompt fast rather than hang)
 * and `LC_ALL=C` (stable porcelain); Grove takes no stance on authentication — SSH agent,
 * credential helpers, and terminal prompts pass through untouched.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { GroveError } from "../errors.ts";
import { assertBranchName, checkRemoteName, resolvedRemoteRefusal } from "../model/validate.ts";
import { nativePathFromBytes, refNameFromBytes, type NativePath, type RefName } from "../model/encoding.ts";
import type { ContainedPath } from "../paths/fs.ts";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitRunner {
  run(cwd: string, args: string[]): Promise<GitResult>;
  runBytes?(cwd: string, args: string[]): Promise<{ stdout: Uint8Array; stderr: Uint8Array; exitCode: number }>;
}

// Only this module can recover the native runner for typed mutation methods. Public runners
// and public Git argv methods both enforce the gate. Injected test runners remain injectable.
const uncheckedRunners = new WeakMap<GitRunner, GitRunner>();
const mutationGateMessage = "Git worktree remove/move requires the typed ContainedPath adapter methods";

function isRawWorktreeMutation(args: readonly string[]): boolean {
  let command = 0;
  const optionsWithValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
  while (command < args.length) {
    const arg = args[command]!;
    const config = arg === "-c" || arg === "--config-env" ? args[command + 1] : arg.startsWith("-c") ? arg.slice(2) : arg.startsWith("--config-env=") ? arg.slice(13) : null;
    if (config && /^alias\./i.test(config)) return true;
    if (optionsWithValue.has(arg)) { command += 2; continue; }
    if (/^-C.+/.test(arg) || /^-c.+/.test(arg) || /^--(?:git-dir|work-tree|namespace|super-prefix|config-env)=/.test(arg)) { command += 1; continue; }
    if (arg.startsWith("-")) { command += 1; continue; }
    break;
  }
  if (args[command] !== "worktree" || (args[command + 1] !== "remove" && args[command + 1] !== "move")) return false;
  const tail = args.slice(command + 2);
  const separator = tail.indexOf("--");
  const optionSegment = separator === -1 ? tail : tail.slice(0, separator);
  return !optionSegment.includes("-h") && !optionSegment.includes("--help");
}

export function createGitRunner(): GitRunner {
  const execute = (cwd: string, args: string[]): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }> =>
    new Promise((resolve) => {
        const child = spawn("git", args, {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (d: Buffer) => stdout.push(Buffer.from(d)));
        child.stderr.on("data", (d: Buffer) => stderr.push(Buffer.from(d)));
        child.on("error", (e) => resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.from(String(e.message ?? e)), exitCode: 128 }));
        child.on("close", (code) => resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code ?? 0 }));
      });
  const unchecked: GitRunner = {
    async run(cwd, args): Promise<GitResult> { const result = await execute(cwd, args); return { stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8"), exitCode: result.exitCode }; },
    async runBytes(cwd, args) { return execute(cwd, args); },
  };
  const guarded: GitRunner = {
    async run(cwd, args) { return isRawWorktreeMutation(args) ? { stdout: "", stderr: mutationGateMessage, exitCode: 128 } : unchecked.run(cwd, args); },
    async runBytes(cwd, args) { return isRawWorktreeMutation(args) ? { stdout: new Uint8Array(), stderr: Buffer.from(mutationGateMessage), exitCode: 128 } : unchecked.runBytes!(cwd, args); },
  };
  uncheckedRunners.set(guarded, unchecked);
  return guarded;
}

export interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

export interface RawWorktreeEntry {
  path: NativePath;
  head: string | null;
  branch: RefName | null;
  bare: boolean;
  prunable: boolean;
  locked: boolean;
}

export interface RepositoryIdentity {
  topLevel: NativePath | null;
  gitDir: NativePath;
  commonGitDir: NativePath;
}
export interface CurrentHead { oid: string | null; branch: RefName | null; detached: boolean; unborn: boolean }
export type GitCapability = "worktree-porcelain-z" | "worktree-move" | "rev-parse-end-of-options" | "bundle-fsck";
export interface GitCapabilities { executable: string; version: string; supported: ReadonlySet<GitCapability> }
export interface RemoteAdvertisementRef { ref: RefName; oid: string }
export interface RemoteInspection {
  empty: boolean;
  symbolicHead: RefName | null;
  requested: RemoteAdvertisementRef | null;
  refs: RemoteAdvertisementRef[];
  advertisementGeneration: string;
}

const OID_RE = /^[0-9a-fA-F]{40,64}$/;
function assertOid(oid: string): string {
  if (!OID_RE.test(oid)) throw new GroveError({ kind: "invalid-input", what: `Invalid Git object ID "${oid}"`, why: "expected a full SHA-1 or SHA-256 object ID", remedy: "Resolve the revision to an exact commit before mutation." });
  return oid.toLowerCase();
}
/**
 * Argv safety for a preferred remote name. A remote NAME is neither a Grove name nor a git ref, so
 * nothing else validates it; a repository whose remote is named `--upload-pack=<command>` reaches
 * `git fetch` as an option and git executes <command>. Exported because EVERY path that persists
 * or spends a preferred remote must apply the same predicate, not just this adapter.
 */
export function assertFetchableRemote(remote: string): void {
  const failure = checkRemoteName(remote);
  if (!failure) return;
  throw new GroveError({ kind: "invalid-input", what: `Cannot use "${remote}" as a preferred remote`, why: failure.why, remedy: `Choose a remote name that is ${failure.rule}.`, detail: { remote, rule: failure.rule } });
}

function utf8Ref(value: RefName, action: string): string {
  if (value.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: `Cannot ${action}`, why: "the Git ref name is not valid UTF-8 and cannot be reproduced losslessly through argv", remedy: "Use native Git with the escaped/base64 ref evidence." });
  return value.utf8;
}

export function parseWorktreePorcelainZ(raw: Uint8Array): RawWorktreeEntry[] {
  const fields = Buffer.from(raw).subarray().toString("latin1").split("\0");
  const entries: RawWorktreeEntry[] = [];
  let current: Partial<RawWorktreeEntry> = {};
  const bytes = (latin1: string): Buffer => Buffer.from(latin1, "latin1");
  const flush = () => {
    if (current.path) entries.push({ path: current.path, head: current.head ?? null, branch: current.branch ?? null, bare: current.bare ?? false, prunable: current.prunable ?? false, locked: current.locked ?? false });
    current = {};
  };
  for (const field of fields) {
    if (field.length === 0) { flush(); continue; }
    const firstSpace = field.indexOf(" ");
    const key = firstSpace < 0 ? field : field.slice(0, firstSpace);
    const value = firstSpace < 0 ? "" : field.slice(firstSpace + 1);
    if (key === "worktree") { flush(); current.path = nativePathFromBytes(bytes(value)); }
    else if (key === "HEAD") current.head = /^0+$/.test(value) ? null : value;
    else if (key === "branch") current.branch = refNameFromBytes(bytes(value));
    else if (key === "bare") current.bare = true;
    else if (key === "prunable") current.prunable = true;
    else if (key === "locked") current.locked = true;
  }
  flush();
  return entries;
}

export class Git {
  private readonly runner: GitRunner;
  constructor(runner: GitRunner) {
    this.runner = uncheckedRunners.get(runner) ?? runner;
  }
  get bytePreserving(): boolean { return this.runner.runBytes !== undefined; }

  private async tryRunUnchecked(cwd: string, args: string[]): Promise<GitResult> {
    try {
      return await this.runner.run(cwd, args);
    } catch (e) {
      return { stdout: "", stderr: String((e as Error).message ?? e), exitCode: 128 };
    }
  }

  private async runUnchecked(cwd: string, args: string[], what: string): Promise<GitResult> {
    const r = await this.tryRunUnchecked(cwd, args);
    if (r.exitCode !== 0) throw new GroveError({ kind: "git", what, why: (r.stderr.trim() || r.stdout.trim() || `git exited ${r.exitCode}`).split("\n")[0] ?? "", remedy: "Check the repository state and re-run.", detail: { args, exitCode: r.exitCode, stderr: r.stderr.trim() } });
    return r;
  }

  async run(cwd: string, args: string[], what: string): Promise<GitResult> {
    const r = await this.tryRun(cwd, args);
    if (r.exitCode !== 0) {
      throw new GroveError({
        kind: "git",
        what,
        why: (r.stderr.trim() || r.stdout.trim() || `git exited ${r.exitCode}`).split("\n")[0] ?? "",
        remedy: "Check the repository state and re-run.",
        detail: { args, exitCode: r.exitCode, stderr: r.stderr.trim() },
      });
    }
    return r;
  }

  /**
   * Where a fetch of `remote` (a URL or a remote name) from `cwd` really goes, as Git itself answers:
   * `ls-remote --get-url` applies every `url.<base>.insteadOf` rule Git would, with conditional
   * includes (`gitdir:`, `onbranch:`, `hasconfig:`) evaluated against the repository at `cwd`. Local
   * only; it contacts nothing. Git's stderr is not quoted: a malformed configuration entry it names
   * can itself be a credential.
   */
  async resolveRemoteUrl(cwd: string, remote: string): Promise<string> {
    const result = await this.tryRun(cwd, ["ls-remote", "--get-url", "--", remote]);
    if (result.exitCode !== 0) throw new GroveError({ kind: "git", what: "Cannot resolve where the remote points", why: `git ls-remote --get-url exited ${result.exitCode}; Git's message is not shown because it can quote configuration values`, remedy: "Check the Git configuration (for example with `git config --list --show-origin`), then retry." });
    return result.stdout.replace(/\r?\n$/, "");
  }

  /** V3SEC-05: why a fetch of `remote` from `cwd` must not run (Git's own answer is credentialed), or null. */
  async fetchDestinationRefusal(cwd: string, remote: string): Promise<{ why: string; remedy: string } | null> {
    return resolvedRemoteRefusal(await this.resolveRemoteUrl(cwd, remote));
  }

  /** Never throws. A spawn failure (a cwd that does not exist) is a non-zero result. */
  async tryRun(cwd: string, args: string[]): Promise<GitResult> {
    if (isRawWorktreeMutation(args)) return { stdout: "", stderr: "Git worktree remove/move requires the typed ContainedPath adapter methods", exitCode: 128 };
    return this.tryRunUnchecked(cwd, args);
  }

  async tryRunBytes(cwd: string, args: string[]): Promise<{ stdout: Uint8Array; stderr: Uint8Array; exitCode: number }> {
    if (isRawWorktreeMutation(args)) return { stdout: new Uint8Array(), stderr: Buffer.from("Git worktree remove/move requires the typed ContainedPath adapter methods"), exitCode: 128 };
    try {
      if (this.runner.runBytes) return await this.runner.runBytes(cwd, args);
      const result = await this.runner.run(cwd, args);
      return { stdout: Buffer.from(result.stdout), stderr: Buffer.from(result.stderr), exitCode: result.exitCode };
    } catch (e) { return { stdout: new Uint8Array(), stderr: Buffer.from(String((e as Error).message ?? e)), exitCode: 128 }; }
  }

  async probeCapabilities(cwd: string, required: readonly GitCapability[]): Promise<GitCapabilities> {
    const versionResult = await this.tryRun(cwd, ["--version"]);
    if (versionResult.exitCode !== 0 || !/^git version \d+(?:\.\d+)+/i.test(versionResult.stdout.trim())) {
      throw new GroveError({ kind: "version-skew", what: "Git executable is unavailable", why: versionResult.stderr.trim().split("\n")[0] || "git --version did not return a recognized version", remedy: "Install an executable Git build and retry.", detail: { exitCode: versionResult.exitCode } });
    }
    const supported = new Set<GitCapability>();
    const probes: Record<GitCapability, string[]> = {
      "worktree-porcelain-z": ["worktree", "list", "--porcelain", "-z"],
      "worktree-move": ["worktree", "move", "-h"],
      "rev-parse-end-of-options": ["rev-parse", "--verify", "--end-of-options", "HEAD"],
      "bundle-fsck": ["bundle", "verify", "--help"],
    };
    for (const capability of required) {
      const result = await this.tryRunUnchecked(cwd, probes[capability]);
      const text = `${result.stdout}\n${result.stderr}`;
      const recognizedHelp = (capability === "worktree-move" || capability === "bundle-fsck") && /usage: git/i.test(text);
      const recognizedBeforeRepository = (capability === "rev-parse-end-of-options" || capability === "worktree-porcelain-z") && result.exitCode === 128 && /not a git repository|not a git work tree/i.test(text) && !/unknown option|unknown switch/i.test(text);
      if (result.exitCode === 0 || recognizedHelp || recognizedBeforeRepository) supported.add(capability);
      else throw new GroveError({ kind: "version-skew", what: `Git capability ${capability} is unavailable`, why: (text.trim().split("\n")[0] || `probe exited ${result.exitCode}`), remedy: "Install a Git build that supports the failed probe before retrying.", detail: { capability, args: probes[capability], exitCode: result.exitCode } });
    }
    return { executable: "git", version: versionResult.stdout.trim(), supported };
  }

  async inspectRepository(anchor: string): Promise<RepositoryIdentity> {
    const cwd = existsSync(anchor) && !anchor.endsWith("/.git") ? anchor : dirname(anchor);
    const prefix = anchor.endsWith("/.git") || !existsSync(cwd) ? ["--git-dir", anchor] : [];
    const query = async (args: string[], nullable = false): Promise<NativePath | null> => {
      const result = await this.tryRunBytes(cwd, [...prefix, "rev-parse", "--path-format=absolute", ...args]);
      if (result.exitCode !== 0) { if (nullable) return null; throw new GroveError({ kind: "git", what: `Cannot inspect repository at ${anchor}`, why: `git rev-parse exited ${result.exitCode}; Git's message is not shown because it can quote configuration values`, remedy: "Repair the repository or correct its registration.", detail: { exitCode: result.exitCode } }); }
      const bytes = Buffer.from(result.stdout); const end = bytes[bytes.length - 1] === 0x0a ? bytes.subarray(0, -1) : bytes;
      return nativePathFromBytes(end);
    };
    const topLevel = await query(["--show-toplevel"], true);
    const gitDir = await query(["--absolute-git-dir"]);
    const commonGitDir = await query(["--git-common-dir"]);
    if (gitDir?.utf8 === null || commonGitDir?.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot register the repository", why: "its Git directory path is not valid UTF-8", remedy: "Use native Git from that path; Grove external anchors require strict UTF-8.", detail: { reason: "unsupported-native-path" } });
    return { topLevel, gitDir: gitDir as NativePath, commonGitDir: commonGitDir as NativePath };
  }

  async inspectRemote(cwd: string, remote: string, requestedBranch: RefName | null): Promise<RemoteInspection> {
    const result = await this.tryRunBytes(cwd, ["ls-remote", "--symref", "--", remote, "HEAD", "refs/heads/*"]);
    if (result.exitCode !== 0) throw new GroveError({ kind: "git", what: "Cannot inspect the remote", why: `git ls-remote exited ${result.exitCode}; remote diagnostics were redacted`, remedy: "Check the remote and authentication, then retry." });
    const raw = Buffer.from(result.stdout);
    const refs: RemoteAdvertisementRef[] = [];
    let symbolicHead: RefName | null = null;
    let start = 0;
    for (let index = 0; index <= raw.length; index++) {
      if (index !== raw.length && raw[index] !== 0x0a) continue;
      const line = raw.subarray(start, index); start = index + 1;
      if (line.length === 0) continue;
      const tab = line.indexOf(0x09);
      if (tab < 0) continue;
      const left = line.subarray(0, tab);
      const right = line.subarray(tab + 1);
      if (left.subarray(0, 5).toString("ascii") === "ref: " && right.equals(Buffer.from("HEAD"))) {
        symbolicHead = refNameFromBytes(left.subarray(5));
        continue;
      }
      const oid = left.toString("ascii");
      if (!OID_RE.test(oid) || !right.subarray(0, 11).equals(Buffer.from("refs/heads/"))) continue;
      refs.push({ ref: refNameFromBytes(right), oid: oid.toLowerCase() });
    }
    refs.sort((left, right) => Buffer.compare(Buffer.from(left.ref.raw), Buffer.from(right.ref.raw)));
    const requested = requestedBranch === null ? null : refs.find((entry) => Buffer.from(entry.ref.raw).equals(Buffer.from(requestedBranch.raw))) ?? null;
    return { empty: refs.length === 0, symbolicHead, requested, refs, advertisementGeneration: createHash("sha256").update(raw).digest("hex") };
  }

  async resolveCommit(cwd: string, revision: string): Promise<{ input: string; oid: string }> {
    if (revision.startsWith("-")) throw new GroveError({ kind: "invalid-input", what: `Cannot resolve revision "${revision}"`, why: "a revision may not be parsed as an option", remedy: "Pass a Git revision that does not begin with a dash." });
    const result = await this.tryRun(cwd, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]);
    if (result.exitCode !== 0 || !OID_RE.test(result.stdout.trim())) throw new GroveError({ kind: "invalid-input", what: `Cannot resolve revision "${revision}"`, why: result.stderr.trim().split("\n")[0] || "it does not resolve to a commit", remedy: "Pass a revision resolving to one commit." });
    return { input: revision, oid: result.stdout.trim().toLowerCase() };
  }

  async refOid(cwd: string, ref: RefName): Promise<string | null> {
    const name = utf8Ref(ref, "resolve the ref");
    const result = await this.tryRun(cwd, ["rev-parse", "--verify", "--end-of-options", `${name}^{object}`]);
    return result.exitCode === 0 && OID_RE.test(result.stdout.trim()) ? result.stdout.trim().toLowerCase() : null;
  }

  async setUpstream(cwd: string, branch: RefName, upstream: RefName): Promise<void> {
    const branchName = utf8Ref(branch, "set branch upstream").replace(/^refs\/heads\//, "");
    const upstreamName = utf8Ref(upstream, "set branch upstream").replace(/^refs\/remotes\//, "");
    assertBranchName(branchName);
    await this.run(cwd, ["branch", "--set-upstream-to", upstreamName, branchName], `Cannot set upstream for ${branchName}`);
  }

  async fetch(commonGitDir: string, remote: string): Promise<void> {
    assertFetchableRemote(remote);
    await this.run(commonGitDir, ["fetch", "--prune", "--", remote], `Cannot fetch ${remote}`);
  }

  /** Non-throwing fetch. Exists so callers wanting `tryRun` semantics never hand-build a fetch argv. */
  async tryFetch(commonGitDir: string, remote: string): Promise<GitResult> {
    assertFetchableRemote(remote);
    return this.tryRun(commonGitDir, ["fetch", "--prune", "--", remote]);
  }

  async fastForward(cwd: string, upstreamOid: string): Promise<void> {
    await this.run(cwd, ["merge", "--ff-only", assertOid(upstreamOid)], "Cannot fast-forward the worktree");
  }

  async rebase(cwd: string, upstreamOid: string): Promise<void> {
    await this.run(cwd, ["rebase", assertOid(upstreamOid)], "Cannot rebase the worktree");
  }

  async isCommitReachableFromRef(commonGitDir: string, oid: string): Promise<boolean> {
    const result = await this.tryRun(commonGitDir, ["for-each-ref", "--format=%(refname)", "--contains", assertOid(oid)]);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }

  // ── worktrees ────────────────────────────────────────────────────────────
  async listWorktrees(objectStore: string): Promise<WorktreeEntry[]> {
    if (!this.runner.runBytes) {
      const result = await this.run(objectStore, ["worktree", "list", "--porcelain"], "Cannot list worktrees");
      const entries: WorktreeEntry[] = [];
      let current: Partial<WorktreeEntry> = {};
      const flush = () => { if (current.path) entries.push({ path: current.path, head: current.head ?? null, branch: current.branch ?? null, bare: current.bare ?? false, prunable: current.prunable ?? false }); current = {}; };
      for (const line of result.stdout.split("\n")) { if (line.startsWith("worktree ")) { flush(); current.path = line.slice(9); } else if (line.startsWith("HEAD ")) current.head = line.slice(5); else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, ""); else if (line === "bare") current.bare = true; else if (line === "prunable" || line.startsWith("prunable ")) current.prunable = true; }
      flush();
      return entries;
    }
    const raw = await this.listWorktreesRaw(objectStore);
    return raw.map((entry) => ({ path: entry.path.utf8 ?? entry.path.display, head: entry.head, branch: entry.branch?.utf8?.replace(/^refs\/heads\//, "") ?? null, bare: entry.bare, prunable: entry.prunable }));
  }

  async listWorktreesRaw(commonGitDir: string): Promise<RawWorktreeEntry[]> { const result = await this.tryRunBytes(commonGitDir, ["worktree", "list", "--porcelain", "-z"]); if (result.exitCode !== 0) throw new GroveError({ kind: "git", what: "Cannot list worktrees", why: Buffer.from(result.stderr).toString("utf8").trim() || `git exited ${result.exitCode}`, remedy: "Repair the repository and retry." }); return parseWorktreePorcelainZ(result.stdout); }

  async currentHead(cwd: string): Promise<CurrentHead> { const symbolic = await this.tryRunBytes(cwd, ["symbolic-ref", "--quiet", "HEAD"]); const branch = symbolic.exitCode === 0 ? refNameFromBytes(Buffer.from(symbolic.stdout).subarray(0, Buffer.from(symbolic.stdout).at(-1) === 0x0a ? -1 : undefined)) : null; const oid = await this.tryRun(cwd, ["rev-parse", "--verify", "HEAD"]); const value = oid.exitCode === 0 ? oid.stdout.trim() : null; return { oid: value, branch, detached: branch === null && value !== null, unborn: branch !== null && value === null }; }

  async upstream(cwd: string): Promise<RefName | null> { const result = await this.tryRunBytes(cwd, ["rev-parse", "--symbolic-full-name", "@{upstream}"]); if (result.exitCode !== 0) return null; const raw = Buffer.from(result.stdout); return refNameFromBytes(raw.at(-1) === 0x0a ? raw.subarray(0, -1) : raw); }
  async aheadBehind(cwd: string, upstream: RefName): Promise<{ ahead: number; behind: number }> { if (upstream.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot compare upstream", why: "the upstream ref is not valid UTF-8", remedy: "Use native Git for this ref." }); const result = await this.run(cwd, ["rev-list", "--left-right", "--count", `HEAD...${upstream.utf8}`], "Cannot compare ahead/behind state"); const [ahead, behind] = result.stdout.trim().split(/\s+/).map(Number); return { ahead: ahead ?? 0, behind: behind ?? 0 }; }
  async sequencerState(cwd: string): Promise<{ kind: string; path: string } | null> { for (const [name, kind] of [["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"]] as const) { const result = await this.tryRun(cwd, ["rev-parse", "--git-path", name]); const path = result.stdout.trim(); if (result.exitCode === 0 && path && existsSync(path)) return { kind, path }; } return null; }

  async addWorktree(objectStore: string, path: string, branch: string): Promise<void> {
    assertBranchName(branch);
    await this.run(objectStore, ["worktree", "add", "--", path, branch], `Cannot create the worktree for ${branch}`);
  }

  async removeWorktree(objectStore: string, path: ContainedPath, force = false): Promise<void> {
    await this.runUnchecked(
      objectStore,
      ["worktree", "remove", ...(force ? ["--force"] : []), "--", path],
      `Cannot remove the worktree at ${path}`,
    );
  }

  async tryRemoveWorktree(objectStore: string, path: ContainedPath, force = false): Promise<GitResult> {
    return this.tryRunUnchecked(objectStore, ["worktree", "remove", ...(force ? ["--force"] : []), "--", path]);
  }

  /** Force still goes through native Git. Grove never recursively deletes a broken worktree. */
  async forceRemoveWorktree(objectStore: string, path: ContainedPath): Promise<void> {
    await this.removeWorktree(objectStore, path, true);
  }

  async pruneWorktrees(objectStore: string): Promise<void> {
    await this.run(objectStore, ["worktree", "prune"], "Cannot prune worktree metadata");
  }

  /** Git records worktree paths as ABSOLUTE strings, so moving a Grove directory breaks every
   * worktree (they become `prunable`) until repaired. */
  async repairWorktrees(objectStore: string, paths: string[]): Promise<void> {
    await this.run(objectStore, ["worktree", "repair", "--", ...paths], "Cannot repair worktree paths");
  }

  async moveWorktree(objectStore: string, from: ContainedPath, to: ContainedPath): Promise<void> {
    await this.runUnchecked(objectStore, ["worktree", "move", "--", from, to], `Cannot move the worktree ${from}`);
  }

  // ── branches ─────────────────────────────────────────────────────────────
  async listBranches(objectStore: string): Promise<string[]> {
    const r = await this.run(
      objectStore,
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      "Cannot list branches",
    );
    return r.stdout.split("\n").filter(Boolean);
  }

  async branchExists(objectStore: string, branch: string): Promise<boolean> {
    assertBranchName(branch);
    const r = await this.tryRun(objectStore, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return r.exitCode === 0;
  }

  /**
   * Remotes as GIT knows them, not as Grove recorded them (Principle I / ruling ② B2).
   *
   * `RepositoryRegistration.remote` is advisory and frequently null for `repo link`ed repositories
   * that do have a perfectly good remote. Asking Git is the difference between "we cannot verify
   * this is pushed" and "Grove never wrote it down".
   */
  async listRemotes(objectStore: string): Promise<string[]> {
    const r = await this.tryRun(objectStore, ["remote"]);
    if (r.exitCode !== 0) return [];
    return r.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  }

  async remoteBranchExists(objectStore: string, remote: string, branch: string): Promise<boolean> {
    assertBranchName(branch);
    const r = await this.tryRun(objectStore, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/${remote}/${branch}`,
    ]);
    return r.exitCode === 0;
  }

  async createBranch(objectStore: string, branch: string, base: string): Promise<void> {
    assertBranchName(branch);
    await this.run(objectStore, ["branch", "--", branch, base], `Cannot create branch ${branch}`);
  }

  /** Resolve a worktree through its recorded HEAD, never by path existence. */
  async currentBranch(worktreePath: string): Promise<string | null> {
    const r = await this.tryRun(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (r.exitCode !== 0) return null;
    const b = r.stdout.trim();
    return b === "HEAD" ? null : b;
  }

  // ── fetch ────────────────────────────────────────────────────────────────
  async fetchAll(objectStore: string): Promise<void> {
    await this.run(
      objectStore,
      ["fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"],
      "Cannot fetch from the remote",
    );
  }

  async fetchTrunk(objectStore: string, trunk: string): Promise<void> {
    assertBranchName(trunk);
    await this.run(
      objectStore,
      ["fetch", "origin", `+refs/heads/${trunk}:refs/remotes/origin/${trunk}`],
      `Cannot fetch ${trunk}`,
    );
  }
}
