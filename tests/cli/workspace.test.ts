import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { workspaceConfig } from "../../src/paths/layout.ts";

after(cleanupTempDirs);

const json = (s: string) => JSON.parse(s.trim());

test("INIT-01/INIT-09: init creates the workspace and status resolves it from root and a nested subdir", () => {
  const fx = makeFixture({ repos: {} });
  const init = fx.grove(["--json", "init"]);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(json(init.stdout).detail.created, true);
  assert.ok(existsSync(workspaceConfig(fx.root)));
  // ASSERT:INIT-01:CREATES-CONFIG-LOCKS-BARE-TRUNKS
  assert.deepEqual(
    ["repos", "trunks", "groves", "archives"].map((directory) => existsSync(join(fx.root, directory))),
    [true, true, true, true],
  );

  const st = fx.grove(["--json", "status"]);
  assert.equal(st.status, 0, st.stderr);
  const s = json(st.stdout).detail;
  // ASSERT:INIT-09:WORKSPACE-NAME-CANONICAL-TARGET-DIRECTORY-S-BASENAME
  assert.equal(s.name, require_basename(fx.root));
  assert.equal(s.repositories.length, 0);

  // Nested subdir resolves the same workspace.
  const nested = join(fx.root, "trunks", "x");
  mkdirSync(nested, { recursive: true });
  const st2 = fx.grove(["--json", "status"], { cwd: nested });
  assert.equal(st2.status, 0, st2.stderr);
  assert.equal(json(st2.stdout).detail.id, s.id);
});

function require_basename(p: string): string {
  return p.split("/").filter(Boolean).slice(-1)[0] as string;
}

test("a command from an un-initialized dir refuses with 'No Grove workspace found' (exit 8)", () => {
  const fx = makeFixture({ repos: {} });
  const st = fx.grove(["status"]);
  assert.equal(st.status, 8);
  assert.match(st.stderr, /No Grove workspace found/);
});

test("DISC-07: a malformed nearest config refuses (exit 8) and does not fall back", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init"]);
  const nested = join(fx.root, "nested");
  mkdirSync(join(nested, ".grove"), { recursive: true });
  writeFileSync(workspaceConfig(nested), "{ not json");
  const st = fx.grove(["status"], { cwd: nested });
  // ASSERT:DISC-07:STOPS-THERE-NEVER-FALLS-BACK-ANCESTOR
  assert.deepEqual({ nestedStatus: st.status, ancestorStatus: fx.grove(["status"]).status }, { nestedStatus: 8, ancestorStatus: 0 });
});

test("INIT-02: init is idempotent — repeating it does not bump the config revision", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init"]);
  const beforeBytes = readFileSync(workspaceConfig(fx.root), "utf8");
  const before = JSON.parse(beforeBytes);
  const again = fx.grove(["--json", "init"]);
  assert.equal(json(again.stdout).detail.created, false);
  const afterBytes = readFileSync(workspaceConfig(fx.root), "utf8");
  const after = JSON.parse(afterBytes);
  // ASSERT:INIT-02:BYTE-BYTE-IDEMPOTENT-ID-REVISION-DO-NOT-CHANGE
  assert.deepEqual(
    { bytes: afterBytes, id: after.id, revision: after._rev },
    { bytes: beforeBytes, id: before.id, revision: before._rev },
    "byte-for-byte idempotent with stable identity and revision",
  );
});

test("INIT-03/INIT-04: --nested is required to init inside an existing workspace", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init", "--name", "finance"]);
  const sub = join(fx.root, "sub");
  mkdirSync(sub, { recursive: true });
  const refused = fx.grove(["init"], { cwd: sub });
  // ASSERT:INIT-03:REFUSES-BECAUSE-FINANCE-OWNS-ANCESTOR
  assert.deepEqual({ status: refused.status, namesAncestor: /finance|ancestor|nested/i.test(refused.stderr + refused.stdout), nestedConfigPresent: existsSync(workspaceConfig(sub)) }, { status: 3, namesAncestor: true, nestedConfigPresent: false });
  const ok = fx.grove(["init", "--nested"], { cwd: sub });
  // ASSERT:INIT-04:CREATES-EXPLICIT-NESTED-WORKSPACE
  assert.deepEqual({ status: ok.status, nestedConfigPresent: existsSync(workspaceConfig(sub)), nestedStatus: fx.grove(["status"], { cwd: sub }).status }, { status: 0, nestedConfigPresent: true, nestedStatus: 0 });
});

