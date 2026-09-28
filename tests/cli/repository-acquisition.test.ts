import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture } from "../testkit/fixture.ts";
import { createGitArgvRecorder } from "../testkit/git-fault.ts";
import { linkExecutable } from "../testkit/shim.ts";

after(cleanupTempDirs);

const json = (s: string) => JSON.parse(s.trim());

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
const snapshot = (cwd: string): { refs: string; worktrees: string } => ({
  refs: git(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)"]).split("\n").sort().join("\n"),
  worktrees: git(cwd, ["worktree", "list", "--porcelain"]).split("\n").sort().join("\n"),
});

function filesBelow(root: string): string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (lstatSync(path).isDirectory()) pending.push(path);
      else files.push(path);
    }
  }
  return files;
}

test("repo add creates a managed bare anchor and an initial peer trunk worktree", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const added = fixture.grove(["repo", "add", fixture.repos[0]!.origin, "--name", "alpha", "--trunk", "main"]);
  assert.equal(added.status, 0, added.stderr || added.stdout);

  const anchor = join(fixture.root, "repos", "alpha");
  assert.equal(git(anchor, ["rev-parse", "--is-bare-repository"]), "true");
  const records = git(anchor, ["worktree", "list", "--porcelain"]).split("\n\n");
  assert.ok(records.some((record) => record === `worktree ${anchor}\nbare`));
  assert.ok(records.some((record) => record.startsWith(`worktree ${join(fixture.root, "trunks", "main@alpha")}`) && record.includes("branch refs/heads/main")));

  const config = JSON.parse(readFileSync(join(fixture.root, ".grove", "config.json"), "utf8"));
  assert.deepEqual(config.repositories[0].location, { kind: "managed" });
  assert.equal("trunks" in config.repositories[0], false);
});

