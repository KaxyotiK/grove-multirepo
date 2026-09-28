/** Corrective result-order witness for configuration-default multi-target commands. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { loadWorkspaceAt, saveWorkspace } from "../../src/config/workspace.ts";
import { makeFixture } from "../testkit/fixture.ts";
import { commandResultExit } from "../../src/model/result.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

test("FR-032A: all-repository fetch order is independent of registration array order", async () => {
  const fx = makeFixture({ repos: { zeta: [], alpha: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repository of fx.repos) assert.equal(fx.grove(["repo", "add", repository.origin, "--name", repository.name]).status, 0);
  const first = fx.grove(["--json", "repo", "fetch"]);
  assert.equal(first.status, 0, `${first.stderr}\n${first.stdout}`);
  const firstOrder = json(first.stdout).targets.map((target: any) => target.selector.repositoryId);
  const workspace = loadWorkspaceAt(fx.root);
  await saveWorkspace(workspace, { ...workspace.config, repositories: [...workspace.config.repositories].reverse() });
  const second = fx.grove(["--json", "repo", "fetch"]);
  assert.equal(second.status, 0, `${second.stderr}\n${second.stdout}`);
  const secondOrder = json(second.stdout).targets.map((target: any) => target.selector.repositoryId);
  assert.deepEqual(secondOrder, firstOrder);
});

test("FR-031: a recovered policy refusal retains exit code 3", () => {
  assert.equal(commandResultExit({ schemaVersion: 1, command: "reconcile", outcome: "partial", targets: [{ selector: {}, before: null, action: "resume-operation", after: null, reason: "refused-policy" }], diagnostics: [] }), 3);
});
