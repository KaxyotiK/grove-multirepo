import assert from "node:assert/strict";
import { after, test } from "node:test";
import { indexRepositoriesByCommonDir, scanCandidateTreeDirectories } from "../../src/model/observed.ts";
import { observeWorkspace } from "../../src/model/observed.ts";
import { Git, createGitRunner } from "../../src/git/adapter.ts";
import { validateWorkspaceConfig, type LoadedWorkspace } from "../../src/config/workspace.ts";
import { DEFAULT_LAYOUT, compileLayout } from "../../src/config/layout.ts";
import { DEFAULT_CONVENTIONS } from "../../src/config/conventions.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

test("repository indexing diagnoses duplicate canonical common-directory anchors", () => {
  const indexed = indexRepositoriesByCommonDir([
    { registration: { id: "r1", name: "api" }, commonGitDir: "/repo/.git" },
    { registration: { id: "r2", name: "web" }, commonGitDir: "/repo/.git" },
  ]);
  assert.equal(indexed.index.size, 0);
  assert.equal(indexed.diagnostics.length, 1);
  assert.equal(indexed.diagnostics[0]?.code, "duplicate-repository-anchor");
});

test("candidate discovery is bounded to the compiled Tree template depth", () => {
  const root = tempDir("candidate-v3");
  mkdirSync(join(root, "groves", "demo", "trees", "api"), { recursive: true });
  mkdirSync(join(root, "unrelated", "deep", "groves", "fake", "trees", "web"), { recursive: true });
  assert.deepEqual(scanCandidateTreeDirectories(compileLayout(root, DEFAULT_LAYOUT)), [{ path: join(root, "groves", "demo", "trees", "api"), grove: "demo", tree: "api" }]);
});

test("one bounded observation reads an ordinary linked repository directly from Git", async () => {
  const root = tempDir("observed-v3");
  const repo = join(root, "external");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "fixture@grove.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
  const commonGitDir = realpathSync(join(repo, ".git"));
  const config = validateWorkspaceConfig("cfg", {
    kind: "workspace", schemaVersion: 3, _rev: 0, id: "w1", name: "workspace",
    layout: DEFAULT_LAYOUT, conventions: DEFAULT_CONVENTIONS, defaults: {}, agents: {},
    repositories: [{ id: "r1", name: "api", location: { kind: "linked", commonGitDir }, remote: null, trunk: "main" }],
  });
  const workspace: LoadedWorkspace = { root, path: join(root, ".grove", "config.json"), config, meta: { rev: 0, size: 0, mtimeNs: 0n, sha256: "test" } };
  const snapshot = await observeWorkspace(workspace, new Git(createGitRunner()));
  assert.equal(snapshot.repositories.length, 1);
  assert.equal(snapshot.repositories[0]?.problem, null);
  assert.equal(snapshot.repositories[0]?.worktrees[0]?.unborn, true);
  assert.equal(snapshot.repositories[0]?.worktrees[0]?.branch?.utf8, "refs/heads/main");
  assert.ok(snapshot.completedAt >= snapshot.startedAt);
});

function loadedWorkspace(root: string, repositories: unknown[] = []): LoadedWorkspace {
  const config = validateWorkspaceConfig("cfg", {
    kind: "workspace", schemaVersion: 3, _rev: 0, id: "w1", name: "workspace",
    layout: DEFAULT_LAYOUT, conventions: DEFAULT_CONVENTIONS, defaults: {}, agents: {}, repositories,
  });
  return { root, path: join(root, ".grove", "config.json"), config, meta: { rev: 0, size: 0, mtimeNs: 0n, sha256: "test" } };
}

test("bounded candidate discovery diagnoses a Git repository under Tree layout that is not registered", async () => {
  const root = tempDir("unregistered-candidate-v3");
  const candidate = join(root, "groves", "demo", "trees", "api");
  mkdirSync(candidate, { recursive: true });
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: candidate });

  const snapshot = await observeWorkspace(loadedWorkspace(root), new Git(createGitRunner()));

  assert.equal(snapshot.repositories.length, 1);
  assert.equal(snapshot.repositories[0]?.registrationStatus, "unregistered");
  assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.code === "unregistered-repository"));
});

test("advisory selectors with no observed Tree are reported as stale metadata", async () => {
  const root = tempDir("stale-metadata-v3");
  mkdirSync(join(root, ".grove", "groves"), { recursive: true });
  writeFileSync(join(root, ".grove", "groves", "demo.json"), `${JSON.stringify({
    kind: "grove", schemaVersion: 3, _rev: 0, id: "g1", name: "demo", state: "active",
    createdAt: "2026-08-21T00:00:00.000Z", defaultAgent: null, defaultBase: null,
    treeOrder: [{ repositoryId: "removed-repo", tree: "api" }],
    treeSettings: [{ selector: { repositoryId: "removed-repo", tree: "api" }, defaultAgent: null, workingDir: null }],
    archiveSnapshot: null,
  }, null, 2)}\n`);

  const snapshot = await observeWorkspace(loadedWorkspace(root), new Git(createGitRunner()));

  assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.code === "stale-metadata"));
});

test("an external worktree is likely misplaced only when branch convention maps it uniquely", async () => {
  const root = tempDir("misplaced-inference-v3");
  const repo = join(root, "external");
  const moved = join(root, "moved-api");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "fixture@grove.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "demo\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: repo });
  execFileSync("git", ["worktree", "add", "-q", "-b", "demo", moved], { cwd: repo });
  mkdirSync(join(root, "groves", "demo"), { recursive: true });
  const commonGitDir = realpathSync(join(repo, ".git"));
  const ws = loadedWorkspace(root, [{ id: "r1", name: "api", location: { kind: "linked", commonGitDir }, remote: null, trunk: "main" }]);

  const snapshot = await observeWorkspace(ws, new Git(createGitRunner()));
  const diagnostic = snapshot.diagnostics.find((entry) => entry.code === "misplaced");

  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.subject, { kind: "worktree", repositoryId: "r1", grove: "demo", tree: "demo@api" });
  assert.equal((diagnostic.facts as { expectedPath: string }).expectedPath, join(root, "groves", "demo", "trees", "demo@api"));
});


test("V3DES-07 round5: mutation conflict follows case-variant owner identity", async (t) => {
  const { existsSync, statSync } = await import("node:fs");
  const { assertWorktreeMutationPath } = await import("../../src/model/observed.ts");
  const root = tempDir("identity-v3");
  mkdirSync(join(root, "groves"));
  if (!existsSync(join(root, "Groves")) || statSync(join(root, "groves")).ino !== statSync(join(root, "Groves")).ino) { t.skip("temporary volume is case-sensitive"); return; }
  const snapshot = await observeWorkspace(loadedWorkspace(root), new Git(createGitRunner()));
  assert.throws(()=>assertWorktreeMutationPath(snapshot, join(root, "Groves")), (e:any)=>e.detail.reason === 'stale-plan');
});
