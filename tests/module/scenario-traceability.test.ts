import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const VALIDATOR = fileURLToPath(new URL("../../scripts/scenario-traceability.mjs", import.meta.url));

function fixture(rows: string[], tests: Record<string, string>, deferrals?: string) {
  const root = tempDir("scenario-traceability");
  const contract = join(root, "scenarios.md");
  const testRoot = join(root, "tests");
  mkdirSync(testRoot, { recursive: true });
  writeFileSync(contract, `| ID | Setup | Expected |\n|---|---|---|\n${rows.join("\n")}\n`);
  for (const [name, source] of Object.entries(tests)) writeFileSync(join(testRoot, `${name}.test.ts`), source);
  const deferralPath = deferrals === undefined ? undefined : join(root, "deferrals.txt");
  if (deferralPath && deferrals !== undefined) writeFileSync(deferralPath, deferrals);
  return { contract, testRoot, deferralPath };
}

function run(input: ReturnType<typeof fixture>, allowDeferrals = false, ledger?: string) {
  const args = [VALIDATOR, "--contract", input.contract, "--tests", input.testRoot];
  if (input.deferralPath) args.push("--deferrals", input.deferralPath);
  if (allowDeferrals) args.push("--allow-deferrals");
  if (ledger) args.push("--ledger", ledger);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function writeLedger(input: ReturnType<typeof fixture>, scenarios: unknown[]): string {
  const ledger = join(input.contract, "..", "ledger.json");
  writeFileSync(ledger, `${JSON.stringify({ schemaVersion: 3, scenarios }, null, 2)}\n`);
  return ledger;
}

test("008 validator: a valid fixture discovers and gates a new family without hardcoding it", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "| NEW9-01 | setup | result |"],
    { witness: 'import { test } from "node:test";\ntest("ALPHA-01 and NEW9-01: complete witnesses", () => {});\n' },
  );
  const result = run(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALPHA: 1\/1/);
  assert.match(result.stdout, /NEW9: 1\/1/);
  assert.match(result.stdout, /2 scenarios, 2 families, 0 deferred/);
});

test("008 validator negative controls name uncited, duplicate, and unknown title citations", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "| ALPHA-01 | duplicate | result |", "| ALPHA-02 | setup | result |"],
    { witness: 'test("BOGUS-99: not authoritative", () => {});\n// ALPHA-02 in a comment receives no credit.\n' },
  );
  const result = run(input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate contract scenario ALPHA-01/);
  assert.match(result.stderr, /unknown test-title scenario BOGUS-99/);
  assert.match(result.stderr, /uncited scenario ALPHA-02/);
});

test("008 validator: citations require exact FAMILY-NN IDs in executable, uncommented titles", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "| BETA-02 | setup | result |", "| WIDE-100 | malformed | result |"],
    {
      partial: 'test("xALPHA-01: partial token", () => {});\n',
      commented: '/*\ntest("ALPHA-01: commented out", () => {});\n*/\n',
      unknown: 'test("BETA-02 and BOGUS-99: one known, one unknown", () => {});\n',
    },
  );
  const result = run(input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /uncited scenario ALPHA-01/);
  assert.match(result.stderr, /unknown test-title scenario BOGUS-99/);
  assert.match(result.stderr, /invalid contract scenario ID WIDE-100 at line 5: expected FAMILY-NN/);
  assert.doesNotMatch(result.stderr, /uncited scenario BETA-02/);
});

test("008 validator: only tables headed `ID` are scenario tables; other tables in the contract are prose", () => {
  // Issue #7. Every pipe row used to be read as a scenario, so an explanatory table was silently
  // adopted as live scenarios owing witnesses.
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "", "| Term | Meaning |", "|---|---|", "| Gamma | an explanatory row |", "| not an id | prose |"],
    { witness: 'import { test } from "node:test";\ntest("ALPHA-01: witness", () => {});\n' },
  );
  const result = run(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 scenarios, 1 families, 0 deferred/);
  assert.doesNotMatch(result.stderr, /Gamma|not an id/);
});

