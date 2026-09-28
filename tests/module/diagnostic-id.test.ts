import assert from "node:assert/strict";
import { test } from "node:test";
import { auditWorktree, diagnosticId, planMove } from "../../src/model/conformance.ts";

test("diagnostic identity ignores presentation and observation timestamps", () => {
  const identity = {
    version: 1,
    code: "misplaced",
    subject: { kind: "tree", repositoryId: "repo-1", tree: "api" },
    facts: { currentPath: "/outside/api", expectedPath: "/workspace/groves/x/trees/api" },
  } as const;
  assert.equal(diagnosticId(identity), diagnosticId({ ...identity }));
});

test("misplaced diagnostics contain complete native move facts and produce an explicit plan", () => {
  const diagnostics = auditWorktree({ repositoryId: "repo-1", tree: "api", currentPath: { utf8: "/outside/api", raw: Buffer.from("/outside/api"), display: "/outside/api" }, expectedPath: "/workspace/groves/x/trees/api", branch: null });
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(planMove(diagnostics[0]!), { kind: "move-worktree", from: "/outside/api", to: "/workspace/groves/x/trees/api", diagnosticId: diagnostics[0]!.id });
});

test("remedy-changing expected facts produce distinct IDs", () => {
  const base = {
    version: 1,
    code: "misplaced",
    subject: { kind: "tree", repositoryId: "repo-1", tree: "api" },
  } as const;
  assert.notEqual(
    diagnosticId({ ...base, facts: { currentPath: "/a", expectedPath: "/b" } }),
    diagnosticId({ ...base, facts: { currentPath: "/a", expectedPath: "/c" } }),
  );
});

