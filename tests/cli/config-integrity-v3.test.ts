/**
 * Phase 5 (ledger V-1…V-5). Three of these are silent-corruption or data-loss class: the command
 * exits 0, reports success, and the damage surfaces later or never.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());
const configOf = (fx: Fixture): any => json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));

function populated(): Fixture {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["config", "set", "--values", '{"defaults":{"agent":"codex","branchPrefix":"jc/","syncStrategy":"rebase"}}']).status, 0);
  assert.equal(fx.grove(["agent", "add", "alpha", process.execPath]).status, 0);
  assert.equal(fx.grove(["agent", "add", "beta", process.execPath]).status, 0);
  return fx;
}

test("V3CFG-01: patching one key in defaults and one in agents preserves every omitted sibling", () => {
  const fx = populated();
  const before = configOf(fx);
  assert.deepEqual(Object.keys(before.defaults).sort(), ["agent", "branchPrefix", "syncStrategy"]);

  const patched = fx.grove(["config", "set", "--values", '{"defaults":{"agent":"claude"}}']);
  const afterPatch = configOf(fx);
  const removed = fx.grove(["config", "set", "--values", '{"defaults":{"branchPrefix":null}}']);
  const afterRemove = configOf(fx);

  // Asserting on the re-read file, not on the command's own success report — the report was always
  // correct about the key it set and silent about the ones it deleted.
  assert.deepEqual(
    {
      patchStatus: patched.status,
      defaultsAfterPatch: afterPatch.defaults,
      agentsSurvived: Object.keys(afterPatch.agents).sort(),
      removeStatus: removed.status,
      defaultsAfterRemove: afterRemove.defaults,
      agentsStillThere: Object.keys(afterRemove.agents).sort(),
    },
    {
      patchStatus: 0,
      defaultsAfterPatch: { agent: "claude", branchPrefix: "jc/", syncStrategy: "rebase" },
      agentsSurvived: ["alpha", "beta"],
      removeStatus: 0,
      defaultsAfterRemove: { agent: "claude", syncStrategy: "rebase" },
      agentsStillThere: ["alpha", "beta"],
    },
  );
});

test("V3CFG-02: every non-object config patch is refused with exit 2 and no revision bump", () => {
  const fx = populated();
  const before = readFileSync(join(fx.root, ".grove", "config.json"), "utf8");
  const beforeRev = configOf(fx)._rev;

  const cases = ["null", "[]", "42", '"x"'];
  const results = cases.map((value) => fx.grove(["--json", "config", "set", "--values", value]));
  const afterBytes = readFileSync(join(fx.root, ".grove", "config.json"), "utf8");

  // `[]` is the important one: it used to pass every check and write a successful, revision-bumping
  // no-op. `null` threw a raw TypeError, surfacing as exit 1 — which the contract reserves for
  // INTERNAL faults, telling the user their own bad input was a Grove bug.
  assert.deepEqual(
    {
      statuses: results.map((r) => r.status),
      kinds: results.map((r) => json(r.stdout).error.kind),
      bytesUnchanged: afterBytes === before,
      revUnchanged: configOf(fx)._rev === beforeRev,
    },
    {
      statuses: [2, 2, 2, 2],
      kinds: ["invalid-input", "invalid-input", "invalid-input", "invalid-input"],
      bytesUnchanged: true,
      revUnchanged: true,
    },
  );
});

test("V3CFG-03: a Git-invalid default base is refused at configure time", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);

  const refused = fx.grove(["--json", "configure", "work", "--default-base", "no-such-ref"]);
  const accepted = fx.grove(["configure", "work", "--default-base", "main"]);
  // The defect was the DEFERRED failure: configure exited 0, doctor said clean, and `commits`
  // failed on every Tree much later. Assert the review commands still work after a valid set.
  assert.deepEqual(
    {
      refusedStatus: refused.status,
      namesTheBase: String(json(refused.stdout).error.what).includes("no-such-ref"),
      acceptedStatus: accepted.status,
      reviewStillWorks: fx.grove(["commits", "work"]).status,
    },
    { refusedStatus: 5, namesTheBase: true, acceptedStatus: 0, reviewStillWorks: 0 },
  );
});

test("V3CFG-04: reorder refuses a duplicate selector and leaves treeOrder byte-identical", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repo of fx.repos) assert.equal(fx.grove(["repo", "add", repo.origin, "--name", repo.name]).status, 0);
  assert.equal(fx.grove(["new", "work", "--all"]).status, 0);
  assert.equal(fx.grove(["tree", "reorder", "work", "--tree", "work@beta", "--tree", "work@alpha"]).status, 0);
  const listedAfterReorder = json(fx.grove(["--json", "tree", "ls", "work"]).stdout);
  assert.deepEqual(listedAfterReorder.detail.trees.map((tree: any) => tree.tree), ["work@beta", "work@alpha"]);

  const manifestPath = join(fx.root, ".grove", "groves", "work.json");
  const before = readFileSync(manifestPath, "utf8");
  const refused = fx.grove(["--json", "tree", "reorder", "work", "--tree", "work@alpha", "--tree", "work@alpha"]);

  assert.deepEqual(
    {
      status: refused.status,
      namesTheDuplicate: String(json(refused.stdout).error.what).includes("work@alpha"),
      manifestByteIdentical: readFileSync(manifestPath, "utf8") === before,
    },
    { status: 2, namesTheDuplicate: true, manifestByteIdentical: true },
  );
});

test("V3SYNC-02: an omitted --strategy uses the configured default", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["config", "set", "--values", '{"defaults":{"syncStrategy":"fetch-only"}}']).status, 0);

  const run = fx.grove(["--json", "sync", "--trunks"]);
  assert.deepEqual(
    { status: run.status, strategy: json(run.stdout).detail.strategy },
    { status: 0, strategy: "fetch-only" },
  );
});

test("V3CFG-02: prototype-mutating keys are refused at every depth with no write", () => {
  // `config set --values` feeds user JSON straight into a recursive merge. Top-level `__proto__`
  // was already refused by the settable-key check, but a NESTED one reached the merge, set a
  // prototype, wrote nothing (JSON serialises own properties only) and bumped the revision — a
  // silent no-op write, which is the same defect V3CFG-02 fixed for `[]`.
  const fx = populated();
  const before = readFileSync(join(fx.root, ".grove", "config.json"), "utf8");
  const cases = [
    '{"defaults":{"__proto__":{"polluted":"yes"}}}',
    '{"agents":{"alpha":{"constructor":{"x":1}}}}',
    '{"defaults":{"prototype":{"x":1}}}',
  ];
  const results = cases.map((value) => fx.grove(["--json", "config", "set", "--values", value]));

  assert.deepEqual(
    {
      statuses: results.map((r) => r.status),
      kinds: results.map((r) => json(r.stdout).error.kind),
      bytesUnchanged: readFileSync(join(fx.root, ".grove", "config.json"), "utf8") === before,
      // The guard must not break ordinary nested merging, which is the whole point of V3CFG-01.
      legitimateMergeStillWorks: fx.grove(["config", "set", "--values", '{"defaults":{"agent":"claude"}}']).status,
    },
    { statuses: [2, 2, 2], kinds: ["invalid-input", "invalid-input", "invalid-input"], bytesUnchanged: true, legitimateMergeStillWorks: 0 },
  );
});