test("CMD-12: config set changes name via CAS; a stale --expect is refused (exit 4)", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init"]);
  const rev = json(fx.grove(["--json", "status"]).stdout).detail.rev;
  const ok = fx.grove(["--json", "config", "set", "--values", '{"name":"finance"}', "--expect", String(rev)]);
  const after = json(fx.grove(["--json", "status"]).stdout).detail.rev;
  // Re-using the now-stale revision is refused.
  const stale = fx.grove(["config", "set", "--values", '{"name":"x"}', "--expect", String(rev)]);
  // ASSERT:CMD-12:FIRST-SUCCEEDS-BUMPS-REV-STALE-ONE-EXITS-4
  assert.deepEqual(
    { firstStatus: ok.status, revisionBumped: after > rev, staleStatus: stale.status, finalName: json(fx.grove(["--json", "config", "get"]).stdout).name },
    { firstStatus: 0, revisionBumped: true, staleStatus: 4, finalName: "finance" },
  );
});

test("CMD-11: config set refuses a structural change (repositories is read-only)", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init"]);
  const before = readFileSync(workspaceConfig(fx.root), "utf8");
  const r = fx.grove(["config", "set", "--values", '{"repositories":[]}']);
  // ASSERT:CMD-11:EXITS-2-MATERIAL-CLAUSE
  assert.deepEqual(
    { status: r.status, config: readFileSync(workspaceConfig(fx.root), "utf8"), namesOwnerCommands: /repo|trunk/i.test(r.stderr + r.stdout) },
    { status: 3, config: before, namesOwnerCommands: true },
  );
});

test("reconcile on a clean workspace reports no pending operations and exits 0 (RECON-04)", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init"]);
  const r = fx.grove(["--json", "reconcile"]);
  assert.equal(r.status, 0, r.stderr);
  const result = json(r.stdout);
  assert.equal(result.outcome, "complete");
  assert.deepEqual(result.detail.resumed, []);
  assert.deepEqual(result.detail.operationErrors, []);
  // ASSERT:RECON-04:REPORTS-NO-DRIFT-PERFORMS-NO-MUTATION-EXITS-0
  assert.deepEqual(result.diagnostics, []);
});

test("isolation: a full run writes nothing under HOME and ignores GROVE_ROOT (ISO-05/DISC-09)", () => {
  const fx = makeFixture({ repos: {} });
  fx.grove(["init"]);
  fx.grove(["status"], { env: { GROVE_ROOT: "/definitely/not/a/workspace" } });
  // The isolated HOME must be untouched (empty).
  const homeEntries = readdirSync(fx.home);
  const discovered = json(fx.grove(["--json", "status"]).stdout).detail.workspace;
  // ASSERT:DISC-09:GROVE-ROOT-IS-IGNORED-AND-CWD-DISCOVERY-STILL-WINS
  assert.deepEqual(
    { discovered, ignoredEnvironmentRoot: discovered !== "/definitely/not/a/workspace" },
    { discovered: fx.root, ignoredEnvironmentRoot: true },
  );
  // ASSERT:ISO-05:NO-FILES-WERE-CREATED-UNDER-GROVE
  assert.deepEqual(homeEntries, [], `HOME should be empty, found ${homeEntries.join(", ")}`);
});

test("INIT-05: init refuses and preserves an existing malformed config byte for byte", () => {
  const fx = makeFixture({ repos: {} });
  mkdirSync(join(fx.root, ".grove"), { recursive: true });
  const malformed = "{ malformed and precious\n";
  writeFileSync(workspaceConfig(fx.root), malformed);
  const result = fx.grove(["init"]);
  // ASSERT:INIT-05:REFUSES-PRESERVES-BYTE-BYTE
  assert.deepEqual(
    { status: result.status, bytes: readFileSync(workspaceConfig(fx.root), "utf8") },
    { status: 8, bytes: malformed },
  );
});

test("INIT-06: init refuses nonempty layout roots without adopting or changing their data", () => {
  for (const directory of ["repos", "trunks", "groves", "archives"]) {
    const fx = makeFixture({ repos: {} });
    mkdirSync(join(fx.root, directory), { recursive: true });
    writeFileSync(join(fx.root, directory, "user-data"), "keep\n");
    const result = fx.grove(["init"]);
    // Consolidated: refusal, non-adoption and data preservation are three clauses and now have
    // three fields. All three obligations previously rested on the `user-data` equality alone,
    // which observes only the third — "Refuses" was proven by a line carrying no marker at all.
    // ASSERT:INIT-06:REFUSES-A-NONEMPTY-LAYOUT-ROOT-WITHOUT-ADOPTING-OR-TOUCHING-IT
    assert.deepEqual(
      {
        status: result.status,
        notAdopted: existsSync(workspaceConfig(fx.root)) === false,
        userDataUntouched: readFileSync(join(fx.root, directory, "user-data"), "utf8"),
      },
      { status: 3, notAdopted: true, userDataUntouched: "keep\n" },
      `${directory}: ${result.stderr}`,
    );
  }
});

