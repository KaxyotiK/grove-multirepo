import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  encodeComponent,
  slugForBranch,
  slugForRepo,
  dirBase,
  allocateDir,
  isValidTrunkAllocation,
  caseFoldKey,
  BRANCH_SLUG_MAX_BYTES,
} from "../../src/model/encoding.ts";
import { GroveError } from "../../src/errors.ts";

test("§5.1 slug rules: preserve, slash→_, @→~40, ~→~7e, case kept", () => {
  assert.equal(slugForBranch("main").slug, "main");
  assert.equal(slugForBranch("feature/pricing").slug, "feature_pricing");
  assert.equal(slugForBranch("release/2026.08").slug, "release_2026.08");
  assert.equal(slugForBranch("Feature/A").slug, "Feature_A", "case preserved");
  assert.equal(slugForBranch("team@experiment").slug, "team~40experiment");
  assert.equal(encodeComponent("~", 96).slug, "~7e");
});

test("§5.1 rule 6: other chars as lowercase UTF-8 bytes prefixed by ~", () => {
  assert.equal(encodeComponent("é", 96).slug, "~c3~a9");
});

test("§5.1 rule 7: underscores are not collapsed", () => {
  assert.equal(slugForBranch("a__b").slug, "a__b");
  assert.equal(slugForBranch("a//b").slug, "a__b");
});

test("directory base uses the single unescaped @ separator", () => {
  const b = slugForBranch("feature/pricing").slug;
  const r = slugForRepo("ledger").slug;
  assert.equal(dirBase(b, r), "feature_pricing@ledger");
});

test("TREE-20: tilde encodes as ~7e and a non-UTF-8 component is refused", () => {
  // Consolidated: one field per clause. Three obligations previously rested on the single
  // `encodeComponent("~")` equality, which observes neither the refusal nor the ref-name rule.
  // ASSERT:TREE-20:TILDE-ENCODES-AND-NON-UTF8-IS-REFUSED-AND-REFS-CANNOT-CARRY-TILDE
  assert.deepEqual(
    {
      tildeSlug: encodeComponent("~", 96).slug,
      nonUtf8Refused: (() => { try { encodeComponent("\ud800", 96); return null; } catch (e) { return GroveError.is(e) ? (e as GroveError).kind : "not-a-grove-error"; } })(),
      // §5.1's reason the escape exists at all: git itself rejects `~` in a ref name.
      gitRejectsTildeInRef: spawnSync("git", ["check-ref-format", "--branch", "a~b"]).status !== 0,
    },
    { tildeSlug: "~7e", nonUtf8Refused: "invalid-input", gitRejectsTildeInRef: true },
  );
});

test("truncation happens only at encoding boundaries and flags truncated", () => {
  const long = "é".repeat(40); // each é is 6 slug bytes
  const s = encodeComponent(long, 10);
  assert.ok(s.truncated);
  assert.ok(s.slug.length <= 10);
  assert.equal(s.slug.length % 6, 0, "only whole ~xx~yy units, never a split escape");
});

test("collision: a case-folded collision gets the shortest unique full-ref hash suffix", () => {
  const taken = new Set([caseFoldKey("feature_a@ledger")]);
  const fullRef = Buffer.from("refs/heads/feature/a");
  const dir = allocateDir({ branch: "feature/a", repo: "ledger", canonicalFullRef: fullRef, taken });
  assert.equal(dir, `feature_a@ledger~${createHash("sha256").update(fullRef).digest("hex").slice(0, 8)}`);
  assert.notEqual(caseFoldKey(dir), "feature_a@ledger");
});

test("TREE-03: case-only component variants allocate distinct portable directories", () => {
  const upperRef = Buffer.from("refs/heads/Feature/Login");
  const lowerRef = Buffer.from("refs/heads/feature/login");
  const upper = allocateDir({ branch: "Feature/Login", repo: "ledger", canonicalFullRef: upperRef, taken: new Set() });
  const lower = allocateDir({
    branch: "feature/login",
    repo: "ledger",
    canonicalFullRef: lowerRef,
    taken: new Set([caseFoldKey(upper)]),
  });
  assert.equal(upper, "Feature_Login@ledger");
  assert.equal(lower, `feature_login@ledger~${createHash("sha256").update(lowerRef).digest("hex").slice(0, 8)}`);
  // ASSERT:TREE-03:CASE-FOLD-COLLISION-HANDLING-GIVES-DISTINCT-PORTABLE-DIRECTORIES
  assert.deepEqual(
    { upper, lowerHasSuffix: lower.includes("~"), caseFoldDistinct: caseFoldKey(upper) !== caseFoldKey(lower) },
    { upper: "Feature_Login@ledger", lowerHasSuffix: true, caseFoldDistinct: true },
  );
});

