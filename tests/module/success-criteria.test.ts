/**
 * P2.3 / ledger G-8. The `§N` stability discipline in `specs/001-grove-cli/contracts/README.md`
 * was never extended to success-criteria IDs, so `SC-004` meant four different things across five
 * features — two of which even share the `003` number prefix. IDs are now namespaced by full
 * feature directory (`003-git-native-grove-SC-004`), and this gate keeps them that way.
 *
 * The second half is the one that matters: a criterion nobody proves is a claim, not a criterion.
 * Every criterion of the feature under construction must be cited by a test title, or carry an
 * explicit `no-witness` disposition naming a reason. Silence is not an option.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FEATURE = "003-git-native-grove";
const DISPOSITIONS = join("specs", FEATURE, "reviews", "success-criteria-dispositions.md");

/** `SC-NNN` with no feature namespace. `DISC-10` must not match — hence the explicit boundary. */
const BARE = /(?<![A-Za-z0-9-])SC-\d{3}\b/g;
const NAMESPACED = /\b\d{3}-[a-z-]+-SC-\d{3}\b/g;

function walk(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  const step = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) step(path);
      else if (test(entry.name)) out.push(path);
    }
  };
  step(dir);
  return out;
}

function definedCriteria(): Map<string, Set<string>> {
  const byFeature = new Map<string, Set<string>>();
  for (const feature of readdirSync("specs")) {
    const spec = join("specs", feature, "spec.md");
    if (!existsSync(spec)) continue;
    const ids = new Set<string>();
    for (const match of readFileSync(spec, "utf8").matchAll(/\*\*(\d{3}-[a-z-]+-SC-\d{3})\*\*/g)) ids.add(match[1]!);
    if (ids.size > 0) byFeature.set(feature, ids);
  }
  return byFeature;
}

const defined = definedCriteria();
const allIds = new Set([...defined.values()].flatMap((set) => [...set]));

test("P2.3: no bare SC-NNN survives in specs, src, or tests", () => {
  const offenders: string[] = [];
  const files = [...walk("specs", (n) => n.endsWith(".md")), ...walk("src", (n) => /\.(ts|mjs)$/.test(n)), ...walk("tests", (n) => /\.(ts|mjs)$/.test(n))];
  for (const file of files) {
    if (file.endsWith("success-criteria.test.ts")) continue; // this file names the bad pattern on purpose
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      for (const match of line.matchAll(BARE)) offenders.push(`${file}:${index + 1} ${match[0]}`);
    });
  }
  assert.deepEqual(offenders, [], `un-namespaced success criteria:\n  ${offenders.join("\n  ")}`);
});

test("P2.3: every namespaced citation resolves to a criterion some spec actually defines", () => {
  const unresolved = new Set<string>();
  for (const file of [...walk("specs", (n) => n.endsWith(".md")), ...walk("src", (n) => /\.(ts|mjs)$/.test(n)), ...walk("tests", (n) => /\.(ts|mjs)$/.test(n))]) {
    for (const match of readFileSync(file, "utf8").matchAll(NAMESPACED)) {
      if (!allIds.has(match[0])) unresolved.add(`${match[0]} (cited in ${file})`);
    }
  }
  assert.deepEqual([...unresolved], [], "citations to criteria no spec defines");
});

test(`P2.3: every ${FEATURE} success criterion has a witness or an explicit no-witness disposition`, () => {
  const criteria = defined.get(FEATURE);
  assert.ok(criteria && criteria.size > 0, `${FEATURE}/spec.md defines no success criteria`);

  const titles = walk("tests", (n) => /\.(ts|mjs)$/.test(n))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const cited = new Set<string>();
  for (const match of titles.matchAll(/^\s*test\(\s*[`"'](.+?)[`"']/gm)) {
    for (const id of match[1]!.matchAll(NAMESPACED)) cited.add(id[0]);
  }

  // A disposition row is `| <id> | <reason> |` with a non-empty reason.
  const dispositions = new Map<string, string>();
  if (existsSync(DISPOSITIONS)) {
    for (const line of readFileSync(DISPOSITIONS, "utf8").split("\n")) {
      const row = /^\|\s*(\d{3}-[a-z-]+-SC-\d{3})\s*\|\s*(.+?)\s*\|/.exec(line);
      if (row && row[2] && !/^-+$/.test(row[2])) dispositions.set(row[1]!, row[2]!);
    }
  }

  const silent = [...criteria].filter((id) => !cited.has(id) && !dispositions.has(id)).sort();
  assert.deepEqual(silent, [], `criteria with neither a witness nor a stated reason:\n  ${silent.join("\n  ")}`);

  // A disposition must not outlive its reason: once a witness exists, the row is stale.
  const stale = [...dispositions.keys()].filter((id) => cited.has(id)).sort();
  assert.deepEqual(stale, [], `dispositions for criteria that ARE now proven — delete these rows:\n  ${stale.join("\n  ")}`);

  // And it must not describe a criterion that no longer exists.
  const orphan = [...dispositions.keys()].filter((id) => !criteria.has(id)).sort();
  assert.deepEqual(orphan, [], `dispositions for criteria ${FEATURE} does not define:\n  ${orphan.join("\n  ")}`);
});

test("gate 2: no live requirement mandates migration, which the constitution forbids", () => {
  // `/speckit-analyze` found 17 FRs still stating "Migration MUST ..." after ruling ⑤ deleted the
  // subsystem — requirements that directly contradict constitution 5.0.0 Principle VI ("There is no
  // migration path"). The constitution's own gate forbids implementing while such a conflict
  // stands, and nothing mechanical would have noticed: FR text is prose that no test read.
  //
  // Void requirements keep their IDs (stable citation keys) and say so; this asserts the marking
  // is there, so deleting the note without deleting the requirement fails.
  const spec = readFileSync(join("specs", FEATURE, "spec.md"), "utf8");
  const constitution = readFileSync(join(".specify", "memory", "constitution.md"), "utf8");
  assert.match(constitution, /There is no migration path/, "the constitution rule this gate enforces has moved or been reworded");

  const live: string[] = [];
  for (const line of spec.split("\n")) {
    const requirement = /^- \*\*(FR-[0-9]+[A-Z]?)\*\*:\s*(.*)$/.exec(line);
    if (!requirement) continue;
    const body = requirement[2]!;
    if (/\bVOID\b/.test(body)) continue;
    if (/\bmigrat/i.test(body) && /\bMUST\b/.test(body)) live.push(`${requirement[1]}: ${body.slice(0, 90)}`);
  }
  assert.deepEqual(live, [], `live requirements mandating a deleted subsystem:\n  ${live.join("\n  ")}`);
});