test("008 validator: a scenario-shaped ID in a table not headed `ID` fails instead of being skipped", () => {
  // Negative control. Skipping every non-`ID` table would silently drop a real scenario table whose
  // first header cell was spelled differently (`Scenario`, `Id`), and its rows would owe no witness.
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "", "| Scenario | Setup | Expected |", "|---|---|---|", "| BETA-01 | setup | result |", "", "| GAMMA-02 | header that is an ID |", "|---|---|"],
    { witness: 'import { test } from "node:test";\ntest("ALPHA-01: witness", () => {});\n' },
  );
  const result = run(input);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /BETA-01 at line \d+ is in a table not headed `ID`/);
  assert.match(result.stderr, /GAMMA-02 at line \d+ is in a table not headed `ID`/);
});

test("008 validator negative controls reject ownerless, unknown, stale, and final-state deferrals", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "| ALPHA-02 | setup | result |", "| ALPHA-03 | setup | result |"],
    { witness: 'test("ALPHA-01: witnessed", () => {});\n' },
    "ALPHA-01|008:T001|already cited\nALPHA-02||owner missing\nBOGUS-99|008:T001|unknown id\nALPHA-03|008:T001|temporary\n",
  );
  const rollout = run(input, true);
  assert.equal(rollout.status, 1);
  assert.match(rollout.stderr, /stale deferral ALPHA-01/);
  assert.match(rollout.stderr, /invalid deferral at line 2/);
  assert.match(rollout.stderr, /unknown deferred scenario BOGUS-99/);

  const finalInput = fixture(["| ALPHA-01 | setup | result |"], {}, "ALPHA-01|008:T001|temporary\n");
  const final = run(finalInput);
  assert.equal(final.status, 1);
  assert.match(final.stderr, /deferral ALPHA-01 is not permitted in the final gate/);
});

test("008 validator: rollout output distinguishes witnessed scenarios from owned deferrals", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |", "| ALPHA-02 | setup | result |"],
    { witness: 'test("ALPHA-01: witnessed", () => {});\n' },
    "ALPHA-02|008/T001|temporary rollout gap\n",
  );
  const result = run(input, true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALPHA: 1\/2 \(1 deferred\)/);
  assert.match(result.stdout, /2 scenarios, 1 families, 1 deferred/);
});

test("T076 validator: an exact disposition, witness title, and literal body marker are all required", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |"],
    { witness: 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:EXACT-RESULT */ assert.equal("actual", "expected"); });\n' },
  );
  const exact = {
    id: "ALPHA-01",
    disposition: "preserved",
    contractExpected: "result",
    evidenceSummary: "The exact assertion checks the inherited result.",
    proofObligations: [{
      id: "result",
      expectedClause: "result",
      actualOutcome: "The executable equality observes the exact expected value.",
      assertionMarkers: ["ASSERT:ALPHA-01:EXACT-RESULT"],
    }],
    witnesses: [{
      file: "witness.test.ts",
      title: "ALPHA-01: exact witness",
      assertionMarkers: [{ marker: "ASSERT:ALPHA-01:EXACT-RESULT", assertion: 'assert.equal("actual", "expected")' }],
    }],
  };
  const valid = run(input, false, writeLedger(input, [exact]));
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /semantic ledger: PASSED \(1 rows, 1 witnesses\)/);

  for (const [label, changed, expected] of [
    ["disposition", { ...exact, disposition: "unknown" }, /invalid disposition/],
    ["file", { ...exact, witnesses: [{ ...exact.witnesses[0], file: "missing.test.ts" }] }, /witness file does not exist/],
    ["title", { ...exact, witnesses: [{ ...exact.witnesses[0], title: "ALPHA-01: renamed" }] }, /exact test title not found/],
    ["expected", { ...exact, contractExpected: "weakened" }, /contract expected-result drift/],
    ["markers", { ...exact, witnesses: [{ ...exact.witnesses[0], assertionMarkers: [] }] }, /missing file, title, or assertion markers/],
    ["marker", { ...exact, witnesses: [{ ...exact.witnesses[0], assertionMarkers: [{ marker: "ASSERT:ALPHA-01:MISSING", assertion: 'assert.equal("actual", "expected")' }] }] }, /assertion marker not found in witness body/],
  ] as const) {
    const result = run(input, false, writeLedger(input, [changed]));
    assert.equal(result.status, 1, label);
    assert.match(result.stderr, expected, label);
  }

  const missing = run(input, false, writeLedger(input, []));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing semantic ledger row ALPHA-01/);

  const duplicate = run(input, false, writeLedger(input, [exact, exact]));
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /duplicate semantic ledger row ALPHA-01/);
});

