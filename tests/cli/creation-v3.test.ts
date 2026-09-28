/** Native schema-3 creation and preflight integration. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture, managedAnchorPath, managedTrunkPath } from "../testkit/fixture.ts";
import { linkExecutable } from "../testkit/shim.ts";
import { beginOperation, recordCompleted, recordPending } from "../../src/store/operation.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

test("v3 init creates compiled roots and no legacy private bare store", () => {
  const fx = makeFixture();
  const run = fx.grove(["--json", "init"]);
  assert.equal(run.status, 0, run.stderr);
  const result = json(run.stdout);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.command, "init");
  assert.equal(json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).schemaVersion, 3);
  assert.equal(existsSync(join(fx.root, ".bare")), false);
  for (const path of ["repos", "trunks", "groves", "archives", ".grove/operations"]) assert.equal(existsSync(join(fx.root, path)), true, path);
});

test("v3 repo add creates a bare anchor plus peer trunk and publishes registration last", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const run = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  const result = json(run.stdout);
  assert.equal(result.command, "repo add");
  assert.equal(existsSync(join(managedAnchorPath(fx, "alpha"), "HEAD")), true);
  assert.equal(existsSync(join(managedTrunkPath(fx, "alpha"), ".git")), true);
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  assert.deepEqual(config.repositories[0].location, { kind: "managed" });
  assert.equal(config.repositories[0].remote, "origin");
  assert.equal(existsSync(join(fx.root, ".bare", "alpha")), false);
});

test("schema-3 new selects configured repositories and creates native Tree worktrees", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const run = fx.grove(["--json", "new", "demo", "--all"]);
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  const result = json(run.stdout);
  assert.equal(result.command, "new");
  assert.equal(result.targets.length, 1);
  assert.equal(existsSync(join(fx.root, "groves", "demo", "trees", "demo@alpha", ".git")), true);
  const listing = json(fx.grove(["--json", "tree", "ls", "demo"]).stdout);
  assert.equal(listing.detail.trees.length, 1);
});

test("schema-3 tree and trunk add use exact native creation grammar", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "demo", "--all"]).status, 0);
  const tree = fx.grove(["--json", "tree", "add", "demo", "alpha", "--name", "second", "--branch", "second", "--from", "main"]);
  assert.equal(tree.status, 0, `${tree.stderr}\n${tree.stdout}`);
  assert.equal(json(tree.stdout).command, "tree add");
  assert.equal(existsSync(join(fx.root, "groves", "demo", "trees", "second", ".git")), true);
  const trunk = fx.grove(["--json", "trunk", "add", "alpha", "develop", "--from", "main"]);
  assert.equal(trunk.status, 0, `${trunk.stderr}\n${trunk.stdout}`);
  assert.equal(json(trunk.stdout).command, "trunk add");
  assert.equal(json(fx.grove(["--json", "trunk", "ls", "alpha"]).stdout).detail.trunks.length, 2);
});

test("schema-3 repo link anchors any Git-resolvable path by canonical common directory", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const linked = fx.grove(["--json", "repo", "link", fx.repos[0]!.origin, "--name", "alpha", "--trunk", "main"]);
  assert.equal(linked.status, 0, `${linked.stderr}\n${linked.stdout}`);
  const result = json(linked.stdout);
  assert.equal(result.command, "repo link");
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  assert.equal(config.repositories[0].location.kind, "linked");
  assert.equal(config.repositories[0].location.commonGitDir, fx.repos[0]!.origin);
});

test("repeated creation refuses with the pending id and explicit reconcile resumes branch-only progress", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  const repositoryId = config.repositories[0].id as string;
  const checkout = managedAnchorPath(fx, "alpha");
  const oid = execFileSync("git", ["rev-parse", "main"], { cwd: checkout, encoding: "utf8" }).trim();
  const target = join(fx.root, "groves", "demo", "trees", "demo@alpha");
  const operation = beginOperation(fx.root, {
    kind: "new-grove",
    scope: { grove: "demo" },
    targetLocks: ["grove:demo", `repository:${repositoryId}:branch:demo`],
    targets: [{ selector: { repositoryId, repositoryAlias: "alpha", grove: "demo", tree: "demo@alpha", path: target }, steps: [{ id: `worktree-${repositoryId}`, kind: "worktree-add", input: { path: target, commonGitDir: checkout, branch: "demo", oid, mode: "new" } }] }],
  });
  recordPending(operation, `worktree-${repositoryId}`, { pathAbsent: true, branch: "demo", oid, mode: "new" });
  execFileSync("git", ["branch", "demo", oid], { cwd: checkout });

  const repeated = fx.grove(["--json", "new", "demo", "--all"]);
  assert.equal(repeated.status, 4);
  assert.match(repeated.stdout, new RegExp(operation.id));
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(existsSync(join(target, ".git")), true);
});

test("reconcile resumes managed bare acquisition both before and after the initial Git side effect", () => {
  for (const initializationAlreadyApplied of [false, true]) {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    const remote = fx.repos[0]!.origin;
    const rawAdvertisement = execFileSync("git", ["ls-remote", "--symref", "--", remote, "HEAD", "refs/heads/*"]);
    const generation = createHash("sha256").update(rawAdvertisement).digest("hex");
    const oid = execFileSync("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
    const anchor = join(fx.root, "repos", "alpha");
    const trunkPath = managedTrunkPath(fx, "alpha");
    const workspaceRevision = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"))._rev as number;
    const repositoryId = `repo-recovery-${initializationAlreadyApplied ? "applied" : "pending"}`;
    const operation = beginOperation(fx.root, {
      kind: "repo-add",
      scope: { repositoryId, repositoryAlias: "alpha" },
      targetLocks: ["repository-alias:alpha", `path:${anchor}`, `path:${trunkPath}`],
      targets: [{ selector: { repositoryId, repositoryAlias: "alpha" }, steps: [
        { id: "initialize-bare", kind: "repository-init-bare", input: { anchor, trunk: "main" } },
        { id: "configure-remote", kind: "remote-add", input: { remote: "[redacted]", name: "origin" } },
        { id: "fetch", kind: "fetch", input: { expectedRemoteOid: oid, generation } },
        { id: "initial-trunk", kind: "worktree-add", input: { path: trunkPath, branch: "main", expectedRemoteOid: oid, unborn: false } },
        { id: "register", kind: "workspace-config-update", input: { repositoryId, expectedRevision: workspaceRevision } },
      ] }],
      secret: { remote },
    });
    recordPending(operation, "initialize-bare", { targetAbsent: true });
    if (initializationAlreadyApplied) execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", "--", anchor], { cwd: fx.root });
    const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
    const result = json(resumed.stdout);
    assert.deepEqual(result.detail.resumed[0].completed, ["initialize-bare", "configure-remote", "fetch", "initial-trunk", "register"]);
    assert.equal(json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories[0].id, repositoryId);
    assert.equal(execFileSync("git", ["rev-parse", "--is-bare-repository"], { cwd: anchor, encoding: "utf8" }).trim(), "true");
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: trunkPath, encoding: "utf8" }).trim(), oid);
  }
});

test("repo-add recovery retains but does not register a hook-dirtied initial trunk", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const remote = fx.repos[0]!.origin;
  const oid = execFileSync("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
  const anchor = join(fx.root, "repos", "alpha");
  const trunkPath = managedTrunkPath(fx, "alpha");
  const repositoryId = "repo-hook-recovery";
  execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", "--", anchor], { cwd: fx.root });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: anchor });
  execFileSync("git", ["fetch", "-q", "origin", "+refs/heads/*:refs/remotes/origin/*"], { cwd: anchor });
  execFileSync("git", ["update-ref", "refs/heads/main", oid], { cwd: anchor });
  const hooks = join(fx.root, "repo-add-hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-checkout");
  linkExecutable(hook, "#!/bin/sh\nprintf 'hook mutation\\n' >> README.md\n");
  execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: anchor });
  const revision = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"))._rev;
  const operation = beginOperation(fx.root, {
    kind: "repo-add", scope: { repositoryId, repositoryAlias: "alpha" }, targetLocks: ["repository-alias:alpha", `path:${anchor}`, `path:${trunkPath}`],
    targets: [{ selector: { repositoryId, repositoryAlias: "alpha" }, steps: [
      { id: "initialize-bare", kind: "repository-init-bare", input: { anchor, trunk: "main" } },
      { id: "configure-remote", kind: "remote-add", input: { remote: "[redacted]", name: "origin" } },
      { id: "fetch", kind: "fetch", input: { expectedRemoteOid: oid, generation: "already-applied" } },
      { id: "initial-trunk", kind: "worktree-add", input: { path: trunkPath, branch: "main", expectedRemoteOid: oid, unborn: false } },
      { id: "register", kind: "workspace-config-update", input: { repositoryId, expectedRevision: revision } },
    ] }], secret: { remote },
  });
  for (const id of ["initialize-bare", "configure-remote", "fetch"]) { recordPending(operation, id, { alreadyApplied: true }); recordCompleted(operation, id, { alreadyApplied: true }); }
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.notEqual(execFileSync("git", ["status", "--porcelain"], { cwd: trunkPath, encoding: "utf8" }).trim(), "");
  assert.equal(json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.length, 0);
});

test("creation revalidates moving sources and classifies every unattempted target", () => {
  {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
    const repositoryId = config.repositories[0].id;
    const anchor = managedAnchorPath(fx, "alpha");
    const oid = execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: anchor, encoding: "utf8" }).trim();
    execFileSync("git", ["tag", "moving-base", oid], { cwd: anchor });
    const target = join(fx.root, "groves", "demo", "trees", "demo@alpha");
    const operation = beginOperation(fx.root, { kind: "new-grove", scope: { grove: "demo" }, targetLocks: [`repository:${repositoryId}:branch:demo`], targets: [{ selector: { repositoryId, repositoryAlias: "alpha", grove: "demo", tree: "demo@alpha", path: target }, steps: [{ id: `worktree-${repositoryId}`, kind: "worktree-add", input: { path: target, commonGitDir: anchor, branch: "demo", oid, mode: "new", sourceRevision: "moving-base" } }] }] });
    recordPending(operation, `worktree-${repositoryId}`, { pathAbsent: true, branch: "demo", oid, mode: "new" });
    execFileSync("git", ["tag", "-f", "moving-base", "refs/heads/main~0"], { cwd: anchor });
    const alternate = execFileSync("git", ["commit-tree", `${oid}^{tree}`, "-p", oid, "-m", "moved tag"], { cwd: anchor, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@grove.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@grove.test" } }).trim();
    execFileSync("git", ["tag", "-f", "moving-base", alternate], { cwd: anchor });
    const refused = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.notEqual(refused.status, 0);
    assert.equal(existsSync(target), false);
    assert.throws(() => execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/demo"], { cwd: anchor }));
  }
  {
    const fx = makeFixture({ repos: { alpha: ["demo"], beta: ["demo"] } });
    assert.equal(fx.grove(["init"]).status, 0);
    for (const repository of fx.repos) assert.equal(fx.grove(["repo", "add", repository.origin, "--name", repository.name]).status, 0);
    const hooks = join(fx.root, "audit-hooks"); mkdirSync(hooks, { recursive: true });
    const hook = join(hooks, "post-checkout");
    linkExecutable(hook, "#!/bin/sh\ncase \"$PWD\" in *demo@alpha) git update-ref -d refs/remotes/origin/demo ;; esac\n");
    const globalConfig = join(fx.root, "audit-gitconfig"); writeFileSync(globalConfig, `[core]\n\thooksPath = ${hooks}\n`);
    const partial = fx.grove(["--json", "new", "demo", "--branch", "alpha=demo", "--branch", "beta=demo", "--all"], { env: { GIT_CONFIG_GLOBAL: globalConfig } });
    assert.notEqual(partial.status, 0, `${partial.stderr}\n${partial.stdout}`);
    const body = json(partial.stdout);
    assert.equal(body.outcome, "partial", `${partial.stderr}\n${partial.stdout}`);
    assert.equal(body.targets.length, 2);
    assert.ok(body.targets.every((target: any) => target.after !== null || target.reason !== null), JSON.stringify(body.targets));
  }
});
