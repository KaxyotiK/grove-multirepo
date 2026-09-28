import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkspaceAt } from "../../src/config/workspace.ts";
import { validateWorkspaceConfig } from "../../src/config/workspace.ts";
import { workspaceConfig } from "../../src/paths/layout.ts";
import { GroveError } from "../../src/errors.ts";
import { DEFAULT_LAYOUT } from "../../src/config/layout.ts";
import { DEFAULT_CONVENTIONS } from "../../src/config/conventions.ts";
import { tempDir, cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

// init module behavior is exercised end-to-end through the CLI in tests/cli/workspace.test.ts.
// These assert the config validator's refuse-never-guess rules directly (§4.1).

test("validator refuses an unknown key (Refuse, Never Guess)", () => {
  assert.throws(
    () => validateWorkspaceConfig("cfg", { kind: "workspace", schemaVersion: 3, _rev: 1, id: "x", name: "n", layout: DEFAULT_LAYOUT, conventions: DEFAULT_CONVENTIONS, defaults: {}, agents: {}, repositories: [], surprise: true }),
    (e) => GroveError.is(e) && (e as GroveError).kind === "config",
  );
});

test("validator refuses an unsupported schema version with exit 9", () => {
  try {
    validateWorkspaceConfig("cfg", { kind: "workspace", schemaVersion: 999, _rev: 1, id: "x", name: "n", defaults: {}, agents: {}, repositories: [] });
    assert.fail("should refuse");
  } catch (e) {
    assert.ok(GroveError.is(e));
    assert.equal((e as GroveError).kind, "version-skew");
    assert.equal((e as GroveError).exitCode, 9);
  }
});

test("validator refuses a wrong kind", () => {
  assert.throws(
    () => validateWorkspaceConfig("cfg", { kind: "grove", schemaVersion: 3 }),
    (e) => GroveError.is(e) && (e as GroveError).kind === "config",
  );
});

test("loadWorkspaceAt refuses malformed JSON rather than defaulting", () => {
  const root = tempDir("init");
  mkdirSync(join(root, ".grove"), { recursive: true });
  writeFileSync(workspaceConfig(root), "{ not json");
  assert.throws(() => loadWorkspaceAt(root), (e) => GroveError.is(e) && (e as GroveError).kind === "config");
});

test("a valid config round-trips through the validator", () => {
  const cfg = { kind: "workspace", schemaVersion: 3, _rev: 3, id: "01K", name: "finance", layout: DEFAULT_LAYOUT, conventions: DEFAULT_CONVENTIONS, defaults: { agent: "codex" }, agents: {}, repositories: [] };
  const validated = validateWorkspaceConfig("cfg", cfg);
  assert.equal(validated.name, "finance");
});