test("T076 validator: TRUNK-01 cannot pass without the readable-path marker and exact equality assertion", () => {
  const row = (source: string) => {
    const input = fixture(["| TRUNK-01 | setup | result |"], { trunk: source });
    const ledger = writeLedger(input, [{
      id: "TRUNK-01",
      disposition: "superseded",
      contractExpected: "result",
      evidenceSummary: "The exact assertion checks the readable peer-trunk path.",
      proofObligations: [{
        id: "readable-path",
        expectedClause: "result",
        actualOutcome: "The installed trunk path equals the readable inherited path.",
        assertionMarkers: ["ASSERT:TRUNK-01:READABLE-PATH"],
      }],
      witnesses: [{
        file: "trunk.test.ts",
        title: "TRUNK-01: readable initial trunk",
        assertionMarkers: [{
          marker: "ASSERT:TRUNK-01:READABLE-PATH",
          assertion: 'assert.equal(actual, join(root, "trunks", "main@ledger"))',
        }],
      }],
    }]);
    return run(input, false, ledger);
  };
  const exact = row('import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { join } from "node:path";\ntest("TRUNK-01: readable initial trunk", () => { /* ASSERT:TRUNK-01:READABLE-PATH */ assert.equal(actual, join(root, "trunks", "main@ledger")); });\n');
  assert.equal(exact.status, 0, exact.stderr);

  const absent = row('test("TRUNK-01: readable initial trunk", () => { assert.equal(actual, join(root, "trunks", "main@ledger")); });\n');
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /TRUNK-01 readable-path marker/);

  const weakened = row('test("TRUNK-01: readable initial trunk", () => { /* ASSERT:TRUNK-01:READABLE-PATH */ assert.equal(actual, join(root, "trunks", "ledger", branchKey("main"))); });\n');
  assert.equal(weakened.status, 1);
  assert.match(weakened.stderr, /TRUNK-01 readable path equality assertion/);

  const commented = row('test("TRUNK-01: readable initial trunk", () => { /* ASSERT:TRUNK-01:READABLE-PATH */ /* assert.equal(actual, join(root, "trunks", "main@ledger")); */ assert.equal(actual, join(root, "trunks", "ledger", branchKey("main"))); });\n');
  assert.equal(commented.status, 1);
  assert.match(commented.stderr, /TRUNK-01 readable path equality assertion/);

  const quoted = row('test("TRUNK-01: readable initial trunk", () => { /* ASSERT:TRUNK-01:READABLE-PATH */ const obsolete = `assert.equal(actual, join(root, "trunks", "main@ledger"))`; assert.equal(actual, join(root, "trunks", "ledger", branchKey("main"))); });\n');
  assert.equal(quoted.status, 1);
  assert.match(quoted.stderr, /TRUNK-01 readable path equality assertion/);
});

test("T076 validator: generic setup assertions and detached semantic markers are rejected", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:OUTCOME-ASSERTION */ assert.equal(fx.grove(["init"]).status, 0); });\n' },
  );
  const base = {
    id: "ALPHA-01",
    disposition: "preserved",
    contractExpected: "result",
    evidenceSummary: "The exact assertion checks the inherited result.",
    proofObligations: [{
      id: "result",
      expectedClause: "result",
      actualOutcome: "The command result is checked by the adjacent assertion.",
      assertionMarkers: ["ASSERT:ALPHA-01:OUTCOME-ASSERTION"],
    }],
    witnesses: [{
      file: "witness.test.ts",
      title: "ALPHA-01: exact witness",
      assertionMarkers: [{
        marker: "ASSERT:ALPHA-01:OUTCOME-ASSERTION",
        assertion: 'assert.equal(fx.grove(["init"]).status, 0)',
      }],
    }],
  };
  const setupOnly = run(input, false, writeLedger(input, [base]));
  assert.equal(setupOnly.status, 1);
  assert.match(setupOnly.stderr, /generic successful-init setup assertion/);

  const detachedInput = fixture(
    ["| ALPHA-01 | setup | result |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:OUTCOME-ASSERTION */ unrelated(); assert.equal(actual, expected); });\n' },
  );
  const detached = run(detachedInput, false, writeLedger(detachedInput, [{
    ...base,
    witnesses: [{
      ...base.witnesses[0],
      assertionMarkers: [{ marker: "ASSERT:ALPHA-01:OUTCOME-ASSERTION", assertion: "assert.equal(actual, expected)" }],
    }],
  }]));
  assert.equal(detached.status, 1);
  assert.match(detached.stderr, /marker is not adjacent/);
});

