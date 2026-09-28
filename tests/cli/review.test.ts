import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI, makeFixture } from "../testkit/fixture.ts";
import { createGitArgvRecorder, createGitArgvRewriter, killAndReapFaultProcess, processGroupAlive, spawnFaultProcess } from "../testkit/git-fault.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (s: string) => JSON.parse(s.trim());

/** Stand up a workspace with one repo and a Grove with a work branch, and return paths. */
function withGrove() {
  const fx = makeFixture({ repos: { alpha: [] } });
  fx.grove(["init"]);
  fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  const created = json(fx.grove(["--json", "new", "work", "--repo", "alpha"]).stdout);
  const worktree = created.targets[0].after.path as string;
  return { fx, worktree };
}

test("changes lists uncommitted edits in a Tree", () => {
  const { fx, worktree } = withGrove();
  writeFileSync(join(worktree, "new.txt"), "hi");
  const r = fx.grove(["--json", "changes", "work"]);
  assert.equal(r.status, 0, r.stderr);
  const trees = json(r.stdout).detail.trees;
  assert.equal(trees[0].changes.length, 1);
});

test("commits and against-trunk report work ahead of the base", () => {
  const { fx, worktree } = withGrove();
  execFileSync("git", ["-C", worktree, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", worktree, "config", "user.name", "t"]);
  writeFileSync(join(worktree, "f.txt"), "x");
  execFileSync("git", ["-C", worktree, "add", "-A"]);
  execFileSync("git", ["-C", worktree, "commit", "-qm", "add f"]);
  const commits = json(fx.grove(["--json", "commits", "work"]).stdout).detail.trees[0];
  assert.equal(commits.commits.length, 1);
  const files = json(fx.grove(["--json", "against-trunk", "work"]).stdout).detail.trees[0];
  assert.equal(files.files.length, 1);
});

test("FILE-03: removed diff surface refuses without touching the Tree", () => {
  const { fx, worktree } = withGrove();
  execFileSync("git", ["-C", worktree, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", worktree, "config", "user.name", "t"]);
  writeFileSync(join(worktree, "README.md"), "# changed\n");
  const d = fx.grove(["diff", "work", "work@alpha", "README.md"]);
  assert.equal(d.status, 2);
  assert.match(d.stderr, /Unknown command/);
  const gitDiff = execFileSync("git", ["-C", worktree, "diff", "--", "README.md"], { encoding: "utf8" });
  // ASSERT:FILE-03:EXITS-2-UNKNOWN-COMMAND-NO-COMPATIBILITY-ALIAS-REPLACEMENT
  assert.deepEqual(
    {
      status: d.status,
      unknownCommand: /Unknown command/.test(d.stderr),
      treeContent: readFileSync(join(worktree, "README.md"), "utf8"),
      nativeGitShowsChange: gitDiff.includes("+# changed"),
    },
    { status: 2, unknownCommand: true, treeContent: "# changed\n", nativeGitShowsChange: true },
  );
});

test("FILE-01: file ls and read refuse parent, absolute, and normalized scope escapes", () => {
  const { fx, worktree } = withGrove();
  const ls = fx.grove(["--json", "file", "ls", "--grove", "work", "--tree", "work@alpha"]);
  assert.equal(ls.status, 0, ls.stderr);
  assert.ok(json(ls.stdout).detail.entries.some((e: { name: string }) => e.name === "README.md"));
  const outside = join(worktree, "..", "outside-secret.txt");
  writeFileSync(outside, "must not escape\n");
  mkdirSync(join(worktree, "nested"));
  for (const target of ["../outside-secret.txt", outside, "nested/../../outside-secret.txt"]) {
    const refused = fx.grove(["--json", "file", "read", target, "--grove", "work", "--tree", "work@alpha"]);
    // ASSERT:FILE-01:REFUSES-NOTHING-OUTSIDE-SCOPE-OPENED
    assert.deepEqual(
      { status: refused.status, leakedOutsideContent: /must not escape/.test(refused.stdout) },
      { status: 2, leakedOutsideContent: false },
      target,
    );
  }
});

test("a missing Tree selector is refused (no silent fallback)", () => {
  const { fx } = withGrove();
  // Force a bogus default base via the manifest is internal; instead assert the happy path base
  // resolves, and that comparing against a nonexistent tree filter refuses.
  const r = fx.grove(["commits", "work", "--tree", "nonexistent"]);
  assert.equal(r.status, 2);
});

test("FILE-02: file read and file ls refuse symlinks escaping the selected Tree", () => {
  const { fx, worktree } = withGrove();
  const outside = join(fx.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "outside\n");
  symlinkSync(join(outside, "secret.txt"), join(worktree, "escaped-file"));
  symlinkSync(outside, join(worktree, "escaped-dir"));
  for (const args of [["file", "read", "escaped-file"], ["file", "ls", "escaped-dir"]]) {
    const result = fx.grove(["--json", ...args, "--grove", "work", "--tree", "work@alpha"]);
    assert.equal(result.status, 2, result.stdout);
    // ASSERT:FILE-02:READ-LIST-REFUSES-AFTER-REAL-PATH-RESOLUTION
    assert.match(json(result.stdout).error.why, /outside/);
  }
});

test("FILE-05: file read returns text but gives bounded typed refusals for binary and oversized files", () => {
  const { fx, worktree } = withGrove();
  writeFileSync(join(worktree, "bin.dat"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  const binary = fx.grove(["--json", "file", "read", "bin.dat", "--grove", "work", "--tree", "work@alpha"]);
  assert.equal(binary.status, 2, binary.stdout);
  assert.match(json(binary.stdout).error.why, /binary/);
  writeFileSync(join(worktree, "big.txt"), "x".repeat(5 * 1024 * 1024));
  const oversized = fx.grove(["--json", "file", "read", "big.txt", "--grove", "work", "--tree", "work@alpha"]);
  writeFileSync(join(worktree, "ok.txt"), "héllo\n");
  const text = fx.grove(["--json", "file", "read", "ok.txt", "--grove", "work", "--tree", "work@alpha"]);
  // ASSERT:FILE-05:BOUNDED-TYPED-REFUSAL-RATHER-THAN-RAW-DUMP
  assert.deepEqual(
    { binaryStatus: binary.status, binaryReason: /binary/.test(String(json(binary.stdout).error.why)), oversizedStatus: oversized.status, oversizedBounded: oversized.stdout.length < 10_000, textContent: json(text.stdout).detail.content },
    { binaryStatus: 2, binaryReason: true, oversizedStatus: 5, oversizedBounded: true, textContent: "héllo\n" },
  );
});

test("FILE-04/FILE-06: aggregate review reports every exact repository target including a per-target missing base", () => {
  const fx = makeFixture({ repos: { alpha: ["alpha-only"], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repository of fx.repos) assert.equal(fx.grove(["repo", "add", repository.origin, "--name", repository.name]).status, 0);
  execFileSync("git", ["branch", "alpha-only", "origin/alpha-only"], { cwd: join(fx.root, "repos", "alpha") });
  assert.equal(fx.grove(["new", "review", "--repo", "alpha", "--repo", "beta", "--branch", "alpha=feature/a", "--branch", "beta=feature/b", "--from", "alpha=main", "--from", "beta=main"]).status, 0);
  assert.equal(fx.grove(["configure", "review", "--default-base", "alpha-only"]).status, 0);
  const result = fx.grove(["--json", "commits", "review"]);
  assert.equal(result.status, 6, `${result.stderr}\n${result.stdout}`);
  assert.equal(json(result.stdout).outcome, "partial");
  const rows = json(result.stdout).detail.trees;
  assert.equal(rows.length, 2);
  // ASSERT:FILE-04:OUTPUT-ATTRIBUTES-EVERY-ENTRY-CORRECT-TREE-REPOSITORY-EXACT
  assert.deepEqual(rows.map((row: any) => row.repository).sort(), ["alpha", "beta"]);
  // ASSERT:FILE-06:TREE-REFUSES-ERROR-NAMING-BRANCH-REPOSITORY-OTHER-TREES
  assert.deepEqual(
    {
      otherTreeProblem: rows.find((row: any) => row.repository === "alpha").problem,
      refusedRepository: rows.find((row: any) => row.repository === "beta").repository,
      refusedProblemNamesBranch: /alpha-only/.test(String(rows.find((row: any) => row.repository === "beta").problem)),
      refusedProblemNamesRepository: /beta/.test(String(rows.find((row: any) => row.repository === "beta").problem)),
    },
    { otherTreeProblem: null, refusedRepository: "beta", refusedProblemNamesBranch: true, refusedProblemNamesRepository: true },
  );
});

/**
 * Issue #11 / feature 009. A resumable `repo-add` retains its exact remote in
 * `.grove/operations/<id>.json` so `reconcile` can resume; every Grove result redacts it. The file
 * surface reached `.grove/` at workspace scope and printed it verbatim.
 */
async function withPendingRepoAdd() {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const record = await interruptRepoAdd(fx, "alpha", fx.repos[0]!.origin);
  return { fx, remote: fx.repos[0]!.origin, record };
}

async function interruptRepoAdd(fx: ReturnType<typeof makeFixture>, name: string, remote: string): Promise<string> {
  // A failed acquisition becomes `conflicted` and is scrubbed at once; only an interrupted one stays
  // resumable with its remote retained. Block the fetch, then kill the process mid-acquisition.
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  const command = spawnFaultProcess(process.execPath, [CLI, "repo", "add", remote, "--name", name], { cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env } });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  return readdirSync(join(fx.root, ".grove", "operations"))
    .filter((record) => record.endsWith(".json"))
    .find((record) => JSON.parse(readFileSync(join(fx.root, ".grove", "operations", record), "utf8")).scope.repositoryAlias === name)!;
}

test("V3SEC-04: file read and file ls refuse every route into .grove and never print the retained remote", async () => {
  const { fx, remote, record } = await withPendingRepoAdd();
  // Not vacuous: the record on disk does retain the remote the surface must not reveal.
  assert.ok(readFileSync(join(fx.root, ".grove", "operations", record), "utf8").includes(remote), "fixture record retains no remote");
  symlinkSync(join(fx.root, ".grove"), join(fx.root, "state-link"));
  const caseInsensitive = existsSync(join(fx.root, ".GROVE"));
  const routes: string[][] = [
    ["file", "read", `.grove/operations/${record}`],
    ["file", "read", `./.grove/operations/${record}`],
    ["file", "read", `groves/../.grove/operations/${record}`],
    ["file", "read", `state-link/operations/${record}`],
    ["file", "read", ".grove/nope.json"],
    ["file", "ls", ".grove"],
    ["file", "ls", "state-link/operations"],
    ...(caseInsensitive ? [["file", "read", `.GROVE/operations/${record}`]] : []),
  ];
  for (const route of routes) {
    const machine = fx.grove(["--json", ...route]);
    const human = fx.grove(route);
    assert.deepEqual(
      {
        machineStatus: machine.status,
        kind: machine.status === 2 ? json(machine.stdout).error.kind : null,
        namesState: machine.status === 2 ? /internal state/.test(json(machine.stdout).error.why) : false,
        humanStatus: human.status,
        leaked: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((out) => out.includes(remote)),
      },
      { machineStatus: 2, kind: "invalid-input", namesState: true, humanStatus: 2, leaked: false },
      route.join(" "),
    );
  }
});

test("V3SEC-04: a workspace-root listing omits .grove and keeps every other entry", async () => {
  const { fx } = await withPendingRepoAdd();
  const listed = fx.grove(["--json", "file", "ls"]);
  assert.equal(listed.status, 0, listed.stderr);
  const names = json(listed.stdout).detail.entries.map((entry: { name: string }) => entry.name);
  const onDisk = readdirSync(fx.root).filter((name) => name !== ".grove").sort();
  assert.deepEqual({ hasState: names.includes(".grove"), rest: [...names].sort() }, { hasState: false, rest: onDisk });
});

test("V3SEC-04: other paths named .grove and Tree-scoped reads are unaffected", () => {
  const { fx, worktree } = withGrove();
  mkdirSync(join(fx.root, "notes", ".grove"), { recursive: true });
  writeFileSync(join(fx.root, "notes", ".grove", "x.txt"), "workspace note\n");
  mkdirSync(join(worktree, ".grove"));
  writeFileSync(join(worktree, ".grove", "y.txt"), "tree content\n");
  const note = fx.grove(["--json", "file", "read", "notes/.grove/x.txt"]);
  const treeState = fx.grove(["--json", "file", "read", ".grove/y.txt", "--grove", "work", "--tree", "work@alpha"]);
  const readme = fx.grove(["--json", "file", "read", "README.md", "--grove", "work", "--tree", "work@alpha"]);
  assert.deepEqual(
    { note: note.status, treeState: treeState.status, readme: readme.status },
    { note: 0, treeState: 0, readme: 0 },
    `${note.stdout}${treeState.stdout}${readme.stdout}`,
  );
});

/**
 * V3SEC-06 / feature 009. Git keeps a remote URL verbatim in a repository's own config, so a token
 * added by hand with `git remote set-url` lands in `repos/<repo>/config`. The file surface must not
 * reach any repository Git directory Grove knows, however the path is spelled.
 */
const TOKEN = "ghp-TOKEN-7f3a91";
const credentialed = (repo: string) => `https://alice-4c2:${TOKEN}@127.0.0.1:1/${repo}.git`;

function assertRefusedAsGitDirectory(fx: ReturnType<typeof makeFixture>, routes: string[][]): void {
  for (const route of routes) {
    const machine = fx.grove(["--json", ...route]);
    const human = fx.grove(route);
    assert.deepEqual(
      {
        machineStatus: machine.status,
        kind: machine.status === 2 ? json(machine.stdout).error.kind : null,
        namesGitDirectory: machine.status === 2 ? /Git directory/.test(json(machine.stdout).error.why) : false,
        humanStatus: human.status,
        leaked: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((out) => out.includes(TOKEN)),
      },
      { machineStatus: 2, kind: "invalid-input", namesGitDirectory: true, humanStatus: 2, leaked: false },
      route.join(" "),
    );
  }
}

test("V3SEC-06: file read and file ls refuse every route into a managed repository store and never print its remote", () => {
  const { fx } = withGrove();
  execFileSync("git", ["-C", join(fx.root, "repos", "alpha"), "remote", "set-url", "origin", credentialed("alpha")]);
  // Not vacuous: the store's config does carry the token the surface must not reveal.
  assert.ok(readFileSync(join(fx.root, "repos", "alpha", "config"), "utf8").includes(TOKEN), "fixture store carries no token");
  symlinkSync(join(fx.root, "repos", "alpha"), join(fx.root, "store-link"));
  const caseInsensitive = existsSync(join(fx.root, "REPOS"));
  assertRefusedAsGitDirectory(fx, [
    ["file", "read", "repos/alpha/config"],
    ["file", "read", "./repos/alpha/config"],
    ["file", "read", "groves/../repos/alpha/config"],
    ["file", "read", "store-link/config"],
    ["file", "read", "repos/alpha"],
    ["file", "read", "repos/alpha/nope"],
    ["file", "ls", "repos/alpha"],
    ["file", "ls", "repos/alpha/refs"],
    ["file", "ls", "store-link"],
    ...(caseInsensitive ? [["file", "read", "REPOS/ALPHA/config"]] : []),
  ]);
});

test("V3SEC-06: listings omit repository stores while trunks, Trees, and their code stay readable", () => {
  const { fx } = withGrove();
  const names = (args: string[]) => json(fx.grove(["--json", "file", "ls", ...args]).stdout).detail.entries.map((entry: { name: string }) => entry.name);
  const trunkRead = fx.grove(["--json", "file", "read", "trunks/main@alpha/README.md"]);
  const treeRead = fx.grove(["--json", "file", "read", "README.md", "--grove", "work", "--tree", "work@alpha"]);
  assert.deepEqual(
    {
      storeOnDisk: existsSync(join(fx.root, "repos", "alpha")),
      repos: names(["repos"]),
      root: names([]).filter((name: string) => ["groves", "repos", "trunks"].includes(name)),
      trunks: names(["trunks"]),
      trunkRead: trunkRead.status === 0 ? json(trunkRead.stdout).detail.content : trunkRead.stdout,
      treeRead: treeRead.status === 0 ? json(treeRead.stdout).detail.content : treeRead.stdout,
    },
    { storeOnDisk: true, repos: [], root: ["groves", "repos", "trunks"], trunks: ["main@alpha"], trunkRead: "# alpha\n", treeRead: "# alpha\n" },
  );
});

test("V3SEC-06: the store guard follows a custom layout.repositories template and an in-workspace linked repository", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["config", "set", "--values", JSON.stringify({ layout: { repositories: "vault/{repo}/.bare" } })]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  execFileSync("git", ["-C", join(fx.root, "vault", "alpha", ".bare"), "remote", "set-url", "origin", credentialed("alpha")]);
  // `repo link` accepts a repository whose remote embeds credentials: Grove never writes, stores, or
  // prints a linked remote's URL, and this guard keeps its Git directory off the file surface.
  const vendor = join(fx.root, "vendor", "beta");
  execFileSync("git", ["clone", "-q", fx.repos[1]!.origin, vendor]);
  execFileSync("git", ["-C", vendor, "remote", "set-url", "origin", credentialed("beta")]);
  const linked = fx.grove(["--json", "repo", "link", vendor, "--name", "beta"]);
  assert.deepEqual({ status: linked.status, leaked: `${linked.stdout}${linked.stderr}`.includes(TOKEN) }, { status: 0, leaked: false }, linked.stderr);
  assertRefusedAsGitDirectory(fx, [
    ["file", "read", "vault/alpha/.bare/config"],
    ["file", "ls", "vault/alpha/.bare"],
    ["file", "read", "vendor/beta/.git/config"],
    ["file", "ls", "vendor/beta/.git"],
  ]);
  const entries = (path: string) => json(fx.grove(["--json", "file", "ls", path]).stdout).detail.entries.map((entry: { name: string }) => entry.name);
  const code = fx.grove(["--json", "file", "read", "vendor/beta/README.md"]);
  assert.deepEqual(
    { vault: entries("vault/alpha"), vendorHasGit: entries("vendor/beta").includes(".git"), code: code.status === 0 ? json(code.stdout).detail.content : code.stdout },
    { vault: [], vendorHasGit: false, code: "# beta\n" },
  );
});

test("V3SEC-06: the store guard covers the anchor of an unfinished repo add", async () => {
  const { fx } = await withPendingRepoAdd();
  const anchor = join(fx.root, "repos", "alpha");
  // Unregistered, so only the operation record says Grove created it.
  assert.equal(JSON.parse(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.length, 0);
  execFileSync("git", ["-C", anchor, "remote", "set-url", "origin", credentialed("alpha")]);
  assertRefusedAsGitDirectory(fx, [["file", "read", "repos/alpha/config"], ["file", "ls", "repos/alpha"]]);
  assert.deepEqual(json(fx.grove(["--json", "file", "ls", "repos"]).stdout).detail.entries, []);
});

test("V3SEC-06: a finished repo add's anchor stops being protected once the path holds something else", () => {
  // Operation records are never deleted, so protecting whatever sits at a recorded anchor would
  // hide a later, unrelated checkout at that path forever.
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["repo", "remove", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  execFileSync("git", ["-C", anchor, "worktree", "remove", join(fx.root, "trunks", "main@alpha")]);
  rmSync(anchor, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, anchor]);
  execFileSync("git", ["-C", anchor, "remote", "set-url", "origin", credentialed("alpha")]);
  assert.equal(fx.grove(["repo", "link", anchor, "--name", "alpha"]).status, 0);
  const code = fx.grove(["--json", "file", "read", "repos/alpha/README.md"]);
  const listed = fx.grove(["--json", "file", "ls", "repos"]);
  assert.deepEqual(
    {
      code: code.status === 0 ? json(code.stdout).detail.content : code.stdout,
      repos: listed.status === 0 ? json(listed.stdout).detail.entries.map((entry: { name: string }) => entry.name) : listed.stdout,
    },
    { code: "# alpha\n", repos: ["alpha"] },
  );
  // The new checkout's own Git directory is a linked repository's, and stays off the surface.
  assertRefusedAsGitDirectory(fx, [["file", "read", "repos/alpha/.git/config"]]);
});

test("V3SEC-06: the store guard covers an unregistered repository observed through a Tree", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["new", "g"]).status, 0);
  const store = join(fx.root, "other", "x.git");
  execFileSync("git", ["clone", "-q", "--bare", fx.repos[0]!.origin, store]);
  execFileSync("git", ["-C", store, "worktree", "add", "-q", join(fx.root, "groves", "g", "trees", "g@x"), "main"]);
  execFileSync("git", ["-C", store, "remote", "set-url", "origin", credentialed("x")]);
  // Not vacuous: Grove observes it only as an unregistered repository.
  assert.ok(json(fx.grove(["--json", "doctor"]).stdout).diagnostics.some((d: { code: string }) => d.code === "unregistered-repository"));
  assertRefusedAsGitDirectory(fx, [["file", "read", "other/x.git/config"], ["file", "ls", "other/x.git"]]);
});

test("V3SEC-06: a corrupt repo-add record still protects the anchor it names (fail closed)", async () => {
  const { fx, record } = await withPendingRepoAdd();
  const file = join(fx.root, ".grove", "operations", record);
  const raw = readFileSync(file, "utf8");
  writeFileSync(file, raw.slice(0, raw.indexOf('"initial-trunk"')));
  execFileSync("git", ["-C", join(fx.root, "repos", "alpha"), "remote", "set-url", "origin", credentialed("alpha")]);
  assertRefusedAsGitDirectory(fx, [["file", "read", "repos/alpha/config"]]);
});

test("V3SEC-06: a recorded store stays protected when its HEAD is a dangling symlink Git still accepts", () => {
  // `core.preferSymlinkRefs` makes HEAD a symlink into refs/, and `pack-refs --all` (which gc runs)
  // removes the loose ref it points at. Git still opens the directory; a HEAD test that follows the
  // symlink did not, and the store stopped being protected.
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["repo", "remove", "alpha"]).status, 0);
  const store = join(fx.root, "repos", "alpha");
  execFileSync("git", ["-C", store, "remote", "set-url", "origin", credentialed("alpha")]);
  execFileSync("git", ["-C", store, "-c", "core.preferSymlinkRefs=true", "symbolic-ref", "HEAD", "refs/heads/main"]);
  execFileSync("git", ["-C", store, "pack-refs", "--all"]);
  // Not vacuous: HEAD is a dangling symlink, and Git still accepts the directory.
  assert.deepEqual(
    { symlink: lstatSync(join(store, "HEAD")).isSymbolicLink(), dangling: !existsSync(join(store, "HEAD")), gitDir: execFileSync("git", ["-C", store, "rev-parse", "--git-dir"], { encoding: "utf8" }).trim() },
    { symlink: true, dangling: true, gitDir: "." },
  );
  assertRefusedAsGitDirectory(fx, [["file", "read", "repos/alpha/config"], ["file", "ls", "repos/alpha"]]);
});

test("V3SEC-05: reconcile re-checks the destination before resuming an interrupted repo add's fetch", async () => {
  // The add was checked when it ran; a rewrite rule added before the resume was not.
  const { fx, record } = await withPendingRepoAdd();
  const secret = "RECONPW-7a40";
  const gitconfig = join(fx.home, "later.gitconfig");
  writeFileSync(gitconfig, `[url "http://u:${secret}@127.0.0.1:1/r/"]\n\tinsteadOf = ${dirname(fx.repos[0]!.origin)}/\n`);
  const recorder = createGitArgvRecorder();
  try {
    const resumed = fx.grove(["--json", "reconcile"], { env: { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1", ...recorder.env } });
    const persisted = JSON.parse(readFileSync(join(fx.root, ".grove", "operations", record), "utf8"));
    assert.deepEqual(
      {
        reason: resumed.stdout ? json(resumed.stdout).targets?.[0]?.reason ?? `error:${json(resumed.stdout).error?.kind}` : null,
        stepReason: persisted.steps.find((step: { id: string }) => step.id === "fetch")?.error?.reason,
        network: recorder.argv().some((argv) => argv.includes("fetch") || (argv.includes("ls-remote") && !argv.includes("--get-url"))),
        echoed: `${resumed.stdout}${resumed.stderr}`.includes(secret),
      },
      { reason: "refused-policy", stepReason: "refused-policy", network: false, echoed: false },
      resumed.stdout + resumed.stderr,
    );
  } finally { recorder.dispose(); }
});

test("reconcile continues after a missing repo-add store, audits, and leaves the stale record abandonable", async () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  const first = await interruptRepoAdd(fx, "alpha", fx.repos[0]!.origin);
  const second = await interruptRepoAdd(fx, "beta", fx.repos[1]!.origin);
  rmSync(join(fx.root, "repos", "alpha"), { recursive: true, force: true });

  const reconciled = fx.grove(["--json", "reconcile"]);
  const result = reconciled.stdout ? json(reconciled.stdout) : null;
  const byId = new Map<string, { id: string; state: string; problem: string | null }>(
    (result?.detail?.resumed ?? []).map((entry: { id: string; state: string; problem: string | null }) => [entry.id, entry]),
  );
  const abandoned = fx.grove(["--json", "reconcile", "--abandon", first.replace(/\.json$/, "")]);
  const firstRecord = JSON.parse(readFileSync(join(fx.root, ".grove", "operations", first), "utf8"));
  const firstTarget = result?.targets?.find((target: any) => target.before?.operationId === first.replace(/\.json$/, ""));
  assert.deepEqual(
    {
      perOperationResults: [first, second].every((record) => byId.has(record.replace(/\.json$/, ""))),
      firstProblem: byId.get(first.replace(/\.json$/, ""))?.problem,
      secondState: byId.get(second.replace(/\.json$/, ""))?.state,
      auditRan: typeof result?.detail?.observedAt === "string",
      why: firstTarget?.detail?.why,
      remedyNamesAbandon: String(firstTarget?.detail?.remedy).includes(`grove reconcile --abandon ${first.replace(/\.json$/, "")}`),
      abandonStatus: abandoned.status,
      abandonedState: firstRecord.state,
    },
    { perOperationResults: true, firstProblem: "stale-plan", secondState: "completed", auditRan: true, why: "the managed repository store is missing", remedyNamesAbandon: true, abandonStatus: 0, abandonedState: "abandoned" },
    reconciled.stdout + reconciled.stderr + abandoned.stdout + abandoned.stderr,
  );
});

test("reconcile reports every operation and audits when remote inspection fails", async () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  const first = await interruptRepoAdd(fx, "alpha", fx.repos[0]!.origin);
  const second = await interruptRepoAdd(fx, "beta", fx.repos[1]!.origin);
  const gitconfig = join(fx.home, "unreachable.gitconfig");
  writeFileSync(gitconfig, `[url "ssh://git@127.0.0.1:1/unreachable/"]\n\tinsteadOf = ${dirname(fx.repos[0]!.origin)}/\n`);
  const reconciled = fx.grove(["--json", "reconcile"], { env: { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: "false" } });
  const result = reconciled.stdout ? json(reconciled.stdout) : null;
  const ids = [first, second].map((record) => record.replace(/\.json$/, ""));
  const persisted = [first, second].map((record) => JSON.parse(readFileSync(join(fx.root, ".grove", "operations", record), "utf8")));
  assert.deepEqual(
    {
      status: reconciled.status,
      perOperationResults: ids.every((id) => result?.detail?.resumed?.some((entry: any) => entry.id === id)),
      reasons: result?.targets?.map((target: any) => target.reason),
      states: persisted.map((record) => record.state),
      stepReasons: persisted.map((record) => record.steps.find((step: any) => step.id === "fetch")?.error?.reason),
      hasWhyAndRemedy: result?.targets?.every((target: any) => typeof target.detail?.why === "string" && typeof target.detail?.remedy === "string"),
      auditRan: typeof result?.detail?.observedAt === "string",
    },
    { status: 6, perOperationResults: true, reasons: ["git-failed", "git-failed"], states: ["recoverable", "recoverable"], stepReasons: ["git-failed", "git-failed"], hasWhyAndRemedy: true, auditRan: true },
    reconciled.stdout + reconciled.stderr,
  );
});

test("reconcile reports a remote-resolution failure with why and remedy and continues", async () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  const first = await interruptRepoAdd(fx, "alpha", fx.repos[0]!.origin);
  const second = await interruptRepoAdd(fx, "beta", fx.repos[1]!.origin);
  writeFileSync(join(fx.root, "repos", "alpha", "config"), "[broken\n");
  const reconciled = fx.grove(["--json", "reconcile"]);
  const result = reconciled.stdout ? json(reconciled.stdout) : null;
  const firstId = first.replace(/\.json$/, "");
  const secondId = second.replace(/\.json$/, "");
  const firstTarget = result?.targets?.find((target: any) => target.before?.operationId === firstId);
  const firstRecord = JSON.parse(readFileSync(join(fx.root, ".grove", "operations", first), "utf8"));
  assert.deepEqual(
    {
      status: reconciled.status,
      firstReason: firstTarget?.reason,
      firstState: firstRecord.state,
      stepReason: firstRecord.steps.find((step: any) => step.id === "fetch")?.error?.reason,
      hasWhyAndRemedy: typeof firstTarget?.detail?.why === "string" && typeof firstTarget?.detail?.remedy === "string",
      secondReported: result?.detail?.resumed?.some((entry: any) => entry.id === secondId),
      auditRan: typeof result?.detail?.observedAt === "string",
    },
    { status: 6, firstReason: "git-failed", firstState: "recoverable", stepReason: "git-failed", hasWhyAndRemedy: true, secondReported: true, auditRan: true },
    reconciled.stdout + reconciled.stderr,
  );
});

test("reconcile records a fixed Git-failure explanation and reports steps completed before it failed", async () => {
  const { fx, record } = await withPendingRepoAdd();
  const path = join(fx.root, ".grove", "operations", record);
  const interrupted = JSON.parse(readFileSync(path, "utf8"));
  // Recreate a crash-before-ack boundary for two already-created artifacts. Reconcile must observe
  // and complete both steps during this run before the later native Git command fails.
  const replayed = interrupted.steps.filter((step: any) => step.kind === "repository-init-bare" || step.kind === "remote-add");
  for (const step of replayed) {
    step.classification = "recoverable-intermediate";
    delete step.postState;
  }
  interrupted.state = "recoverable";
  writeFileSync(path, `${JSON.stringify(interrupted, null, 2)}\n`);

  const fetch = interrupted.steps.find((step: any) => step.id === "fetch");
  const trunk = interrupted.steps.find((step: any) => step.id === "initial-trunk");
  const updateRef = ["update-ref", `refs/heads/${trunk.input.branch}`, fetch.input.expectedRemoteOid];
  const raw = "RAW-GIT-STDERR-TOKEN-95c1";
  const rewriter = createGitArgvRewriter(updateRef, ["-c", raw, ...updateRef]);
  try {
    const reconciled = fx.grove(["--json", "reconcile"], { env: rewriter.env });
    const result = reconciled.stdout ? json(reconciled.stdout) : null;
    const target = result?.targets?.find((candidate: any) => candidate.before?.operationId === interrupted.id);
    const persisted = JSON.parse(readFileSync(path, "utf8"));
    const stepError = persisted.steps.find((step: any) => step.id === "fetch")?.error;
    const expectedWhy = "Git exited 128 while resuming step fetch";
    assert.deepEqual(
      {
        status: reconciled.status,
        reason: target?.reason,
        resultWhy: target?.detail?.why,
        recordWhy: stepError?.detail?.why,
        completed: target?.after?.completed,
        leakedInStreams: `${reconciled.stdout}${reconciled.stderr}`.includes(raw),
        leakedInRecord: readFileSync(path, "utf8").includes(raw),
      },
      {
        status: 6,
        reason: "git-failed",
        resultWhy: expectedWhy,
        recordWhy: expectedWhy,
        completed: replayed.map((step: any) => step.id),
        leakedInStreams: false,
        leakedInRecord: false,
      },
      reconciled.stdout + reconciled.stderr,
    );
  } finally { rewriter.dispose(); }
});
