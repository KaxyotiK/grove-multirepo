/**
 * P2.7 / ledger G-12. `acceptance-scenarios-v3.md` states dispositions in prose while
 * `reviews/prior-release-scenario-ledger.json` states them as data, and the two disagreed:
 * the closing bullet listed `CMD-11` among IDs that "preserve their prior user-visible safety
 * result" while the ledger marked it `superseded` (its exit code changed 2 → 3).
 *
 * The traceability validator structurally cannot catch this — it compares `contractExpected`
 * against the 001 contract cell and never reads this file's prose. So the check lives here.
 * The ledger is authoritative; the prose must not contradict it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CONTRACT = "specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md";
const LEDGER = "specs/003-git-native-grove/reviews/prior-release-scenario-ledger.json";

const prose = readFileSync(CONTRACT, "utf8");
const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
  scenarios: { id: string; disposition: string }[];
};
const disposition = new Map(ledger.scenarios.map((s) => [s.id, s.disposition]));
const v3Acceptance = prose;
const v3Surface = readFileSync("specs/003-git-native-grove/contracts/cli-surface-v3.md", "utf8");
const feature009 = readFileSync("specs/009-file-surface-state-exclusion/spec.md", "utf8");
const research009 = readFileSync("specs/009-file-surface-state-exclusion/research.md", "utf8");
const jsonResults = readFileSync("specs/003-git-native-grove/contracts/json-results-v1.md", "utf8");

/** The bullet that claims a set of IDs kept its prior result. Expanded through `X through Y` runs. */
function preservedByProse(): string[] {
  const bullet = prose
    .split("\n- ")
    .find((b) => /preserve their prior user-visible safety result/.test(b));
  assert.ok(bullet, "the 'preserve their prior result' bullet is missing from the contract");

  const ids = new Set<string>();
  // `FILE-01` through `FILE-06` means the whole inclusive run, not just the endpoints.
  for (const run of bullet.matchAll(/`([A-Z][A-Z0-9]*)-(\d{2})`\s+through\s+`\1-(\d{2})`/g)) {
    for (let n = Number(run[2]); n <= Number(run[3]); n++) ids.add(`${run[1]}-${String(n).padStart(2, "0")}`);
  }
  let stripped = bullet.replace(/`([A-Z][A-Z0-9]*)-(\d{2})`\s+through\s+`\1-(\d{2})`/g, "");
  for (const single of stripped.matchAll(/`([A-Z][A-Z0-9]*-\d{2})`/g)) ids.add(single[1]!);
  return [...ids].sort();
}

test("P2.7: no scenario the contract calls preserved is marked superseded in the ledger", () => {
  const contradictions = preservedByProse()
    .filter((id) => disposition.get(id) && disposition.get(id) !== "preserved")
    .map((id) => `${id}: prose says preserved, ledger says ${disposition.get(id)}`);
  assert.deepEqual(contradictions, [], `contract prose contradicts the authoritative ledger:\n  ${contradictions.join("\n  ")}`);
});

test("P2.7: the check can fail — it resolves real IDs and reads real dispositions", () => {
  // Non-vacuity. If the bullet parser returned nothing, or the ledger map were empty, the test
  // above would pass against any contradiction at all.
  const preserved = preservedByProse();
  assert.ok(preserved.length >= 10, `the bullet parser found only ${preserved.length} IDs`);
  assert.ok(preserved.includes("FILE-03"), "`X through Y` runs must expand, not just match endpoints");
  assert.ok(disposition.size >= 180, `the ledger map holds only ${disposition.size} rows`);
  // CMD-11 is the specific defect G-12 recorded: it must be superseded and must NOT be claimed.
  assert.equal(disposition.get("CMD-11"), "superseded");
  assert.equal(preserved.includes("CMD-11"), false, "CMD-11 is superseded and must not be listed as preserved");
});

test("round-6 credential wording distinguishes SSH URL redaction and the partial-add remedy", () => {
  assert.match(v3Acceptance, /an `ssh:\/\/` remote is echoed with its query and fragment stripped, while a (?:plain )?scp-like SSH remote is echoed unchanged/);
  assert.match(v3Surface, /The pre-mutation refusal is `invalid-input` \(exit 2\)/);
  assert.match(v3Surface, /`grove reconcile --abandon <operationId>`[^.]*before retrying/);
  assert.match(feature009, /When `sync` reads a URL-valued\s+`branch\.<name>\.remote`, it redacts the value before placing it in a result or operation record/);
});

test("FR-009 states that later re-checks cover Git network calls, not third-party checkout filters", () => {
  assert.match(feature009, /This covers network calls made by Git itself; it does\s+not cover an independently configured third-party checkout filter such as Git LFS smudge/);
  assert.match(v3Surface, /This covers network calls made by Git itself; it does not cover an independently configured third-party checkout filter such as Git LFS smudge/);
});

test("round-8 SSH credential wording describes Git's exact decode and bracket precedence", () => {
  for (const document of [feature009, research009, v3Surface, jsonResults]) {
    assert.match(document, /percent-decodes? only (?:a )?(?:scheme:\/\/|`scheme:\/\/`|URL-shaped) (?:SSH )?(?:URL|value|input)/i);
    assert.match(document, /first\s+`@\[`[\s\S]{0,120}(?:then|otherwise)[\s\S]{0,120}leading `\[`/i);
    assert.match(document, /slash(?:es)?\s+inside\s+(?:a\s+)?bracketed\s+host\s+field/);
    assert.match(document, /login[\s\S]{0,120}last\s+`@`/);
  }
});