test("T076 validator: every material contract clause needs an explicit executable proof obligation", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | Succeeds; retains the exact ref without changing config. |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:REF-RETAINED */ assert.equal(afterRef, beforeRef); });\n' },
  );
  const ledger = writeLedger(input, [{
    id: "ALPHA-01",
    disposition: "preserved",
    contractExpected: "Succeeds; retains the exact ref without changing config.",
    evidenceSummary: "The claimed witness proves ref retention but omits success and unchanged config.",
    proofObligations: [{
      id: "ref-retained",
      expectedClause: "retains the exact ref",
      actualOutcome: "The ref after the command equals its exact pre-command value.",
      assertionMarkers: ["ASSERT:ALPHA-01:REF-RETAINED"],
    }],
    witnesses: [{
      file: "witness.test.ts",
      title: "ALPHA-01: exact witness",
      assertionMarkers: [{ marker: "ASSERT:ALPHA-01:REF-RETAINED", assertion: "assert.equal(afterRef, beforeRef)" }],
    }],
  }]);
  const result = run(input, false, ledger);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /multi-clause outcome has 1 proof obligation/);
});

test("T076 validator: obligations must map literal contract clauses to assigned witness markers", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | Refuses; preserves config. |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:COMMAND-REFUSES */ assert.notEqual(result.status, 0); /* ASSERT:ALPHA-01:CONFIG-PRESERVED */ assert.equal(after, before); });\n' },
  );
  const base = {
    id: "ALPHA-01",
    disposition: "preserved",
    contractExpected: "Refuses; preserves config.",
    evidenceSummary: "Two exact executable assertions prove refusal and config preservation.",
    proofObligations: [
      {
        id: "refusal",
        expectedClause: "Refuses",
        actualOutcome: "The command exits nonzero.",
        assertionMarkers: ["ASSERT:ALPHA-01:COMMAND-REFUSES"],
      },
      {
        id: "config-preserved",
        expectedClause: "preserves config.",
        actualOutcome: "The post-command config equals the pre-command bytes.",
        assertionMarkers: ["ASSERT:ALPHA-01:CONFIG-PRESERVED"],
      },
    ],
    witnesses: [{
      file: "witness.test.ts",
      title: "ALPHA-01: exact witness",
      assertionMarkers: [
        { marker: "ASSERT:ALPHA-01:COMMAND-REFUSES", assertion: "assert.notEqual(result.status, 0)" },
        { marker: "ASSERT:ALPHA-01:CONFIG-PRESERVED", assertion: "assert.equal(after, before)" },
      ],
    }],
  };
  const valid = run(input, false, writeLedger(input, [base]));
  assert.equal(valid.status, 0, valid.stderr);

  const missingClause = run(input, false, writeLedger(input, [{
    ...base,
    proofObligations: [{
      ...base.proofObligations[0],
      expectedClause: "not literal contract text",
    }, base.proofObligations[1]],
  }]));
  assert.equal(missingClause.status, 1);
  assert.match(missingClause.stderr, /expected clause is not literal contract text/);

  const unassigned = run(input, false, writeLedger(input, [{
    ...base,
    proofObligations: [base.proofObligations[0]],
  }]));
  assert.equal(unassigned.status, 1);
  assert.match(unassigned.stderr, /witness marker is not assigned to a proof obligation/);

  const reusedSimple = run(input, false, writeLedger(input, [{
    ...base,
    proofObligations: [
      base.proofObligations[0],
      { ...base.proofObligations[1], assertionMarkers: ["ASSERT:ALPHA-01:COMMAND-REFUSES"] },
    ],
  }]));
  assert.equal(reusedSimple.status, 1);
  assert.match(reusedSimple.stderr, /rest \d+ proof obligations on one non-consolidated assertion/);

  const duplicatedClause = run(input, false, writeLedger(input, [{
    ...base,
    proofObligations: [
      base.proofObligations[0],
      { ...base.proofObligations[1], expectedClause: "Refuses" },
    ],
  }]));
  assert.equal(duplicatedClause.status, 1);
  assert.match(duplicatedClause.stderr, /duplicates an expected clause|no proof obligation for exact material clause/);
});

