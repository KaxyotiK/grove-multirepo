/**
 * Ruling ④ (P4.4, ledger C-5/C-6). `--force` meant two unrelated things at once — "destroy content
 * that exists in only one place" and "proceed with work that is only local" — and reported neither.
 * A forced run said "all refs were retained", which is true and useless: the refs were never at
 * risk, while the uncommitted files and loose content that WERE destroyed went unmentioned.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { createGitGate } from "../testkit/git-gate.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

/** A Grove with one Tree carrying an uncommitted file and a loose file never known to Git. */
function dirtyGrove(name = "work"): { fx: Fixture; treePath: string; groveDir: string } {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", name, "--repo", "alpha"]).status, 0);
  const groveDir = join(fx.root, "groves", name);
  const treePath = join(groveDir, "trees", `${name}@alpha`);
  writeFileSync(join(treePath, "tracked-edit.txt"), "uncommitted\n");
  writeFileSync(join(treePath, "secret-draft.md"), "also uncommitted\n");
  writeFileSync(join(groveDir, "my-notes.txt"), "loose, never in git\n");
  mkdirSync(join(groveDir, "subdir"), { recursive: true });
  writeFileSync(join(groveDir, "subdir", "inner.txt"), "also loose\n");
  return { fx, treePath, groveDir };
}

function rootWorktreeGrove(): { fx: Fixture; marker: string } {
  const fx = makeFixture();
  const main = join(dirname(fx.root), "root-worktree-main");
  rmSync(fx.root, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, main]);
  execFileSync("git", ["worktree", "add", "-q", "-b", "scratch", fx.root], { cwd: main });
  assert.equal(fx.grove(["init", "."]).status, 0);
  assert.equal(fx.grove(["repo", "link", main, "--name", "self"]).status, 0);
  assert.equal(fx.grove(["new", "g1"]).status, 0);
  execFileSync("git", ["switch", "-q", "-c", "g1"], { cwd: fx.root });
  const marker = join(fx.root, "root-worktree-must-survive.txt");
  writeFileSync(marker, "workspace root content\n");
  return { fx, marker };
}

for (const { label, args } of [
  { label: "tree remove", args: ["tree", "remove", "g1", "g1@self", "--allow-destructive-all"] },
  { label: "archive", args: ["archive", "g1", "--allow-destructive-all"] },
  { label: "delete", args: ["delete", "g1", "--allow-destructive-all"] },
] as const) {
  test(`V3DES-06: ${label} never selects a worktree at the workspace root`, () => {
    const { fx, marker } = rootWorktreeGrove();
    const listed = fx.grove(["--json", "tree", "ls", "g1"]);
    const run = fx.grove([...args]);
    const listedPaths = listed.status === 0
      ? (json(listed.stdout).detail.trees as Array<{ path: string | { value?: string } }>).map((tree) => typeof tree.path === "string" ? tree.path : tree.path.value)
      : [];

    assert.deepEqual(
      {
        treeListStatus: listed.status,
        rootReportedAsTree: listedPaths.includes(fx.root),
        commandRefusedOrCompleted: [0, 2, 3, 4, 5].includes(run.status),
        rootGitFileSurvives: existsSync(join(fx.root, ".git")),
        workspaceConfigSurvives: existsSync(join(fx.root, ".grove", "config.json")),
        rootContentSurvives: existsSync(marker),
      },
      {
        treeListStatus: 0,
        rootReportedAsTree: false,
        commandRefusedOrCompleted: true,
        rootGitFileSurvives: true,
        workspaceConfigSurvives: true,
        rootContentSurvives: true,
      },
    );
  });
}

