import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
const gitState = (cwd: string): string =>
  [git(cwd, ["for-each-ref", "--format=%(refname) %(objectname)"]), git(cwd, ["worktree", "list", "--porcelain"])].join("\n");
const config = (root: string): string => readFileSync(join(root, ".grove", "config.json"), "utf8");
const preferredTrunk = (root: string, name: string): string | null =>
  (JSON.parse(config(root)) as { repositories: { name: string; trunk: string | null }[] }).repositories.find((entry) => entry.name === name)?.trunk ?? null;

test("V3ACQ-03: repo link and repo configure take the advisory base as --base, refuse --trunk, and repo add keeps --trunk", () => {
  const fixture = makeFixture({ repos: { alpha: ["develop"] } });
  const checkout = join(resolve(fixture.root, ".."), "base-option-source");
  git(resolve(fixture.root, ".."), ["clone", "-q", fixture.repos[0]!.origin, checkout]);
  git(checkout, ["branch", "develop", "origin/develop"]);
  const common = git(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  assert.equal(fixture.grove(["init"]).status, 0);

  const beforeRefused = config(fixture.root);
  const linkRefused = fixture.grove(["repo", "link", checkout, "--name", "refused", "--trunk", "develop"]);
  assert.equal(linkRefused.status, 2, `${linkRefused.stderr}\n${linkRefused.stdout}`);
  assert.match(linkRefused.stderr + linkRefused.stdout, /--trunk/);
  assert.equal(config(fixture.root), beforeRefused, "a refused --trunk must not change the workspace config");

  const beforeLink = gitState(common);
  const linked = fixture.grove(["repo", "link", checkout, "--name", "external", "--base", "develop"]);
  assert.equal(linked.status, 0, `${linked.stderr}\n${linked.stdout}`);
  assert.equal(preferredTrunk(fixture.root, "external"), "develop");
  assert.equal(git(checkout, ["branch", "--show-current"]), "main", "--base must not check anything out");
  assert.equal(gitState(common), beforeLink, "--base must create no ref or worktree");

  const beforeConfigureRefused = config(fixture.root);
  const configureRefused = fixture.grove(["repo", "configure", "external", "--trunk", "main"]);
  assert.equal(configureRefused.status, 2, `${configureRefused.stderr}\n${configureRefused.stdout}`);
  assert.equal(config(fixture.root), beforeConfigureRefused);

  const configured = fixture.grove(["repo", "configure", "external", "--base", "main"]);
  assert.equal(configured.status, 0, `${configured.stderr}\n${configured.stdout}`);
  assert.equal(preferredTrunk(fixture.root, "external"), "main");
  assert.equal(gitState(common), beforeLink, "configure --base must not touch Git");

  const added = fixture.grove(["repo", "add", fixture.repos[0]!.origin, "--name", "managed", "--trunk", "develop"]);
  assert.equal(added.status, 0, `${added.stderr}\n${added.stdout}`);
  assert.equal(existsSync(join(fixture.root, "trunks", "develop@managed", ".git")), true);

  for (const command of [["repo", "link"], ["repo", "configure"]]) {
    const help = fixture.grove([...command, "--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--base <branch>/, `${command.join(" ")} help must document --base`);
    assert.doesNotMatch(help.stdout, /--trunk/, `${command.join(" ")} help must not document --trunk`);
  }
});
