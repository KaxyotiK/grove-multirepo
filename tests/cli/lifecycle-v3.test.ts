/** Git-observed schema-3 lifecycle and forward-recovery integration. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture, managedAnchorPath, managedTrunkPath } from "../testkit/fixture.ts";
import { beginOperation, captureDirectoryTarget, recordCompleted, recordPending } from "../../src/store/operation.ts";
import { collectDirectoryMergeRoots } from "../../src/paths/fs.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

function setup() {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "demo", "--all"]).status, 0);
  return { fx, anchor: managedAnchorPath(fx, "alpha"), checkout: managedTrunkPath(fx, "alpha"), tree: join(fx.root, "groves", "demo", "trees", "demo@alpha") };
}

test("V3LIFE-01/003-git-native-grove-SC-003/003-git-native-grove-SC-008: Tree settings are advisory and explicit removal retains every ref", () => {
  const { fx, checkout } = setup();
  const configured = fx.grove(["--json", "tree", "configure", "demo", "demo@alpha", "--default-agent", "review"]);
  assert.equal(configured.status, 0, `${configured.stderr}\n${configured.stdout}`);
  assert.equal(json(configured.stdout).command, "tree configure");
  assert.equal(fx.grove(["tree", "reorder", "demo", "--tree", "demo@alpha"]).status, 0);
  const removed = fx.grove(["--json", "tree", "remove", "demo", "demo@alpha", "--forget-settings"]);
  assert.equal(removed.status, 0, `${removed.stderr}\n${removed.stdout}`);
  assert.equal(json(removed.stdout).command, "tree remove");
  assert.equal(execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/demo"], { cwd: checkout }).length, 0);
  const metadata = json(readFileSync(join(fx.root, ".grove", "groves", "demo.json"), "utf8"));
  assert.deepEqual(metadata.treeSettings, []);
});

test("trunk removal and repository unregister retain Git storage and refs", () => {
  const { fx, checkout } = setup();
  assert.equal(fx.grove(["trunk", "add", "alpha", "develop", "--from", "main"]).status, 0);
  const removed = fx.grove(["--json", "trunk", "remove", "alpha", "develop"]);
  assert.equal(removed.status, 0, `${removed.stderr}\n${removed.stdout}`);
  execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/develop"], { cwd: checkout });
  const unregistered = fx.grove(["--json", "repo", "remove", "alpha"]);
  assert.equal(unregistered.status, 0, `${unregistered.stderr}\n${unregistered.stdout}`);
  assert.equal(existsSync(join(managedAnchorPath(fx, "alpha"), "HEAD")), true);
  assert.equal(json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories.length, 0);
});

test("reconcile refuses removal when a detached HEAD loses its last protecting ref", () => {
  const { fx, anchor, tree } = setup();
  execFileSync("git", ["switch", "--detach", "-q"], { cwd: tree });
  writeFileSync(join(tree, "detached.txt"), "retain me\n");
  execFileSync("git", ["add", "detached.txt"], { cwd: tree });
  execFileSync("git", ["commit", "-q", "-m", "detached work"], { cwd: tree });
  const oid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  execFileSync("git", ["tag", "protect-detached", oid], { cwd: anchor });
  const repositoryId = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories[0].id;
  const operation = beginOperation(fx.root, { kind: "tree-remove", scope: { grove: "demo" }, targetLocks: ["grove:demo", `worktree:${tree}`], targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: anchor, headOid: oid, branch: null, force: false } }] }] });
  recordPending(operation, "remove", { registered: true, headOid: oid, dirty: false });
  execFileSync("git", ["tag", "-d", "protect-detached"], { cwd: anchor, stdio: "ignore" });

  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.notEqual(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(existsSync(tree), true, "the last worktree retaining the detached commit must remain");
  assert.equal(execFileSync("git", ["cat-file", "-t", oid], { cwd: anchor, encoding: "utf8" }).trim(), "commit");
});

test("archive, restore, rename, and delete use observed worktrees while retaining refs", () => {
  const { fx, checkout, tree } = setup();
  const refBefore = execFileSync("git", ["rev-parse", "refs/heads/demo"], { cwd: checkout, encoding: "utf8" }).trim();
  const archived = fx.grove(["--json", "archive", "demo", "--allow-unpushed"]);
  assert.equal(archived.status, 0, `${archived.stderr}\n${archived.stdout}`);
  assert.equal(existsSync(tree), false);
  let metadata = json(readFileSync(join(fx.root, ".grove", "groves", "demo.json"), "utf8"));
  assert.equal(metadata.state, "archived");
  assert.equal(metadata.archiveSnapshot.recipes.length, 1);
  assert.equal(execFileSync("git", ["rev-parse", "refs/heads/demo"], { cwd: checkout, encoding: "utf8" }).trim(), refBefore);

  const restored = fx.grove(["--json", "restore", "demo"]);
  assert.equal(restored.status, 0, `${restored.stderr}\n${restored.stdout}`);
  assert.equal(existsSync(join(tree, ".git")), true);
  writeFileSync(join(fx.root, "groves", "demo", "notes.txt"), "preserve me\n");
  mkdirSync(join(fx.root, "groves", "demo", "trees", "manual"), { recursive: true });
  writeFileSync(join(fx.root, "groves", "demo", "trees", "manual", "keep.txt"), "also preserve me\n");
  const renamed = fx.grove(["--json", "rename", "demo", "renamed"]);
  assert.equal(renamed.status, 0, `${renamed.stderr}\n${renamed.stdout}`);
  const renamedTree = join(fx.root, "groves", "renamed", "trees", "demo@alpha");
  assert.equal(existsSync(join(renamedTree, ".git")), true);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: renamedTree, encoding: "utf8" }).trim(), refBefore);
  assert.equal(readFileSync(join(fx.root, "groves", "renamed", "notes.txt"), "utf8"), "preserve me\n");
  assert.equal(readFileSync(join(fx.root, "groves", "renamed", "trees", "manual", "keep.txt"), "utf8"), "also preserve me\n");
  metadata = json(readFileSync(join(fx.root, ".grove", "groves", "renamed.json"), "utf8"));
  assert.equal(metadata.name, "renamed");
  assert.equal(existsSync(join(fx.root, ".grove", "groves", "demo.json")), false);

  const deleted = fx.grove(["--json", "delete", "renamed", "--allow-destructive-all"]);
  assert.equal(deleted.status, 0, `${deleted.stderr}\n${deleted.stdout}`);
  assert.equal(existsSync(renamedTree), false);
  assert.equal(execFileSync("git", ["rev-parse", "refs/heads/demo"], { cwd: checkout, encoding: "utf8" }).trim(), refBefore);
});

test("reconcile recognizes already-applied native remove and move lifecycle steps", () => {
  {
    const { fx, checkout, tree } = setup();
    const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
    const repositoryId = config.repositories[0].id;
    const headOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
    const operation = beginOperation(fx.root, { kind: "tree-remove", scope: { grove: "demo" }, targetLocks: [`worktree:${tree}`], targets: [{ selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: managedAnchorPath(fx, "alpha"), headOid, force: false } }] }] });
    recordPending(operation, "remove", { path: tree, headOid });
    execFileSync("git", ["worktree", "remove", "--", tree], { cwd: checkout });
    const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
    assert.deepEqual(json(resumed.stdout).detail.resumed[0].completed, ["remove"]);
  }
  {
    const { fx, checkout, tree } = setup();
    const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
    const repositoryId = config.repositories[0].id;
    const moved = join(fx.root, "moved-for-recovery");
    const headOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
    const operation = beginOperation(fx.root, { kind: "fix-move", scope: {}, targetLocks: [`worktree:${tree}`, `path:${moved}`], targets: [{ selector: { repositoryId, path: tree }, steps: [{ id: "move-0", kind: "worktree-move", input: { from: tree, to: moved, headOid, commonGitDir: managedAnchorPath(fx, "alpha") } }] }] });
    recordPending(operation, "move-0", { from: tree, to: moved, headOid });
    execFileSync("git", ["worktree", "move", "--", tree, moved], { cwd: checkout });
    const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
    assert.deepEqual(json(resumed.stdout).detail.resumed[0].completed, ["move-0"]);
  }
});

test("reconcile resumes normalized restore worktrees and tree-setting CAS steps", () => {
  {
    const { fx, anchor, tree } = setup();
    writeFileSync(join(fx.root, "groves", "demo", "NOTES.md"), "restore through operation\n");
    const headOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
    assert.equal(fx.grove(["archive", "demo", "--allow-unpushed"]).status, 0);
    const metadata = json(readFileSync(join(fx.root, ".grove", "groves", "demo.json"), "utf8"));
    const recipe = metadata.archiveSnapshot.recipes[0];
    const archivePath = metadata.archiveSnapshot.looseContentPath;
    const activePath = join(fx.root, "groves", "demo");
    const operation = beginOperation(fx.root, { kind: "grove-restore", scope: { grove: "demo" }, targetLocks: ["grove:demo", `worktree:${tree}`], targets: [
      { selector: { grove: "demo" }, steps: [{ id: "restore-content", kind: "directory-move", input: { from: archivePath, to: activePath } }] },
      { selector: { repositoryId: recipe.selector.repositoryId, grove: "demo", tree: recipe.selector.tree, path: tree }, steps: [{ id: "restore-0", kind: "restore-worktree", input: { commonGitDir: anchor, path: tree, branch: recipe.branch, oid: headOid } }] },
      { selector: { grove: "demo" }, steps: [{ id: "restore-metadata", kind: "central-metadata-update", input: { state: "active" } }] },
    ] });
    const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
    assert.equal(readFileSync(join(activePath, "NOTES.md"), "utf8"), "restore through operation\n");
    assert.equal(existsSync(join(tree, ".git")), true);
    assert.equal(json(readFileSync(join(fx.root, ".grove", "groves", "demo.json"), "utf8")).state, "active");
  }
  {
    const { fx, checkout, tree } = setup();
    assert.equal(fx.grove(["tree", "configure", "demo", "demo@alpha", "--default-agent", "review"]).status, 0);
    assert.equal(fx.grove(["tree", "reorder", "demo", "--tree", "demo@alpha"]).status, 0);
    const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
    const repositoryId = config.repositories[0].id;
    const headOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
    const selector = { repositoryId, tree: "demo@alpha" };
    const operation = beginOperation(fx.root, { kind: "tree-remove", scope: { grove: "demo" }, targetLocks: [`worktree:${tree}`], targets: [{ selector: { ...selector, grove: "demo", path: tree }, steps: [{ id: "remove", kind: "worktree-remove", input: { path: tree, commonGitDir: managedAnchorPath(fx, "alpha"), headOid, force: false } }, { id: "forget", kind: "central-metadata-update", input: { selector } }] }] });
    recordPending(operation, "remove", { path: tree, headOid });
    execFileSync("git", ["worktree", "remove", "--", tree], { cwd: checkout });
    recordCompleted(operation, "remove", { registered: false, refsRetained: true });
    recordPending(operation, "forget", { selector });
    const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
    assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
    const metadata = json(readFileSync(join(fx.root, ".grove", "groves", "demo.json"), "utf8"));
    assert.deepEqual(metadata.treeSettings, []);
    assert.deepEqual(metadata.treeOrder, []);
  }
});

test("rename recovery forward-merges loose and unregistered content without recursive deletion", () => {
  const { fx, checkout, tree } = setup();
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  const repositoryId = config.repositories[0].id;
  const oldRoot = join(fx.root, "groves", "demo");
  const newRoot = join(fx.root, "groves", "renamed");
  const movedTree = join(newRoot, "trees", "demo@alpha");
  const headOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  writeFileSync(join(oldRoot, "notes.txt"), "partially moved\n");
  mkdirSync(join(oldRoot, "trees", "manual"), { recursive: true });
  writeFileSync(join(oldRoot, "trees", "manual", "keep.txt"), "never delete\n");
  const mergeRoots = collectDirectoryMergeRoots(oldRoot, newRoot, [tree]);

  const operation = beginOperation(fx.root, {
    kind: "grove-rename",
    scope: { grove: "demo", newName: "renamed" },
    targetLocks: ["grove:demo", "grove:renamed", `worktree:${tree}`],
    targets: [
      { selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "move-0", kind: "worktree-move", input: { from: tree, to: movedTree, headOid, commonGitDir: managedAnchorPath(fx, "alpha") } }] },
      { selector: { grove: "demo" }, steps: [{ id: "move-content", kind: "directory-merge", input: { from: oldRoot, to: newRoot, mergeRoots } }, { id: "rename-metadata", kind: "central-metadata-update", input: { oldName: "demo", newName: "renamed" } }] },
    ],
  });
  recordPending(operation, "move-0", { from: tree, to: movedTree, headOid });
  mkdirSync(join(newRoot, "trees"), { recursive: true });
  execFileSync("git", ["worktree", "move", "--", tree, movedTree], { cwd: checkout });
  recordCompleted(operation, "move-0", { path: movedTree, headOid });
  recordPending(operation, "move-content", { from: oldRoot, to: newRoot, mergeRoots, fromIdentity: captureDirectoryTarget(fx.root, "active-grove", { grove: "demo" }, oldRoot), toIdentity: captureDirectoryTarget(fx.root, "active-grove", { grove: "renamed" }, newRoot) });
  renameSync(join(oldRoot, "notes.txt"), join(newRoot, "notes.txt"));

  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.deepEqual(json(resumed.stdout).detail.resumed[0].completed, ["move-content", "rename-metadata"]);
  assert.equal(existsSync(oldRoot), false);
  assert.equal(readFileSync(join(newRoot, "notes.txt"), "utf8"), "partially moved\n");
  assert.equal(readFileSync(join(newRoot, "trees", "manual", "keep.txt"), "utf8"), "never delete\n");
  assert.equal(json(readFileSync(join(fx.root, ".grove", "groves", "renamed.json"), "utf8")).name, "renamed");
});

test("ARCH-11: reconcile finishes archived metadata and later delete steps after crash boundaries", () => {
  const { fx, checkout, tree } = setup();
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  const repositoryId = config.repositories[0].id;
  const headOid = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).trim();
  const active = join(fx.root, "groves", "demo");
  const archived = join(fx.root, "archives", "demo");
  const archiveOperation = beginOperation(fx.root, {
    kind: "grove-archive",
    scope: { grove: "demo" },
    targetLocks: ["grove:demo", `worktree:${tree}`],
    targets: [
      { selector: { repositoryId, grove: "demo", tree: "demo@alpha", path: tree }, steps: [{ id: "remove-0", kind: "worktree-remove", input: { selector: { repositoryId, tree: "demo@alpha" }, repositoryAlias: "alpha", commonGitDir: managedAnchorPath(fx, "alpha"), branch: "refs/heads/demo", headOid, priorPath: tree, force: false } }] },
      { selector: { grove: "demo" }, steps: [{ id: "archive-content", kind: "directory-move", input: { from: active, to: archived } }, { id: "archive-metadata", kind: "central-metadata-update", input: { state: "archived" } }] },
    ],
  });
  recordPending(archiveOperation, "remove-0", { path: tree, headOid });
  execFileSync("git", ["worktree", "remove", "--", tree], { cwd: checkout });
  recordCompleted(archiveOperation, "remove-0", { registered: false, refsRetained: true });
  recordPending(archiveOperation, "archive-content", { from: active, to: archived });
  mkdirSync(join(fx.root, "archives"), { recursive: true });
  renameSync(active, archived);
  recordCompleted(archiveOperation, "archive-content", { archivedPath: archived });
  recordPending(archiveOperation, "archive-metadata", { revision: null, state: "active" });

  const resumedArchive = fx.grove(["--json", "reconcile", "--operation", archiveOperation.id]);
  assert.equal(resumedArchive.status, 0, `${resumedArchive.stderr}\n${resumedArchive.stdout}`);
  assert.deepEqual(json(resumedArchive.stdout).detail.resumed[0].completed, ["archive-metadata"]);
  const metadataPath = join(fx.root, ".grove", "groves", "demo.json");
  assert.equal(json(readFileSync(metadataPath, "utf8")).state, "archived");

  // FR-023: replay consent names the empty Tree container left by native removal.
  const deleteOperation = beginOperation(fx.root, {
    kind: "grove-delete",
    scope: { grove: "demo" },
    targetLocks: ["grove:demo"],
    targets: [{ selector: { grove: "demo" }, steps: [{ id: "delete-content", kind: "directory-remove", input: { path: archived, allowDestructive: true, discardedLoose: ["trees"] } }, { id: "delete-metadata", kind: "central-metadata-remove", input: { path: metadataPath } }] }],
  });
  recordPending(deleteOperation, "delete-content", { path: archived, present: true });
  const resumedDelete = fx.grove(["--json", "reconcile", "--operation", deleteOperation.id]);
  // Consolidated: one field per clause this row still owes. Three obligations previously rested on
  // a single `assert.equal(existsSync(metadataPath), false)` — one boolean standing in for resume,
  // completion, content removal and ref retention at once.
  // ASSERT:ARCH-11:RECONCILE-COMPLETES-ARCHIVE-AND-DELETE-STEPS-FORWARD
  assert.deepEqual(
    {
      status: resumedDelete.status,
      completedSteps: json(resumedDelete.stdout).detail.resumed[0].completed,
      contentRemoved: existsSync(archived) === false,
      metadataRemoved: existsSync(metadataPath) === false,
      branchRetained: (() => { try { execFileSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/demo"], { cwd: checkout }); return true; } catch { return false; } })(),
    },
    { status: 0, completedSteps: ["delete-content", "delete-metadata"], contentRemoved: true, metadataRemoved: true, branchRetained: true },
    `${resumedDelete.stderr}\n${resumedDelete.stdout}`,
  );
});

test("reconcile finishes pending repository unregistration without touching Git", () => {
  const { fx, checkout } = setup();
  const configPath = join(fx.root, ".grove", "config.json");
  const config = json(readFileSync(configPath, "utf8"));
  const registration = config.repositories[0];
  const operation = beginOperation(fx.root, {
    kind: "repo-remove",
    scope: { repositoryId: registration.id },
    targetLocks: [`repository:${registration.id}`],
    targets: [{ selector: { repositoryId: registration.id, repositoryAlias: registration.name }, steps: [{ id: "unregister", kind: "workspace-config-update", input: { registration, expectedRevision: config._rev } }] }],
  });
  recordPending(operation, "unregister", { revision: config._rev, registered: true });
  const resumed = fx.grove(["--json", "reconcile", "--operation", operation.id]);
  assert.equal(resumed.status, 0, `${resumed.stderr}\n${resumed.stdout}`);
  assert.equal(json(readFileSync(configPath, "utf8")).repositories.length, 0);
  assert.equal(existsSync(join(managedAnchorPath(fx, "alpha"), "HEAD")), true);
});

/**
 * `layout.trees` is a first-class configurable — `config/layout.ts` allows `{grove}`, `{tree}` and
 * `{repo}` plus arbitrary static segments, and `config-v3.md:22` restricts only `repositories`,
 * `groves` and `archives`. Every other test in this repository hardcodes the DEFAULT expansion
 * `groves/<g>/trees/<t>`, so the loose-content accounting could hardcode the literal segment
 * `trees` and a single descent level and still pass the whole suite. It did, at two sites, and
 * `delete` consequently refused at exit 5 for every Grove under a non-default template — then, on
 * the `--allow-destructive-all` its own remedy recommends, itemized live Tree worktrees as discarded
 * loose content, which is the exact inversion of ruling ④.
 */
