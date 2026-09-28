/**
 * The comparison seam under both deletion paths (FR-023, FR-023A; V3DES-09, V3DES-10):
 * `inventoryLooseContent` records loose content per path, and `unconsentedLooseEntries` decides
 * what the recorded consent does not cover.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { inventoryLooseContent, looseEntryLabel, persistedLooseInventory, readRecordedLooseConsent, unconsentedLooseEntries } from "../../src/paths/fs.ts";
import { GroveError } from "../../src/errors.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

function grove(): { root: string; tree: string } {
  const root = join(tempDir("loose"), "g");
  const tree = join(root, "trees", "g@alpha");
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, "tracked.txt"), "a Tree's own work is consented separately\n");
  mkdirSync(join(root, "notes", "deep"), { recursive: true });
  writeFileSync(join(root, "notes", "old.txt"), "old\n");
  writeFileSync(join(root, "notes", "deep", "leaf.txt"), "leaf\n");
  writeFileSync(join(root, "NOTES.md"), "top\n");
  writeFileSync(join(root, "trees", "beside.txt"), "beside a Tree\n");
  return { root, tree };
}

const labels = (root: string, accounted: string[], options = {}) => inventoryLooseContent(root, accounted, options).entries.map(looseEntryLabel);

test("V3DES-09 unit: loose content is inventoried recursively per path, around structural Tree ancestors", () => {
  const { root, tree } = grove();
  assert.deepEqual(labels(root, [tree]), ["NOTES.md", "notes/", "notes/deep/", "notes/deep/leaf.txt", "notes/old.txt", "trees/beside.txt"]);
  assert.deepEqual(inventoryLooseContent(root, [tree]).incomplete, []);
  // At the point of use the Tree has been removed; anything present at its path is new content.
  assert.deepEqual(labels(root, [tree], { accountedPresent: "inventory" }).filter((label) => label.startsWith("trees/")), ["trees/beside.txt", "trees/g@alpha/", "trees/g@alpha/tracked.txt"]);
});

test("V3DES-09 unit: an added descendant, a type change, and a legacy directory name are all unconsented", () => {
  const { root, tree } = grove();
  const recorded = persistedLooseInventory(inventoryLooseContent(root, [tree]));
  writeFileSync(join(root, "notes", "new.txt"), "added after the plan\n");
  const current = inventoryLooseContent(root, [tree]).entries;
  assert.deepEqual(unconsentedLooseEntries({ entries: recorded.entries, legacy: false }, current).map(looseEntryLabel), ["notes/new.txt"]);

  // A recorded file replaced by a directory of the same name is not the consented entry.
  const typed = { entries: [{ path: "NOTES.md", type: "directory" as const }], legacy: false };
  assert.deepEqual(unconsentedLooseEntries(typed, [{ path: "NOTES.md", type: "file" }]).map((entry) => entry.path), ["NOTES.md"]);

  // A pre-fix record's name covers exactly that path, never what is below it.
  const legacy = readRecordedLooseConsent({ discardedLoose: ["NOTES.md", "notes", "trees"] })!;
  assert.equal(legacy.legacy, true);
  assert.deepEqual(unconsentedLooseEntries(legacy, current).map(looseEntryLabel), ["notes/deep/", "notes/deep/leaf.txt", "notes/new.txt", "notes/old.txt", "trees/beside.txt"]);

  // Recorded paths that vanished are not objections; they are simply not discarded.
  assert.deepEqual(unconsentedLooseEntries({ entries: recorded.entries, legacy: false }, []), []);
});

test("V3DES-10 unit: recorded consent parses only a well-formed versioned inventory", () => {
  assert.deepEqual(readRecordedLooseConsent({ looseInventory: { version: 1, entries: [{ path: "a", type: "file" }] } }), { entries: [{ path: "a", type: "file" }], legacy: false });
  for (const malformed of [null, {}, { version: 2, entries: [] }, { version: 1, entries: [{ path: "a" }] }, { version: 1, entries: [{ path: 1, type: "file" }] }, { version: 1, entries: [{ path: "a", type: "file", rawPathBase64: 3 }] }]) {
    assert.equal(readRecordedLooseConsent({ looseInventory: malformed }), null, JSON.stringify(malformed));
  }
  assert.deepEqual(readRecordedLooseConsent({}), { entries: [], legacy: true });
});

test("V3DES-09 unit: symlinks are recorded, never followed, including at a structural position", () => {
  const { root, tree } = grove();
  const outside = join(tempDir("loose-outside"), "target");
  mkdirSync(outside);
  writeFileSync(join(outside, "elsewhere.txt"), "not Grove content\n");
  symlinkSync(outside, join(root, "notes", "link"));
  const inventory = inventoryLooseContent(root, [tree]);
  assert.deepEqual(inventory.entries.filter((entry) => entry.path.startsWith("notes/link")), [{ path: "notes/link", type: "symlink" }]);
  // A symlink where a structural Tree ancestor should be is loose, not a directory to descend.
  const other = join(tempDir("loose-structural"), "g");
  mkdirSync(other);
  symlinkSync(outside, join(other, "trees"));
  assert.deepEqual(inventoryLooseContent(other, [join(other, "trees", "g@alpha")]).entries, [{ path: "trees", type: "symlink" }]);
});

test("V3DES-09 unit: nested Git owners are not descended and leave the inventory incomplete", () => {
  const { root, tree } = grove();
  const nested = join(root, "notes", "checkout");
  execFileSync("git", ["init", "-q", nested]);
  writeFileSync(join(nested, "unique.txt"), "owned elsewhere\n");
  const bare = join(root, "store.git");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  const inventory = inventoryLooseContent(root, [tree]);
  assert.ok(inventory.entries.some((entry) => entry.path === "notes/checkout" && entry.type === "directory"));
  assert.ok(!inventory.entries.some((entry) => entry.path.startsWith("notes/checkout/") || entry.path.startsWith("store.git/")), JSON.stringify(inventory.entries));
  assert.deepEqual(inventory.incomplete.map((gap) => gap.path), ["notes/checkout", "store.git"]);
  assert.throws(() => persistedLooseInventory(inventory), (error) => GroveError.is(error));
});

test("V3DES-09 unit: unreadable directories and the entry and depth bounds make the inventory incomplete", (t) => {
  const { root, tree } = grove();
  const locked = join(root, "notes", "locked");
  mkdirSync(locked);
  writeFileSync(join(locked, "hidden.txt"), "cannot be listed\n");
  chmodSync(locked, 0o000);
  try {
    const inventory = inventoryLooseContent(root, [tree]);
    if (process.getuid?.() === 0) { t.skip("root can read a mode-000 directory"); return; }
    assert.deepEqual(inventory.incomplete.map((gap) => gap.path), ["notes/locked"]);
  } finally { chmodSync(locked, 0o755); }

  const bounded = inventoryLooseContent(root, [tree], { maxEntries: 3 });
  assert.equal(bounded.entries.length, 3);
  assert.equal(bounded.incomplete.length, 1);
  assert.match(bounded.incomplete[0]!.problem, /more than 3 loose entries/);

  const shallow = inventoryLooseContent(root, [tree], { maxDepth: 1 });
  assert.ok(shallow.incomplete.some((gap) => gap.path === "notes/deep" && /deeper than 1 levels/.test(gap.problem)), JSON.stringify(shallow.incomplete));
});

test("V3DES-09 unit: non-UTF-8 names keep their exact bytes as identity", (t) => {
  const root = tempDir("loose-bytes");
  const rawName = Buffer.from([0x6e, 0x6f, 0x74, 0x65, 0xff]);
  try { writeFileSync(Buffer.concat([Buffer.from(`${root}/`), rawName]), "raw\n"); }
  catch { t.skip("this volume refuses invalid UTF-8 names"); return; }
  const inventory = inventoryLooseContent(root, []);
  assert.equal(inventory.entries.length, 1);
  assert.equal(inventory.entries[0]!.rawPathBase64, rawName.toString("base64"));
  const consent = { entries: inventory.entries, legacy: false };
  assert.deepEqual(unconsentedLooseEntries(consent, inventory.entries), []);
});
