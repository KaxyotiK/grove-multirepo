import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGroveManifest } from "../../src/config/grove.ts";
import { GroveError } from "../../src/errors.ts";

const manifest = {
  kind: "grove", schemaVersion: 3, _rev: 1, id: "01KGROVE", name: "pricing-fix",
  state: "active", createdAt: "2026-08-21T00:00:00.000Z", defaultAgent: null,
  defaultBase: null, treeOrder: [{ repositoryId: "r1", tree: "pricing-fix@api" }],
  treeSettings: [], archiveSnapshot: null,
};

test("central schema-3 Grove metadata is advisory and has no authoritative trees", () => {
  assert.equal(validateGroveManifest("central.json", manifest).name, "pricing-fix");
  assert.throws(() => validateGroveManifest("central.json", { ...manifest, trees: [] }), /unknown key.*trees/i);
});

test("central metadata validates durable selectors and refuses ownership schema 2", () => {
  assert.throws(() => validateGroveManifest("central.json", {
    ...manifest, treeOrder: [{ repositoryId: "", tree: "bad/name" }],
  }), /treeOrder/i);
  assert.throws(
    () => validateGroveManifest("central.json", { ...manifest, schemaVersion: 2 }),
    (error) => GroveError.is(error) && error.kind === "version-skew" && error.exitCode === 9,
  );
});