for (const [label, template, treeDirectory] of [
  ["no `trees` segment at all", "groves/{grove}/{tree}", "demo@alpha"],
  ["a deeper nesting than the default", "groves/{grove}/trees/{repo}/{tree}", join("trees", "alpha", "demo@alpha")],
] as const) {
  test(`V3DES-04: delete accounts for Trees under a non-default layout.trees — ${label}`, () => {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    assert.equal(fx.grove(["config", "set", "--values", JSON.stringify({ layout: { trees: template } })]).status, 0);
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    assert.equal(fx.grove(["new", "demo", "--all"]).status, 0);
    assert.ok(existsSync(join(fx.root, "groves", "demo", treeDirectory)), `Tree not at the configured layout path ${treeDirectory}`);

    // Unforced: the Tree is accounted for, so there is nothing loose and nothing to force past.
    const deleted = fx.grove(["--json", "delete", "demo"]);
    assert.deepEqual(
      { exit: deleted.status, discardedLoose: json(deleted.stdout).targets[0].after?.discardedLoose ?? [], groveGone: !existsSync(join(fx.root, "groves", "demo")) },
      { exit: 0, discardedLoose: [], groveGone: true },
      `${deleted.stderr}\n${deleted.stdout}`,
    );
  });

  test(`V3DES-05: genuinely loose content under a non-default layout.trees is still refused and named — ${label}`, () => {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    assert.equal(fx.grove(["config", "set", "--values", JSON.stringify({ layout: { trees: template } })]).status, 0);
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    assert.equal(fx.grove(["new", "demo", "--all"]).status, 0);
    // A user file beside the Tree, at the same depth the layout puts Trees at.
    const stray = join(fx.root, "groves", "demo", treeDirectory, "..", "notes.txt");
    writeFileSync(stray, "keep me");
    const refused = fx.grove(["--json", "delete", "demo"]);
    assert.deepEqual(
      { exit: refused.status, names: /notes\.txt/.test(json(refused.stdout).error.why), stillThere: existsSync(stray) },
      { exit: 5, names: true, stillThere: true },
      `${refused.stderr}\n${refused.stdout}`,
    );
  });
}
