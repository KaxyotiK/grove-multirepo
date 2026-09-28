import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_LAYOUT, assertNoLayoutCollisions, compileLayout, expandArchivePath, expandGrovePath, expandRepositoryPath, expandTreePath, expandTrunkPath, resolveLayoutTarget, validateLayoutConfig } from "../../src/config/layout.ts";
import { DEFAULT_CONVENTIONS, expectedBranch, expectedTreeName, validateNamingConfig } from "../../src/config/conventions.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

test("v3 default layout expands managed stores and peer worktrees through one compiler", () => {
  const layout = compileLayout("/workspace", validateLayoutConfig(DEFAULT_LAYOUT));
  assert.equal(DEFAULT_LAYOUT.trunks, "trunks/{trunk}");
  assert.equal(expandRepositoryPath(layout, "api"), "/workspace/repos/api");
  assert.equal(expandTrunkPath(layout, "feature_a@api"), "/workspace/trunks/feature_a@api");
  assert.equal(expandGrovePath(layout, "demo"), "/workspace/groves/demo");
  assert.equal(expandTreePath(layout, "demo", "demo@api", "api"), "/workspace/groves/demo/trees/demo@api");
  assert.equal(expandArchivePath(layout, "demo"), "/workspace/archives/demo");
});

test("trunk layouts accept only one whole-segment allocated trunk token", () => {
  assert.throws(() => validateLayoutConfig({ ...DEFAULT_LAYOUT, trunks: "trunks/{repo}/{branchKey}" }), /does not allow|must contain/i);
  assert.throws(() => validateLayoutConfig({ ...DEFAULT_LAYOUT, trunks: "trunks/{repo}" }), /does not allow|must contain/i);
});

test("layout targets refuse a contained symlink whose lexical and canonical identities differ", () => {
  const root = tempDir("layout-contained-link");
  const actual = join(root, "actual-trunks");
  mkdirSync(actual, { recursive: true });
  symlinkSync(actual, join(root, "trunks"));
  const layout = compileLayout(root, DEFAULT_LAYOUT);
  const target = expandTrunkPath(layout, "main@api");
  assert.throws(() => resolveLayoutTarget(layout, target), /canonical|symlink|one path identity/i);
});

test("templates reject embedded/repeated tokens, invalid nesting, and case-fold collisions", () => {
  assert.throws(() => validateLayoutConfig({ ...DEFAULT_LAYOUT, repositories: "repos/x-{repo}" }), /entire segment/i);
  assert.throws(() => validateLayoutConfig({ ...DEFAULT_LAYOUT, trees: "other/{grove}/{tree}" }), /nested under/i);
  assert.throws(() => assertNoLayoutCollisions(["/workspace/groves/Demo", "/workspace/groves/demo"]), /collide/i);
  assert.throws(() => validateNamingConfig({ branch: "{grove}{grove}", tree: "{repo}" }), /unique/i);
  assert.throws(() => validateLayoutConfig({ ...DEFAULT_LAYOUT, repositories: "shared/{repo}", groves: "shared/{grove}", trees: "shared/{grove}/trees/{tree}" }), /overlapping path/i);
});

test("layout roles reject prefix languages that can place live roots inside one another", () => {
  const unsafe = [
    { groves: "{grove}", trees: "{grove}/trees/{tree}" },
    { trunks: "work/trunks/{trunk}", groves: "work/{grove}", trees: "work/{grove}/trees/{tree}" },
    { archives: "{grove}" },
    { groves: "work/groves/{grove}", trees: "work/groves/{grove}/trees/{tree}", archives: "work/{grove}" },
    { repositories: "repos/{repo}", groves: "Repos/{grove}", trees: "Repos/{grove}/trees/{tree}" },
    { trunks: "Work/live/{trunk}", groves: "work/{grove}", trees: "work/{grove}/trees/{tree}" },
  ];
  for (const layout of unsafe) {
    assert.throws(() => validateLayoutConfig({ ...DEFAULT_LAYOUT, ...layout }), /overlapping path/i);
  }
});

test("Tree convention resolves before branch convention", () => {
  const conventions = validateNamingConfig(DEFAULT_CONVENTIONS);
  const tree = expectedTreeName(conventions, { grove: "demo", repo: "api" });
  assert.equal(tree, "demo@api");
  assert.equal(expectedBranch(conventions, { branchPrefix: "jc/", grove: "demo", repo: "api", tree }), "jc/demo");
});
