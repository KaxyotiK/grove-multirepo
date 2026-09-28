import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, initV2Workspace } from "../testkit/fixture.ts";
import { createGitArgvRecorder } from "../testkit/git-fault.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

test("V3DPF-01 / 003-git-native-grove-SC-019: deleting a clean two-Tree Grove completes within a bounded Git-call count", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initV2Workspace(fx);
  const created = fx.grove(["new", "g", "--all"]);
  assert.equal(created.status, 0, created.stderr || created.stdout);

  const recorder = createGitArgvRecorder();
  let deleted;
  let calls;
  try {
    deleted = fx.grove(["--json", "delete", "g"], { env: recorder.env });
    calls = recorder.argv();
  } finally {
    recorder.dispose();
  }
  assert.equal(deleted.status, 0, deleted.stderr || deleted.stdout);
  assert.equal(existsSync(join(fx.root, "groves", "g")), false);
  assert.ok(calls.length <= 120, `delete used ${calls.length} Git calls; expected at most 120`);
});

test("V3DPF-02: plain delete still refuses dirty and untracked Tree work", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  initV2Workspace(fx);
  const created = fx.grove(["new", "g", "--all"]);
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const tree = join(fx.root, "groves", "g", "trees", "g@alpha");
  writeFileSync(join(tree, "README.md"), "changed\n");
  writeFileSync(join(tree, "untracked.txt"), "keep\n");
  const deleted = fx.grove(["--json", "delete", "g"]);
  assert.equal(deleted.status, 5, deleted.stderr || deleted.stdout);
  assert.equal(JSON.parse(deleted.stdout).error.kind, "refused-precondition");
  assert.equal(existsSync(join(tree, "untracked.txt")), true);
});

test("V3DPF-02: plain delete still refuses .grove-cmux loose content with or without projection.json", () => {
  for (const projection of [false, true]) {
    const fx = makeFixture();
    initV2Workspace(fx);
    const created = fx.grove(["new", "g", "--all"]);
    assert.equal(created.status, 0, created.stderr || created.stdout);
    const marker = join(fx.root, "groves", "g", ".grove-cmux");
    mkdirSync(marker);
    if (projection) writeFileSync(join(marker, "projection.json"), "{}\n");
    const refused = fx.grove(["--json", "delete", "g"]);
    assert.equal(refused.status, 5, refused.stderr || refused.stdout);
    assert.equal(JSON.parse(refused.stdout).error.kind, "refused-precondition");
    assert.match(refused.stdout, /\.grove-cmux/);
    assert.equal(existsSync(marker), true);
    const forced = fx.grove(["delete", "g", "--allow-destructive-all"]);
    assert.equal(forced.status, 0, forced.stderr || forced.stdout);
    assert.equal(existsSync(marker), false);
  }
});
