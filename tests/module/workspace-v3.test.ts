import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWorkspaceConfig, validateWorkspaceConfigChange } from "../../src/config/workspace.ts";
import { DEFAULT_LAYOUT } from "../../src/config/layout.ts";
import { DEFAULT_CONVENTIONS } from "../../src/config/conventions.ts";
import { GroveError } from "../../src/errors.ts";

const base = {
  kind: "workspace", schemaVersion: 3, _rev: 0, id: "01KWORKSPACE", name: "acme",
  layout: DEFAULT_LAYOUT, conventions: DEFAULT_CONVENTIONS,
  defaults: {}, agents: {}, repositories: [],
};

test("schema 3 stores registration policy and preferences without live ownership arrays", () => {
  const config = validateWorkspaceConfig("config.json", {
    ...base,
    repositories: [
      { id: "01KMANAGED", name: "api", location: { kind: "managed" }, remote: "origin", trunk: "main" },
      { id: "01KLINKED", name: "web", location: { kind: "linked", commonGitDir: "/external/web/.git" }, remote: null, trunk: "develop" },
    ],
  });
  assert.equal(config.schemaVersion, 3);
  assert.deepEqual(config.repositories.map((repo) => repo.location.kind), ["managed", "linked"]);
  assert.ok(config.repositories.every((repo) => !("trunks" in repo)));
});

test("normal loading refuses ownership schemas 1 and 2 with version-skew exit 9", () => {
  for (const schemaVersion of [1, 2]) {
    assert.throws(
      () => validateWorkspaceConfig("config.json", { ...base, schemaVersion }),
      (error) => GroveError.is(error) && error.kind === "version-skew" && error.exitCode === 9,
    );
  }
});

test("strict validation refuses unknown/live-state keys and duplicate aliases", () => {
  assert.throws(() => validateWorkspaceConfig("config.json", { ...base, claims: [] }), /unknown key/i);
  assert.throws(() => validateWorkspaceConfig("config.json", {
    ...base,
    repositories: [
      { id: "r1", name: "Api", location: { kind: "managed" }, remote: null, trunk: "main" },
      { id: "r2", name: "api", location: { kind: "linked", commonGitDir: "/tmp/api.git" }, remote: null, trunk: "main" },
    ],
  }), /duplicate repository alias/i);
  assert.throws(() => validateWorkspaceConfig("config.json", {
    ...base,
    repositories: [{ id: "r1", name: "api", location: { kind: "managed" }, remote: null, trunk: "main", trunks: [] }],
  }), /unknown key.*trunks/i);
});

test("managed repository layout cannot change while it is the sole discovery anchor", () => {
  const current = validateWorkspaceConfig("config.json", {
    ...base,
    repositories: [{ id: "r1", name: "api", location: { kind: "managed" }, remote: null, trunk: "main" }],
  });
  assert.throws(() => validateWorkspaceConfigChange(current, {
    ...current, layout: { ...current.layout, repositories: "sources/{repo}" },
  }, { hasGroveLooseContent: false, hasArchiveLooseContent: false }), /still registered/i);
});