test("P2a validator: a superseded row decomposes its multi-clause outcome exactly like a preserved row", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | Refuses; preserves config. |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:COMMAND-REFUSES */ assert.notEqual(result.status, 0); /* ASSERT:ALPHA-01:CONFIG-PRESERVED */ assert.equal(after, before); });\n' },
  );
  const refusal = {
    id: "refusal",
    expectedClause: "Refuses",
    actualOutcome: "The command exits nonzero.",
    assertionMarkers: ["ASSERT:ALPHA-01:COMMAND-REFUSES"],
  };
  const configPreserved = {
    id: "config-preserved",
    expectedClause: "preserves config.",
    actualOutcome: "The post-command config equals the pre-command bytes.",
    assertionMarkers: ["ASSERT:ALPHA-01:CONFIG-PRESERVED"],
  };
  const refusalMarker = { marker: "ASSERT:ALPHA-01:COMMAND-REFUSES", assertion: "assert.notEqual(result.status, 0)" };
  const configMarker = { marker: "ASSERT:ALPHA-01:CONFIG-PRESERVED", assertion: "assert.equal(after, before)" };
  const witness = {
    file: "witness.test.ts",
    title: "ALPHA-01: exact witness",
    assertionMarkers: [refusalMarker, configMarker],
  };
  const witnesses = [witness];
  const base = {
    id: "ALPHA-01",
    disposition: "superseded",
    contractExpected: "Refuses; preserves config.",
    evidenceSummary: "Superseded; the v1 clauses remain individually witnessed.",
    proofObligations: [refusal, configPreserved],
    witnesses,
  };

  // A superseded row with one obligation against a two-clause v1 outcome must FAIL. Before P2a the
  // validator compared against `[row.contractExpected]` whole for superseded rows, so this passed —
  // exempting precisely the rows whose behaviour changed.
  const underProven = run(input, false, writeLedger(input, [{
    ...base,
    proofObligations: [refusal],
    witnesses: [{ ...witness, assertionMarkers: [refusalMarker] }],
  }]));
  assert.equal(underProven.status, 1);
  assert.match(underProven.stderr, /multi-clause outcome has 1 proof obligation;/);
  assert.match(underProven.stderr, /no proof obligation for exact material clause: "preserves config\."/);

  // A superseded row that decomposes every material clause passes, exactly as a preserved one does.
  const decomposed = run(input, false, writeLedger(input, [base]));
  assert.equal(decomposed.status, 0, decomposed.stderr);

  // Disposition must not change the required clause set at all.
  const preserved = run(input, false, writeLedger(input, [{
    ...base,
    disposition: "preserved",
    proofObligations: [refusal],
    witnesses: [{ ...witness, assertionMarkers: [refusalMarker] }],
  }]));
  assert.equal(preserved.status, 1);
  assert.match(preserved.stderr, /multi-clause outcome has 1 proof obligation;/);
});

