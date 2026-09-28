/**
 * P1.2 / ruling ⑧ (ledger G-1). `specs/001-grove-cli/contracts/` stays the stable `§` citation
 * authority — 91 live references and 180 regression scenario IDs resolve there, and the
 * traceability gate reads its `acceptance-scenarios.md` by path — but it is closed to new
 * behaviour, and the sections describing subsystems v3 deleted are marked **Superseded**.
 *
 * The defect this gate closes: a citation that resolves into a description of something that no
 * longer exists is worse than no citation, because it reads as current specification. Before this
 * test, `src/model/encoding.ts` cited §10.3.1, a section the contract index had already retired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONTRACTS = "specs/001-grove-cli/contracts";

/** §N ranges each contract file owns, read from its own `**Owns:**` line rather than hardcoded. */
function ownership(): Map<string, { file: string; retired: boolean }> {
  const owners = new Map<string, { file: string; retired: boolean }>();
  for (const name of readdirSync(CONTRACTS).filter((n) => n.endsWith(".md") && n !== "README.md")) {
    const text = readFileSync(join(CONTRACTS, name), "utf8");
    const owns = /^\*\*Owns:\*\*\s*(.+?)\s*·/m.exec(text);
    assert.ok(owns, `${name} has no **Owns:** line; the citation gate cannot place its sections`);
    for (const part of (owns[1] ?? "").split("·")[0]!.split(",")) {
      const range = /§(\d+)(?:[–-]§?(\d+))?/.exec(part.trim());
      if (!range) continue;
      const lo = Number(range[1]);
      const hi = range[2] === undefined ? lo : Number(range[2]);
      for (let n = lo; n <= hi; n++) owners.set(String(n), { file: name, retired: false });
    }
  }
  return owners;
}

/** Top-level sections the contract index itself marks retired — these own no file. */
function retiredTopLevel(): Set<string> {
  const index = readFileSync(join(CONTRACTS, "README.md"), "utf8");
  const retired = new Set<string>();
  for (const line of index.split("\n")) {
    const row = /^\|\s*§(\d+)\s*\|.*\*retired\*/.exec(line);
    if (row) retired.add(row[1]!);
  }
  return retired;
}

/**
 * A section is superseded when a `> **Superseded` blockquote follows its heading before the next
 * heading of the same or shallower depth. Returns the dotted section numbers, e.g. "6.1".
 */
function supersededSections(): Set<string> {
  const superseded = new Set<string>();
  for (const name of readdirSync(CONTRACTS).filter((n) => n.endsWith(".md"))) {
    const lines = readFileSync(join(CONTRACTS, name), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const heading = /^(#{2,6})\s+(\d+(?:\.\d+)*)\s/.exec(lines[i] ?? "");
      if (!heading) continue;
      const depth = heading[1]!.length;
      for (let j = i + 1; j < lines.length; j++) {
        const next = /^(#{2,6})\s/.exec(lines[j] ?? "");
        if (next && next[1]!.length <= depth) break;
        if (/^>\s*\*\*Superseded/.test(lines[j] ?? "")) { superseded.add(heading[2]!); break; }
      }
    }
  }
  return superseded;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      // This file cites §6.1 and §10 as *examples of dead citations*; reading its own prose as
      // claims would make the gate permanently red against itself.
      else if (/\.(ts|mjs)$/.test(entry.name) && !path.endsWith("citations.test.ts")) out.push(path);
    }
  };
  walk("src");
  walk("tests");
  return out;
}

const owners = ownership();
const retired = retiredTopLevel();
const superseded = supersededSections();

test("P1.2: every § citation in src/ and tests/ resolves to a live contract section", () => {
  const bad: string[] = [];
  let total = 0;
  for (const file of sourceFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/§(\d+(?:\.\d+)*)/g)) {
        total++;
        const dotted = match[1]!;
        const top = dotted.split(".")[0]!;
        const where = `${file}:${index + 1} §${dotted}`;
        if (retired.has(top)) { bad.push(`${where} — §${top} is marked *retired* in the contract index`); continue; }
        if (!owners.has(top)) { bad.push(`${where} — no contract file declares ownership of §${top}`); continue; }
        // A citation is dead if it, or any ancestor section, carries a Superseded note.
        const parts = dotted.split(".");
        for (let n = 1; n <= parts.length; n++) {
          const ancestor = parts.slice(0, n).join(".");
          if (superseded.has(ancestor)) { bad.push(`${where} — §${ancestor} is superseded by the v3 contracts`); break; }
        }
      }
    });
  }
  assert.ok(total > 50, `expected the citation corpus to be substantial; found ${total}`);
  assert.deepEqual(bad, [], `dead § citations:\n  ${bad.join("\n  ")}`);
});