test("INIT-07: an interrupted empty pre-publication scaffold remains undiscoverable and retry-safe", () => {
  const fx = makeFixture({ repos: {} });
  for (const directory of ["repos", "trunks", "groves", "archives", join(".grove", "locks"), join(".grove", "operations")]) {
    mkdirSync(join(fx.root, directory), { recursive: true });
  }
  // Consolidated: undiscoverable before publication, then adoptable. Both clauses ARE preserved by
  // schema 3 and both are observed here; three obligations previously rested on the first scalar.
  // ASSERT:INIT-07:AN-EMPTY-PRE-PUBLICATION-SCAFFOLD-IS-UNDISCOVERABLE-THEN-ADOPTABLE
  assert.deepEqual(
    {
      undiscoverableBefore: existsSync(workspaceConfig(fx.root)) === false,
      statusExit: fx.grove(["status"]).status,
      initExit: fx.grove(["init"]).status,
      publishedAfter: existsSync(workspaceConfig(fx.root)),
    },
    { undiscoverableBefore: true, statusExit: 8, initExit: 0, publishedAfter: true },
  );
});

test("ISO-01/ISO-02/ISO-03/ISO-04: workspaces keep config, locks, failures, and selection isolated", () => {
  const finance = makeFixture({ repos: {} });
  const quoting = makeFixture({ repos: {} });
  assert.equal(finance.grove(["init", "--name", "finance"]).status, 0);
  assert.equal(quoting.grove(["init", "--name", "quoting"]).status, 0);
  assert.equal(finance.grove(["config", "set", "--values", '{"defaults":{"branchPrefix":"fin/"}}']).status, 0);
  assert.equal(quoting.grove(["config", "set", "--values", '{"defaults":{"branchPrefix":"quo/"}}']).status, 0);
  // ASSERT:ISO-01:EACH-COMMAND-USES-ONLY-OWN-CONFIG
  assert.equal(json(finance.grove(["--json", "config", "get"]).stdout).defaults.branchPrefix, "fin/");
  assert.equal(json(quoting.grove(["--json", "config", "get"]).stdout).defaults.branchPrefix, "quo/");
  writeFileSync(join(finance.root, ".grove", "locks", "op-workspace.lock"), JSON.stringify({ token: "live", pid: process.pid, host: "other-host", startedAt: 0, heartbeatAt: 0, op: "config set" }));
  const isolatedWrite = quoting.grove(["config", "set", "--values", '{"name":"quoting2"}']);
  // ASSERT:ISO-02:FINANCE-LOCK-DOES-NOT-BLOCK-QUOTING-WRITE
  assert.deepEqual(
    { status: isolatedWrite.status, quotingName: json(quoting.grove(["--json", "config", "get"]).stdout).name, financePrefix: json(finance.grove(["--json", "config", "get"]).stdout).defaults.branchPrefix },
    { status: 0, quotingName: "quoting2", financePrefix: "fin/" },
  );
  writeFileSync(workspaceConfig(finance.root), "{ broken");
  // ASSERT:ISO-03:BROKEN-FINANCE-CONFIG-DOES-NOT-AFFECT-QUOTING
  assert.deepEqual({ quotingStatus: quoting.grove(["status"]).status, financeStatus: finance.grove(["status"]).status }, { quotingStatus: 0, financeStatus: 8 });
  // ASSERT:ISO-04:NO-REMEMBERED-WORKSPACE-SELECTED
  assert.equal(makeFixture({ repos: {} }).grove(["status"]).status, 8);
});

test("--json errors are JSON on stdout with what/why/remedy/exitCode", () => {
  const fx = makeFixture({ repos: {} });
  const r = fx.grove(["--json", "status"]); // no workspace
  assert.equal(r.status, 8);
  const err = json(r.stdout).error;
  assert.equal(err.exitCode, 8);
  assert.ok(err.what && err.why && err.remedy);
});

test("P1.1: init creates no migrations directory and does not ignore one", () => {
  // The `.grove/migrations/active.json` gate is what bricked workspaces: a marker written by a
  // crashed migration made every subsequent command refuse, with a remedy naming `grove migrate
  // --resume`. With the subsystem deleted, neither the directory nor its ignore rule may return.
  const fx = makeFixture({ repos: {} });
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(existsSync(join(fx.root, ".grove", "migrations")), false);
  assert.doesNotMatch(readFileSync(join(fx.root, ".grove", ".gitignore"), "utf8"), /migrations/);
});