test("repo link resolves a subdirectory and does not mutate refs or worktrees", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const external = join(resolve(fixture.root, ".."), "linked-normal");
  git(resolve(fixture.root, ".."), ["clone", "-q", fixture.repos[0]!.origin, external]);
  mkdirSync(join(external, "nested"), { recursive: true });
  writeFileSync(join(external, "nested", "note.txt"), "linked\n");
  const before = snapshot(external);

  const linked = fixture.grove(["repo", "link", join(external, "nested"), "--name", "external", "--base", "main"]);
  assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  assert.deepEqual(snapshot(external), before);

  const config = JSON.parse(readFileSync(join(fixture.root, ".grove", "config.json"), "utf8"));
  assert.deepEqual(config.repositories[0].location, { kind: "linked", commonGitDir: git(external, ["rev-parse", "--path-format=absolute", "--git-common-dir"]) });
  for (const args of [["trunk", "add", "external", "develop", "--from", "main"], ["trunk", "remove", "external", "main"], ["trunk", "sync", "external"]]) {
    const state = snapshot(external);
    const result = fixture.grove(args);
    assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly succeeded`);
    assert.match(result.stderr + result.stdout, /linked|trunk management|advisory/i);
    assert.deepEqual(snapshot(external), state, `${args.join(" ")} mutated linked Git state`);
  }
});

test("repo add supports a non-main long-running trunk and every managed trunk remains a removable peer", () => {
  const fixture = makeFixture({ repos: { alpha: ["develop", "release/2026"] } });
  assert.equal(fixture.grove(["init"]).status, 0);
  const added = fixture.grove(["--json", "repo", "add", fixture.repos[0]!.origin, "--name", "alpha", "--trunk", "develop"]);
  assert.equal(added.status, 0, `${added.stderr}\n${added.stdout}`);
  const anchor = join(fixture.root, "repos", "alpha");
  const initial = JSON.parse(added.stdout).targets[0].after.trunkPath as string;
  assert.equal(git(initial, ["branch", "--show-current"]), "develop");
  assert.equal(fixture.grove(["trunk", "add", "alpha", "release/2026"]).status, 0);
  const beforeRefs = git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"]);
  assert.equal(fixture.grove(["trunk", "remove", "alpha", "develop"]).status, 0);
  assert.equal(existsSync(initial), false);
  assert.equal(git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"]), beforeRefs, "peer-trunk removal retains every branch ref");
});

test("repo add supports an explicit unborn trunk for an empty remote", () => {
  const fixture = makeFixture({ repos: {} });
  const empty = join(resolve(fixture.root, ".."), "empty.git");
  git(resolve(fixture.root, ".."), ["init", "-q", "--bare", "--initial-branch=main", empty]);
  assert.equal(fixture.grove(["init"]).status, 0);
  const withoutTrunk = fixture.grove(["repo", "add", empty, "--name", "ambiguous"]);
  assert.notEqual(withoutTrunk.status, 0);
  const added = fixture.grove(["--json", "repo", "add", empty, "--name", "empty", "--trunk", "main"]);
  assert.equal(added.status, 0, `${added.stderr}\n${added.stdout}`);
  const trunk = JSON.parse(added.stdout).targets[0].after.trunkPath as string;
  assert.equal(git(trunk, ["symbolic-ref", "--short", "HEAD"]), "main");
  assert.equal(existsSync(join(fixture.root, "repos", "empty", "refs", "heads", "main")), false);
});

test("repo link accepts linked-worktree and bare inputs without changing their native snapshots", () => {
  for (const inputKind of ["linked-worktree", "bare"] as const) {
    const fixture = makeFixture();
    assert.equal(fixture.grove(["init"]).status, 0);
    let input: string;
    let common: string;
    if (inputKind === "bare") {
      input = fixture.repos[0]!.origin;
      common = input;
    } else {
      const checkout = join(resolve(fixture.root, ".."), "external");
      const worktree = join(resolve(fixture.root, ".."), "external-side");
      git(resolve(fixture.root, ".."), ["clone", "-q", fixture.repos[0]!.origin, checkout]);
      git(checkout, ["branch", "side", "main"]);
      git(checkout, ["worktree", "add", "-q", worktree, "side"]);
      input = worktree;
      common = git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    }
    const before = snapshot(common);
    const linked = fixture.grove(["repo", "link", input, "--name", inputKind, "--base", "main"]);
    assert.equal(linked.status, 0, `${inputKind}: ${linked.stderr}\n${linked.stdout}`);
    assert.deepEqual(snapshot(common), before, `${inputKind} registration changed Git`);
    const configured = JSON.parse(readFileSync(join(fixture.root, ".grove", "config.json"), "utf8")).repositories[0];
    assert.deepEqual(configured.location, { kind: "linked", commonGitDir: common });
  }
});

test("linked repositories support Trees while trunk operations and advisory configuration remain zero-mutation", () => {
  const fixture = makeFixture();
  const checkout = join(resolve(fixture.root, ".."), "linked-tree-source");
  git(resolve(fixture.root, ".."), ["clone", "-q", fixture.repos[0]!.origin, checkout]);
  git(checkout, ["remote", "add", "upstream", fixture.repos[0]!.origin]);
  assert.equal(fixture.grove(["init"]).status, 0);
  assert.equal(fixture.grove(["repo", "link", checkout, "--name", "external", "--base", "main"]).status, 0);
  const common = git(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const beforePolicy = snapshot(common);
  const configured = fixture.grove(["repo", "configure", "external", "--remote", "upstream", "--base", "develop"]);
  assert.equal(configured.status, 0, `${configured.stderr}\n${configured.stdout}`);
  assert.deepEqual(snapshot(common), beforePolicy, "advisory configuration must not touch Git");
  const beforeTrunk = snapshot(common);
  for (const args of [["trunk", "add", "external", "release", "--from", "main"], ["trunk", "remove", "external", "main"], ["trunk", "sync", "external"]]) {
    const refused = fixture.grove(args);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr + refused.stdout, /linked|advisory/i);
    assert.deepEqual(snapshot(common), beforeTrunk);
  }
  const created = fixture.grove(["new", "demo", "--repo", "external", "--branch", "external=linked-demo", "--from", "external=main"]);
  assert.equal(created.status, 0, `${created.stderr}\n${created.stdout}`);
  assert.equal(existsSync(join(fixture.root, "groves", "demo", "trees", "demo@external", ".git")), true);
});

test("linked default Tree creation resolves its advisory trunk local-first, then configured remote-only, and refuses missing", () => {
  const fixture = makeFixture({ repos: { alpha: ["develop"] } });
  const checkout = join(resolve(fixture.root, ".."), "linked-advisory-source");
  git(resolve(fixture.root, ".."), ["clone", "-q", fixture.repos[0]!.origin, checkout]);
  assert.equal(fixture.grove(["init"]).status, 0);
  assert.throws(() => git(checkout, ["show-ref", "--verify", "--quiet", "refs/heads/develop"]));
  const remoteOid = git(checkout, ["rev-parse", "refs/remotes/origin/develop"]);
  assert.equal(fixture.grove(["repo", "link", checkout, "--name", "external", "--base", "develop"]).status, 0);

  const created = fixture.grove(["--json", "new", "remote-base", "--repo", "external"]);
  assert.equal(created.status, 0, `${created.stderr}\n${created.stdout}`);
  const target = JSON.parse(created.stdout).targets[0];
  assert.equal(target.after.headOid, remoteOid);
  assert.equal(git(checkout, ["rev-parse", "refs/heads/remote-base"]), remoteOid);
  assert.throws(() => git(checkout, ["show-ref", "--verify", "refs/heads/develop"]));
  assert.equal(existsSync(join(fixture.root, "trunks", "develop@external")), false);

  git(checkout, ["switch", "-q", "-c", "priority", "main"]);
  git(checkout, ["commit", "--allow-empty", "-qm", "local priority"]);
  const localOid = git(checkout, ["rev-parse", "refs/heads/priority"]);
  git(checkout, ["update-ref", "refs/remotes/origin/priority", remoteOid]);
  git(checkout, ["switch", "-q", "main"]);
  assert.equal(fixture.grove(["repo", "configure", "external", "--base", "priority"]).status, 0);
  const local = fixture.grove(["--json", "new", "local-base", "--repo", "external"]);
  assert.equal(local.status, 0, `${local.stderr}\n${local.stdout}`);
  assert.equal(JSON.parse(local.stdout).targets[0].after.headOid, localOid, "the local advisory ref wins over a different remote-tracking ref");

  const configured = fixture.grove(["repo", "configure", "external", "--base", "absent"]);
  assert.equal(configured.status, 0, `${configured.stderr}\n${configured.stdout}`);
  const missing = fixture.grove(["--json", "new", "missing-base", "--repo", "external"]);
  assert.equal(missing.status, 5, `${missing.stderr}\n${missing.stdout}`);
  const error = JSON.parse(missing.stdout).error;
  assert.equal(error.detail.reason, "missing-revision");
});

test("duplicate canonical registrations and symlinked layout roots refuse before Git mutation", () => {
  const duplicate = makeFixture();
  const checkout = join(resolve(duplicate.root, ".."), "duplicate-source");
  git(resolve(duplicate.root, ".."), ["clone", "-q", duplicate.repos[0]!.origin, checkout]);
  assert.equal(duplicate.grove(["init"]).status, 0);
  assert.equal(duplicate.grove(["repo", "link", checkout, "--name", "first", "--base", "main"]).status, 0);
  const configPath = join(duplicate.root, ".grove", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.repositories.push({ ...config.repositories[0], id: "repo-duplicate", name: "second" });
  config._rev += 1;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const before = snapshot(checkout);
  const refusedDuplicate = duplicate.grove(["new", "ambiguous", "--repo", "first", "--from", "first=main"]);
  assert.notEqual(refusedDuplicate.status, 0);
  assert.match(refusedDuplicate.stderr + refusedDuplicate.stdout, /duplicate|healthy repository/i);
  assert.deepEqual(snapshot(checkout), before);

  const escaped = makeFixture();
  assert.equal(escaped.grove(["init"]).status, 0);
  assert.equal(escaped.grove(["repo", "add", escaped.repos[0]!.origin, "--name", "alpha", "--trunk", "main"]).status, 0);
  const escapedConfigPath = join(escaped.root, ".grove", "config.json");
  const escapedConfig = JSON.parse(readFileSync(escapedConfigPath, "utf8"));
  escapedConfig.layout.trunks = "escaped/{trunk}";
  escapedConfig._rev += 1;
  writeFileSync(escapedConfigPath, `${JSON.stringify(escapedConfig, null, 2)}\n`);
  const outside = join(resolve(escaped.root, ".."), "outside-layout");
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(escaped.root, "escaped"));
  const anchor = join(escaped.root, "repos", "alpha");
  const refsBefore = snapshot(anchor);
  const refusedEscape = escaped.grove(["trunk", "add", "alpha", "escape", "--from", "main"]);
  assert.notEqual(refusedEscape.status, 0);
  assert.match(refusedEscape.stderr + refusedEscape.stdout, /outside|expanded layout target|scope/i);
  assert.deepEqual(snapshot(anchor), refsBefore);
  assert.equal(existsSync(join(outside, "escape@alpha")), false);

  const contained = makeFixture({ repos: { alpha: ["contained"] } });
  assert.equal(contained.grove(["init"]).status, 0);
  assert.equal(contained.grove(["repo", "add", contained.repos[0]!.origin, "--name", "alpha", "--trunk", "main"]).status, 0);
  const containedConfigPath = join(contained.root, ".grove", "config.json");
  const containedConfig = JSON.parse(readFileSync(containedConfigPath, "utf8"));
  containedConfig.layout.trunks = "linked-trunks/{trunk}";
  containedConfig._rev += 1;
  writeFileSync(containedConfigPath, `${JSON.stringify(containedConfig, null, 2)}\n`);
  const actual = join(contained.root, "actual-trunks");
  mkdirSync(actual, { recursive: true });
  symlinkSync(actual, join(contained.root, "linked-trunks"));
  const containedAnchor = join(contained.root, "repos", "alpha");
  const containedBefore = snapshot(containedAnchor);
  const refusedContained = contained.grove(["trunk", "add", "alpha", "contained"]);
  assert.notEqual(refusedContained.status, 0);
  assert.match(refusedContained.stderr + refusedContained.stdout, /canonical|symlink|path identity/i);
  assert.deepEqual(snapshot(containedAnchor), containedBefore);
  assert.equal(existsSync(join(actual, "contained@alpha")), false);
});

test("creation verifies checkout cleanliness and failed remote diagnostics redact credentials", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const hooks = join(resolve(fixture.root, ".."), "audit-hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-checkout");
  linkExecutable(hook, "#!/bin/sh\nprintf 'hook dirtied checkout\\n' >> README.md\n");
  const globalConfig = join(resolve(fixture.root, ".."), "audit-gitconfig");
  writeFileSync(globalConfig, `[core]\n\thooksPath = ${hooks}\n`);
  const dirty = fixture.grove(["--json", "repo", "add", fixture.repos[0]!.origin, "--name", "dirty", "--trunk", "main"], { env: { GIT_CONFIG_GLOBAL: globalConfig } });
  assert.notEqual(dirty.status, 0, `${dirty.stderr}\n${dirty.stdout}`);
  assert.equal(JSON.parse(dirty.stdout).outcome, "partial");
  assert.equal(JSON.parse(readFileSync(join(fixture.root, ".grove", "config.json"), "utf8")).repositories.length, 0);

  // Userinfo is refused before Git runs (V3SEC-05); a query or fragment still reaches the failed
  // preflight, so that path must redact it.
  const secret = "https://127.0.0.1:1/repo.git?token=abc#frag";
  const refused = fixture.grove(["--json", "repo", "add", secret, "--name", "secret"]);
  assert.notEqual(refused.status, 0);
  assert.doesNotMatch(refused.stdout + refused.stderr, /token=abc|frag/);
});

test("V3SEC-05: repo add refuses a remote URL that embeds credentials, before any side effect, without echoing them", () => {
  // Git stores a remote URL verbatim in the managed repository's config, where no redaction
  // reaches, so a token in the URL would outlive every redacted Grove result.
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const configBefore = readFileSync(join(fixture.root, ".grove", "config.json"));
  const operations = join(fixture.root, ".grove", "operations");
  const operationsBefore = existsSync(operations) ? readdirSync(operations).sort() : [];
  const token = "ghp-TOKEN-7f3a91";
  const user = "alice-user-4c2";
  const remotes = [
    `https://${user}:${token}@127.0.0.1:1/ledger.git`,
    `https://${token}@127.0.0.1:1/ledger.git`,
    `HTTP://${user}:${token}@127.0.0.1:1/ledger.git`,
    `https::https://${token}@127.0.0.1:1/ledger.git`,
    `ftp://${user}:${token}@127.0.0.1:1/ledger.git`,
    `git://${token}@127.0.0.1:1/ledger.git`,
    `ssh://git:${token}@127.0.0.1:1/ledger.git`,
    `http:///${token}:pw@127.0.0.1:1/ledger.git`,
    `https:///${token}@127.0.0.1:1/ledger.git`,
    `http://${token}:pw\\@127.0.0.1:1/ledger.git`,
    `http::${token}@127.0.0.1:1/ledger.git/a://../..`,
    `http::${token}@127.0.0.1:1/ledger.git?u=http://y`,
    `ssh://git:${token}?@127.0.0.1/ledger.git`,
    `ssh://git:${token}#@127.0.0.1/ledger.git`,
    `ssh://git:${token}%40127.0.0.1/ledger.git`,
    `ssh://git%3A${token}%40127.0.0.1/ledger.git`,
    `ssh://[git:${token}/@127.0.0.1]/ledger.git`,
    `ssh://%5Bgit:${token}/@127.0.0.1%5D/ledger.git`,
    `[git:${token}/@127.0.0.1]:/ledger.git`,
    `[git:${token}@127.0.0.1]:/ledger.git`,
    `ssh://[x]@[git:${token}/@127.0.0.1]/ledger.git`,
  ];
  const recorder = createGitArgvRecorder();
  try {
    for (const remote of remotes) {
      const machine = fixture.grove(["--json", "repo", "add", remote, "--name", "ledger"], { env: recorder.env });
      const human = fixture.grove(["repo", "add", remote, "--name", "ledger"], { env: recorder.env });
      const error = machine.status === 2 ? json(machine.stdout).error : null;
      assert.deepEqual(
        {
          machineStatus: machine.status,
          humanStatus: human.status,
          kind: error?.kind ?? null,
          namesCredentials: /credentials/.test(String(error?.why)),
          remedyNamesSshAndHelper: /SSH/.test(String(error?.remedy)) && /credential helper/.test(String(error?.remedy)) && /drop the user name/.test(String(error?.remedy)),
          echoed: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((out) => out.includes(token) || out.includes(user)),
        },
        { machineStatus: 2, humanStatus: 2, kind: "invalid-input", namesCredentials: true, remedyNamesSshAndHelper: true, echoed: false },
        remote.replace(token, "<token>").replace(user, "<user>"),
      );
    }
    assert.deepEqual(
      {
        gitInvocations: recorder.argv().length,
        repository: existsSync(join(fixture.root, "repos", "ledger")),
        operations: existsSync(operations) ? readdirSync(operations).sort() : [],
        configUnchanged: readFileSync(join(fixture.root, ".grove", "config.json")).equals(configBefore),
      },
      { gitInvocations: 0, repository: false, operations: operationsBefore, configUnchanged: true },
    );
  } finally { recorder.dispose(); }
});