test("V3DES-07: a symlinked layout root cannot hide a peer worktree inside a removal target", () => {
  const fx = makeFixture({ repos: { self: [], alpha: [] } });
  const main = join(dirname(fx.root), "symlink-layout-main");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, main]);
  assert.equal(fx.grove(["init", "."]).status, 0);
  assert.equal(fx.grove(["repo", "link", main, "--name", "self"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[1]!.origin, "--name", "alpha"]).status, 0);
  const removalTarget = join(fx.root, "data");
  execFileSync("git", ["worktree", "add", "-q", "-b", "g1", removalTarget], { cwd: main });
  assert.equal(fx.grove(["new", "g1"]).status, 0);
  assert.equal(fx.grove(["new", "other", "--repo", "alpha"]).status, 0);
  const lexicalGroves = join(fx.root, "groves");
  const physicalGroves = join(removalTarget, "groves");
  const marker = join(physicalGroves, "other", "trees", "other@alpha", "work.txt");
  writeFileSync(join(lexicalGroves, "other", "trees", "other@alpha", "work.txt"), "must survive through the symlink\n");
  renameSync(lexicalGroves, physicalGroves);
  symlinkSync(join("data", "groves"), lexicalGroves);

  const doctor = fx.grove(["--json", "doctor"]);
  const removed = fx.grove(["--json", "tree", "remove", "g1", "g1@self", "--allow-destructive-all"]);

  assert.deepEqual(
    {
      refused: [2, 4].includes(removed.status),
      demotionDiagnosed: doctor.status === 0 && json(doctor.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "unsafe-tree-location"),
      targetSurvives: existsSync(removalTarget),
      peerSurvives: existsSync(dirname(marker)),
      uncommittedSurvives: existsSync(marker) ? readFileSync(marker, "utf8") : null,
      layoutLinkSurvives: lstatSync(lexicalGroves).isSymbolicLink(),
    },
    { refused: true, demotionDiagnosed: true, targetSurvives: true, peerSurvives: true, uncommittedSurvives: "must survive through the symlink\n", layoutLinkSurvives: true },
  );
});

test("V3DES-07: a worktree at its own Grove content root is diagnosed and never selected as a Tree", () => {
  const fx = makeFixture({ repos: { self: [] } });
  const main = join(dirname(fx.root), "grove-root-main");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, main]);
  assert.equal(fx.grove(["init", "."]).status, 0);
  assert.equal(fx.grove(["new", "g1"]).status, 0);
  assert.equal(fx.grove(["repo", "link", main, "--name", "self"]).status, 0);
  const groveRoot = join(fx.root, "groves", "g1");
  execFileSync("git", ["worktree", "add", "-q", "-b", "g1", groveRoot], { cwd: main });
  const marker = join(groveRoot, "must-survive.txt");
  writeFileSync(marker, "whole Grove content\n");

  const listed = fx.grove(["--json", "tree", "ls", "g1"]);
  const doctor = fx.grove(["--json", "doctor"]);
  const removed = fx.grove(["--json", "tree", "remove", "g1", "g1@self", "--allow-destructive-all"]);
  const paths = listed.status === 0
    ? (json(listed.stdout).detail.trees as Array<{ path: string | { value?: string } }>).map((tree) => typeof tree.path === "string" ? tree.path : tree.path.value)
    : [];

  assert.deepEqual(
    {
      listed: listed.status,
      selected: paths.includes(groveRoot),
      diagnosed: doctor.status === 0 && json(doctor.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "unsafe-tree-location" && diagnostic.facts.protectedKind === "grove-content-root"),
      refused: removed.status !== 0,
      marker: existsSync(marker) ? readFileSync(marker, "utf8") : null,
    },
    { listed: 0, selected: false, diagnosed: true, refused: true, marker: "whole Grove content\n" },
  );
});

function layoutAncestorWorktreeGrove(): { fx: Fixture; marker: string; ancestor: string } {
  const fx = makeFixture({ repos: { self: [], alpha: [] } });
  const main = join(dirname(fx.root), "layout-ancestor-main");
  execFileSync("git", ["clone", "-q", fx.repos[0]!.origin, main]);
  assert.equal(fx.grove(["init", "."]).status, 0);
  assert.equal(fx.grove(["repo", "link", main, "--name", "self"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[1]!.origin, "--name", "alpha"]).status, 0);
  const ancestor = join(fx.root, "groves");
  execFileSync("git", ["worktree", "add", "-q", "-b", "g1", ancestor], { cwd: main });
  assert.equal(fx.grove(["new", "g1"]).status, 0);
  assert.equal(fx.grove(["new", "other", "--repo", "alpha"]).status, 0);
  const marker = join(ancestor, "other", "trees", "other@alpha", "work.txt");
  writeFileSync(marker, "uncommitted content in another Grove\n");
  return { fx, marker, ancestor };
}

