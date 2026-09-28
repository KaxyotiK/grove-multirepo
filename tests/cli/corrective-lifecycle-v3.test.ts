/** Corrective lifecycle witnesses for the bounded Grove v3 adversarial findings. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { beginOperation, captureDirectoryTarget, recordCompleted, recordPending } from "../../src/store/operation.ts";
import { loadWorkspaceAt, saveWorkspace } from "../../src/config/workspace.ts";
import { makeFixture, managedAnchorPath, managedTrunkPath } from "../testkit/fixture.ts";
import { collectDirectoryMergeRoots } from "../../src/paths/fs.ts";
import { createGitGate } from "../testkit/git-gate.ts";
import { linkExecutable } from "../testkit/shim.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

function setup() {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "demo", "--all"]).status, 0);
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  return {
    fx,
    repositoryId: config.repositories[0].id as string,
    anchor: managedAnchorPath(fx, "alpha"),
    trunk: managedTrunkPath(fx, "alpha"),
    tree: join(fx.root, "groves", "demo", "trees", "demo@alpha"),
  };
}

function overlappingStorageSetup() {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "alpha", "--repo", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  const content = join(fx.root, "groves", "alpha");
  const tree = join(content, "trees", "alpha@alpha");
  execFileSync("git", ["worktree", "remove", "--force", "--", tree], { cwd: anchor });
  const repository = join(content, "repository-storage");
  renameSync(anchor, repository);
  symlinkSync(repository, anchor);
  return { fx, repository, content };
}

test("FR-036: restore refuses an unregistered advisory repository before moving archived content", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["archive", "demo", "--allow-unpushed"]).status, 0);
  assert.equal(fx.grove(["repo", "remove", "alpha"]).status, 0);
  const restored = fx.grove(["--json", "restore", "demo"]);
  assert.notEqual(restored.status, 0, `${restored.stderr}\n${restored.stdout}`);
  assert.equal(existsSync(join(fx.root, "groves", "demo")), false);
  assert.equal(existsSync(join(fx.root, "archives", "demo")), true);
});

test("FR-021: Tree and trunk removals refuse targets owned by pending operations", () => {
  {
    const { fx, repositoryId, tree } = setup();
    const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
    const operation = beginOperation(fx.root, {
      kind: "tree-add",
      scope: { grove: "demo" },
      targetLocks: ["grove:demo", `repository:${repositoryId}:branch:demo`, `worktree:${resolve(tree)}`],
      targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "hold-tree", kind: "worktree-add", input: { path: tree, commonGitDir: managedAnchorPath(fx, "alpha"), branch: "demo", oid, mode: "existing" } }] }],
    });
    recordPending(operation, "hold-tree", { held: true });
    const removed = fx.grove(["--json", "tree", "remove", "demo", "demo@alpha", "--allow-destructive-all"]);
    assert.notEqual(removed.status, 0, `${removed.stderr}\n${removed.stdout}`);
    assert.equal(existsSync(tree), true);
  }
  {
    const { fx, repositoryId } = setup();
    assert.equal(fx.grove(["trunk", "add", "alpha", "develop", "--from", "main"]).status, 0);
    const trunk = managedTrunkPath(fx, "alpha", "develop");
    const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: trunk, encoding: "utf8" }).trim();
    const operation = beginOperation(fx.root, {
      kind: "trunk-add",
      scope: { repositoryId },
      targetLocks: [`repository:${repositoryId}:branch:develop`, `worktree:${resolve(trunk)}`],
      targets: [{ selector: { repositoryId, path: trunk }, steps: [{ id: "hold-trunk", kind: "worktree-add", input: { path: trunk, commonGitDir: managedAnchorPath(fx, "alpha"), branch: "develop", oid, mode: "existing" } }] }],
    });
    recordPending(operation, "hold-trunk", { held: true });
    const removed = fx.grove(["--json", "trunk", "remove", "alpha", "develop", "--allow-destructive-all"]);
    assert.notEqual(removed.status, 0, `${removed.stderr}\n${removed.stdout}`);
    assert.equal(existsSync(trunk), true);
  }
});

test("FR-033A/FR-035: forced trunk removal itemizes identical discarded filenames in human and JSON results", () => {
  const humanFixture = setup();
  writeFileSync(join(humanFixture.trunk, "tracked-edit.txt"), "uncommitted\n");
  writeFileSync(join(humanFixture.trunk, "secret-draft.md"), "also uncommitted\n");
  const human = humanFixture.fx.grove(["trunk", "remove", "alpha", "main", "--allow-destructive-all"]);

  const machineFixture = setup();
  writeFileSync(join(machineFixture.trunk, "tracked-edit.txt"), "uncommitted\n");
  writeFileSync(join(machineFixture.trunk, "secret-draft.md"), "also uncommitted\n");
  const machine = machineFixture.fx.grove(["--json", "trunk", "remove", "alpha", "main", "--allow-destructive-all"]);
  const machineAfter = json(machine.stdout).targets[0].after;

  assert.deepEqual(
    {
      humanStatus: human.status,
      humanNamesTrackedEdit: /tracked-edit\.txt/.test(human.stdout),
      humanNamesSecretDraft: /secret-draft\.md/.test(human.stdout),
      machineStatus: machine.status,
      machineDiscardedFiles: (machineAfter.discardedWork ?? []).map((change: { path: string }) => change.path).sort(),
    },
    {
      humanStatus: 0,
      humanNamesTrackedEdit: true,
      humanNamesSecretDraft: true,
      machineStatus: 0,
      machineDiscardedFiles: ["secret-draft.md", "tracked-edit.txt"],
    },
  );
});

test("FR-033A/FR-035: forced trunk removal refuses when discarded work cannot be enumerated", () => {
  const { fx, trunk } = setup();
  writeFileSync(join(trunk, "secret-draft.md"), "uncommitted\n");
  const operationCountBefore = readdirSync(join(fx.root, ".grove", "operations")).length;
  const gate = createGitGate([
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["status", "--porcelain"],
  ], { failExitCode: 42 });
  let removed;
  try {
    removed = fx.grove(["--json", "trunk", "remove", "alpha", "main", "--allow-destructive-all"], { env: gate.env });
  } finally {
    gate.dispose();
  }
  assert.deepEqual(
    { status: removed.status, operationDelta: readdirSync(join(fx.root, ".grove", "operations")).length - operationCountBefore, trunkSurvives: existsSync(trunk), workSurvives: existsSync(join(trunk, "secret-draft.md")) },
    { status: 5, operationDelta: 0, trunkSurvives: true, workSurvives: true },
  );
});

test("FR-036: hook-dirtied direct restore remains incomplete", () => {
  const { fx, anchor, tree } = setup();
  assert.equal(fx.grove(["archive", "demo", "--allow-unpushed"]).status, 0);
  const hooks = join(fx.root, "restore-hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-checkout");
  linkExecutable(hook, "#!/bin/sh\nprintf 'hook mutation\\n' >> README.md\n");
  execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: anchor });
  const restored = fx.grove(["--json", "restore", "demo"]);
  assert.notEqual(restored.status, 0, `${restored.stderr}\n${restored.stdout}`);
  assert.equal(existsSync(tree), true, "the incomplete checkout is retained for explicit recovery");
  assert.notEqual(execFileSync("git", ["status", "--porcelain"], { cwd: tree, encoding: "utf8" }).trim(), "");
});

test("FR-021/FR-036: generic worktree-add recovery rejects a hook-dirtied checkout", () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const hooks = join(fx.root, "reconcile-hooks");
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, "post-checkout");
  linkExecutable(hook, "#!/bin/sh\nprintf 'hook mutation\\n' >> README.md\n");
  execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: anchor });
  const operation = beginOperation(fx.root, {
    kind: "tree-add",
    scope: { grove: "demo" },
    targetLocks: ["grove:demo", `repository:${repositoryId}:branch:demo`, `worktree:${resolve(tree)}`],
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: `worktree-${repositoryId}`, kind: "worktree-add", input: { path: tree, commonGitDir: anchor, branch: "demo", oid, mode: "existing", sourceRevision: "refs/heads/demo" } }] }],
  });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.notEqual(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.notEqual(execFileSync("git", ["status", "--porcelain"], { cwd: tree, encoding: "utf8" }).trim(), "");
});

test("FR-023: relocated destructive replay preserves a directory reoccupying the old path", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["archive", "demo", "--allow-unpushed"]).status, 0);
  const archived = join(fx.root, "archives", "demo");
  const metadataPath = join(fx.root, ".grove", "groves", "demo.json");
  const operation = beginOperation(fx.root, {
    kind: "grove-delete",
    scope: { grove: "demo" },
    targetLocks: ["grove:demo"],
    targets: [{ selector: { grove: "demo" }, steps: [
      { id: "delete-content", kind: "directory-remove", input: { path: archived, force: true, targetIdentity: captureDirectoryTarget(fx.root, "grove-content", { grove: "demo" }, archived) } },
      { id: "delete-metadata", kind: "central-metadata-remove", input: { path: metadataPath } },
    ] }],
  });
  recordPending(operation, "delete-content", { path: archived, present: true });

  const movedRoot = join(dirname(fx.root), "relocated-grove");
  renameSync(fx.root, movedRoot);
  mkdirSync(archived, { recursive: true });
  const sentinel = join(archived, "unrelated.txt");
  writeFileSync(sentinel, "preserve me\n");
  const resumed = fx.grove(["--workspace", movedRoot, "--json", "reconcile", "--operation", operation.id], { cwd: movedRoot });
  assert.notEqual(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(readFileSync(sentinel, "utf8"), "preserve me\n");
});

test("FR-033A: reconcile preserves the unreachable-detached safety reason", () => {
  const { fx, repositoryId, anchor, tree } = setup();
  execFileSync("git", ["switch", "--detach", "-q"], { cwd: tree });
  writeFileSync(join(tree, "detached.txt"), "retain me\n");
  execFileSync("git", ["add", "detached.txt"], { cwd: tree });
  execFileSync("git", ["commit", "-q", "-m", "detached work"], { cwd: tree });
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  execFileSync("git", ["tag", "protect-detached", oid], { cwd: anchor });
  const operation = beginOperation(fx.root, {
    kind: "tree-remove",
    scope: { grove: "demo" },
    targetLocks: ["grove:demo", `worktree:${resolve(tree)}`],
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: anchor, headOid: oid, branch: null, force: false } }] }],
  });
  recordPending(operation, "remove", { registered: true, headOid: oid, dirty: false });
  execFileSync("git", ["tag", "-d", "protect-detached"], { cwd: anchor, stdio: "ignore" });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 5, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "unreachable-detached");
  assert.equal(existsSync(tree), true);
  const repeated = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(repeated.status, 5, `${repeated.stderr}\n${repeated.stdout}`);
  assert.equal(json(repeated.stdout).detail.resumed[0].problem, "unreachable-detached");
});

test("FR-021: reconcile refuses a target concurrently owned by another pending operation", () => {
  const { fx, repositoryId, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const locks = ["grove:demo", `repository:${repositoryId}:branch:demo`, `worktree:${resolve(tree)}`];
  const creator = beginOperation(fx.root, {
    kind: "tree-add", scope: { grove: "demo" }, targetLocks: locks,
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "create", kind: "worktree-add", input: { path: tree, commonGitDir: managedAnchorPath(fx, "alpha"), branch: "demo", oid, mode: "existing" } }] }],
  });
  recordPending(creator, "create", { held: true });
  const remover = beginOperation(fx.root, {
    kind: "tree-remove", scope: { grove: "demo" }, targetLocks: locks,
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: managedAnchorPath(fx, "alpha"), headOid: oid, branch: "refs/heads/demo", force: false } }] }],
  });
  recordPending(remover, "remove", { held: true });
  const resumed = fx.grove(["--json", "reconcile", "--operation", remover.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).error.detail.operationId, creator.id);
  assert.equal(existsSync(tree), true);
});

test("FR-021: worktree-removal replay refuses a same-ID repository rebound", async () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const operation = beginOperation(fx.root, {
    kind: "tree-remove", scope: { grove: "demo" }, targetLocks: ["grove:demo", `repository:${repositoryId}:branch:demo`, `worktree:${resolve(tree)}`],
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: anchor, headOid: oid, branch: "refs/heads/demo", force: false } }] }],
  });
  recordPending(operation, "remove", { path: tree, commonGitDir: anchor, headOid: oid });
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });

  const replacement = join(fx.root, "replacement-checkout");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, replacement]);
  execFileSync("git", ["branch", "demo", oid], { cwd: replacement });
  execFileSync("git", ["worktree", "add", "-q", "--", tree, "demo"], { cwd: replacement });
  const replacementCommon = realpathSync(join(replacement, ".git"));
  const workspace = loadWorkspaceAt(fx.root);
  await saveWorkspace(workspace, { ...workspace.config, repositories: workspace.config.repositories.map((registration) => registration.id === repositoryId ? { ...registration, location: { kind: "linked" as const, commonGitDir: replacementCommon } } : registration) });

  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(existsSync(tree), true);
  assert.equal(execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: tree, encoding: "utf8" }).trim().length > 0, true);
});

test("FR-021: worktree-add replay refuses a same-ID repository rebound", async () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const operation = beginOperation(fx.root, {
    kind: "tree-add", scope: { grove: "demo" }, targetLocks: ["grove:demo", `worktree:${resolve(tree)}`],
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "add", kind: "worktree-add", input: { path: tree, commonGitDir: anchor, branch: "demo", oid, mode: "existing", sourceRevision: "refs/heads/demo" } }] }],
  });
  const replacement = join(fx.root, "replacement-add-checkout");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, replacement]);
  execFileSync("git", ["branch", "demo", oid], { cwd: replacement });
  const workspace = loadWorkspaceAt(fx.root);
  await saveWorkspace(workspace, { ...workspace.config, repositories: workspace.config.repositories.map((registration) => registration.id === repositoryId ? { ...registration, location: { kind: "linked" as const, commonGitDir: realpathSync(join(replacement, ".git")) } } : registration) });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(existsSync(tree), false);
});

test("FR-023: worktree-move replay refuses a same-ID repository rebound", async () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const destination = join(fx.root, "groves", "renamed", "trees", "demo@alpha");
  const operation = beginOperation(fx.root, {
    kind: "grove-rename", scope: { grove: "demo", newName: "renamed" }, targetLocks: ["grove:demo", "grove:renamed", `worktree:${resolve(tree)}`],
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "move", kind: "worktree-move", input: { from: tree, to: destination, commonGitDir: anchor, headOid: oid } }] }],
  });
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const replacement = join(fx.root, "replacement-move-checkout");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, replacement]);
  execFileSync("git", ["branch", "demo", oid], { cwd: replacement });
  execFileSync("git", ["worktree", "add", "-q", "--", tree, "demo"], { cwd: replacement });
  const workspace = loadWorkspaceAt(fx.root);
  await saveWorkspace(workspace, { ...workspace.config, repositories: workspace.config.repositories.map((registration) => registration.id === repositoryId ? { ...registration, location: { kind: "linked" as const, commonGitDir: realpathSync(join(replacement, ".git")) } } : registration) });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(existsSync(tree), true);
  assert.equal(existsSync(destination), false);
});

test("FR-021: stale rename recovery does not create a destination reservation", () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const destination = join(fx.root, "groves", "renamed", "trees", "demo@alpha");
  const operation = beginOperation(fx.root, { kind: "grove-rename", scope: { grove: "demo", newName: "renamed" }, targetLocks: ["grove:demo", "grove:renamed"], targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "move", kind: "worktree-move", input: { from: tree, to: destination, commonGitDir: anchor, headOid: oid } }] }] });
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(existsSync(join(fx.root, "groves", "renamed")), false);
});

test("FR-023: a durably pending empty rename reservation resumes", () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const newRoot = join(fx.root, "groves", "renamed");
  const destination = join(newRoot, "trees", "demo@alpha");
  const operation = beginOperation(fx.root, { kind: "grove-rename", scope: { grove: "demo", newName: "renamed" }, targetLocks: ["grove:demo", "grove:renamed"], targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "move", kind: "worktree-move", input: { from: tree, to: destination, commonGitDir: anchor, headOid: oid } }] }] });
  recordPending(operation, "move", { from: tree, to: destination, headOid: oid, destinationExpectedAbsent: true, reservationToken: operation.id });
  mkdirSync(newRoot);
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(existsSync(join(destination, ".git")), true);
});

test("FR-021: set-upstream replay refuses a same-ID repository rebound", async () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const operation = beginOperation(fx.root, {
    kind: "tree-add", scope: { grove: "demo" }, targetLocks: ["grove:demo", `worktree:${resolve(tree)}`],
    targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [
      { id: "add", kind: "worktree-add", input: { path: tree, commonGitDir: anchor, branch: "demo", oid, mode: "existing" } },
      { id: "upstream", kind: "set-upstream", input: { commonGitDir: anchor, branch: "demo", upstream: "refs/remotes/origin/main", oid, upstreamOid: oid } },
    ] }],
  });
  recordPending(operation, "add", { alreadyApplied: true });
  recordCompleted(operation, "add", { path: tree, headOid: oid });
  recordPending(operation, "upstream", { upstream: null });
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const replacement = join(fx.root, "replacement-upstream-checkout");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, replacement]);
  execFileSync("git", ["branch", "demo", oid], { cwd: replacement });
  execFileSync("git", ["worktree", "add", "-q", "--", tree, "demo"], { cwd: replacement });
  const workspace = loadWorkspaceAt(fx.root);
  await saveWorkspace(workspace, { ...workspace.config, repositories: workspace.config.repositories.map((registration) => registration.id === repositoryId ? { ...registration, location: { kind: "linked" as const, commonGitDir: realpathSync(join(replacement, ".git")) } } : registration) });
  assert.throws(() => execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd: tree, stdio: "ignore" }));
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.throws(() => execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd: tree, stdio: "ignore" }));
});

test("FR-019: multi-repository new refuses every claimant before its first mutation", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repository of fx.repos) assert.equal(fx.grove(["repo", "add", repository.origin, "--name", repository.name]).status, 0);
  const alpha = managedAnchorPath(fx, "alpha");
  const beta = managedAnchorPath(fx, "beta");
  execFileSync("git", ["branch", "shared", "main"], { cwd: alpha });
  execFileSync("git", ["branch", "shared", "main"], { cwd: beta });
  const claimant = join(fx.root, "external-beta-claimant");
  execFileSync("git", ["worktree", "add", "-q", "--", claimant, "shared"], { cwd: beta });
  const created = fx.grove(["--json", "new", "demo", "--repo", "alpha", "--repo", "beta", "--branch", "alpha=shared", "--branch", "beta=shared"]);
  assert.equal(created.status, 4, `${created.stderr}\n${created.stdout}`);
  assert.equal(json(created.stdout).error.detail.claimantPath, claimant);
  assert.equal(existsSync(join(fx.root, "groves", "demo", "trees", "demo@alpha")), false);
  assert.equal(existsSync(join(fx.root, "groves", "demo", "trees", "demo@beta")), false);
});

test("FR-021/FR-034B: trunk removal rechecks HEAD after the last clean-status observation", () => {
  const { fx, anchor } = setup();
  assert.equal(fx.grove(["trunk", "add", "alpha", "develop", "--from", "main"]).status, 0);
  const trunk = managedTrunkPath(fx, "alpha", "develop");
  execFileSync("git", ["config", "user.email", "fixture@grove.test"], { cwd: trunk });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: trunk });
  const wrapperDirectory = join(fx.root, "git-wrapper");
  mkdirSync(wrapperDirectory, { recursive: true });
  const wrapper = join(wrapperDirectory, "git");
  const counter = join(wrapperDirectory, "status-count");
  const oidFile = join(wrapperDirectory, "detached-oid");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  linkExecutable(wrapper, `#!/bin/sh
REAL_GIT="$GROVE_TEST_REAL_GIT"
TARGET="$GROVE_TEST_TARGET"
COUNTER="$GROVE_TEST_COUNTER"
OID_FILE="$GROVE_TEST_OID_FILE"
if [ "$PWD" = "$TARGET" ] && [ "$1" = status ]; then
  "$REAL_GIT" "$@"
  RESULT=$?
  COUNT=0
  [ ! -f "$COUNTER" ] || COUNT=$("$REAL_GIT" -C "$TARGET" show "$COUNTER" 2>/dev/null || sed -n '1p' "$COUNTER")
  case "$COUNT" in ''|*[!0-9]*) COUNT=0 ;; esac
  COUNT=$((COUNT + 1))
  printf '%s\n' "$COUNT" > "$COUNTER"
  if [ "$COUNT" -eq 2 ]; then
    "$REAL_GIT" -C "$TARGET" switch --detach -q
    printf 'race\n' > "$TARGET/race.txt"
    "$REAL_GIT" -C "$TARGET" add race.txt
    "$REAL_GIT" -C "$TARGET" commit -qm 'concurrent detached work'
    "$REAL_GIT" -C "$TARGET" rev-parse HEAD > "$OID_FILE"
  fi
  exit "$RESULT"
fi
exec "$REAL_GIT" "$@"
`);
  const removed = fx.grove(["--json", "trunk", "remove", "alpha", "develop", "--allow-destructive-all"], { env: {
    PATH: `${wrapperDirectory}:${process.env.PATH ?? ""}`,
    GROVE_TEST_REAL_GIT: realGit,
    GROVE_TEST_TARGET: trunk,
    GROVE_TEST_COUNTER: counter,
    GROVE_TEST_OID_FILE: oidFile,
  } });
  assert.notEqual(removed.status, 0, `${removed.stderr}\n${removed.stdout}`);
  assert.equal(existsSync(trunk), true);
  const detachedOid = readFileSync(oidFile, "utf8").trim();
  assert.equal(execFileSync("git", ["cat-file", "-t", detachedOid], { cwd: anchor, encoding: "utf8" }).trim(), "commit");
});

test("FR-023: directory-move recovery refuses a same-path replacement", () => {
  const { fx, anchor, tree } = setup();
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const active = join(fx.root, "groves", "demo");
  const archived = join(fx.root, "archives", "demo");
  const operation = beginOperation(fx.root, {
    kind: "grove-archive", scope: { grove: "demo" }, targetLocks: ["grove:demo"],
    targets: [{ selector: { grove: "demo" }, steps: [{ id: "archive-content", kind: "directory-move", input: {
      from: active,
      to: archived,
      fromIdentity: captureDirectoryTarget(fx.root, "active-grove" as any, { grove: "demo" }, active),
      toIdentity: captureDirectoryTarget(fx.root, "archive-grove" as any, { grove: "demo" }, archived),
    } }] }],
  });
  recordPending(operation, "archive-content", { from: active, to: archived });
  renameSync(active, `${active}-displaced`);
  mkdirSync(active, { recursive: true });
  const sentinel = join(active, "unrelated.txt");
  writeFileSync(sentinel, "preserve replacement\n");
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(readFileSync(sentinel, "utf8"), "preserve replacement\n");
});

for (const command of ["archive", "rename"] as const) {
  test(`FR-023: ${command} reports a native worktree failure as git-failed`, () => {
    const { fx, tree } = setup();
    const args = command === "archive"
      ? ["--json", "archive", "demo", "--allow-destructive-all", "--allow-unpushed"]
      : ["--json", "rename", "demo", "renamed"];
    const destination = join(fx.root, "groves", "renamed", "trees", "demo@alpha");
    const gitArgs = command === "archive"
      ? ["worktree", "remove", "--force", "--", tree]
      : ["worktree", "move", "--", tree, destination];
    const gate = createGitGate(gitArgs, { failExitCode: 42 });
    let run;
    try { run = fx.grove(args, { env: gate.env }); }
    finally { gate.dispose(); }
    const output = json(run.stdout);
    assert.deepEqual(
      { status: run.status, outcome: output.outcome, reasons: output.targets.map((target: any) => target.reason) },
      { status: 6, outcome: "partial", reasons: ["git-failed"] },
    );
  });
}

for (const recoveryKind of ["directory-remove", "directory-move", "directory-merge"] as const) {
  test(`V3DES-08: ${recoveryKind} recovery refuses repository storage as Grove content`, () => {
    const { fx, repository, content } = overlappingStorageSetup();
    const destination = recoveryKind === "directory-move" ? join(fx.root, "archives", "alpha") : join(fx.root, "Storage", "renamed");
    const step = recoveryKind === "directory-remove"
      ? { id: "content", kind: recoveryKind, input: { path: content, force: true, targetIdentity: captureDirectoryTarget(fx.root, "grove-content", { grove: "alpha" }, content) } }
      : recoveryKind === "directory-move"
        ? { id: "content", kind: recoveryKind, input: {
            from: content,
            to: destination,
            fromIdentity: captureDirectoryTarget(fx.root, "active-grove", { grove: "alpha" }, content),
            toIdentity: captureDirectoryTarget(fx.root, "archive-grove", { grove: "alpha" }, destination),
          } }
        : { id: "content", kind: recoveryKind, input: {
            from: content,
            to: destination,
            mergeRoots: collectDirectoryMergeRoots(content, destination),
            fromIdentity: captureDirectoryTarget(fx.root, "active-grove", { grove: "alpha" }, content),
            toIdentity: captureDirectoryTarget(fx.root, "active-grove", { grove: "renamed" }, destination),
          } };
    const operation = beginOperation(fx.root, {
      kind: recoveryKind === "directory-remove" ? "grove-delete" : recoveryKind === "directory-move" ? "grove-archive" : "grove-rename",
      scope: { grove: "alpha", ...(recoveryKind === "directory-merge" ? { newName: "renamed" } : {}) },
      targetLocks: ["grove:alpha"],
      targets: [{ selector: { grove: "alpha" }, steps: [step] }],
    });

    const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);

    assert.deepEqual(
      {
        status: resumed.status,
        problem: json(resumed.stdout).detail.resumed[0].problem,
        repositorySurvives: existsSync(repository),
        headSurvives: existsSync(join(repository, "HEAD")),
        objectsSurvive: existsSync(join(repository, "objects")),
      },
      { status: 4, problem: "stale-plan", repositorySurvives: true, headSurvives: true, objectsSurvive: true },
    );
  });
}

test("FR-023: directory-move recovery classifies a symlink replacement as stale-plan", () => {
  const { fx, anchor, tree } = setup();
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const active = join(fx.root, "groves", "demo");
  const archived = join(fx.root, "archives", "demo");
  const operation = beginOperation(fx.root, {
    kind: "grove-archive", scope: { grove: "demo" }, targetLocks: ["grove:demo"],
    targets: [{ selector: { grove: "demo" }, steps: [{ id: "archive-content", kind: "directory-move", input: {
      from: active,
      to: archived,
      fromIdentity: captureDirectoryTarget(fx.root, "active-grove" as any, { grove: "demo" }, active),
      toIdentity: captureDirectoryTarget(fx.root, "archive-grove" as any, { grove: "demo" }, archived),
    } }] }],
  });
  recordPending(operation, "archive-content", { from: active, to: archived });
  const displaced = `${active}-displaced`;
  renameSync(active, displaced);
  symlinkSync(displaced, active);
  const sentinel = join(displaced, "unrelated.txt");
  writeFileSync(sentinel, "preserve symlink target\n");

  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);

  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(readFileSync(sentinel, "utf8"), "preserve symlink target\n");
});

test("FR-023: directory-merge recovery refuses stale absolute paths after workspace relocation", () => {
  const { fx, anchor, tree } = setup();
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const from = join(fx.root, "groves", "demo");
  const to = join(fx.root, "groves", "renamed");
  const mergeRoots = collectDirectoryMergeRoots(from, to);
  const operation = beginOperation(fx.root, {
    kind: "grove-rename", scope: { grove: "demo", newName: "renamed" }, targetLocks: ["grove:demo", "grove:renamed"],
    targets: [{ selector: { grove: "demo" }, steps: [{ id: "move-content", kind: "directory-merge", input: {
      from,
      to,
      mergeRoots,
      fromIdentity: captureDirectoryTarget(fx.root, "active-grove" as any, { grove: "demo" }, from),
      toIdentity: captureDirectoryTarget(fx.root, "active-grove" as any, { grove: "renamed" }, to),
    } }] }],
  });
  recordPending(operation, "move-content", { from, to });
  const movedRoot = join(dirname(fx.root), "relocated-rename");
  renameSync(fx.root, movedRoot);
  mkdirSync(from, { recursive: true });
  const sentinel = join(from, "unrelated.txt");
  writeFileSync(sentinel, "preserve replacement\n");
  const resumed = fx.grove(["--workspace", movedRoot, "--json", "reconcile", "--operation", operation.id], { cwd: movedRoot });
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(readFileSync(sentinel, "utf8"), "preserve replacement\n");
});

test("FR-023: rename recovery proves a destination created by a completed worktree move", () => {
  const { fx, repositoryId, anchor, tree } = setup();
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const oldRoot = join(fx.root, "groves", "demo");
  const newRoot = join(fx.root, "groves", "renamed");
  const movedTree = join(newRoot, "trees", "demo@alpha");
  writeFileSync(join(oldRoot, "notes.txt"), "retain loose content\n");
  const mergeRoots = collectDirectoryMergeRoots(oldRoot, newRoot, [tree]);
  const operation = beginOperation(fx.root, {
    kind: "grove-rename", scope: { grove: "demo", newName: "renamed" }, targetLocks: ["grove:demo", "grove:renamed", `worktree:${resolve(tree)}`],
    targets: [
      { selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "move", kind: "worktree-move", input: { from: tree, to: movedTree, commonGitDir: anchor, headOid: oid } }] },
      { selector: { grove: "demo" }, steps: [{ id: "move-content", kind: "directory-merge", input: { from: oldRoot, to: newRoot, mergeRoots } }, { id: "rename-metadata", kind: "central-metadata-update", input: { oldName: "demo", newName: "renamed" } }] },
    ],
  });
  recordPending(operation, "move", { from: tree, to: movedTree, headOid: oid });
  mkdirSync(dirname(movedTree), { recursive: true });
  execFileSync("git", ["worktree", "move", "--", tree, movedTree], { cwd: anchor });
  recordCompleted(operation, "move", { path: movedTree, headOid: oid, destinationRootIdentity: captureDirectoryTarget(fx.root, "active-grove", { grove: "renamed" }, newRoot) });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(readFileSync(join(newRoot, "notes.txt"), "utf8"), "retain loose content\n");
});

test("FR-021/FR-023: rename recovery revalidates after persisting its pending boundary", () => {
  const { fx, anchor, tree } = setup();
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: anchor });
  const from = join(fx.root, "groves", "demo");
  const to = join(fx.root, "groves", "renamed");
  writeFileSync(join(from, "notes.txt"), "retain source content\n");
  mkdirSync(to, { recursive: true });
  const mergeRoots = collectDirectoryMergeRoots(from, to);
  const operation = beginOperation(fx.root, {
    kind: "grove-rename", scope: { grove: "demo", newName: "renamed" }, targetLocks: ["grove:demo", "grove:renamed"],
    targets: [{ selector: { grove: "demo" }, steps: [{ id: "move-content", kind: "directory-merge", input: { from, to, mergeRoots } }] }],
  });
  const sentinel = join(to, "late-unrelated.txt");
  const preload = join(fx.root, "inject-after-operation-write.mjs");
  writeFileSync(preload, `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalRenameSync = fs.renameSync;
let injected = false;
fs.renameSync = function (from, to) {
  const result = originalRenameSync.apply(this, arguments);
  if (!injected && to === process.env.GROVE_TEST_OPERATION_FILE) {
    injected = true;
    fs.writeFileSync(process.env.GROVE_TEST_SENTINEL, "late unrelated content\\n");
  }
  return result;
};
syncBuiltinESMExports();
`);
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id], { env: {
    NODE_OPTIONS: `--import=${preload}`,
    GROVE_TEST_OPERATION_FILE: operation.file,
    GROVE_TEST_SENTINEL: sentinel,
  } });
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(resumed.stdout).detail.resumed[0].problem, "stale-plan");
  assert.equal(readFileSync(sentinel, "utf8"), "late unrelated content\n");
  assert.equal(readFileSync(join(from, "notes.txt"), "utf8"), "retain source content\n");
});

test("FR-021/FR-026: rename refuses content concurrently inserted into its reserved destination", () => {
  const { fx } = setup();
  const oldRoot = join(fx.root, "groves", "demo");
  const newRoot = join(fx.root, "groves", "renamed");
  writeFileSync(join(oldRoot, "notes.txt"), "original loose content\n");
  const wrapperDirectory = join(fx.root, "rename-wrapper");
  mkdirSync(wrapperDirectory, { recursive: true });
  const wrapper = join(wrapperDirectory, "git");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  linkExecutable(wrapper, `#!/bin/sh
if [ "$1" = worktree ] && [ "$2" = move ]; then
  printf 'unrelated concurrent content\\n' > "$GROVE_TEST_INSERTED_FILE"
fi
exec "$GROVE_TEST_REAL_GIT" "$@"
`);
  const renamed = fx.grove(["--json", "rename", "demo", "renamed"], { env: {
    PATH: `${wrapperDirectory}:${process.env.PATH ?? ""}`,
    GROVE_TEST_INSERTED_FILE: join(newRoot, "unrelated.txt"),
    GROVE_TEST_REAL_GIT: realGit,
  } });
  assert.equal(renamed.status, 4, `${renamed.stderr}\n${renamed.stdout}`);
  assert.equal(json(renamed.stdout).outcome, "partial");
  assert.equal(readFileSync(join(newRoot, "unrelated.txt"), "utf8"), "unrelated concurrent content\n");
  assert.equal(readFileSync(join(oldRoot, "notes.txt"), "utf8"), "original loose content\n");
});

test("FR-023: metadata removal replay refuses workspace relocation and old-path reoccupation", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["configure", "demo", "--default-base", "main"]).status, 0);
  const metadata = join(fx.root, ".grove", "groves", "demo.json");
  const operation = beginOperation(fx.root, { kind: "grove-delete", scope: { grove: "demo" }, targetLocks: ["grove:demo"], targets: [{ selector: { grove: "demo" }, steps: [{ id: "metadata", kind: "central-metadata-remove", input: { path: metadata } }] }] });
  recordPending(operation, "metadata", { path: metadata, present: true });
  const movedRoot = join(dirname(fx.root), "relocated-metadata");
  renameSync(fx.root, movedRoot);
  mkdirSync(dirname(metadata), { recursive: true });
  writeFileSync(metadata, "unrelated sentinel\n");
  const resumed = fx.grove(["--workspace", movedRoot, "--json", "reconcile", "--operation", operation.id], { cwd: movedRoot });
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(readFileSync(metadata, "utf8"), "unrelated sentinel\n");
  assert.equal(existsSync(join(movedRoot, ".grove", "groves", "demo.json")), true);
});

test("FR-023: metadata removal replay refuses a same-path replacement", () => {
  const { fx } = setup();
  assert.equal(fx.grove(["configure", "demo", "--default-base", "main"]).status, 0);
  const metadata = join(fx.root, ".grove", "groves", "demo.json");
  const operation = beginOperation(fx.root, { kind: "grove-delete", scope: { grove: "demo" }, targetLocks: ["grove:demo"], targets: [{ selector: { grove: "demo" }, steps: [{ id: "metadata", kind: "central-metadata-remove", input: { path: metadata } }] }] });
  recordPending(operation, "metadata", { path: metadata, present: true });
  renameSync(metadata, `${metadata}.displaced`);
  writeFileSync(metadata, "replacement sentinel\n");
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 4, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(readFileSync(metadata, "utf8"), "replacement sentinel\n");
});
