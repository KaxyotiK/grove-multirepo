#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";

function parseArgs(argv) {
  const options = {
    contract: "specs/001-grove-cli/contracts/acceptance-scenarios.md",
    tests: "tests",
    deferrals: null,
    ledger: null,
    allowDeferrals: false,
    ignorePrefixes: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--allow-deferrals") options.allowDeferrals = true;
    else if (arg === "--ignore-unknown") {
      // P2.2 / ledger G-6. Removed deliberately, and refused loudly rather than ignored: while it
      // existed it short-circuited EVERY unknown-ID check, so a mistyped or invented V3 scenario
      // id in a test title passed the gate silently. Its legitimate use -- letting the v3 leg
      // tolerate the 180 prior-release ids that prior-release test titles are REQUIRED to cite --
      // is re-expressed per family with --ignore-prefix, which cannot swallow a V3 typo.
      process.stderr.write("--ignore-unknown was removed (P2.2): pass --ignore-prefix per prior-release family instead.\n");
      process.exit(2);
    }
    else if (arg === "--ignore-prefix") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a prefix`);
      options.ignorePrefixes.push(value);
    }
    else if (arg === "--contract" || arg === "--tests" || arg === "--deferrals" || arg === "--ledger") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a path`);
      options[arg.slice(2)] = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function testFiles(root) {
  const out = [];
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else if (child.endsWith(".test.ts")) out.push(child);
    }
  };
  visit(root);
  return out;
}

function executableSource(source) {
  // Remove comments without touching quoted test titles. A line that merely LOOKS like a test
  // inside `/* ... */` is not executable and must never earn traceability credit.
  let executable = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") { lineComment = false; executable += char; }
      else executable += " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { executable += "  "; index++; blockComment = false; }
      else executable += char === "\n" ? "\n" : " ";
      continue;
    }
    if (quote !== null) {
      executable += char;
      if (char === "\\" && next !== undefined) { executable += next; index++; }
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; executable += char; continue; }
    if (char === "/" && next === "/") { executable += "  "; index++; lineComment = true; continue; }
    if (char === "/" && next === "*") { executable += "  "; index++; blockComment = true; continue; }
    executable += char;
  }
  // Test declarations in this repository begin on their own line. Anchoring prevents fixture
  // strings such as `'test("BOGUS-99", …)'` from being mistaken for executable title citations.
  return executable;
}