for (const { label, args } of [
  { label: "tree remove", args: ["tree", "remove", "g1", "g1@self", "--allow-destructive-all"] },
  { label: "archive", args: ["archive", "g1", "--allow-destructive-all", "--allow-unpushed"] },
  { label: "delete", args: ["delete", "g1", "--allow-destructive-all"] },
] as const) {
  test(`V3DES-07: ${label} never selects a worktree at a layout ancestor`, () => {
    const { fx, marker, ancestor } = layoutAncestorWorktreeGrove();
    const listed = fx.grove(["--json", "tree", "ls", "g1"]);
    const listedPaths = listed.status === 0
      ? (json(listed.stdout).detail.trees as Array<{ path: string | { value?: string } }>).map((tree) => typeof tree.path === "string" ? tree.path : tree.path.value)
      : [];
    const run = fx.grove([...args]);

    assert.deepEqual(
      {
        treeListStatus: listed.status,
        ancestorReportedAsTree: listedPaths.includes(ancestor),
        commandRefusedOrCompleted: [0, 2, 3, 4, 5].includes(run.status),
        ancestorWorktreeSurvives: existsSync(join(ancestor, ".git")),
        otherTreeSurvives: existsSync(dirname(marker)),
        uncommittedContentSurvives: existsSync(marker),
        uncommittedContent: existsSync(marker) ? readFileSync(marker, "utf8") : null,
        workspaceConfigSurvives: existsSync(join(fx.root, ".grove", "config.json")),
      },
      {
        treeListStatus: 0,
        ancestorReportedAsTree: false,
        commandRefusedOrCompleted: true,
        ancestorWorktreeSurvives: true,
        otherTreeSurvives: true,
        uncommittedContentSurvives: true,
        uncommittedContent: "uncommitted content in another Grove\n",
        workspaceConfigSurvives: true,
      },
    );
  });
}

test("FR-012D: a refused Tree removal leaves no replayable operation", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "g1", "--repo", "alpha"]).status, 0);
  const tree = join(fx.root, "groves", "g1", "trees", "g1@alpha");
  const marker = join(tree, "must-survive.txt");
  writeFileSync(marker, "do not replay\n");
  const operations = join(fx.root, ".grove", "operations");
  const before = readdirSync(operations).filter((file) => file.endsWith(".json"));
  const realGroves = join(dirname(fx.root), "moved-groves");
  renameSync(join(fx.root, "groves"), realGroves);
  symlinkSync(realGroves, join(fx.root, "groves"));

  const refused = fx.grove(["tree", "remove", "g1", "g1@alpha", "--allow-destructive-all"]);
  const afterRefusal = readdirSync(operations).filter((file) => file.endsWith(".json"));
  const reconciled = fx.grove(["reconcile"]);
  const records = afterRefusal.map((file) => JSON.parse(readFileSync(join(operations, file), "utf8")) as { state: string });

  assert.deepEqual(
    {
      refused: refused.status,
      operationCountUnchanged: afterRefusal.length === before.length,
      replayableRecord: records.some((record) => record.state === "running" || record.state === "recoverable"),
      reconcile: reconciled.status,
      treeSurvives: existsSync(tree),
      markerSurvives: existsSync(marker),
    },
    {
      refused: 2,
      operationCountUnchanged: true,
      replayableRecord: false,
      reconcile: 0,
      treeSurvives: true,
      markerSurvives: true,
    },
  );
});

