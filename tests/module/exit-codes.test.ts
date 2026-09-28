import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GroveError, EXIT_CODES, exitCodeFor, EXIT_OK, EXIT_INTERNAL, EXIT_USAGE } from "../../src/errors.ts";

// contracts/exit-codes.md — the taxonomy, asserted exactly.
const EXPECTED: Record<string, number> = {
  "invalid-input": 2,
  "refused-policy": 3,
  "refused-conflict": 4,
  "refused-precondition": 5,
  git: 6,
  io: 7,
  config: 8,
  "version-skew": 9,
};

test("CMD-10: every GroveError kind maps to its declared §9 exit code", () => {
  for (const [kind, code] of Object.entries(EXPECTED)) {
    assert.equal(EXIT_CODES[kind as keyof typeof EXIT_CODES], code, `kind ${kind} → ${code}`);
    const err = new GroveError({ kind: kind as never, what: "w", why: "y", remedy: "r" });
    // ASSERT:CMD-10:EVERY-TYPED-ERROR-USES-DECLARED-CODE
    assert.equal(err.exitCode, code);
  }
});

test("there is no exit code above 9 (no legacy cursor-expired)", () => {
  assert.ok(Object.values(EXIT_CODES).every((c) => c <= 9));
});

test("refusals are distinguishable from failures", () => {
  assert.ok(new GroveError({ kind: "refused-policy", what: "w", why: "y", remedy: "r" }).isRefusal);
  assert.ok(!new GroveError({ kind: "git", what: "w", why: "y", remedy: "r" }).isRefusal);
});

test("a non-Grove error is internal (1), never silently zero", () => {
  assert.equal(exitCodeFor(new Error("boom")), EXIT_INTERNAL);
  assert.equal(exitCodeFor("nope"), EXIT_INTERNAL);
});

test("toJSON carries what/why/remedy/exitCode for machine consumers", () => {
  const err = new GroveError({ kind: "refused-conflict", what: "W", why: "Y", remedy: "R" });
  const j = err.toJSON() as { error: Record<string, unknown> };
  assert.equal(j.error.what, "W");
  assert.equal(j.error.remedy, "R");
  assert.equal(j.error.exitCode, 4);
});

test("P1-8: the §9 contract table and EXIT_CODES cannot drift apart", () => {
  // The previous version of this contract carried a "typical trigger" column whose three examples
  // for exit 3 all returned something else — wrong text in a NORMATIVE document, which is worse
  // than wrong text in a comment. The table is now parsed and compared, so the next edit to either
  // side fails here instead of being discovered by a reviewer.
  const contract = readFileSync(
    new URL("../../specs/001-grove-cli/contracts/exit-codes.md", import.meta.url),
    "utf8",
  );

  const documented = new Map<number, string>();
  for (const line of contract.split("\n")) {
    const m = /^\|\s*`(\d)`\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (m) documented.set(Number(m[1]), m[2]!);
  }
  assert.ok(documented.size >= 10, `the §9 table did not parse — got ${documented.size} rows`);

  // Every kind's code is documented, and nothing is documented that the code cannot produce.
  for (const [kind, code] of Object.entries(EXIT_CODES)) {
    assert.ok(documented.has(code), `${kind} exits ${code}, which the §9 table does not document`);
  }
  const produced = new Set<number>([EXIT_OK, EXIT_INTERNAL, EXIT_USAGE, ...Object.values(EXIT_CODES)]);
  for (const code of documented.keys()) {
    assert.ok(produced.has(code), `the §9 table documents exit ${code}, which no error kind produces`);
  }
  assert.deepEqual([...documented.keys()].sort((a, b) => a - b), [...produced].sort((a, b) => a - b));
});

// P1-7: `agent run` is the ONE documented exception to "every command returns exactly one of
// these codes". These tests pin the exception to what §9.1 says, so code and contract cannot drift.

test("P1-7: §9.1 documents the agent run passthrough as an explicit, named exception", () => {
  const contract = readFileSync(new URL("../../specs/001-grove-cli/contracts/exit-codes.md", import.meta.url), "utf8");
  assert.match(contract, /### 9\.1 The `agent run` passthrough/, "§9.1 is missing from the normative contract");
  // The three outcomes the implementation actually produces must each be stated.
  assert.match(contract, /128 \+ N/, "§9.1 does not state the signal convention");
  assert.match(contract, /`127`/, "§9.1 does not state the could-not-start code");
  // The surface contract must point at it, so a reader of `agent run` finds the exception.
  const surface = readFileSync(new URL("../../specs/001-grove-cli/contracts/cli-surface.md", import.meta.url), "utf8");
  assert.match(surface, /agent run[^\n]*§9\.1/, "cli-surface.md does not cite §9.1 from `agent run`");
});

test("P1-7: `agent run --help` states the passthrough rather than leaving it undocumented", async () => {
  const { registerAll } = await import("../../src/commands/index.ts");
  const { all } = await import("../../src/commands/registry.ts");
  registerAll();
  const spec = all().find((c) => c.path === "agent run");
  assert.ok(spec, "agent run is not registered");
  assert.match(`${spec.note ?? ""}`, /exit code/i, "agent run --help does not mention the exit-code passthrough");
  assert.match(`${spec.note ?? ""}`, /§9\.1/, "agent run --help does not cite §9.1");
});