test("P1.2: the gate can actually fail — a citation into a superseded section is rejected", () => {
  // Non-vacuity. §6.1 (the rollback journal) is marked Superseded by this phase; if the parser
  // silently found nothing, the test above would pass against any corpus.
  assert.ok(superseded.has("6.1"), "§6.1 should be marked Superseded in safety.md");
  assert.ok(retired.has("10"), "§10 should be marked *retired* in the contract index");
  assert.ok(owners.has("9") && owners.get("9")!.file === "exit-codes.md", "§9 should resolve to exit-codes.md");
});

test("P1.2: no contract file under specs/001 is still marked normative", () => {
  const still: string[] = [];
  for (const name of readdirSync(CONTRACTS).filter((n) => n.endsWith(".md") && n !== "README.md")) {
    const text = readFileSync(join(CONTRACTS, name), "utf8");
    if (/\*\*Status:\*\*\s*normative/.test(text)) still.push(name);
  }
  assert.deepEqual(still, [], "001 is closed to new behaviour; every contract file must say so");
});

test("P2.7: no contract names a normative source outside specs/", () => {
  // ledger G-13. `cli-surface-v3.md` cited `docs/git-native-grove-proposal.md` as its "Normative
  // source" — an 1835-line non-contract document outside specs/ carrying three stacked supersession
  // banners. That makes a contract's authority depend on a file nobody maintains against it.
  const offenders: string[] = [];
  const contractDirs = ["specs/001-grove-cli/contracts", "specs/003-git-native-grove/contracts"];
  for (const dir of contractDirs) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      readFileSync(join(dir, name), "utf8").split("\n").forEach((line, index) => {
        if (!/\bnormative\b/i.test(line)) return;
        // A path outside specs/ on a line that claims normativity.
        for (const match of line.matchAll(/`([^`]*\.md)`|\b((?:docs|\.archive)\/[\w./-]+\.md)\b/g)) {
          const path = (match[1] ?? match[2])!;
          if (path.startsWith("specs/") || !path.includes("/")) continue;
          if (/not normative|historical|no longer/i.test(line)) continue; // an explicit demotion is the fix, not the defect
          offenders.push(`${dir}/${name}:${index + 1} cites ${path} on a normativity line`);
        }
      });
    }
  }
  assert.deepEqual(offenders, [], `contracts naming a normative source outside specs/:\n  ${offenders.join("\n  ")}`);
});

test("010: no v3 contract depends on the historical proposal", () => {
  // P2.7 keys on file paths, so "Normative source: proposal section 5" passed it while making three
  // contracts depend on a document nobody maintained against them. Key on the word instead; an
  // explicit demotion is how a line may still mention it.
  const dir = "specs/003-git-native-grove/contracts";
  const offenders: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    readFileSync(join(dir, name), "utf8").split("\n").forEach((line, index) => {
      if (/\bproposal\b/i.test(line) && !/historical|not normative|\bvoid\b|no longer/i.test(line)) offenders.push(`${dir}/${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `contract lines depending on the proposal:\n  ${offenders.join("\n  ")}`);
});

test("P2b: every § citation in the prior-release ledger resolves to a section that still exists", () => {
  // Scoped deliberately narrower than the src/tests gate above, and the reason matters.
  //
  // EVERY `§` in this ledger sits inside verbatim v1 contract text — `contractExpected` is pinned
  // byte-for-byte by the validator, `expectedClause` must be a literal substring of it, and
  // `actualOutcome` is boilerplate wrapping that same clause. A citation into a SUPERSEDED section
  // is therefore correct history, not a defect: it records what v1 promised. Rejecting those would
  // reward rewriting the historical record to satisfy a linter, which is the failure mode this
  // whole review exists to correct.
  //
  // What IS worth enforcing is that no citation dangles: the sections must still exist and still be
  // owned by a contract file. That is exactly what "never renumber sections" protects, and nothing
  // else checked it for this file.
  const text = readFileSync("specs/003-git-native-grove/reviews/prior-release-scenario-ledger.json", "utf8");
  const dangling = new Set<string>();
  let total = 0;
  for (const match of text.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    total++;
    const top = match[1]!.split(".")[0]!;
    if (!owners.has(top) && !retired.has(top)) dangling.add(`§${match[1]}`);
  }
  assert.ok(total >= 20, `expected the ledger to carry a substantial citation corpus; found ${total}`);
  assert.deepEqual([...dangling], [], "ledger citations pointing at sections no contract file owns");
});