function testDeclarations(source) {
  const executable = executableSource(source);
  const declaration = /^\s*test\s*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1(\s*,\s*\{[^}]*\})?/gm;
  const matches = [...executable.matchAll(declaration)];
  return matches.map((match, index) => ({
    title: match[2],
    // `test(name, { skip: true }, fn)` satisfied the title regex, and `node --test` counts a skip
    // as a pass — so 123 witnesses could be disabled with both gates still printing PASSED and
    // `npm test` exiting 0. A skipped or todo'd test proves nothing and is not a witness.
    skipped: /\b(?:skip|todo)\s*:\s*(?!false\b)/.test(match[3] ?? ""),
    // Declaration slicing is intentionally lexical rather than TypeScript-aware. Test declarations
    // in this repository begin on their own line, and the next declaration is the tightest safe
    // boundary for literal assertion-marker proof without executing or importing test modules.
    body: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

function executableTokenOffsets(source, token) {
  const offsets = [];
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { index++; blockComment = false; }
      continue;
    }
    if (quote !== null) {
      if (char === "\\" && next !== undefined) index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "/" && next === "/") { index++; lineComment = true; continue; }
    if (char === "/" && next === "*") { index++; blockComment = true; continue; }
    if (source.startsWith(token, index)) {
      offsets.push(index);
      index += token.length - 1;
    }
  }
  return offsets;
}

const FINITE_VERB = /\b(?:is|are|was|were|has|have|had|does|do|did|can|cannot|must|may|will|remains?|stays?|keeps?|becomes?|exits?|succeeds?|fails?|refuses?|blocks?|warns?|names?|reports?|returns?|prints?|says?|states?|lists?|shows?|emits?|writes?|reads?|creates?|deletes?|removes?|retains?|preserves?|discards?|itemi[sz]es?|bumps?|changes?|leaves?|sets?|adds?|resolves?|rejects?|accepts?|appears?|contains?|carries|produces?|records?|observes?|prunes?|recovers?|releases?|tears?|counts?)\b/i;

/**
 * The separately observable clauses of a contract's expected result.
 *
 * Splits on sentence end, semicolon and em-dash, AND on "and" when BOTH sides carry a finite verb.
 *
 * History, because this rule was got wrong once in a way worth recording. The original splitter
 * broke on every bare "and" (plus "while"/"then"/"without"), producing 82 fragments out of 399 --
 * `"modified"`, `"the Grove"`, `"without force."` -- that nothing can observe. I removed all four
 * splitters. That did cure the fragments, but it also collapsed 65 genuinely independent predicates
 * into single obligations and took the red-row count from 45 to 10, and only the second effect
 * needed the "and" removal. A reviewer measured the alternative -- split on "and" only when both
 * sides contain a finite verb -- and showed it eliminates every fragment I had cited while leaving
 * far more rows red. Both grounds that could have made it unworkable were tested and failed:
 * it produces no duplicate clauses and no clause that violates the literal-substring check.
 *
 * So the finer rule is the honest one and this is it. A coarser clause that is easy to satisfy is
 * not a better clause -- it is a weaker gate wearing the same number.
 */
function materialClauses(expected) {
  const parts = expected
    .split(/\s*(?:;|\s—\s|(?<=\.)\s+(?=[A-Z`]))\s*/)
    .flatMap((part) => {
      const out = [];
      let rest = part;
      for (;;) {
        const at = rest.search(/\s+and\s+/i);
        if (at < 0) { out.push(rest); break; }
        const left = rest.slice(0, at);
        const right = rest.replace(/^[\s\S]{0,}?\s+and\s+/i, "");
        // A compound SUBJECT ("modified and untracked files are gone") has no verb on the left; a
        // compound PREDICATE ("Refuses and preserves it") has one on each side. Only the latter is
        // two obligations.
        if (FINITE_VERB.test(left) && FINITE_VERB.test(right)) { out.push(left); rest = right; continue; }
        out.push(rest); break;
      }
      return out;
    });
  return parts.map((clause) => clause.trim()).filter(Boolean);
}

/**
 * Distinct, non-literal value expressions a consolidated assertion reads from the program.
 *
 * Returns `null` when the shape cannot be read at all — treated as a failure rather than a pass,
 * because an unreadable assertion is exactly what a bypass looks like. A field whose expression is
 * a bare literal (`true`, `0`, `"x"`) observes nothing and does not count; duplicated expressions
 * count once, so restating one observation under several names buys nothing.
 */
/**
 * The body of the `name` declaration in `source`, or null when it declares no such thing.
 * Used to check that a fixture the observed-value rule EXEMPTS really is a multi-assertion routine.
 */
function declarationBody(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*=`).exec(source);
  if (declaration === null) return null;
  const open = source.indexOf("{", declaration.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}

function observedFields(assertion, witnessBody = null) {
  // `assert.throws(...)` observes the throw plus whatever its predicate checks: one outcome.
  // A `deepEqual` whose first argument is an EXPRESSION rather than an object literal (a `.map()`
  // result, say) likewise observes one derived value. Both are honest single observations, not
  // unreadable shapes — returning null for them would be a false positive in this rule, and the
  // rule exists precisely because false confidence is the failure mode under repair.
  // A NAMED FIXTURE is a multi-assertion routine, not a single check: `crashCreation` alone runs
  // seven assertions over refs, worktrees and durable records. Counting it as one observation
  // understated it and was my error, not the witness's — so these are exempt from the count while
  // still being required to be a consolidated form.
  //
  // Residual risk, stated rather than hidden: an author could evade the count by hiding a weak
  // check inside a new fixture. The whitelist is three names, all of which are real multi-assert
  // routines today, and adding to it is a visible edit to this file.
  const fixture = /^(assertEnvelope|goldenJourney|crashCreation)\s*\(/.exec(assertion);
  if (fixture) {
    // VERIFY THE PREMISE rather than trusting the name. Matching the name as text alone was defeated
    // by a two-line local shadow -- `const assertEnvelope = () => {};` in the witness file -- which
    // discharged two obligations with a function that does nothing. The old comment here claimed the
    // residual risk required "a visible edit to this file"; that was false, and this is the
    // correction. All three real fixtures ARE declared in their own witness file (5, 14 and 8
    // `assert.` calls), so the check is not "is it local" but "does the declaration this name
    // resolves to actually assert several times".
    const declared = declarationBody(witnessBody ?? "", fixture[1]);
    if (declared !== null && (declared.match(/\bassert\.\w+\s*\(/g) ?? []).length >= 3) return ["<named-fixture>", "<multi-assert>"];
    return ["<single-expression>"];
  }
  const head = /^assert\.(\w+)\s*\(/.exec(assertion);
  if (head && head[1] === "throws") return ["<throws>"];
  const firstArg = assertion.slice(head ? head[0].length : 0).trimStart();
  if (!firstArg.startsWith("{")) return ["<single-expression>"];
  const open = assertion.indexOf("{");
  if (open < 0) return null;
  let depth = 0, end = -1;
  for (let i = open; i < assertion.length; i++) {
    if (assertion[i] === "{") depth++;
    else if (assertion[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = assertion.slice(open + 1, end);
  // Split STRING-AWARE. Splitting the body on a bare `,` treated a comma INSIDE a string literal as
  // a field separator, so one literal was parsed as n+1 unterminated-quote fragments, each of which
  // escaped the bare-literal filter below. That revived the exact vacuous-assertion bypass this
  // rule was written to close -- `{ vacuous: "yes,indeed" }` counted 2, and `{ n: "a,b,c,d,e,f,g,h" }`
  // counted 8 -- and it scaled without bound.
  const fields = [];
  let field = "", nest = 0, quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote !== null) {
      field += ch;
      if (ch === "\\") { field += body[++i] ?? ""; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; field += ch; continue; }
    if (ch === "[" || ch === "(" || ch === "{") nest++;
    else if (ch === "]" || ch === ")" || ch === "}") nest--;
    if (ch === "," && nest === 0) { fields.push(field); field = ""; continue; }
    field += ch;
  }
  fields.push(field);

  const values = [];
  for (const raw of fields) {
    // The key may itself be a computed or quoted name; find the colon OUTSIDE any string/nesting.
    let colon = -1, depth = 0, q = null;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (q !== null) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { q = ch; continue; }
      if (ch === "[" || ch === "(" || ch === "{") depth++;
      else if (ch === "]" || ch === ")" || ch === "}") depth--;
      else if (ch === ":" && depth === 0) { colon = i; break; }
    }
    const expression = (colon < 0 ? raw : raw.slice(colon + 1)).trim();
    if (expression === "") continue;
    // A bare literal observes nothing about the program. Anchored, and the string form now requires
    // a PROPERLY TERMINATED literal, so a fragment can no longer masquerade as an expression.
    if (/^(?:true|false|null|undefined|-?\d+(?:\.\d+)?)$/.test(expression)) continue;
    if (/^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$|^`(?:[^`\\]|\\.)*`$/.test(expression)) continue;
    // Normalise away spelling-only differences before deduping: `r.status` and `(r.status)` are one
    // observation. This does NOT catch every restatement (`r["status"]`, `Number(r.status)` still
    // read as distinct) -- stated rather than hidden; the global owner counting below is the real
    // bound, not this dedup.
    values.push(expression.replace(/\s+/g, "").replace(/^\(+|\)+$/g, ""));
  }
  return [...new Set(values)];
}

function validateLedger(path, contractRows, testsPath, declarationsByFile, failures) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { failures.push(`cannot read semantic ledger ${path}: ${error instanceof Error ? error.message : String(error)}`); return { rows: 0, witnesses: 0 }; }
  if (typeof raw !== "object" || raw === null || raw.schemaVersion !== 3 || !Array.isArray(raw.scenarios)) {
    failures.push(`invalid semantic ledger ${path}: expected schemaVersion 3 and scenarios array`);
    return { rows: 0, witnesses: 0 };
  }
  const rows = new Map();
  for (const [index, row] of raw.scenarios.entries()) {
    if (typeof row !== "object" || row === null || typeof row.id !== "string") { failures.push(`invalid semantic ledger row ${index + 1}: missing id`); continue; }
    if (rows.has(row.id)) { failures.push(`duplicate semantic ledger row ${row.id}`); continue; }
    rows.set(row.id, row);
  }
  for (const id of rows.keys()) if (!contractRows.has(id)) failures.push(`unknown semantic ledger scenario ${id}`);
  const seenMarkers = new Set();
  let witnessCount = 0;
  // Accumulated across EVERY row, not per row. Built inside the row loop, the rule only ever fired
  // when two obligations of the SAME scenario shared an assertion, so one assertion could discharge
  // unlimited obligations as long as they were spread across different scenarios -- and 133 of 322
  // live obligations across 67 of 180 rows did exactly that. The worst case was
  // `assert.equal(readFileSync(corruptMetadata, "utf8"), "x{")` -- a two-character byte comparison
  // on a setup file -- silently discharging 9 obligations across 6 scenarios.
  const ownersByAssertion = new Map();
  const witnessBodies = new Map();
  for (const id of [...contractRows.keys()].sort()) {
    const row = rows.get(id);
    if (!row) { failures.push(`missing semantic ledger row ${id}`); continue; }
    if (row.disposition !== "preserved" && row.disposition !== "superseded") failures.push(`invalid disposition for ${id}: expected preserved or superseded`);
    if (row.contractExpected !== contractRows.get(id).expectedResult) failures.push(`contract expected-result drift for ${id}`);
    // `row.evidenceSummary` is deliberately NOT checked. Measured across this ledger it is prose
    // restatement of `contractExpected`, so no string check can distinguish evidence from
    // boilerplate. It is retained in the JSON as non-normative human commentary (and, per P2b, as
    // the supersession pointer) — it is not a gate input.
    const obligationMarkers = new Map();
    const obligationIds = new Set();
    const obligationClauses = new Set();
    if (!Array.isArray(row.proofObligations) || row.proofObligations.length === 0) {
      failures.push(`semantic ledger row ${id} has no proof obligations`);
    } else {
      for (const [index, obligation] of row.proofObligations.entries()) {
        const label = `${id} proof obligation ${index + 1}`;
        if (typeof obligation !== "object" || obligation === null || typeof obligation.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(obligation.id)) {
          failures.push(`${label} has no stable kebab-case id`);
          continue;
        }
        if (obligationIds.has(obligation.id)) failures.push(`${label} duplicates obligation id ${obligation.id}`);
        obligationIds.add(obligation.id);
        if (typeof obligation.expectedClause !== "string" || !row.contractExpected.includes(obligation.expectedClause)) failures.push(`${label} expected clause is not literal contract text`);
        else if (obligationClauses.has(obligation.expectedClause)) failures.push(`${label} duplicates an expected clause instead of proving a distinct material clause`);
        else obligationClauses.add(obligation.expectedClause);
        // `obligation.actualOutcome` is deliberately NOT checked. 286 of 293 obligations in this
        // ledger are a boilerplate prefix plus `expectedClause` verbatim, including all 221
        // preserved ones, so a length or overlap threshold rejects the ledger rather than the
        // vacuous rows. The binding evidence is the marker→assertion chain below.
        if (!Array.isArray(obligation.assertionMarkers) || obligation.assertionMarkers.length === 0) {
          failures.push(`${label} has no assertion markers`);
          continue;
        }
        for (const marker of obligation.assertionMarkers) {
          if (typeof marker !== "string" || !marker.startsWith(`ASSERT:${id}:`)) {
            failures.push(`${label} has an invalid row-specific marker reference`);
            continue;
          }
          const owners = obligationMarkers.get(marker) ?? new Set();
          owners.add(obligation.id);
          obligationMarkers.set(marker, owners);
        }
      }
      // Every disposition decomposes identically. Exempting `superseded` exempted precisely the
      // rows whose behaviour changed — the rows most in need of clause-by-clause proof.
      const requiredClauses = materialClauses(row.contractExpected);
      if (row.proofObligations.length < requiredClauses.length) failures.push(`semantic ledger row ${id} multi-clause outcome has ${row.proofObligations.length} proof obligation${row.proofObligations.length === 1 ? "" : "s"}; expected at least ${requiredClauses.length}`);
      for (const clause of requiredClauses) if (!obligationClauses.has(clause)) failures.push(`semantic ledger row ${id} has no proof obligation for exact material clause: ${JSON.stringify(clause)}`);
    }
    if (!Array.isArray(row.witnesses) || row.witnesses.length === 0) { failures.push(`semantic ledger row ${id} has no witnesses`); continue; }
    const witnessedMarkers = new Set();
    const witnessAssertions = new Map();
    for (const [index, witness] of row.witnesses.entries()) {
      witnessCount++;
      const label = `${id} witness ${index + 1}`;
      if (typeof witness !== "object" || witness === null || typeof witness.file !== "string" || typeof witness.title !== "string" || !Array.isArray(witness.assertionMarkers) || witness.assertionMarkers.length === 0) {
        failures.push(`${label} is missing file, title, or assertion markers`); continue;
      }
      const candidate = resolve(testsPath, witness.file);
      const escaped = relative(testsPath, candidate);
      if (isAbsolute(witness.file) || escaped === ".." || escaped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) { failures.push(`${label} escapes the test root: ${witness.file}`); continue; }
      if (!existsSync(candidate) || !statSync(candidate).isFile()) { failures.push(`${label} witness file does not exist: ${witness.file}`); continue; }
      const relativeFile = relative(testsPath, candidate);
      const declarations = declarationsByFile.get(relativeFile) ?? [];
      const exact = declarations.filter((entry) => entry.title === witness.title);
      // A skipped witness proves nothing: `node --test` counts a skip as a pass, so both gates and
      // `npm test` stayed green while 123 witnesses were disabled.
      if (exact.some((entry) => entry.skipped)) { failures.push(`${label} witness test is skipped, so it proves nothing: ${JSON.stringify(witness.title)}`); continue; }
      if (exact.length !== 1) { failures.push(`${label} exact test title not found uniquely in ${witness.file}: ${JSON.stringify(witness.title)}`); continue; }
      const body = exact[0].body;
      const titleMentionsId = new RegExp(`(^|[^A-Za-z0-9-])${id.replace("-", "\\-")}([^A-Za-z0-9-]|$)`).test(witness.title);
      if (!titleMentionsId) failures.push(`${label} exact title does not cite ${id}`);
      for (const marker of witness.assertionMarkers) {
        if (typeof marker !== "object" || marker === null || typeof marker.marker !== "string" || typeof marker.assertion !== "string") {
          failures.push(`${label} has an invalid assertion marker`);
          continue;
        }
        if (!marker.marker.startsWith(`ASSERT:${id}:`) || marker.marker.length < id.length + 16) failures.push(`${label} marker is not row-specific: ${JSON.stringify(marker.marker)}`);
        if (seenMarkers.has(marker.marker)) failures.push(`duplicate semantic assertion marker ${marker.marker}`);
        seenMarkers.add(marker.marker);
        witnessedMarkers.add(marker.marker);
        witnessAssertions.set(marker.marker, marker.assertion);
        witnessBodies.set(marker.assertion, body);
        const markerAt = body.indexOf(marker.marker);
        const canonicalBody = body.replace(/\s+/g, " ");
        const assertionAt = canonicalBody.indexOf(marker.assertion);
        if (markerAt < 0) failures.push(`${label} assertion marker not found in witness body: ${JSON.stringify(marker.marker)}`);
        if (assertionAt < 0) failures.push(`${label} exact evidence assertion not found in witness body: ${JSON.stringify(marker.assertion)}`);
        if (!/^(?:assert(?:\.[A-Za-z]+|[A-Z][A-Za-z]*)|assertEnvelope|goldenJourney|crashCreation)\s*\(/.test(marker.assertion)) failures.push(`${label} evidence is not an assertion or named fixture call`);
        if (/grove\s*\(\s*\[\s*["']init["'][^\]]*\]\s*\)\.status\s*,\s*0/.test(marker.assertion)) failures.push(`${label} uses a generic successful-init setup assertion`);
        if (markerAt >= 0 && assertionAt >= 0) {
          const assertionHead = /^(?:assert(?:\.[A-Za-z]+|[A-Z][A-Za-z]*)|assertEnvelope|goldenJourney|crashCreation)\s*\(/.exec(marker.assertion)?.[0] ?? "";
          const lineStart = body.lastIndexOf("\n", markerAt) + 1;
          const markerLineEnd = body.indexOf("\n", markerAt);
          const markerLine = body.slice(lineStart, markerLineEnd < 0 ? body.length : markerLineEnd);
          const sameLineTail = markerLine.slice(markerLine.indexOf(marker.marker) + marker.marker.length)
            .replace(/^\s*\*\/\s*/, "")
            .trimStart();
          let adjacent = sameLineTail.startsWith(assertionHead);
          if (!adjacent && markerLineEnd >= 0) {
            for (const line of body.slice(markerLineEnd + 1).split("\n")) {
              if (/^\s*\/\/\s*ASSERT:/.test(line)) continue;
              adjacent = line.trimStart().replace(/^return\s+/, "").startsWith(assertionHead);
              break;
            }
          }
          if (!adjacent) failures.push(`${label} marker is not adjacent to its evidence assertion`);
        }
      }
      if (id === "TRUNK-01") {
        if (!/ASSERT:TRUNK-01:[A-Z0-9-]*READABLE[A-Z0-9-]*/.test(body)) failures.push("TRUNK-01 readable-path marker is absent from its exact witness body");
        const readableEquality = /(?:^assert\.(?:equal|deepEqual|strictEqual)\s*\(\s*[^,]+,\s*(?:join\s*\([\s\S]*?["'`]trunks["'`]\s*,\s*["'`]main@[A-Za-z0-9._~-]+["'`]\s*\)|["'`][^"'`\n]*trunks\/main@[A-Za-z0-9._~-]+["'`])\s*[,)]|^assert\.deepEqual\s*\([\s\S]*?join\s*\([\s\S]*?["'`]trunks["'`]\s*,\s*["'`]main@[A-Za-z0-9._~-]+["'`]\s*\))/m;
        const hasExecutableEquality = executableTokenOffsets(body, "assert.")
          .some((offset) => readableEquality.test(body.slice(offset)));
        if (!hasExecutableEquality) failures.push("TRUNK-01 readable path equality assertion is absent or weakened");
      }
    }
    for (const marker of obligationMarkers.keys()) if (!witnessedMarkers.has(marker)) failures.push(`semantic ledger row ${id} proof obligation references missing witness marker ${marker}`);
    for (const marker of witnessedMarkers) if (!obligationMarkers.has(marker)) failures.push(`semantic ledger row ${id} witness marker is not assigned to a proof obligation: ${marker}`);
    // Keyed on the ASSERTION TEXT, not the marker name. Keyed on the name, the rule fired only when
    // two obligations shared one marker — so giving each obligation its own synonym marker over the
    // SAME assertion evaded it completely, and P2b's authoring script did exactly that on all 63
    // rows it touched. Proven both directions: the honest shared-marker form failed the gate while
    // the synonym form passed, and substituting `assert.equal(1, 1)` for eight scenarios' real
    // evidence still passed. A rule its own author can trivially evade is not a gate.
    for (const [marker, owners] of obligationMarkers) {
      const assertion = witnessAssertions.get(marker);
      if (assertion === undefined) continue;
      const seen = ownersByAssertion.get(assertion) ?? { preserved: new Set(), superseded: new Set(), rows: new Set() };
      seen.rows.add(id);
      // A PRESERVED clause must be observed one-for-one. A SUPERSEDED clause describes a v1
      // mechanism schema 3 deliberately deleted, so it cannot be observed at all -- all of them
      // together demand one real observation, no more.
      if (row.disposition === "preserved") for (const owner of owners) seen.preserved.add(`${id}/${owner}`);
      else seen.superseded.add(id);
      ownersByAssertion.set(assertion, seen);
    }
  }

  for (const [assertion, seen] of ownersByAssertion) {
    {
      const required = seen.preserved.size + (seen.superseded.size > 0 ? 1 : 0);
      const where = [...seen.rows].sort().join(", ");
      if (required < 2) continue;
      // Keying on the assertion TEXT only moved which string an author must vary in order to
      // evade the rule. Two demonstrated bypasses: a vacuous `assert.deepEqual({ vacuous: true },
      // { vacuous: true })`, and three textually-distinct restatements of one observation. Both
      // printed PASSED. So relate obligations to the OBSERVED VALUES the assertion actually reads:
      // a consolidated assertion may back at most as many obligations as it has distinct,
      // non-literal observed fields.
      // The observation count binds PRESERVED clauses. A SUPERSEDED clause describes a v1
      // mechanism schema 3 deliberately deleted — "A §6.1 journal remains", "rolls back the
      // recorded steps" — and no assertion can observe a mechanism that does not exist. Demanding
      // one observation per superseded clause is a category error, and satisfying it would mean
      // inventing fields: the exact bookkeeping-as-evidence this rule exists to stop.
      //
      // Superseded rows still may not rest on nothing: the cited assertion must observe at least
      // one real value (so a vacuous consolidation is still caught) and must be a consolidated form
      // when it backs more than one obligation.
      //
      // Residual, stated rather than hidden: for a superseded row this does NOT prove each clause
      // was correctly judged superseded. That judgement is prose, and prose is a second-reader
      // obligation — which is why release gate 3 exists and why it has caught real defects twice.
      const observed = observedFields(assertion, witnessBodies.get(assertion) ?? null);
      if (observed !== null && observed.length >= required) continue;
      if (observed === null) {
        failures.push(`semantic ledger rows ${where} rest ${required} proof obligations on an assertion whose observed values cannot be read: ${JSON.stringify(assertion.slice(0, 70))}`);
      } else {
        failures.push(`semantic ledger rows ${where} rest ${required} proof obligations on an assertion observing only ${observed.length} distinct program value(s): ${JSON.stringify(assertion.slice(0, 70))}`);
      }
      // Only a consolidated assertion — one whose observed values jointly carry a fact per clause —
      // may back more than one obligation. A bare `assert.equal` observes one thing.
      if (!/^(?:assert\.(?:deepEqual|throws)|assertEnvelope|goldenJourney|crashCreation)\s*\(/.test(assertion)) failures.push(`semantic ledger rows ${where} rest ${required} proof obligations on one non-consolidated assertion: ${JSON.stringify(assertion.slice(0, 70))}`);
    }
  }
  return { rows: rows.size, witnesses: witnessCount };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const contractPath = resolve(options.contract);
  const testsPath = resolve(options.tests);
  const failures = [];
  const rows = [];
  const contractLines = readFileSync(contractPath, "utf8").split("\n");
  // Only a table whose header's first cell is `ID` is a scenario table. Any other table in the
  // contract (an explanatory matrix, a retirement list) is prose, not a set of live scenarios. A
  // prose table must not lead with a scenario-shaped ID, though: that is almost certainly a scenario
  // table with a misspelled header, and skipping it would drop its rows without a witness.
  const scenarioShaped = /^[A-Z][A-Z0-9]*-[0-9]{2}$/;
  const skippedScenario = (id, index) => failures.push(`scenario-shaped ID ${id} at line ${index + 1} is in a table not headed \`ID\`; head the table \`ID\` or move the row`);
  let inScenarioTable = false;
  for (let index = 0; index < contractLines.length; index++) {
    const cell = /^\|\s*([^|]+?)\s*\|/.exec(contractLines[index]);
    if (!cell) { inScenarioTable = false; continue; }
    const candidate = cell[1].trim();
    const startsTable = index === 0 || !/^\|/.test(contractLines[index - 1]);
    if (startsTable) {
      inScenarioTable = candidate === "ID";
      if (scenarioShaped.test(candidate)) skippedScenario(candidate, index);
      continue;
    }
    if (!inScenarioTable) { if (scenarioShaped.test(candidate)) skippedScenario(candidate, index); continue; }
    if (/^:?-+:?$/.test(candidate)) continue;
    if (!scenarioShaped.test(candidate)) {
      failures.push(`invalid contract scenario ID ${candidate} at line ${index + 1}: expected FAMILY-NN`);
      continue;
    }
    const cells = contractLines[index].split("|").slice(1, -1).map((value) => value.trim());
    rows.push({ id: candidate, line: index + 1, expectedResult: cells.at(-1) });
  }

  const byId = new Map();
  for (const row of rows) {
    const previous = byId.get(row.id) ?? [];
    previous.push(row.line);
    byId.set(row.id, previous);
  }
  for (const [id, lines] of byId) {
    if (lines.length > 1) failures.push(`duplicate contract scenario ${id} at lines ${lines.join(", ")}`);
  }
  const known = new Set(byId.keys());
  const contractRows = new Map(rows.map((row) => [row.id, row]));
  const witnesses = new Map([...known].map((id) => [id, []]));
  const titleToken = /(^|[^A-Za-z0-9-])([A-Z][A-Z0-9]*-[0-9]{2})(?=[^A-Za-z0-9-]|$)/g;
  const declarationsByFile = new Map();
  for (const file of testFiles(testsPath)) {
    const relative = file.slice(testsPath.length + 1);
    const declarations = testDeclarations(readFileSync(file, "utf8"));
    declarationsByFile.set(relative, declarations);
    for (const { title, skipped } of declarations) {
      // A skipped test does not cite a scenario; otherwise `{ skip: true }` silently discharges the
      // citation requirement for every id in its title while the gate reports PASSED.
      if (skipped) continue;
      for (const match of title.matchAll(titleToken)) {
        const token = match[2];
        const ignored = options.ignorePrefixes.some((prefix) => token.startsWith(prefix));
        if (!known.has(token) && !ignored) failures.push(`unknown test-title scenario ${token} in ${relative}: ${JSON.stringify(title)}`);
      }
      for (const id of known) {
        const boundary = new RegExp(`(^|[^A-Za-z0-9-])${id.replace("-", "\\-")}([^A-Za-z0-9-]|$)`);
        if (boundary.test(title)) witnesses.get(id).push({ file: relative, title });
      }
    }
  }

  const deferrals = new Map();
  if (options.deferrals && existsSync(options.deferrals)) {
    const lines = readFileSync(options.deferrals, "utf8").split("\n");
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index].trim();
      if (!raw || raw.startsWith("#")) continue;
      const [id = "", owner = "", ...reasonParts] = raw.split("|").map((part) => part.trim());
      const reason = reasonParts.join("|").trim();
      if (!id || !owner || !reason) {
        failures.push(`invalid deferral at line ${index + 1}: expected ID|owner|reason with no empty field`);
        continue;
      }
      if (deferrals.has(id)) failures.push(`duplicate deferral ${id} at line ${index + 1}`);
      else deferrals.set(id, { owner, reason, line: index + 1 });
    }
  }
  for (const [id, deferral] of deferrals) {
    if (!known.has(id)) failures.push(`unknown deferred scenario ${id} at line ${deferral.line}`);
    else if (witnesses.get(id).length > 0) failures.push(`stale deferral ${id}: already cited by a test title`);
    if (!options.allowDeferrals) failures.push(`deferral ${id} is not permitted in the final gate (owner ${deferral.owner})`);
  }

  for (const id of [...known].sort()) {
    if (witnesses.get(id).length === 0 && !deferrals.has(id)) failures.push(`uncited scenario ${id}`);
  }

  const ledger = options.ledger ? validateLedger(resolve(options.ledger), contractRows, testsPath, declarationsByFile, failures) : null;

  if (failures.length > 0) {
    for (const failure of [...new Set(failures)]) process.stderr.write(`FAIL: ${failure}\n`);
    process.stderr.write(`scenario traceability: FAILED (${failures.length} finding${failures.length === 1 ? "" : "s"})\n`);
    return 1;
  }

  const families = new Map();
  for (const id of known) {
    const family = id.replace(/-[0-9]+$/, "");
    const state = families.get(family) ?? { total: 0, witnessed: 0, deferred: 0 };
    state.total++;
    if (witnesses.get(id).length > 0) state.witnessed++;
    if (deferrals.has(id)) state.deferred++;
    families.set(family, state);
  }
  for (const [family, state] of [...families].sort()) {
    const pending = state.deferred > 0 ? ` (${state.deferred} deferred)` : "";
    process.stdout.write(`  ${family}: ${state.witnessed}/${state.total}${pending}\n`);
  }
  for (const [id, value] of [...deferrals].sort()) process.stdout.write(`  deferred ${id} — ${value.owner}: ${value.reason}\n`);
  process.stdout.write(`scenario traceability: PASSED (${known.size} scenarios, ${families.size} families, ${deferrals.size} deferred)\n`);
  if (ledger) process.stdout.write(`semantic ledger: PASSED (${ledger.rows} rows, ${ledger.witnesses} witnesses)\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