test("FR-012D: delete re-observes after persistence and preserves a concurrently added peer worktree", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "g1", "--repo", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  const peer = join(fx.root, "groves", "g1", "peer");
  const marker = join(peer, "uncommitted.txt");
  const preload = join(fx.root, "inject-peer-after-plan.mjs");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(preload, `
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const originalRenameSync = fs.renameSync;
let injected = false;
fs.renameSync = function (from, to) {
  const result = originalRenameSync.apply(this, arguments);
  if (!injected && String(to).includes("/.grove/operations/") && String(to).endsWith(".json")) {
    const record = JSON.parse(fs.readFileSync(to, "utf8"));
    if (record.kind === "grove-delete") {
      injected = true;
      childProcess.execFileSync(process.env.GROVE_TEST_REAL_GIT, ["-C", process.env.GROVE_TEST_ANCHOR, "worktree", "add", "-q", "-b", "peer", process.env.GROVE_TEST_PEER, "main"]);
      fs.writeFileSync(process.env.GROVE_TEST_MARKER, "concurrent user data\\n");
    }
  }
  return result;
};
syncBuiltinESMExports();
`);

  const deleted = fx.grove(["--json", "delete", "g1", "--allow-destructive-all"], { env: {
    NODE_OPTIONS: `--import=${preload}`,
    GROVE_TEST_REAL_GIT: realGit,
    GROVE_TEST_ANCHOR: anchor,
    GROVE_TEST_PEER: peer,
    GROVE_TEST_MARKER: marker,
  } });

  assert.deepEqual(
    {
      refused: deleted.status,
      peerSurvives: existsSync(peer),
      uncommittedSurvives: existsSync(marker) ? readFileSync(marker, "utf8") : null,
      stillRegistered: execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: anchor, encoding: "utf8" }).includes(peer),
    },
    { refused: 4, peerSurvives: true, uncommittedSurvives: "concurrent user data\n", stillRegistered: true },
  );
});

function overlappingStorageGrove(): { fx: Fixture; repository: string; groveContent: string; operations: string } {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "alpha", "--repo", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  const groveContent = join(fx.root, "groves", "alpha");
  const repository = join(groveContent, "repository-storage");
  renameSync(anchor, repository);
  symlinkSync(repository, anchor);
  assert.equal(lstatSync(anchor).isSymbolicLink(), true);
  const operations = join(fx.root, ".grove", "operations");
  return { fx, repository, groveContent, operations };
}

test("V3DES-08: destructive consent cannot delete repository storage beneath Grove content", () => {
  const { fx, repository, operations } = overlappingStorageGrove();
  const before = readdirSync(operations).filter((file) => file.endsWith(".json")).length;

  const run = fx.grove(["--json", "delete", "alpha", "--allow-destructive-all"]);
  const output = run.stdout.trim() ? json(run.stdout) : null;
  const after = readdirSync(operations).filter((file) => file.endsWith(".json")).length;

  assert.deepEqual(
    {
      refused: run.status,
      operationCountUnchanged: after === before,
      repositorySurvives: existsSync(repository),
      bareHeadSurvives: existsSync(join(repository, "HEAD")),
      objectsSurvive: existsSync(join(repository, "objects")),
      claimsRefsRetained: JSON.stringify(output).includes('"refsRetained":true'),
    },
    {
      refused: 4,
      operationCountUnchanged: true,
      repositorySurvives: true,
      bareHeadSurvives: true,
      objectsSurvive: true,
      claimsRefsRetained: false,
    },
  );
});

test("V3DES-08: destructive consent cannot delete a trunk beneath Grove content", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "inside", "--repo", "alpha"]).status, 0);
  const trunkLink = join(fx.root, "trunks", "main@alpha");
  const content = join(fx.root, "groves", "inside");
  const trunk = join(content, "preserved-trunk");
  renameSync(trunkLink, trunk);
  symlinkSync(trunk, trunkLink);
  const operations = join(fx.root, ".grove", "operations");
  const before = readdirSync(operations).filter((file) => file.endsWith(".json")).length;

  const run = fx.grove(["--json", "delete", "inside", "--allow-destructive-all"]);

  assert.deepEqual(
    {
      refused: run.status,
      operationCountUnchanged: readdirSync(operations).filter((file) => file.endsWith(".json")).length === before,
      trunkSurvives: existsSync(trunk),
      trunkHeadSurvives: existsSync(join(trunk, ".git")),
    },
    { refused: 4, operationCountUnchanged: true, trunkSurvives: true, trunkHeadSurvives: true },
  );
});