test("TREE-05: composed and decomposed Unicode components encode to distinct ASCII identities", () => {
  const composed = encodeComponent("é", 96).slug;
  const decomposed = encodeComponent("e\u0301", 96).slug;
  assert.equal(composed, "~c3~a9");
  assert.equal(decomposed, "e~cc~81");
  assert.notEqual(composed, decomposed);
  // ASSERT:TREE-05:THEIR-DISTINCT-UTF-8-BYTE-SEQUENCES-PRODUCE-DISTINCT
  assert.deepEqual(
    { composed, decomposed, distinct: composed.localeCompare(decomposed) !== 0, asciiOnly: /^[\x00-\x7f]+$/.test(composed + decomposed) },
    { composed: "~c3~a9", decomposed: "e~cc~81", distinct: true, asciiOnly: true },
  );
});

test("no collision and not truncated → the plain base, no suffix", () => {
  const dir = allocateDir({ branch: "main", repo: "ledger", canonicalFullRef: Buffer.from("refs/heads/main"), taken: new Set() });
  assert.equal(dir, "main@ledger");
});

test("TREE-06: an over-limit encoding truncates safely with a stable full-ref hash suffix", () => {
  const branch = "x".repeat(BRANCH_SLUG_MAX_BYTES + 20);
  const canonicalFullRef = Buffer.from(`refs/heads/${branch}`);
  const input = { branch, repo: "ledger", canonicalFullRef, taken: new Set<string>() };
  const dir = allocateDir(input);
  assert.equal(dir, allocateDir(input), "canonical ref bytes make allocation stable");
  assert.ok(dir.endsWith(`~${createHash("sha256").update(canonicalFullRef).digest("hex").slice(0, 8)}`));
  // ASSERT:TREE-06:TRUNCATES-SAFELY-APPENDS-STABLE-TREE-ID
  assert.deepEqual(
    {
      stable: dir === allocateDir(input),
      hashSuffix: dir.endsWith(`~${createHash("sha256").update(canonicalFullRef).digest("hex").slice(0, 8)}`),
      bounded: Buffer.byteLength(dir.split("@")[0]!) <= BRANCH_SLUG_MAX_BYTES + 9,
    },
    { stable: true, hashSuffix: true, bounded: true },
  );
});

test("trunk allocation extends the full-ref hash prefix only until case-fold unique", () => {
  const canonicalFullRef = Buffer.from("refs/heads/feature/a");
  const hash = createHash("sha256").update(canonicalFullRef).digest("hex");
  const taken = new Set([caseFoldKey("feature_a@ledger"), caseFoldKey(`feature_a@ledger~${hash.slice(0, 8)}`)]);
  assert.equal(allocateDir({ branch: "feature/a", repo: "ledger", canonicalFullRef, taken }), `feature_a@ledger~${hash.slice(0, 9)}`);
});

test("trunk observation accepts deterministic and historical v1 suffixes without parsing branch identity from them", () => {
  const canonicalFullRef = Buffer.from("refs/heads/feature/a");
  const hash = createHash("sha256").update(canonicalFullRef).digest("hex");
  assert.equal(isValidTrunkAllocation("feature_a@ledger", "feature/a", "ledger", canonicalFullRef), true);
  assert.equal(isValidTrunkAllocation(`feature_a@ledger~${hash.slice(0, 8)}`, "feature/a", "ledger", canonicalFullRef), true);
  assert.equal(isValidTrunkAllocation("feature_a@ledger~01K9F3Q2", "feature/a", "ledger", canonicalFullRef), true);
  assert.equal(isValidTrunkAllocation("feature_a@ledger~deadbeef", "feature/a", "ledger", canonicalFullRef), false);
});
