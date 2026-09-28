/**
 * Phase 8 (ledger U-1…U-16). Ruling ⑦'s sibling problem: documentation that describes behaviour the
 * program does not have. A flag-parity audit cannot catch any of these — they are prose-versus-
 * behaviour defects with no flag-registration signature — so each documented claim gets executed.
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

test("V3HLP-01: the README golden path runs end to end", () => {
  // Extracted from README.md rather than transcribed, so the test cannot drift from the document
  // it is validating. The path failed at `agent run`: `agent add` never set defaults.agent, so the
  // documented sequence ended in refused-precondition.
  const readme = readFileSync("README.md", "utf8");
  const block = /## Golden path\s*```bash\n([\s\S]*?)```/.exec(readme);
  assert.ok(block, "README.md no longer has a fenced Golden path block");
  const steps = block[1]!.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  assert.ok(steps.length >= 6, `expected a multi-step golden path, got ${steps.length}`);

  const fx = makeFixture();
  const results: { step: string; status: number }[] = [];
  for (const step of steps) {
    // Substitute the README's illustrative remote and agent for ones this fixture can run; every
    // other token is executed exactly as written.
    const argv = step.split(/\s+/)
      .map((token) => (token === "git@github.com:example/ledger.git" ? fx.repos[0]!.origin : token))
      .map((token) => (token === "codex" ? process.execPath : token));
    if (argv[0] === "grove") {
      results.push({ step, status: fx.grove(argv.slice(1)).status });
      continue;
    }
    // A golden path is a bash block a real user pastes; the native Git steps are part of it.
    let status = 0;
    try { execFileSync(argv[0]!, argv.slice(1), { cwd: fx.root, stdio: "pipe" }); }
    catch { status = 1; }
    results.push({ step, status });
  }

  assert.deepEqual(
    results.filter((r) => r.status !== 0),
    [],
    `README golden path steps that do not exit 0:\n  ${results.filter((r) => r.status !== 0).map((r) => `${r.step} -> ${r.status}`).join("\n  ")}`,
  );
});

test("V3HLP-02: repo fetch on a remote-less repository behaves as its help states", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["repo", "configure", "alpha", "--no-remote"]).status, 0);

  const help = fx.grove(["repo", "fetch", "--help"]).stdout;
  const named = fx.grove(["--json", "repo", "fetch", "alpha"]);
  const all = fx.grove(["--json", "repo", "fetch"]);

  // The help makes two distinct promises: bare `repo fetch` SKIPS remote-less repositories, and
  // NAMING one is an error. Both are executed here rather than read.
  assert.deepEqual(
    {
      helpPromisesSkip: /skips remote-less/.test(help),
      helpPromisesError: /naming a\s+remote-less repo is an error/.test(help),
      namedIsError: named.status !== 0,
      namedReason: json(named.stdout).targets?.[0]?.reason,
      bareSkipsCleanly: all.status,
    },
    { helpPromisesSkip: true, helpPromisesError: true, namedIsError: true, namedReason: "no-remote", bareSkipsCleanly: 0 },
  );
});

test("V3HLP-03: tree reorder omission semantics match help", () => {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repo of fx.repos) assert.equal(fx.grove(["repo", "add", repo.origin, "--name", repo.name]).status, 0);
  assert.equal(fx.grove(["new", "work", "--all"]).status, 0);

  const help = fx.grove(["tree", "reorder", "--help"]).stdout;
  // Name only ONE of two Trees. The help used to say "list every Tree exactly once", which implies
  // this is an error; the implementation appends the omitted Tree instead.
  const partial = fx.grove(["--json", "tree", "reorder", "work", "--tree", "work@beta"]);
  const order = json(partial.stdout).detail.order.map((selector: any) => selector.tree);
  const observedOrder = json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees.map((tree: any) => tree.tree);

  assert.deepEqual(
    {
      status: partial.status,
      order,
      observedOrder,
      helpDescribesOmission: /omit/i.test(help),
      helpNoLongerDemandsEveryTree: !/List every Tree exactly once/.test(help),
    },
    { status: 0, order: ["work@beta", "work@alpha"], observedOrder: ["work@beta", "work@alpha"], helpDescribesOmission: true, helpNoLongerDemandsEveryTree: true },
  );
});