for (const { label, args } of [
  { label: "archive", args: ["archive", "alpha", "--allow-destructive-all", "--allow-unpushed"] },
  { label: "rename", args: ["rename", "alpha", "renamed"] },
] as const) {
  test(`V3DES-08: ${label} cannot move repository storage as Grove content`, () => {
    const { fx, repository, operations } = overlappingStorageGrove();
    const before = readdirSync(operations).filter((file) => file.endsWith(".json")).length;
    const run = fx.grove(["--json", ...args]);
    const after = readdirSync(operations).filter((file) => file.endsWith(".json")).length;
    assert.deepEqual(
      {
        refused: run.status,
        operationCountUnchanged: after === before,
        repositorySurvives: existsSync(repository),
        bareHeadSurvives: existsSync(join(repository, "HEAD")),
        objectsSurvive: existsSync(join(repository, "objects")),
        claimsRefsRetained: JSON.stringify(run.stdout).includes('"refsRetained":true'),
      },
      {
        refused: 4,
        operationCountUnchanged: true,
        repositorySurvives: true,
        bareHeadSurvives: true,
        objectsSurvive: true,
        claimsRefsRetained: false,
      },
    );
  });
}

test("V3DES-08: restore cannot move archived content onto repository storage", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "alpha", "--repo", "alpha"]).status, 0);
  assert.equal(fx.grove(["archive", "alpha", "--allow-unpushed"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  const archived = join(fx.root, "archives", "alpha");
  const repository = join(archived, "repository-storage");
  renameSync(anchor, repository);
  symlinkSync(repository, anchor);
  const operations = join(fx.root, ".grove", "operations");
  const before = readdirSync(operations).filter((file) => file.endsWith(".json")).length;

  const restored = fx.grove(["--json", "restore", "alpha"]);

  assert.deepEqual(
    {
      refused: restored.status,
      operationCountUnchanged: readdirSync(operations).filter((file) => file.endsWith(".json")).length === before,
      repositorySurvives: existsSync(join(repository, "HEAD")) && existsSync(join(repository, "objects")),
      archiveSurvives: existsSync(archived),
    },
    { refused: 4, operationCountUnchanged: true, repositorySurvives: true, archiveSurvives: true },
  );
});

test("V3DES-01: a forced delete itemizes every discarded uncommitted file and loose entry", () => {
  const { fx, groveDir } = dirtyGrove();
  const run = fx.grove(["delete", "work", "--allow-destructive-all"]);
  const machine = fx.grove(["--json", "ls"]);

  const { fx: fx2, groveDir: dir2 } = dirtyGrove("work2");
  const jsonRun = fx2.grove(["--json", "delete", "work2", "--allow-destructive-all"]);
  const target = json(jsonRun.stdout).targets[0].after;

  assert.deepEqual(
    {
      status: run.status,
      humanNamesTrackedEdit: /tracked-edit\.txt/.test(run.stdout),
      humanNamesLooseFile: /my-notes\.txt/.test(run.stdout),
      humanNamesLooseDir: /subdir/.test(run.stdout),
      jsonNamesTrackedEdit: JSON.stringify(target.discardedWork).includes("tracked-edit.txt"),
      jsonLoose: [...target.discardedLoose].sort(),
      groveGone: existsSync(groveDir),
      otherGroveGone: existsSync(dir2),
      stillListed: json(machine.stdout).detail.groves.some((g: any) => g.name === "work"),
    },
    {
      status: 0,
      humanNamesTrackedEdit: true,
      humanNamesLooseFile: true,
      humanNamesLooseDir: true,
      jsonNamesTrackedEdit: true,
      // FR-023: per path, so a later addition inside subdir/ is never covered by the name.
      jsonLoose: ["my-notes.txt", "subdir/", "subdir/inner.txt"],
      groveGone: false,
      otherGroveGone: false,
      stillListed: false,
    },
  );
});

test("V3DES-02: forced archive itemizes discarded uncommitted files and preserves loose content", () => {
  const { fx } = dirtyGrove();
  const run = fx.grove(["archive", "work", "--allow-destructive-all", "--allow-unpushed"]);
  const archived = join(fx.root, "archives", "work");

  // The asymmetry is the point: archive MOVES the directory, so loose content survives; delete
  // destroys it. Asserting on the filesystem rather than on Grove's own report.
  assert.deepEqual(
    {
      status: run.status,
      humanNamesTrackedEdit: /tracked-edit\.txt/.test(run.stdout),
      looseFilePreserved: existsSync(join(archived, "my-notes.txt")),
      looseDirPreserved: existsSync(join(archived, "subdir", "inner.txt")),
      humanClaimsLooseDiscarded: /discarded loose content/.test(run.stdout),
    },
    {
      status: 0,
      humanNamesTrackedEdit: true,
      looseFilePreserved: true,
      looseDirPreserved: true,
      humanClaimsLooseDiscarded: false,
    },
  );
});

test("V3DES-03: --force is no longer accepted", () => {
  const { fx } = dirtyGrove();
  const results = [
    fx.grove(["--json", "delete", "work", "--force"]),
    fx.grove(["--json", "archive", "work", "--force", "--allow-unpushed"]),
    fx.grove(["--json", "tree", "remove", "work", "work@alpha", "--force"]),
  ];
  assert.deepEqual(results.map((r) => r.status), [2, 2, 2]);
  // And the Grove is still there — a rejected flag must not have destroyed anything.
  assert.equal(json(fx.grove(["--json", "ls"]).stdout).detail.groves.some((g: any) => g.name === "work"), true);
});

test("V3DES-01: the refusal itemizes too, not only the forced run", () => {
  // This test was VACUOUS as first written. Its regex was /my-notes\.txt|subdir|uncommitted/, and
  // the third alternative is a substring of the generic message "…: uncommitted work" that the
  // non-itemizing code always produced — so it passed for exactly the behaviour it forbids.
  // Named filenames only, and the machine detail must carry them too (⑦).
  const { fx } = dirtyGrove();
  const human = fx.grove(["delete", "work"]);
  const refused = fx.grove(["--json", "delete", "work"]);
  const error = json(refused.stdout).error;
  const detail = error.detail as { uncommitted?: { tree: string; path: string }[]; loose?: string[] } | undefined;
  const humanText = `${human.stdout}\n${human.stderr}`;

  assert.deepEqual(
    {
      humanStatus: human.status,
      humanNamesLooseFile: /my-notes\.txt/.test(humanText),
      humanNamesLooseDir: /subdir/.test(humanText),
      status: refused.status,
      whyNamesBothFiles: /tracked-edit\.txt/.test(String(error.why)) && /secret-draft\.md/.test(String(error.why)),
      whyNamesLooseContent: /my-notes\.txt/.test(String(error.why)) && /subdir/.test(String(error.why)),
      detailPaths: (detail?.uncommitted ?? []).map((entry) => entry.path).sort(),
      detailLoose: [...(detail?.loose ?? [])].sort(),
      // The bare word that made the original assertion unfailable must not be doing the work.
      notPassingOnTheGenericPhrase: !/^[^:]*: uncommitted work$/.test(String(error.why).split("; ")[0] ?? ""),
    },
    {
      humanStatus: 5,
      humanNamesLooseFile: true,
      humanNamesLooseDir: true,
      status: 5,
      whyNamesBothFiles: true,
      whyNamesLooseContent: true,
      detailPaths: ["secret-draft.md", "tracked-edit.txt"],
      detailLoose: ["my-notes.txt", "subdir/", "subdir/inner.txt"],
      notPassingOnTheGenericPhrase: true,
    },
  );
});

test("V3DES-01: tree remove itemizes on the refusal and on the forced run", () => {
  // Ruling ④ / constitution Principle IV bind every destructive command, not just archive/delete.
  // `tree remove` reported a COUNT ("2 uncommitted file(s)") and then destroyed the files naming
  // none, while the constitution's MUST had already shipped.
  const { fx } = dirtyGrove();
  const refused = fx.grove(["--json", "tree", "remove", "work", "work@alpha"]);
  const forced = fx.grove(["tree", "remove", "work", "work@alpha", "--allow-destructive-all"]);
  const { fx: machineFx } = dirtyGrove("machine-tree");
  const machine = machineFx.grove(["--json", "tree", "remove", "machine-tree", "machine-tree@alpha", "--allow-destructive-all"]);
  const machineAfter = json(machine.stdout).targets[0].after;

  assert.deepEqual(
    {
      refusedStatus: refused.status,
      refusalNamesFiles: /tracked-edit\.txt/.test(String(json(refused.stdout).error.why)),
      refusalDetail: ((json(refused.stdout).error.detail ?? {}).uncommitted ?? []).sort(),
      forcedStatus: forced.status,
      forcedNamesFiles: /tracked-edit\.txt/.test(forced.stdout),
      machineStatus: machine.status,
      machineDiscardedFiles: (machineAfter.discardedWork ?? []).map((change: { path: string }) => change.path).sort(),
    },
    {
      refusedStatus: 5,
      refusalNamesFiles: true,
      refusalDetail: ["secret-draft.md", "tracked-edit.txt"],
      forcedStatus: 0,
      forcedNamesFiles: true,
      machineStatus: 0,
      machineDiscardedFiles: ["secret-draft.md", "tracked-edit.txt"],
    },
  );
});

test("V3DES-01: forced Tree removal refuses when discarded work cannot be enumerated", () => {
  const { fx, treePath } = dirtyGrove("unreadable-tree");
  const operationCountBefore = readdirSync(join(fx.root, ".grove", "operations")).length;
  const gate = createGitGate([
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["status", "--porcelain"],
  ], { failExitCode: 42 });
  let removed;
  try {
    removed = fx.grove(["--json", "tree", "remove", "unreadable-tree", "unreadable-tree@alpha", "--allow-destructive-all"], { env: gate.env });
  } finally {
    gate.dispose();
  }
  assert.deepEqual(
    { status: removed.status, operationDelta: readdirSync(join(fx.root, ".grove", "operations")).length - operationCountBefore, treeSurvives: existsSync(treePath), workSurvives: existsSync(join(treePath, "secret-draft.md")) },
    { status: 5, operationDelta: 0, treeSurvives: true, workSurvives: true },
  );
});

test("V3DES-01: content under trees/ that is not a worktree is loose, not exempt", () => {
  // `delete` exempted the WHOLE `trees/` subtree on the assumption that everything inside it is a
  // worktree the worktree-remove steps already handled. Nothing enforced that, so a user directory
  // at groves/<name>/trees/<anything> was destroyed by an UNFORCED delete at exit 0 — with the
  // machine result affirmatively reporting `discardedLoose: []`. `rename` already preserves such
  // content, so delete was inconsistent with its own sibling as well as with ruling ④.
  const { fx, groveDir } = dirtyGrove();
  const stray = join(groveDir, "trees", "stray-notes");
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, "important.txt"), "six months of notes\n");

  const refused = fx.grove(["--json", "delete", "work"]);
  const survived = existsSync(join(stray, "important.txt"));
  const forced = fx.grove(["--json", "delete", "work", "--allow-destructive-all"]);
  const target = json(forced.stdout).targets[0].after;

  assert.deepEqual(
    {
      unforcedRefused: refused.status,
      survivedTheRefusal: survived,
      forcedStatus: forced.status,
      namedInDiscardedLoose: ["trees/stray-notes/", "trees/stray-notes/important.txt"].every((path) => (target.discardedLoose ?? []).includes(path)),
      humanNamesIt: /trees\/stray-notes/.test(fx.grove(["ls"]).stdout) === false,
    },
    { unforcedRefused: 5, survivedTheRefusal: true, forcedStatus: 0, namedInDiscardedLoose: true, humanNamesIt: true },
  );
});
