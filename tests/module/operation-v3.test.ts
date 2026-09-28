import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { GroveError } from "../../src/errors.ts";
import { buildCreationOperationPlan, classifyCreationBranch } from "../../src/model/plan.ts";
import {
  abandonOperation,
  assertTargetsAvailable,
  beginOperation,
  recordStepFailure,
  scanOperations,
} from "../../src/store/operation.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

test("FR-018: an implicitly derived branch never adopts an existing ref", () => {
  assert.throws(
    () => classifyCreationBranch({ branch: "feature/work", explicit: false, localOid: "a".repeat(40), remoteOid: null, fromOid: null, defaultBaseOid: null, upstream: null }),
    (error) => GroveError.is(error) && error.kind === "refused-conflict",
  );
  assert.deepEqual(
    classifyCreationBranch({ branch: "feature/work", explicit: true, localOid: "a".repeat(40), remoteOid: null, fromOid: null, defaultBaseOid: null, upstream: null }),
    { mode: "existing", oid: "a".repeat(40), upstream: null },
  );
});

test("FR-021: creation owns the canonical worktree path and attached branch", () => {
  const path = resolve(tempDir("creation-target"), "trees", "work@alpha");
  const plan = buildCreationOperationPlan("tree-add", { grove: "work" }, [{
    repositoryId: "repo-alpha",
    repositoryAlias: "alpha",
    commonGitDir: resolve(tempDir("creation-repo"), "alpha.git"),
    grove: "work",
    tree: "work@alpha",
    path,
    branch: "work",
    oid: "a".repeat(40),
    mode: "new",
    upstream: null,
  }]);
  assert.deepEqual(plan.targetLocks, [
    "grove:work",
    "repository:repo-alpha:branch:work",
    `worktree:${path}`,
  ]);
});

test("FR-023/FR-025: abandon closes only conflicted forward work and never compensates", () => {
  const root = tempDir("forward-abandon");
  const operation = beginOperation(root, {
    kind: "tree-add",
    scope: { grove: "work" },
    targetLocks: ["grove:work"],
    targets: [{ selector: { grove: "work" }, steps: [{ id: "worktree", kind: "worktree-add", input: { path: "/work" } }] }],
  });
  assert.throws(() => abandonOperation(operation), (error) => GroveError.is(error) && error.kind === "refused-precondition");
  recordStepFailure(operation, "worktree", "conflicted", "stale-plan", { refRetained: true });
  assert.throws(() => assertTargetsAvailable(root, ["grove:work"]), (error) => GroveError.is(error) && error.kind === "refused-conflict");
  abandonOperation(operation);
  assert.doesNotThrow(() => assertTargetsAvailable(root, ["grove:work"]));
  const persisted = JSON.parse(readFileSync(operation.file, "utf8"));
  assert.equal(persisted.state, "abandoned");
  assert.equal(persisted.steps[0].error.detail.refRetained, true);
  assert.equal(existsSync(operation.file), true, "audit evidence is retained after abandon");
  assert.equal(scanOperations(root).records.length, 1);
});