test("V3SEC-05: SSH remotes and credential-free HTTPS remotes are not refused as credentialed", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  for (const remote of ["git@127.0.0.1:acme/ledger.git", "ssh://git@127.0.0.1:1/acme/ledger.git", "https://127.0.0.1:1/acme/ledger.git"]) {
    // Unreachable on purpose: each must get past the credential check and fail at the Git preflight.
    const result = fixture.grove(["--json", "repo", "add", remote, "--name", "ledger"], { env: { GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0" } });
    const error = result.stdout ? json(result.stdout).error ?? null : null;
    assert.equal(/credentials/.test(String(error?.why)), false, `${remote}: ${result.stdout}${result.stderr}`);
  }
});

test("V3SEC-05: url.<base>.insteadOf rewrites are checked, and an SSH user name survives only if the rewrite stays SSH", () => {
  // Git rewrites the typed URL before choosing a transport, and stores the typed URL. A rule turning
  // `web:` or `ssh://` into `http://` made credentials that looked opaque, or like an SSH login, go
  // out as HTTP Basic auth.
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const token = "ghp-TOKEN-4b8e21";
  const gitconfig = join(fixture.home, "insteadof.gitconfig");
  writeFileSync(gitconfig, `[url "http://"]\n\tinsteadOf = web:\n\tinsteadOf = ssh://\n`);
  const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  const configBefore = readFileSync(join(fixture.root, ".grove", "config.json"));
  const recorder = createGitArgvRecorder();
  try {
    for (const remote of [`web:${token}:pw@127.0.0.1:1/ledger.git`, `ssh://${token}@127.0.0.1:1/ledger.git`]) {
      const machine = fixture.grove(["--json", "repo", "add", remote, "--name", "ledger"], { env: { ...env, ...recorder.env } });
      const human = fixture.grove(["repo", "add", remote, "--name", "ledger"], { env: { ...env, ...recorder.env } });
      const error = machine.status === 2 ? json(machine.stdout).error : null;
      assert.deepEqual(
        {
          machineStatus: machine.status,
          humanStatus: human.status,
          kind: error?.kind ?? null,
          namesRewrite: /insteadOf/.test(String(error?.why)),
          // Git stores the typed URL, not the rewrite, so the why must not claim otherwise, and the
          // remedy must say what to change: the rewrite rule.
          truthful: !/verbatim/.test(String(error?.why)) && /insteadOf/.test(String(error?.remedy)),
          echoed: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((out) => out.includes(token)),
        },
        { machineStatus: 2, humanStatus: 2, kind: "invalid-input", namesRewrite: true, truthful: true, echoed: false },
        remote.replace(token, "<token>"),
      );
    }
    assert.deepEqual(
      {
        // Asking Git where the typed URL goes (`ls-remote --get-url`, local only) is the only Git call.
        onlyUrlResolution: recorder.argv().every((argv) => argv.includes("ls-remote") && argv.includes("--get-url")),
        repository: existsSync(join(fixture.root, "repos", "ledger")),
        configUnchanged: readFileSync(join(fixture.root, ".grove", "config.json")).equals(configBefore),
      },
      { onlyUrlResolution: true, repository: false, configUnchanged: true },
    );
  } finally { recorder.dispose(); }
});

test("V3SEC-05: an SSH remote is echoed verbatim in the repo add result, user name included", () => {
  // insteadOf points the SSH spelling at the local fixture origin, so the add really completes.
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const gitconfig = join(fixture.home, "ssh-alias.gitconfig");
  writeFileSync(gitconfig, `[url "${fixture.repos[0]!.origin}"]\n\tinsteadOf = ssh://git@example.test/acme/alpha.git\n`);
  const added = fixture.grove(["--json", "repo", "add", "ssh://git@example.test/acme/alpha.git", "--name", "alpha"], { env: { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(added.status, 0, added.stdout + added.stderr);
  assert.equal(json(added.stdout).detail.remote, "ssh://git@example.test/acme/alpha.git");
});

/** A stand-in for `ssh` that runs the remote command locally, so an ssh:// URL reaches a local path. */
function localSsh(dir: string): string {
  return linkExecutable(join(dir, "local-ssh"), "#!/bin/sh\nfor last; do :; done\nexec sh -c \"$last\"\n");
}

test("V3SEC-05: the store's own URL rewrite is checked before its first fetch (includeIf gitdir)", () => {
  // Git evaluates includeIf gitdir: against the repository it runs in. A rule that applies only
  // inside the store turns an ssh:// login name into HTTP credentials for the store's fetch, which
  // a check made at the workspace root never sees.
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const user = "tokenuser-3c9";
  const include = join(fixture.home, "store-only.gitconfig");
  writeFileSync(include, `[url "http://"]\n\tinsteadOf = ssh://\n`);
  const gitconfig = join(fixture.home, "global.gitconfig");
  writeFileSync(gitconfig, `[includeIf "gitdir:${realpathSync(fixture.root)}/repos/"]\n\tpath = ${include}\n`);
  const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: localSsh(fixture.home), GIT_SSH_VARIANT: "simple" };
  const recorder = createGitArgvRecorder();
  try {
    const added = fixture.grove(["--json", "repo", "add", `ssh://${user}@localhost${fixture.repos[0]!.origin}`, "--name", "alpha"], { env: { ...env, ...recorder.env } });
    const result = added.stdout ? json(added.stdout) : null;
    assert.deepEqual(
      {
        status: added.status,
        outcome: result?.outcome,
        step: result?.targets?.[0]?.action,
        reason: result?.targets?.[0]?.reason,
        namesRewrite: /insteadOf/.test(String(result?.targets?.[0]?.detail?.why)),
        namesAbandonBeforeRetry: /reconcile --abandon/.test(String(result?.targets?.[0]?.detail?.remedy)) && /before retrying/.test(String(result?.targets?.[0]?.detail?.remedy)),
        storeFetched: recorder.argv().some((argv) => argv.includes("fetch")),
        registered: JSON.parse(readFileSync(join(fixture.root, ".grove", "config.json"), "utf8")).repositories.length,
      },
      { status: 3, outcome: "partial", step: "fetch", reason: "refused-policy", namesRewrite: true, namesAbandonBeforeRetry: true, storeFetched: false, registered: 0 },
      added.stdout + added.stderr,
    );
  } finally { recorder.dispose(); }
});

test("V3SEC-05: repo fetch and sync re-check a managed remote's destination before fetching; a linked repository is exempt", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  assert.equal(fixture.grove(["repo", "add", fixture.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const linked = join(fixture.home, "linked-alpha");
  execFileSync("git", ["clone", "-q", fixture.repos[0]!.origin, linked]);
  assert.equal(fixture.grove(["repo", "link", linked, "--name", "beta"]).status, 0);
  // Added later, in the user's Git config: every fetch of the fixture origins now goes out as HTTP
  // with credentials.
  const secret = "FETCHPW-81d2";
  const gitconfig = join(fixture.home, "later.gitconfig");
  writeFileSync(gitconfig, `[url "http://u:${secret}@127.0.0.1:1/r/"]\n\tinsteadOf = ${dirname(fixture.repos[0]!.origin)}/\n`);
  const recorder = createGitArgvRecorder();
  try {
    const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1", ...recorder.env };
    const fetched = fixture.grove(["--json", "repo", "fetch"], { env });
    const synced = fixture.grove(["--json", "sync", "--trunks", "--strategy", "fetch-only"], { env });
    const reason = (out: string, alias: string) => json(out).targets.find((target: any) => target.selector.repositoryAlias === alias)?.reason;
    const fetchCommonDirs = recorder.argv().filter((argv) => argv.includes("fetch")).length;
    assert.deepEqual(
      {
        fetchStatus: fetched.status,
        managed: reason(fetched.stdout, "alpha"),
        linked: reason(fetched.stdout, "beta"),
        syncStatus: synced.status,
        syncManaged: reason(synced.stdout, "alpha"),
        // Only the linked repository's fetch ran (and failed against the unreachable rewrite).
        fetchInvocations: fetchCommonDirs,
        echoed: [fetched.stdout, fetched.stderr, synced.stdout, synced.stderr].some((out) => out.includes(secret)),
      },
      { fetchStatus: 6, managed: "refused-policy", linked: "git-failed", syncStatus: 3, syncManaged: "refused-policy", fetchInvocations: 1, echoed: false },
      fetched.stdout + synced.stdout,
    );
  } finally { recorder.dispose(); }
});

test("V3SEC-05: sync redacts a linked Tree's URL-valued branch remote from output and operation records", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const linked = join(fixture.home, "linked-alpha");
  execFileSync("git", ["clone", "-q", fixture.repos[0]!.origin, linked]);
  assert.equal(fixture.grove(["repo", "link", linked, "--name", "alpha"]).status, 0);
  assert.equal(fixture.grove(["new", "work", "--repo", "alpha", "--branch", "alpha=feat", "--from", "alpha=main"]).status, 0);
  const token = "SYNC-BRANCH-TOKEN-61ce";
  const branchRemote = `http://${token}@example.test/acme/alpha.git`;
  execFileSync("git", ["-C", linked, "config", "branch.feat.remote", branchRemote]);
  const gitconfig = join(fixture.home, "sync-branch.gitconfig");
  writeFileSync(gitconfig, `[url "${fixture.repos[0]!.origin}"]\n\tinsteadOf = ${branchRemote}\n`);
  const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  const machine = fixture.grove(["--json", "sync", "work", "--strategy", "fetch-only"], { env });
  const human = fixture.grove(["sync", "work", "--strategy", "fetch-only"], { env });
  const stateFiles = filesBelow(join(fixture.root, ".grove"));
  assert.deepEqual(
    {
      machineStatus: machine.status,
      humanStatus: human.status,
      machineRemote: json(machine.stdout).targets[0].after?.remote,
      leakedInStreams: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((text) => text.includes(token)),
      leakedOnDisk: stateFiles.some((file) => readFileSync(file).includes(token)),
    },
    { machineStatus: 0, humanStatus: 0, machineRemote: "<redacted-remote>", leakedInStreams: false, leakedOnDisk: false },
  );
});

test("V3SEC-05: sync redacts an SSH branch remote whose decoded login is credential-shaped", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const linked = join(fixture.home, "linked-ssh-remote");
  execFileSync("git", ["clone", "-q", fixture.repos[0]!.origin, linked]);
  assert.equal(fixture.grove(["repo", "link", linked, "--name", "alpha"]).status, 0);
  assert.equal(fixture.grove(["new", "work", "--repo", "alpha", "--branch", "alpha=feat", "--from", "alpha=main"]).status, 0);
  const token = "SECSYNC-SSH-4d2a";
  const branchRemote = `ssh://git:${token}%40127.0.0.1/x.git`;
  execFileSync("git", ["-C", linked, "config", "branch.feat.remote", branchRemote]);
  const gitconfig = join(fixture.home, "sync-ssh-branch.gitconfig");
  writeFileSync(gitconfig, `[url "${fixture.repos[0]!.origin}"]\n\tinsteadOf = ${branchRemote}\n`);
  const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  const machine = fixture.grove(["--json", "sync", "work", "--strategy", "fetch-only"], { env });
  const human = fixture.grove(["sync", "work", "--strategy", "fetch-only"], { env });
  const stateFiles = filesBelow(join(fixture.root, ".grove"));
  assert.deepEqual(
    {
      machineStatus: machine.status,
      humanStatus: human.status,
      machineRemote: json(machine.stdout).targets[0].after?.remote,
      leakedInStreams: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((text) => text.includes(token)),
      leakedOnDisk: stateFiles.some((file) => readFileSync(file).includes(token)),
    },
    { machineStatus: 0, humanStatus: 0, machineRemote: "<redacted-remote>", leakedInStreams: false, leakedOnDisk: false },
  );
});

test("V3SEC-05: sync redacts an SSH branch remote whose later bracket determines Git's login", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const linked = join(fixture.home, "linked-bracket-remote");
  execFileSync("git", ["clone", "-q", fixture.repos[0]!.origin, linked]);
  assert.equal(fixture.grove(["repo", "link", linked, "--name", "alpha"]).status, 0);
  assert.equal(fixture.grove(["new", "work", "--repo", "alpha", "--branch", "alpha=feat", "--from", "alpha=main"]).status, 0);
  const token = "SECSYNC-BRACKET-8b4f";
  const branchRemote = `ssh://[x]@[git:${token}/@127.0.0.1]/x.git`;
  execFileSync("git", ["-C", linked, "config", "branch.feat.remote", branchRemote]);
  const gitconfig = join(fixture.home, "sync-bracket-branch.gitconfig");
  writeFileSync(gitconfig, `[url "${fixture.repos[0]!.origin}"]\n\tinsteadOf = ${branchRemote}\n`);
  const env = { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: "1" };
  const machine = fixture.grove(["--json", "sync", "work", "--strategy", "fetch-only"], { env });
  const human = fixture.grove(["sync", "work", "--strategy", "fetch-only"], { env });
  const stateFiles = filesBelow(join(fixture.root, ".grove"));
  assert.deepEqual(
    {
      machineStatus: machine.status,
      humanStatus: human.status,
      machineRemote: json(machine.stdout).targets[0].after?.remote,
      leakedInStreams: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((text) => text.includes(token)),
      leakedOnDisk: stateFiles.some((file) => readFileSync(file).includes(token)),
    },
    { machineStatus: 0, humanStatus: 0, machineRemote: "<redacted-remote>", leakedInStreams: false, leakedOnDisk: false },
  );
});

test("V3SEC-05: sync never echoes a listed remote name that redaction would mask", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const linked = join(fixture.home, "linked-shaped-name");
  execFileSync("git", ["clone", "-q", fixture.repos[0]!.origin, linked]);
  assert.equal(fixture.grove(["repo", "link", linked, "--name", "alpha"]).status, 0);
  assert.equal(fixture.grove(["new", "work", "--repo", "alpha", "--branch", "alpha=feat", "--from", "alpha=main"]).status, 0);
  const token = "REMOTE-NAME-TOKEN-771c";
  const branchRemote = `http://${token}@example.test/x.git`;
  const config = join(linked, ".git", "config");
  writeFileSync(config, `${readFileSync(config, "utf8")}\n[remote "${branchRemote}"]\n\turl = ${fixture.repos[0]!.origin}\n`);
  execFileSync("git", ["-C", linked, "config", "branch.feat.remote", branchRemote]);
  assert.ok(execFileSync("git", ["-C", linked, "remote"], { encoding: "utf8" }).split(/\r?\n/).includes(branchRemote));
  const machine = fixture.grove(["--json", "sync", "work", "--strategy", "fetch-only"]);
  const human = fixture.grove(["sync", "work", "--strategy", "fetch-only"]);
  const stateFiles = filesBelow(join(fixture.root, ".grove"));
  assert.deepEqual(
    {
      machineStatus: machine.status,
      humanStatus: human.status,
      machineRemote: json(machine.stdout).targets[0].after?.remote,
      leakedInStreams: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((text) => text.includes(token)),
      leakedOnDisk: stateFiles.some((file) => readFileSync(file).includes(token)),
    },
    { machineStatus: 0, humanStatus: 0, machineRemote: "<redacted-remote>", leakedInStreams: false, leakedOnDisk: false },
  );
});

test("V3SEC-05: a Git configuration error that quotes a credential is not echoed", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  const secret = "CFGKEY-TOKEN-5e1";
  const env = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: secret, GIT_CONFIG_VALUE_0: "x" };
  const machine = fixture.grove(["--json", "repo", "add", "https://127.0.0.1:1/ledger.git", "--name", "ledger"], { env });
  const human = fixture.grove(["repo", "add", "https://127.0.0.1:1/ledger.git", "--name", "ledger"], { env });
  assert.deepEqual(
    { failed: machine.status !== 0 && human.status !== 0, echoed: [machine.stdout, machine.stderr, human.stdout, human.stderr].some((out) => out.includes(secret)) },
    { failed: true, echoed: false },
  );
});

test("V3SEC-05: repository inspection withholds Git errors that quote configuration credentials", () => {
  const fixture = makeFixture();
  assert.equal(fixture.grove(["init"]).status, 0);
  assert.equal(fixture.grove(["repo", "add", fixture.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const secret = "INSPECT-CFG-TOKEN-83bf";
  const env = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.http://${secret}@h/`, GIT_CONFIG_VALUE_0: "x" };
  const results = [
    fixture.grove(["--json", "repo", "fetch"], { env }),
    fixture.grove(["--json", "ls"], { env }),
  ];
  assert.deepEqual(
    {
      producedResults: results.every((result) => result.stdout.trim().startsWith("{")),
      leaked: results.some((result) => `${result.stdout}${result.stderr}`.includes(secret)),
    },
    { producedResults: true, leaked: false },
  );
});