test("P2a validator: a witness must still be a real titled test whose body contains the exact assertion", () => {
  const input = fixture(
    ["| ALPHA-01 | setup | result |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:REF-RETAINED */ assert.equal(afterRef, beforeRef); });\n' },
  );
  const base = {
    id: "ALPHA-01",
    disposition: "superseded",
    contractExpected: "result",
    evidenceSummary: "Superseded; the single v1 clause is still witnessed exactly.",
    proofObligations: [{
      id: "ref-retained",
      expectedClause: "result",
      actualOutcome: "The ref after the command equals its exact pre-command value.",
      assertionMarkers: ["ASSERT:ALPHA-01:REF-RETAINED"],
    }],
    witnesses: [{
      file: "witness.test.ts",
      title: "ALPHA-01: exact witness",
      assertionMarkers: [{ marker: "ASSERT:ALPHA-01:REF-RETAINED", assertion: "assert.equal(afterRef, beforeRef)" }],
    }],
  };
  const valid = run(input, false, writeLedger(input, [base]));
  assert.equal(valid.status, 0, valid.stderr);

  // Regression guard for `:208`: the witness title must exist verbatim in the named file. A ledger
  // row may not name a test that was renamed or never written.
  const absentTitle = run(input, false, writeLedger(input, [{
    ...base,
    witnesses: [{ ...base.witnesses[0], title: "ALPHA-01: a test that does not exist" }],
  }]));
  assert.equal(absentTitle.status, 1);
  assert.match(absentTitle.stderr, /exact test title not found uniquely in witness\.test\.ts/);

  // Regression guard for `:227`: the cited assertion text must appear verbatim in that test's body.
  // Prose describing an assertion earns no credit.
  const absentAssertion = run(input, false, writeLedger(input, [{
    ...base,
    witnesses: [{
      ...base.witnesses[0],
      assertionMarkers: [{ marker: "ASSERT:ALPHA-01:REF-RETAINED", assertion: "assert.equal(neverWrittenActual, neverWrittenExpected)" }],
    }],
  }]));
  assert.equal(absentAssertion.status, 1);
  assert.match(absentAssertion.stderr, /exact evidence assertion not found in witness body/);

  // Regression guard for `:230-246`: an assertion that survives only inside a comment is not
  // executable evidence, so the marker is no longer adjacent to anything.
  const commentedInput = fixture(
    ["| ALPHA-01 | setup | result |"],
    { witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:REF-RETAINED */ /* assert.equal(afterRef, beforeRef); */ });\n' },
  );
  const commented = run(commentedInput, false, writeLedger(commentedInput, [base]));
  assert.equal(commented.status, 1);
  assert.match(commented.stderr, /marker is not adjacent to its evidence assertion/);
});

/**
 * Round-3's independent reader broke the observed-value rule three ways and demonstrated each with
 * a working bypass that printed PASSED. All three are closed; these are the negative controls.
 */
test("round-3 bypasses: cross-row sharing, string-fragment miscounts, and a shadowed fixture all fail", () => {
  const witnessBody =
    'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:A */ assert.deepEqual({ vacuous: "yes,indeed" }, { vacuous: "yes,indeed" }); });\n' +
    'test("BETA-01: exact witness", () => { /* ASSERT:BETA-01:A */ assert.deepEqual({ vacuous: "yes,indeed" }, { vacuous: "yes,indeed" }); });\n';
  const input = fixture(
    ["| ALPHA-01 | setup | Refuses. |", "| BETA-01 | setup | Refuses. |"],
    { witness: witnessBody },
  );
  const shared = 'assert.deepEqual({ vacuous: "yes,indeed" }, { vacuous: "yes,indeed" })';
  const row = (id: string) => ({
    id,
    disposition: "preserved",
    contractExpected: "Refuses.",
    evidenceSummary: "One assertion.",
    proofObligations: [{ id: "c1", expectedClause: "Refuses.", actualOutcome: "x", assertionMarkers: [`ASSERT:${id}:A`] }],
    witnesses: [{ file: "witness.test.ts", title: `${id}: exact witness`, assertionMarkers: [{ marker: `ASSERT:${id}:A`, assertion: shared }] }],
  });

  // ONE assertion, one obligation in EACH of two scenarios. The old per-row rule never looked
  // across rows, so this printed PASSED; 133 live obligations rested on exactly this shape.
  // The assertion is also the round-2 vacuous bypass with one comma added — the comma used to be
  // read as a field separator, turning a 0-observation literal into 2.
  const crossRow = run(input, false, writeLedger(input, [row("ALPHA-01"), row("BETA-01")]));
  assert.equal(crossRow.status, 1, crossRow.stderr);
  assert.match(crossRow.stderr, /rows ALPHA-01, BETA-01 rest 2 proof obligations on an assertion observing only 0 distinct/);

  // A no-op local shadow of an exempt fixture name earns the exemption no longer: the rule now
  // checks that the declaration the name resolves to really does assert several times.
  const shadowInput = fixture(
    ["| ALPHA-01 | setup | Refuses; preserves config. |"],
    { witness: 'const assertEnvelope = (_x: unknown) => {};\ntest("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:A */ assertEnvelope(result); });\n' },
  );
  const shadowed = run(shadowInput, false, writeLedger(shadowInput, [{
    id: "ALPHA-01",
    disposition: "preserved",
    contractExpected: "Refuses; preserves config.",
    evidenceSummary: "A fixture call.",
    proofObligations: [
      { id: "c1", expectedClause: "Refuses", actualOutcome: "x", assertionMarkers: ["ASSERT:ALPHA-01:A"] },
      { id: "c2", expectedClause: "preserves config.", actualOutcome: "x", assertionMarkers: ["ASSERT:ALPHA-01:A"] },
    ],
    witnesses: [{ file: "witness.test.ts", title: "ALPHA-01: exact witness", assertionMarkers: [{ marker: "ASSERT:ALPHA-01:A", assertion: "assertEnvelope(result)" }] }],
  }]));
  assert.equal(shadowed.status, 1, shadowed.stderr);
  assert.match(shadowed.stderr, /rest 2 proof obligations on an assertion observing only 1 distinct/);
});

