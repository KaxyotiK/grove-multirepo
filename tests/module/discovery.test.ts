import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverWorkspace, isWorkspaceRoot } from "../../src/config/discovery.ts";
import { workspaceConfig, groveDir } from "../../src/paths/layout.ts";
import { GroveError } from "../../src/errors.ts";
import { tempDir, cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

/** Lay down a bare marker file so discovery has something to find. */
function markWorkspace(root: string): void {
  mkdirSync(groveDir(root), { recursive: true });
  writeFileSync(workspaceConfig(root), '{"kind":"workspace"}');
}

test("DISC-10: the marker is EXACTLY .grove/config.json — a .grove/ dir alone is not enough", () => {
  const parent = tempDir("disc");
  markWorkspace(parent);
  const child = join(parent, "child");
  mkdirSync(groveDir(child), { recursive: true });
  // ASSERT:DISC-10:NOT-MARKER-WALK-CONTINUES-UPWARD
  assert.deepEqual(
    { childIsMarker: isWorkspaceRoot(child), resolved: discoverWorkspace({ cwd: child }) },
    { childIsMarker: false, resolved: parent },
  );
});

test("DISC-01/DISC-02/DISC-03/DISC-14: root and every managed subtree resolve the owning workspace", () => {
  const root = tempDir("disc");
  markWorkspace(root);
  const trunk = join(root, "trunks", "main@ledger", "src");
  const tree = join(root, "groves", "pricing-fix", "trees", "feature_pricing@ledger");
  const repository = join(root, ".bare", "ledger");
  for (const nested of [trunk, tree, repository]) mkdirSync(nested, { recursive: true });
  // ASSERT:DISC-01:USES-ROOT-S-GROVE-CONFIG-JSON
  assert.equal(discoverWorkspace({ cwd: root }), root);
  // ASSERT:DISC-02:WALKS-UPWARD-RESOLVES-SAME-WORKSPACE
  assert.deepEqual(
    { trunk: discoverWorkspace({ cwd: trunk }), tree: discoverWorkspace({ cwd: tree }) },
    { trunk: root, tree: root },
  );
  // ASSERT:DISC-03:RESOLVES-OWNING-WORKSPACE
  assert.equal(discoverWorkspace({ cwd: tree }), root);
  // ASSERT:DISC-14:SCHEMA3-REPOSITORY-SUBTREE-DISCOVERS-WORKSPACE
  assert.equal(discoverWorkspace({ cwd: repository }), root);
});

test("DISC-06: nearest marker wins for nested workspaces", () => {
  const outer = tempDir("disc");
  markWorkspace(outer);
  const inner = join(outer, "sub");
  markWorkspace(inner);
  const deep = join(inner, "x");
  mkdirSync(deep, { recursive: true });
  // ASSERT:DISC-06:NEAREST-MARKER-WINS
  assert.equal(discoverWorkspace({ cwd: deep }), inner);
});

test("DISC-04/DISC-13: marker-free walks terminate and refuse with exit 8", () => {
  const bare = tempDir("disc");
  let refusal: unknown;
  try {
    discoverWorkspace({ cwd: bare });
  } catch (e) {
    refusal = e;
  }
  // ASSERT:DISC-04:REFUSES-GROVE-INIT-CREATES-NOTHING
  assert.deepEqual(
    {
      errorKind: GroveError.is(refusal) ? refusal.kind : null,
      exitCode: GroveError.is(refusal) ? refusal.exitCode : null,
      namesInit: GroveError.is(refusal) ? /grove init/.test(refusal.remedy) : false,
      entries: readdirSync(bare),
    },
    { errorKind: "config", exitCode: 8, namesInit: true, entries: [] },
  );
  if (!isWorkspaceRoot("/")) {
    const rootOutcome = (() => {
      try { discoverWorkspace({ cwd: "/" }); return { kind: "accepted", exitCode: 0 }; }
      catch (e) { return { kind: GroveError.is(e) ? e.kind : "unknown", exitCode: GroveError.is(e) ? e.exitCode : -1 }; }
    })();
    // ASSERT:DISC-13:WALK-TERMINATES-ROOT-REFUSES-NO-UNBOUNDED-LOOP
    assert.deepEqual({ kind: rootOutcome.kind, exitCode: rootOutcome.exitCode }, { kind: "config", exitCode: 8 });
  }
});

test("DISC-08/DISC-11: --workspace wins exactly and an invalid explicit path never falls back", () => {
  const root = tempDir("disc");
  markWorkspace(root);
  const other = tempDir("disc");
  // ASSERT:DISC-08:EXPLICIT-WORKSPACE-WINS
  assert.equal(discoverWorkspace({ cwd: other, workspace: root }), root);
  const invalidExplicit = (() => {
    try { discoverWorkspace({ cwd: root, workspace: other }); return { kind: "fell-back", exitCode: 0 }; }
    catch (e) { return { kind: GroveError.is(e) ? e.kind : "not-a-grove-error", exitCode: GroveError.is(e) ? e.exitCode : -1 }; }
  })();
  // ASSERT:DISC-11:INVALID-EXPLICIT-EXITS-8-WITHOUT-FALLBACK
  assert.deepEqual(
    { kind: invalidExplicit.kind, exitCode: invalidExplicit.exitCode },
    { kind: "config", exitCode: 8 },
  );
});

test("DISC-09: no GROVE_* environment variable selects or opens a workspace", () => {
  const selected = tempDir("disc-selected");
  const ignored = tempDir("disc-ignored");
  markWorkspace(selected);
  markWorkspace(ignored);
  const prev = process.env.GROVE_ROOT;
  process.env.GROVE_ROOT = ignored;
  try {
    assert.equal(discoverWorkspace({ cwd: selected }), selected);
  } finally {
    if (prev === undefined) delete process.env.GROVE_ROOT;
    else process.env.GROVE_ROOT = prev;
  }
});

test("DISC-05: a valid sibling workspace is never consulted", () => {
  const parent = tempDir("disc-siblings");
  const selected = join(parent, "selected");
  const sibling = join(parent, "sibling");
  markWorkspace(selected);
  markWorkspace(sibling);
  const cwd = join(selected, "deep");
  mkdirSync(cwd, { recursive: true });
  // ASSERT:DISC-05:NEVER-READS-SIBLING-CONFIG
  assert.equal(discoverWorkspace({ cwd }), selected);
});

test("DISC-12: a symlinked cwd canonicalizes to the real workspace path", () => {
  const root = tempDir("disc-real");
  markWorkspace(root);
  const nested = join(root, "nested");
  mkdirSync(nested, { recursive: true });
  const link = join(tempDir("disc-link"), "linked");
  symlinkSync(nested, link);
  // ASSERT:DISC-12:CANONICAL-REAL-PATH-DRIVES-DISCOVERY-CONTAINMENT
  assert.deepEqual({ resolved: discoverWorkspace({ cwd: link }), canonicalRoot: root }, { resolved: root, canonicalRoot: root });
});
