/** Built-artifact regression coverage for every configurable layout template. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Fixture, RunResult } from "../testkit/fixture.ts";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

function expectSuccess(result: RunResult): any {
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return json(result.stdout);
}

function initWithLayout(fx: Fixture, layout: Record<string, string>): void {
  assert.equal(fx.grove(["init"]).status, 0);
  const configured = fx.grove(["config", "set", "--values", JSON.stringify({ layout })]);
  assert.equal(configured.status, 0, `${configured.stderr}\n${configured.stdout}`);
}

function addRepository(fx: Fixture, name: string): any {
  const source = fx.repos.find((repo) => repo.name === name);
  assert.ok(source, `fixture repository ${name} is missing`);
  return expectSuccess(fx.grove(["--json", "repo", "add", source.origin, "--name", name]));
}

test("V3LAY-01: all storage roots compile before registration and repositories then pin their root", () => {
  const fx = makeFixture({ repos: { alpha: ["develop"] } });
  const layout = {
    repositories: "storage/repos/{repo}",
    trunks: "work/trunks/{trunk}",
    groves: "work/groves/{grove}",
    trees: "work/groves/{grove}/trees/{tree}",
    archives: "work/archives/{grove}",
  };
  initWithLayout(fx, layout);

  const repositoryPath = join(fx.root, "storage", "repos", "alpha");
  const mainPath = join(fx.root, "work", "trunks", "main@alpha");
  const added = addRepository(fx, "alpha");
  assert.deepEqual(
    {
      commonGitDir: added.targets[0].after.commonGitDir,
      trunkPath: added.targets[0].after.trunkPath,
      bare: execFileSync("git", ["rev-parse", "--is-bare-repository"], { cwd: repositoryPath, encoding: "utf8" }).trim(),
      trunkPresent: existsSync(join(mainPath, ".git")),
    },
    { commonGitDir: repositoryPath, trunkPath: mainPath, bare: "true", trunkPresent: true },
  );

  const developPath = join(fx.root, "work", "trunks", "develop@alpha");
  const trunk = expectSuccess(fx.grove(["--json", "trunk", "add", "alpha", "develop"]));
  const listedTrunks = expectSuccess(fx.grove(["--json", "trunk", "ls", "alpha"]));
  const syncedTrunks = expectSuccess(fx.grove(["--json", "sync", "--trunks", "--strategy", "fetch-only"]));
  assert.deepEqual(
    {
      reported: trunk.targets[0].after.path,
      present: existsSync(join(developPath, ".git")),
      listedPaths: listedTrunks.detail.trunks.map((entry: any) => entry.path.value ?? entry.path).sort(),
      syncedPaths: syncedTrunks.targets.map((target: any) => target.selector.path).sort(),
      strategy: syncedTrunks.detail.strategy,
    },
    {
      reported: developPath,
      present: true,
      listedPaths: [developPath, mainPath].sort(),
      syncedPaths: [developPath, mainPath].sort(),
      strategy: "fetch-only",
    },
  );

  const refused = fx.grove([
    "--json",
    "config",
    "set",
    "--values",
    JSON.stringify({ layout: { repositories: "relocated/{repo}" } }),
  ]);
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  assert.deepEqual(
    {
      status: refused.status,
      kind: json(refused.stdout).error.kind,
      configured: config.layout.repositories,
      repositoryStillPresent: existsSync(join(repositoryPath, "HEAD")),
    },
    { status: 2, kind: "invalid-input", configured: layout.repositories, repositoryStillPresent: true },
  );
});

test("V3LAY-02: the main lifecycle honors deeper Grove and archive roots", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initWithLayout(fx, {
    repositories: "storage/repos/{repo}",
    trunks: "work/trunks/{trunk}",
    groves: "work/groves/{grove}",
    trees: "work/groves/{grove}/trees/{tree}",
    archives: "work/archives/{grove}",
  });
  addRepository(fx, "alpha");
  addRepository(fx, "beta");

  const active = join(fx.root, "work", "groves", "demo");
  const alphaTree = join(active, "trees", "demo@alpha");
  const betaTree = join(active, "trees", "demo@beta");
  const created = expectSuccess(fx.grove(["--json", "new", "demo", "--repo", "alpha"]));
  const added = expectSuccess(fx.grove(["--json", "tree", "add", "demo", "beta"]));
  assert.deepEqual(
    {
      newPath: created.targets[0].after.path,
      addedPath: added.targets[0].after.path,
      alphaPresent: existsSync(join(alphaTree, ".git")),
      betaPresent: existsSync(join(betaTree, ".git")),
    },
    { newPath: alphaTree, addedPath: betaTree, alphaPresent: true, betaPresent: true },
  );

  const doctor = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(doctor.diagnostics, []);

  writeFileSync(join(active, "NOTES.md"), "custom archive notes\n");
  mkdirSync(join(active, "scratch", "nested"), { recursive: true });
  writeFileSync(join(active, "scratch", "nested", "idea.txt"), "keep this\n");
  const archivePath = join(fx.root, "work", "archives", "demo");
  const archived = expectSuccess(fx.grove(["--json", "archive", "demo", "--allow-unpushed"]));
  assert.deepEqual(
    {
      path: archived.targets[0].after.archivePath,
      activeGone: !existsSync(active),
      archivePresent: existsSync(archivePath),
      recipes: archived.targets[0].after.recipes,
      notes: readFileSync(join(archivePath, "NOTES.md"), "utf8"),
      nested: readFileSync(join(archivePath, "scratch", "nested", "idea.txt"), "utf8"),
    },
    {
      path: archivePath,
      activeGone: true,
      archivePresent: true,
      recipes: 2,
      notes: "custom archive notes\n",
      nested: "keep this\n",
    },
  );

  const manifestPath = join(fx.root, ".grove", "groves", "demo.json");
  const manifest = readFileSync(manifestPath, "utf8");
  rmSync(manifestPath);
  const archiveObservedWithoutMetadata = expectSuccess(fx.grove(["--json", "doctor"]));
  const orphanedArchive = archiveObservedWithoutMetadata.diagnostics.find((entry: any) => entry.code === "orphaned-archive");
  assert.equal(orphanedArchive?.facts.path, archivePath, JSON.stringify(archiveObservedWithoutMetadata));
  writeFileSync(manifestPath, manifest);
  const archivedListing = expectSuccess(fx.grove(["--json", "ls", "--archived"]));
  assert.deepEqual(archivedListing.detail.groves.map((entry: any) => entry.name), ["demo"]);

  const restored = expectSuccess(fx.grove(["--json", "restore", "demo"]));
  assert.deepEqual(
    {
      trees: restored.targets[0].after.trees,
      archiveGone: !existsSync(archivePath),
      alphaRestored: existsSync(join(alphaTree, ".git")),
      betaRestored: existsSync(join(betaTree, ".git")),
      notes: readFileSync(join(active, "NOTES.md"), "utf8"),
      nested: readFileSync(join(active, "scratch", "nested", "idea.txt"), "utf8"),
    },
    {
      trees: 2,
      archiveGone: true,
      alphaRestored: true,
      betaRestored: true,
      notes: "custom archive notes\n",
      nested: "keep this\n",
    },
  );

  const renamedRoot = join(fx.root, "work", "groves", "renamed");
  const renamed = expectSuccess(fx.grove(["--json", "rename", "demo", "renamed"]));
  assert.deepEqual(
    {
      path: renamed.targets[0].after.path,
      oldGone: !existsSync(active),
      alphaMoved: existsSync(join(renamedRoot, "trees", "demo@alpha", ".git")),
      betaMoved: existsSync(join(renamedRoot, "trees", "demo@beta", ".git")),
    },
    { path: renamedRoot, oldGone: true, alphaMoved: true, betaMoved: true },
  );

  const deleted = expectSuccess(fx.grove(["--json", "delete", "renamed", "--allow-destructive-all"]));
  assert.deepEqual(
    {
      deleted: deleted.targets[0].after.deleted,
      discardedWork: deleted.targets[0].after.discardedWork,
      discardedLoose: deleted.targets[0].after.discardedLoose,
      rootGone: !existsSync(renamedRoot),
      alphaRefRetained: execFileSync("git", ["show-ref", "--verify", "--hash", "refs/heads/demo"], {
        cwd: join(fx.root, "storage", "repos", "alpha"),
        encoding: "utf8",
      }).trim().length > 0,
      betaRefRetained: execFileSync("git", ["show-ref", "--verify", "--hash", "refs/heads/demo"], {
        cwd: join(fx.root, "storage", "repos", "beta"),
        encoding: "utf8",
      }).trim().length > 0,
    },
    {
      deleted: true,
      discardedWork: [],
      discardedLoose: ["NOTES.md", "scratch/", "scratch/nested/", "scratch/nested/idea.txt"],
      rootGone: true,
      alphaRefRetained: true,
      betaRefRetained: true,
    },
  );
});

test("V3LAY-03: a flat Tree template needs no literal trees segment", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initWithLayout(fx, { trees: "groves/{grove}/{tree}" });
  addRepository(fx, "alpha");
  addRepository(fx, "beta");

  const active = join(fx.root, "groves", "flat");
  const alphaTree = join(active, "flat@alpha");
  const betaTree = join(active, "flat@beta");
  const created = expectSuccess(fx.grove(["--json", "new", "flat", "--repo", "alpha"]));
  const added = expectSuccess(fx.grove(["--json", "tree", "add", "flat", "beta"]));
  assert.deepEqual(
    { newPath: created.targets[0].after.path, addedPath: added.targets[0].after.path },
    { newPath: alphaTree, addedPath: betaTree },
  );

  writeFileSync(join(active, "NOTES.md"), "flat notes\n");
  mkdirSync(join(active, "scratch", "nested"), { recursive: true });
  writeFileSync(join(active, "scratch", "nested", "draft.txt"), "flat draft\n");
  const archivePath = join(fx.root, "archives", "flat");
  expectSuccess(fx.grove(["--json", "archive", "flat", "--allow-unpushed"]));
  assert.deepEqual(
    {
      notes: readFileSync(join(archivePath, "NOTES.md"), "utf8"),
      nested: readFileSync(join(archivePath, "scratch", "nested", "draft.txt"), "utf8"),
      activeGone: !existsSync(active),
    },
    { notes: "flat notes\n", nested: "flat draft\n", activeGone: true },
  );
  expectSuccess(fx.grove(["--json", "restore", "flat"]));
  assert.deepEqual(
    {
      alphaRestored: existsSync(join(alphaTree, ".git")),
      betaRestored: existsSync(join(betaTree, ".git")),
      defaultTreesAbsent: !existsSync(join(active, "trees")),
      notes: readFileSync(join(active, "NOTES.md"), "utf8"),
      nested: readFileSync(join(active, "scratch", "nested", "draft.txt"), "utf8"),
    },
    {
      alphaRestored: true,
      betaRestored: true,
      defaultTreesAbsent: true,
      notes: "flat notes\n",
      nested: "flat draft\n",
    },
  );

  const misplaced = join(fx.root, "misplaced-flat-alpha");
  execFileSync("git", ["worktree", "move", "--", alphaTree, misplaced], {
    cwd: join(fx.root, "repos", "alpha"),
  });
  const movedDoctor = expectSuccess(fx.grove(["--json", "doctor"]));
  const movedDiagnostic = movedDoctor.diagnostics.find((entry: any) => entry.code === "misplaced");
  assert.deepEqual(
    { currentPath: movedDiagnostic?.facts.currentPath, expectedPath: movedDiagnostic?.facts.expectedPath },
    { currentPath: misplaced, expectedPath: alphaTree },
  );
  const movedBack = expectSuccess(fx.grove(["--json", "fix", "--move"]));
  const clean = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(
    {
      moves: movedBack.detail.moves.map(({ from, to }: any) => ({ from, to })),
      alphaRestored: existsSync(join(alphaTree, ".git")),
      misplacedGone: !existsSync(misplaced),
      diagnostics: clean.diagnostics,
    },
    {
      moves: [{ from: misplaced, to: alphaTree }],
      alphaRestored: true,
      misplacedGone: true,
      diagnostics: [],
    },
  );

  const renamedRoot = join(fx.root, "groves", "renamed");
  const renamed = expectSuccess(fx.grove(["--json", "rename", "flat", "renamed"]));
  assert.deepEqual(
    {
      path: renamed.targets[0].after.path,
      oldGone: !existsSync(active),
      alphaMoved: existsSync(join(renamedRoot, "flat@alpha", ".git")),
      betaMoved: existsSync(join(renamedRoot, "flat@beta", ".git")),
      defaultTreeSegmentAbsent: !existsSync(join(renamedRoot, "trees")),
    },
    { path: renamedRoot, oldGone: true, alphaMoved: true, betaMoved: true, defaultTreeSegmentAbsent: true },
  );

  const deleted = expectSuccess(fx.grove(["--json", "delete", "renamed", "--allow-destructive-all"]));
  assert.deepEqual(
    {
      discardedLoose: deleted.targets[0].after.discardedLoose,
      rootGone: !existsSync(renamedRoot),
    },
    { discardedLoose: ["NOTES.md", "scratch/", "scratch/nested/", "scratch/nested/draft.txt"], rootGone: true },
  );
});

test("V3LAY-04: repository-grouped Trees permit the same Tree identity in two repositories", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initWithLayout(fx, { trees: "groves/{grove}/trees/{repo}/{tree}" });
  const alphaRepository = addRepository(fx, "alpha");
  const betaRepository = addRepository(fx, "beta");
  expectSuccess(fx.grove(["--json", "new", "grouped"]));

  const alphaPath = join(fx.root, "groves", "grouped", "trees", "alpha", "shared");
  const betaPath = join(fx.root, "groves", "grouped", "trees", "beta", "shared");
  const alpha = expectSuccess(
    fx.grove(["--json", "tree", "add", "grouped", "alpha", "--name", "shared", "--branch", "grouped", "--from", "main"]),
  );
  const beta = expectSuccess(
    fx.grove(["--json", "tree", "add", "grouped", "beta", "--name", "shared", "--branch", "grouped", "--from", "main"]),
  );
  const listed = expectSuccess(fx.grove(["--json", "tree", "ls", "grouped"]));
  const doctor = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(
    {
      alphaReported: alpha.targets[0].after.path,
      betaReported: beta.targets[0].after.path,
      alphaPresent: existsSync(join(alphaPath, ".git")),
      betaPresent: existsSync(join(betaPath, ".git")),
      listedPaths: listed.detail.trees.map((tree: any) => tree.path.value ?? tree.path).sort(),
      listedIdentities: listed.detail.trees.map((tree: any) => tree.tree).sort(),
      repositoryIds: listed.targets.map((target: any) => target.selector.repositoryId).sort(),
      diagnostics: doctor.diagnostics,
    },
    {
      alphaReported: alphaPath,
      betaReported: betaPath,
      alphaPresent: true,
      betaPresent: true,
      listedPaths: [alphaPath, betaPath].sort(),
      listedIdentities: ["shared", "shared"],
      repositoryIds: [
        alphaRepository.targets[0].after.repositoryId,
        betaRepository.targets[0].after.repositoryId,
      ].sort(),
      diagnostics: [],
    },
  );

  const active = join(fx.root, "groves", "grouped");
  writeFileSync(join(active, "NOTES.md"), "grouped notes\n");
  mkdirSync(join(active, "scratch", "nested"), { recursive: true });
  writeFileSync(join(active, "scratch", "nested", "draft.txt"), "grouped draft\n");
  const archivePath = join(fx.root, "archives", "grouped");
  expectSuccess(fx.grove(["--json", "archive", "grouped", "--allow-unpushed"]));
  assert.deepEqual(
    {
      notes: readFileSync(join(archivePath, "NOTES.md"), "utf8"),
      nested: readFileSync(join(archivePath, "scratch", "nested", "draft.txt"), "utf8"),
      activeGone: !existsSync(active),
    },
    { notes: "grouped notes\n", nested: "grouped draft\n", activeGone: true },
  );
  expectSuccess(fx.grove(["--json", "restore", "grouped"]));
  assert.deepEqual(
    {
      alphaRestored: existsSync(join(alphaPath, ".git")),
      betaRestored: existsSync(join(betaPath, ".git")),
      notes: readFileSync(join(active, "NOTES.md"), "utf8"),
      nested: readFileSync(join(active, "scratch", "nested", "draft.txt"), "utf8"),
    },
    {
      alphaRestored: true,
      betaRestored: true,
      notes: "grouped notes\n",
      nested: "grouped draft\n",
    },
  );

  const refused = fx.grove(["--json", "delete", "grouped"]);
  const refusal = json(refused.stdout).error;
  assert.deepEqual(
    {
      status: refused.status,
      loose: [...(refusal.detail?.loose ?? [])].sort(),
      rootRetained: existsSync(active),
    },
    { status: 5, loose: ["NOTES.md", "scratch/", "scratch/nested/", "scratch/nested/draft.txt"], rootRetained: true },
  );
  const deleted = expectSuccess(fx.grove(["--json", "delete", "grouped", "--allow-destructive-all"]));
  assert.deepEqual(
    {
      discardedLoose: [...deleted.targets[0].after.discardedLoose].sort(),
      rootGone: !existsSync(active),
    },
    { discardedLoose: ["NOTES.md", "scratch/", "scratch/nested/", "scratch/nested/draft.txt"], rootGone: true },
  );
});

function treeSelectors(fx: Fixture, grove: string): Array<{ repositoryId: string; tree: string; path: string }> {
  return expectSuccess(fx.grove(["--json", "tree", "ls", grove])).targets
    .map(({ selector }: any) => ({ repositoryId: selector.repositoryId, tree: selector.tree, path: selector.path }))
    .sort((left: any, right: any) => left.path.localeCompare(right.path));
}

function misplacedFacts(doctor: any): Array<{ subject: unknown; currentPath: unknown; expectedPath: unknown }> {
  return doctor.diagnostics
    .filter((entry: any) => entry.code === "misplaced")
    .map((entry: any) => ({ subject: entry.subject, currentPath: entry.facts.currentPath, expectedPath: entry.facts.expectedPath }));
}

// Issue #18: the `{repo}` segment of a repository-grouped Tree path was extracted but never compared
// with the repository whose `git worktree list` reports the worktree, so a Tree moved by native Git
// into another repository's slot was silently treated as conforming.
test("V3LAY-07: issue #18 — a Tree in another repository's grouped slot is misplaced and fix --move returns it with its work to its owner's slot", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initWithLayout(fx, { trees: "groves/{grove}/trees/{repo}/{tree}" });
  const alphaId = addRepository(fx, "alpha").targets[0].after.repositoryId;
  const betaId = addRepository(fx, "beta").targets[0].after.repositoryId;
  expectSuccess(fx.grove(["--json", "new", "d", "--all"]));

  const created = join(fx.root, "groves", "d", "trees", "alpha", "d@alpha");
  const misplaced = join(fx.root, "groves", "d", "trees", "beta", "x@alpha");
  // Git's rename to `x@alpha` is accepted as the Tree's identity (constitution I); only the
  // `{repo}` slot disagrees with the observed owner, so the destination keeps the observed name.
  const ownerSlot = join(fx.root, "groves", "d", "trees", "alpha", "x@alpha");
  const betaTree = join(fx.root, "groves", "d", "trees", "beta", "d@beta");

  // Work that exists in one place only: an unpushed commit, a tracked edit, an untracked file,
  // and ignored files (one inside an ignored directory).
  const inTree = (cwd: string, args: string[]): string =>
    execFileSync("git", ["-c", "user.email=fixture@grove.test", "-c", "user.name=Fixture", ...args], { cwd, encoding: "utf8" });
  writeFileSync(join(created, ".gitignore"), "*.log\nbuild/\n");
  writeFileSync(join(created, "unpushed.txt"), "local only\n");
  inTree(created, ["add", ".gitignore", "unpushed.txt"]);
  inTree(created, ["commit", "-qm", "unpushed work"]);
  const unpushedOid = inTree(created, ["rev-parse", "HEAD"]).trim();
  writeFileSync(join(created, "README.md"), "# alpha\ntracked edit\n");
  writeFileSync(join(created, "untracked.txt"), "untracked work\n");
  writeFileSync(join(created, "debug.log"), "ignored log\n");
  mkdirSync(join(created, "build"));
  writeFileSync(join(created, "build", "alpha.bin"), "ignored build output\n");
  const statusArgs = ["status", "--porcelain=v1", "--ignored=matching", "--untracked-files=all"];
  const statusBefore = inTree(created, statusArgs);

  execFileSync("git", ["worktree", "move", "--", created, misplaced], { cwd: join(fx.root, "repos", "alpha") });

  const doctor = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(
    misplacedFacts(doctor),
    [{ subject: { kind: "worktree", repositoryId: alphaId, grove: "d", tree: "x@alpha" }, currentPath: misplaced, expectedPath: ownerSlot }],
  );

  const dryRun = expectSuccess(fx.grove(["--json", "fix", "--move", "--dry-run"]));
  assert.deepEqual(
    {
      dryRun: dryRun.detail.dryRun,
      moves: dryRun.detail.moves.map(({ from, to }: any) => ({ from, to })),
      ownerSlotStillAbsent: !existsSync(ownerSlot),
      misplacedStillPresent: existsSync(join(misplaced, ".git")),
    },
    { dryRun: true, moves: [{ from: misplaced, to: ownerSlot }], ownerSlotStillAbsent: true, misplacedStillPresent: true },
  );

  const fixed = expectSuccess(fx.grove(["--json", "fix", "--move"]));
  const clean = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(
    {
      outcome: fixed.outcome,
      moves: fixed.detail.moves.map(({ from, to }: any) => ({ from, to })),
      misplacedGone: !existsSync(misplaced),
      diagnostics: clean.diagnostics,
      trees: treeSelectors(fx, "d"),
    },
    {
      outcome: "complete",
      moves: [{ from: misplaced, to: ownerSlot }],
      misplacedGone: true,
      diagnostics: [],
      trees: [
        { repositoryId: alphaId, tree: "x@alpha", path: ownerSlot },
        { repositoryId: betaId, tree: "d@beta", path: betaTree },
      ].sort((left, right) => left.path.localeCompare(right.path)),
    },
  );

  assert.deepEqual(
    {
      head: inTree(ownerSlot, ["rev-parse", "HEAD"]).trim(),
      branch: inTree(ownerSlot, ["symbolic-ref", "HEAD"]).trim(),
      status: inTree(ownerSlot, statusArgs),
      unpushed: readFileSync(join(ownerSlot, "unpushed.txt"), "utf8"),
      tracked: readFileSync(join(ownerSlot, "README.md"), "utf8"),
      untracked: readFileSync(join(ownerSlot, "untracked.txt"), "utf8"),
      ignored: readFileSync(join(ownerSlot, "debug.log"), "utf8"),
      ignoredNested: readFileSync(join(ownerSlot, "build", "alpha.bin"), "utf8"),
      worktreeList: inTree(join(fx.root, "repos", "alpha"), ["worktree", "list", "--porcelain"]).includes(`worktree ${ownerSlot}\n`),
    },
    {
      head: unpushedOid,
      branch: "refs/heads/d",
      status: statusBefore,
      unpushed: "local only\n",
      tracked: "# alpha\ntracked edit\n",
      untracked: "untracked work\n",
      ignored: "ignored log\n",
      ignoredNested: "ignored build output\n",
      worktreeList: true,
    },
  );
});

test("V3LAY-08: owner-slot conformance leaves correctly placed Trees, same-slot renames, and layouts without {repo} unchanged", () => {
  // Repository-grouped layout: a native rename that stays in the owner's own `{repo}` slot, and the
  // untouched peer Tree in its correct slot, both remain conforming with nothing to move.
  const grouped = makeFixture({ repos: { alpha: [], beta: [] } });
  initWithLayout(grouped, { trees: "groves/{grove}/trees/{repo}/{tree}" });
  const groupedAlphaId = addRepository(grouped, "alpha").targets[0].after.repositoryId;
  const groupedBetaId = addRepository(grouped, "beta").targets[0].after.repositoryId;
  expectSuccess(grouped.grove(["--json", "new", "d", "--all"]));
  const renamedInSlot = join(grouped.root, "groves", "d", "trees", "alpha", "y@alpha");
  const betaInSlot = join(grouped.root, "groves", "d", "trees", "beta", "d@beta");
  execFileSync("git", ["worktree", "move", "--", join(grouped.root, "groves", "d", "trees", "alpha", "d@alpha"), renamedInSlot], {
    cwd: join(grouped.root, "repos", "alpha"),
  });
  const groupedDoctor = expectSuccess(grouped.grove(["--json", "doctor"]));
  const groupedFix = grouped.grove(["--json", "fix", "--move", "--dry-run"]);
  assert.deepEqual(
    {
      diagnostics: groupedDoctor.diagnostics,
      fixStatus: groupedFix.status,
      fixKind: json(groupedFix.stdout).error.kind,
      trees: treeSelectors(grouped, "d"),
    },
    {
      diagnostics: [],
      fixStatus: 5,
      fixKind: "refused-precondition",
      trees: [
        { repositoryId: groupedAlphaId, tree: "y@alpha", path: renamedInSlot },
        { repositoryId: groupedBetaId, tree: "d@beta", path: betaInSlot },
      ].sort((left, right) => left.path.localeCompare(right.path)),
    },
  );

  // Layouts without `{repo}` have no repository slot to compare: a Tree whose name follows another
  // repository's naming convention is still the observed owner's conforming Tree.
  for (const trees of ["groves/{grove}/trees/{tree}", "groves/{grove}/{tree}"]) {
    const fx = makeFixture({ repos: { alpha: [], beta: [] } });
    if (trees === "groves/{grove}/trees/{tree}") assert.equal(fx.grove(["init"]).status, 0);
    else initWithLayout(fx, { trees });
    const alphaId = addRepository(fx, "alpha").targets[0].after.repositoryId;
    const betaId = addRepository(fx, "beta").targets[0].after.repositoryId;
    expectSuccess(fx.grove(["--json", "new", "d", "--all"]));
    const treeRoot = trees === "groves/{grove}/{tree}" ? join(fx.root, "groves", "d") : join(fx.root, "groves", "d", "trees");
    const renamed = join(treeRoot, "x@beta");
    execFileSync("git", ["worktree", "move", "--", join(treeRoot, "d@alpha"), renamed], { cwd: join(fx.root, "repos", "alpha") });
    const doctor = expectSuccess(fx.grove(["--json", "doctor"]));
    assert.deepEqual(
      { layout: trees, diagnostics: doctor.diagnostics, trees: treeSelectors(fx, "d") },
      {
        layout: trees,
        diagnostics: [],
        trees: [
          { repositoryId: alphaId, tree: "x@beta", path: renamed },
          { repositoryId: betaId, tree: "d@beta", path: join(treeRoot, "d@beta") },
        ].sort((left, right) => left.path.localeCompare(right.path)),
      },
    );
  }
});

// Repository names are unique under ASCII case-folding (`caseFoldKey`), so a `{repo}` segment that
// spells the owner's name in another case names the owner, not another repository. On a
// case-insensitive volume it is also the same directory, so no move could ever repair it.
test("V3LAY-09: a {repo} slot spelling its owner's name in another case is conforming and an unfiltered fix --move still repairs another misplaced Tree", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initWithLayout(fx, { trees: "groves/{grove}/trees/{repo}/{tree}" });
  const alphaId = addRepository(fx, "alpha").targets[0].after.repositoryId;
  const betaId = addRepository(fx, "beta").targets[0].after.repositoryId;
  expectSuccess(fx.grove(["--json", "new", "d", "--all"]));
  expectSuccess(fx.grove(["--json", "new", "e", "--all"]));
  const alphaStore = join(fx.root, "repos", "alpha");

  const caseVariant = join(fx.root, "groves", "d", "trees", "Alpha", "x@alpha");
  execFileSync("git", ["worktree", "move", "--", join(fx.root, "groves", "d", "trees", "alpha", "d@alpha"), caseVariant], { cwd: alphaStore });
  const eHome = join(fx.root, "groves", "e", "trees", "alpha", "e@alpha");
  const eMisplaced = join(fx.root, "groves", "e", "trees", "beta", "e@alpha");
  execFileSync("git", ["worktree", "move", "--", eHome, eMisplaced], { cwd: alphaStore });

  const doctor = expectSuccess(fx.grove(["--json", "doctor"]));
  const fixed = fx.grove(["--json", "fix", "--move"]);
  const fixedResult = json(fixed.stdout);
  const clean = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(
    {
      misplaced: misplacedFacts(doctor),
      fixStatus: fixed.status,
      moves: fixedResult.detail?.moves?.map(({ from, to }: any) => ({ from, to })) ?? fixedResult.error,
      eRestored: existsSync(join(eHome, ".git")),
      diagnosticsAfter: clean.diagnostics,
      dTrees: treeSelectors(fx, "d"),
    },
    {
      misplaced: [{ subject: { kind: "worktree", repositoryId: alphaId, grove: "e", tree: "e@alpha" }, currentPath: eMisplaced, expectedPath: eHome }],
      fixStatus: 0,
      moves: [{ from: eMisplaced, to: eHome }],
      eRestored: true,
      diagnosticsAfter: [],
      dTrees: [
        { repositoryId: alphaId, tree: "x@alpha", path: caseVariant },
        { repositoryId: betaId, tree: "d@beta", path: join(fx.root, "groves", "d", "trees", "beta", "d@beta") },
      ].sort((left, right) => left.path.localeCompare(right.path)),
    },
  );
});

test("V3LAY-05: doctor and fix move a native relocation back to a repository-grouped path", () => {
  const fx = makeFixture();
  initWithLayout(fx, {
    repositories: "storage/{repo}",
    groves: "work/groves/{grove}",
    trees: "work/groves/{grove}/trees/{repo}/{tree}",
  });
  const addedRepository = addRepository(fx, "alpha");
  expectSuccess(fx.grove(["--json", "new", "demo", "--all"]));

  const expected = join(fx.root, "work", "groves", "demo", "trees", "alpha", "demo@alpha");
  const misplaced = join(fx.root, "misplaced-demo-alpha");
  execFileSync("git", ["worktree", "move", "--", expected, misplaced], {
    cwd: join(fx.root, "storage", "alpha"),
  });

  const doctor = expectSuccess(fx.grove(["--json", "doctor"]));
  const diagnostic = doctor.diagnostics.find((entry: any) => entry.code === "misplaced");
  assert.ok(diagnostic, JSON.stringify(doctor));
  assert.deepEqual(
    {
      subject: diagnostic.subject,
      currentPath: diagnostic.facts.currentPath,
      expectedPath: diagnostic.facts.expectedPath,
    },
    {
      subject: {
        kind: "worktree",
        repositoryId: addedRepository.targets[0].after.repositoryId,
        grove: "demo",
        tree: "demo@alpha",
      },
      currentPath: misplaced,
      expectedPath: expected,
    },
  );

  const dryRun = expectSuccess(fx.grove(["--json", "fix", "--move", "--dry-run"]));
  assert.deepEqual(
    {
      dryRun: dryRun.detail.dryRun,
      moves: dryRun.detail.moves.map(({ from, to }: any) => ({ from, to })),
      expectedStillAbsent: !existsSync(expected),
      misplacedStillPresent: existsSync(join(misplaced, ".git")),
    },
    {
      dryRun: true,
      moves: [{ from: misplaced, to: expected }],
      expectedStillAbsent: true,
      misplacedStillPresent: true,
    },
  );

  const fixed = expectSuccess(fx.grove(["--json", "fix", "--move"]));
  const clean = expectSuccess(fx.grove(["--json", "doctor"]));
  assert.deepEqual(
    {
      dryRun: fixed.detail.dryRun,
      moves: fixed.detail.moves.map(({ from, to }: any) => ({ from, to })),
      expectedPresent: existsSync(join(expected, ".git")),
      misplacedGone: !existsSync(misplaced),
      diagnostics: clean.diagnostics,
    },
    {
      dryRun: false,
      moves: [{ from: misplaced, to: expected }],
      expectedPresent: true,
      misplacedGone: true,
      diagnostics: [],
    },
  );
});

test("V3LAY-06: config set refuses ancestor layout languages without changing config", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const configPath = join(fx.root, ".grove", "config.json");
  const before = readFileSync(configPath, "utf8");
  const unsafe = [
    { groves: "{grove}", trees: "{grove}/trees/{tree}" },
    { trunks: "work/trunks/{trunk}", groves: "work/{grove}", trees: "work/{grove}/trees/{tree}" },
    { archives: "{grove}" },
    { repositories: "storage/{repo}", groves: "Storage/{grove}", trees: "Storage/{grove}/trees/{tree}" },
  ];

  for (const layout of unsafe) {
    const refused = fx.grove(["--json", "config", "set", "--values", JSON.stringify({ layout })]);
    const error = json(refused.stdout).error;
    assert.deepEqual(
      {
        status: refused.status,
        kind: error.kind,
        remedyNamesLayout: /layout/i.test(String(error.remedy)),
        configUnchanged: readFileSync(configPath, "utf8") === before,
      },
      { status: 2, kind: "invalid-input", remedyNamesLayout: true, configUnchanged: true },
    );
  }
});