/**
 * The clause splitter must decompose a compound PREDICATE ("Refuses and preserves it") into two
 * obligations, while leaving a compound SUBJECT ("modified and untracked files are gone") whole.
 * Removing the `and` split entirely cured the fragments but collapsed 65 independent predicates.
 */
test("materialClauses splits and-joined predicates but not and-joined subjects", () => {
  const input = fixture(["| ALPHA-01 | setup | Refuses and preserves it byte-for-byte. |"], {
    witness: 'test("ALPHA-01: exact witness", () => { /* ASSERT:ALPHA-01:REFUSES-AND-PRESERVES-BYTES */ assert.equal(r.status, 2); });\n',
  });
  const oneObligation = run(input, false, writeLedger(input, [{
    id: "ALPHA-01",
    disposition: "preserved",
    contractExpected: "Refuses and preserves it byte-for-byte.",
    evidenceSummary: "One assertion.",
    proofObligations: [{ id: "c1", expectedClause: "Refuses and preserves it byte-for-byte.", actualOutcome: "x", assertionMarkers: ["ASSERT:ALPHA-01:REFUSES-AND-PRESERVES-BYTES"] }],
    witnesses: [{ file: "witness.test.ts", title: "ALPHA-01: exact witness", assertionMarkers: [{ marker: "ASSERT:ALPHA-01:REFUSES-AND-PRESERVES-BYTES", assertion: "assert.equal(r.status, 2)" }] }],
  }]));
  assert.equal(oneObligation.status, 1, oneObligation.stderr);
  assert.match(oneObligation.stderr, /has no proof obligation for exact material clause: "Refuses"/);

  const subject = fixture(["| BETA-01 | setup | Modified and untracked files are gone. |"], {
    witness: 'test("BETA-01: exact witness", () => { /* ASSERT:BETA-01:MODIFIED-AND-UNTRACKED-ARE-GONE */ assert.equal(r.status, 0); });\n',
  });
  const wholeSubject = run(subject, false, writeLedger(subject, [{
    id: "BETA-01",
    disposition: "preserved",
    contractExpected: "Modified and untracked files are gone.",
    evidenceSummary: "One assertion.",
    proofObligations: [{ id: "c1", expectedClause: "Modified and untracked files are gone.", actualOutcome: "x", assertionMarkers: ["ASSERT:BETA-01:MODIFIED-AND-UNTRACKED-ARE-GONE"] }],
    witnesses: [{ file: "witness.test.ts", title: "BETA-01: exact witness", assertionMarkers: [{ marker: "ASSERT:BETA-01:MODIFIED-AND-UNTRACKED-ARE-GONE", assertion: "assert.equal(r.status, 0)" }] }],
  }]));
  assert.equal(wholeSubject.status, 0, wholeSubject.stderr);
});
