/**
 * Argv-injection witnesses for the preferred remote (V3SEC-01…V3SEC-03).
 *
 * A remote NAME is not a git ref and never passed through `check-ref-format`, so it was the one
 * persisted repository field with no grammar anywhere. `git fetch --prune <name>` parses a name
 * beginning with `-` as an OPTION, and `--upload-pack=<command>` makes git execute that command —
 * arbitrary code execution from a repository the user merely linked.
 *
 * Everything here is offline: the hostile input is a local repository whose sole remote is written
 * straight into `.git/config` (`git remote add` refuses the name, the config file does not).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitArgvRecorder } from "../testkit/git-fault.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

interface HostileInput {
  /** Non-bare repository whose ONLY remote is named so that git parses it as an option. */
  path: string;
  /** The hostile remote name, verbatim. */
  remote: string;
  /** The file `--upload-pack` would create if the name ever reached a git command line. */
  marker: string;
}

function hostileRepository(): HostileInput {
  const base = tempDir("security-argv");
  const marker = join(base, "executed");
  const origin = join(base, "origin.git");
  const path = join(base, "input");
  git(base, ["init", "-q", "--bare", "--initial-branch=main", origin]);
  git(base, ["init", "-q", "--initial-branch=main", path]);
  git(path, ["config", "user.email", "security@grove.test"]);
  git(path, ["config", "user.name", "Security Test"]);
  writeFileSync(join(path, "README.md"), "# hostile\n");
  git(path, ["add", "-A"]);
  git(path, ["commit", "-qm", "init"]);
  const remote = `--upload-pack=touch ${marker}`;
  appendFileSync(
    join(path, ".git", "config"),
    `[remote "${remote}"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/hostile/*\n`,
  );
  assert.equal(git(path, ["remote"]), remote, "fixture must present the hostile name as the sole remote");
  return { path, remote, marker };
}

const workspaceConfigPath = (fx: Fixture): string => join(fx.root, ".grove", "config.json");

test("V3SEC-01: repo link refuses an option-like remote and writes nothing", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const hostile = hostileRepository();
  const before = readFileSync(workspaceConfigPath(fx));

  const linked = fx.grove(["--json", "repo", "link", hostile.path, "--name", "hostile"]);
  assert.equal(linked.status, 2, linked.stdout || linked.stderr);
  assert.equal(existsSync(hostile.marker), false);
  assert.deepEqual(readFileSync(workspaceConfigPath(fx)), before);
  const listed = fx.grove(["--json", "repo", "ls"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).detail.repositories, []);
});

test("V3SEC-02: a hand-poisoned config is refused at load", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const added = fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  assert.equal(added.status, 0, added.stderr);
  const hostile = hostileRepository();

  const path = workspaceConfigPath(fx);
  const config = JSON.parse(readFileSync(path, "utf8")) as { repositories: Array<{ remote: string | null }> };
  config.repositories[0]!.remote = hostile.remote;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);

  const listed = fx.grove(["--json", "repo", "ls"]);
  assert.equal(listed.status, 8, listed.stdout || listed.stderr);
  const fetched = fx.grove(["--json", "repo", "fetch"]);
  assert.equal(fetched.status, 8, fetched.stdout || fetched.stderr);
  assert.equal(existsSync(hostile.marker), false);
});

test("V3SEC-03: a poisoned remote never reaches the git command line", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const hostile = hostileRepository();
  const recorder = createGitArgvRecorder();

  fx.grove(["--json", "repo", "link", hostile.path, "--name", "hostile"], { env: recorder.env });
  fx.grove(["--json", "repo", "fetch"], { env: recorder.env });

  const recorded = recorder.argv();
  assert.ok(recorded.length > 0, "the PATH proxy must have observed Grove's git invocations");
  const contaminated = recorded.filter((argv) => argv.some((value) => value.includes("--upload-pack")));
  assert.deepEqual(contaminated, []);
  assert.equal(existsSync(hostile.marker), false);
});
