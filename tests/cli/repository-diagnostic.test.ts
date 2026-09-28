import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";
import { locksDir } from "../../src/paths/layout.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("REPO-30: healthy managed status reports canonical bare identity and observed peer trunk", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const result = fx.grove(["--json", "repo", "status", "alpha"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const repository = json(result.stdout).detail.repositories[0];
  // ASSERT:REPO-30:A-HEALTHY-REPOSITORY-RETURNS-AN-EMPTY-PROBLEM-LIST
  assert.deepEqual(
    {
      exit: result.status,
      problem: repository.problem,
      diagnosticsForRepo: json(result.stdout).diagnostics.length,
      commonGitDir: repository.commonGitDir,
      managedStores: repository.worktrees.filter((worktree: any) => worktree.role === "managed-store").length,
      trunks: repository.worktrees.filter((worktree: any) => worktree.role === "trunk").length,
    },
    { exit: 0, problem: null, diagnosticsForRepo: 0, commonGitDir: join(fx.root, "repos", "alpha"), managedStores: 1, trunks: 1 },
    `${result.stderr}\n${result.stdout}`,
  );
});

test("REPO-30: linked status reports external checkout identity without manufacturing a trunk role", () => {
  const fx = makeFixture();
  const checkout = join(tempDir("repo-status-linked"), "checkout");
  git(join(checkout, ".."), ["clone", "-q", fx.repos[0]!.origin, checkout]);
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "link", checkout, "--name", "linked"]).status, 0);
  const repository = json(fx.grove(["--json", "repo", "status", "linked"]).stdout).detail.repositories[0];
  assert.equal(repository.commonGitDir, git(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  assert.equal(repository.worktrees.some((worktree: any) => worktree.role === "trunk"), false);
  // ASSERT:REPO-30:REPO-STATUS-JSON-EXITS-0-SETS-HEALTHY-FALSE:W2
  assert.equal(repository.worktrees.some((worktree: any) => worktree.role === "external"), true);
});

test("REPO-30: a missing managed anchor is typed as an observed repository problem", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  renameSync(join(fx.root, "repos", "alpha"), join(fx.root, "repos", "alpha-missing"));
  const result = fx.grove(["--json", "repo", "status", "alpha"]);
  // §8.4: the command stays diagnostic. An unhealthy repository is reported at exit 0 carrying the
  // typed problem — it is not a command failure — so exit code, problem text and typed diagnostic
  // are observed together rather than the exit code being taken on trust.
  // ASSERT:REPO-30:REPO-STATUS-JSON-EXITS-0-SETS-HEALTHY-FALSE-AND-RETURNS-THE-TYPED-PROBLEM
  assert.deepEqual(
    {
      exit: result.status,
      problemIsTyped: /Cannot inspect repository|not a git repository/i.test(json(result.stdout).detail.repositories[0].problem),
      diagnosticCodes: json(result.stdout)
        .diagnostics.map((diagnostic: any) => diagnostic.code)
        .filter((code: string) => code === "missing-repository"),
    },
    { exit: 0, problemIsTyped: true, diagnosticCodes: ["missing-repository"] },
    `${result.stderr}\n${result.stdout}`,
  );
});

test("FR-027/FR-029: doctor identifies a same-host dead lock as automatically reclaimable by the next mutation", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const lockPath = join(locksDir(fx.root), "op-workspace.lock");
  writeFileSync(lockPath, JSON.stringify({
    token: "dead-holder",
    pid: 2_147_483_600,
    host: hostname(),
    startedAt: 0,
    heartbeatAt: Date.now(),
    op: "interrupted mutation",
  }));

  const doctor = fx.grove(["--json", "doctor", "--strict"]);
  const diagnostic = json(doctor.stdout).diagnostics.find((entry: any) => entry.code === "stale-lock");
  const mutation = fx.grove(["new", "after-stale-lock", "--repo", "alpha"]);

  assert.deepEqual(
    {
      doctorStatus: doctor.status,
      severity: diagnostic?.severity,
      recovery: diagnostic?.facts?.recovery,
      summaryIsAutomatic: /reclaim.*automat|automat.*reclaim/i.test(String(diagnostic?.summary)),
      remedyRetriesMutation: /retry.*mutation|mutation.*retry/i.test(String(diagnostic?.remedy)),
      remedyDemandsManualRemoval: /remove the lock file/i.test(String(diagnostic?.remedy)),
      diagnosticCount: json(doctor.stdout).diagnostics.length,
      detailTotal: json(doctor.stdout).detail.counts.total,
      detailInfo: json(doctor.stdout).detail.counts.info,
      mutationStatus: mutation.status,
      staleLockSurvives: existsSync(lockPath),
    },
    {
      doctorStatus: 0,
      severity: "info",
      recovery: "automatic",
      summaryIsAutomatic: true,
      remedyRetriesMutation: true,
      remedyDemandsManualRemoval: false,
      diagnosticCount: 1,
      detailTotal: 1,
      detailInfo: 1,
      mutationStatus: 0,
      staleLockSurvives: false,
    },
    `${doctor.stderr}\n${doctor.stdout}\n${mutation.stderr}`,
  );
});

test("V3DIAG-04: doctor reports an aged orphaned steal marker but not a fresh in-progress steal", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const lockPath = join(locksDir(fx.root), "op-workspace.lock");
  const markerPath = `${lockPath}.steal`;
  const deadHolder = JSON.stringify({
    token: "dead-holder",
    pid: 2_147_483_600,
    host: hostname(),
    startedAt: 0,
    heartbeatAt: Date.now(),
    op: "interrupted mutation",
  });
  writeFileSync(lockPath, deadHolder);
  writeFileSync(markerPath, "orphaned-stealer");
  const old = (Date.now() - 60_000) / 1_000;
  utimesSync(markerPath, old, old);
  const before = {
    lock: readFileSync(lockPath, "utf8"),
    marker: readFileSync(markerPath, "utf8"),
    lockMtime: statSync(lockPath).mtimeMs,
    markerMtime: statSync(markerPath).mtimeMs,
  };

  const first = fx.grove(["--json", "doctor", "--strict"]);
  const second = fx.grove(["--json", "doctor", "--strict"]);
  const firstDiagnostic = json(first.stdout).diagnostics.find((entry: any) => entry.code === "orphaned-steal-marker");
  const secondDiagnostic = json(second.stdout).diagnostics.find((entry: any) => entry.code === "orphaned-steal-marker");
  const after = {
    lock: readFileSync(lockPath, "utf8"),
    marker: readFileSync(markerPath, "utf8"),
    lockMtime: statSync(lockPath).mtimeMs,
    markerMtime: statSync(markerPath).mtimeMs,
  };

  assert.deepEqual(
    {
      statuses: [first.status, second.status],
      code: firstDiagnostic?.code,
      severity: firstDiagnostic?.severity,
      subject: firstDiagnostic?.subject,
      facts: firstDiagnostic?.facts,
      stableId: firstDiagnostic?.id === secondDiagnostic?.id,
      summaryIsAutomatic: /automat.*reclaim|reclaim.*automat/i.test(String(firstDiagnostic?.summary)),
      remedyRetriesMutation: /retry.*mutation|mutation.*retry/i.test(String(firstDiagnostic?.remedy)),
      remedyDemandsManualRemoval: /(?:manually|by hand).*marker|marker.*(?:manually|by hand)/i.test(String(firstDiagnostic?.remedy)),
      auditIsReadOnly: after,
    },
    {
      statuses: [0, 0],
      code: "orphaned-steal-marker",
      severity: "info",
      subject: { kind: "lock-steal-marker", path: "op-workspace.lock.steal" },
      facts: {
        lock: "op-workspace.lock",
        lockState: "reclaimable",
        reason: "steal marker has not been touched past the stale window",
        recovery: "automatic",
      },
      stableId: true,
      summaryIsAutomatic: true,
      remedyRetriesMutation: true,
      remedyDemandsManualRemoval: false,
      auditIsReadOnly: before,
    },
    `${first.stderr}\n${first.stdout}\n${second.stderr}\n${second.stdout}`,
  );

  const mutation = fx.grove(["new", "after-orphan", "--repo", "alpha"]);
  assert.deepEqual(
    { status: mutation.status, lockSurvives: existsSync(lockPath), markerSurvives: existsSync(markerPath) },
    { status: 0, lockSurvives: false, markerSurvives: false },
    `${mutation.stderr}\n${mutation.stdout}`,
  );

  writeFileSync(lockPath, deadHolder);
  writeFileSync(markerPath, "in-progress-stealer");
  const fresh = fx.grove(["--json", "doctor"]);
  const freshStaleLock = json(fresh.stdout).diagnostics.find((entry: any) => entry.code === "stale-lock");
  const markerSurvivesFreshAudit = existsSync(markerPath);
  unlinkSync(markerPath);
  const unblocked = fx.grove(["--json", "doctor"]);
  const unblockedStaleLock = json(unblocked.stdout).diagnostics.find((entry: any) => entry.code === "stale-lock");
  assert.deepEqual(
    {
      statuses: [fresh.status, unblocked.status],
      markerDiagnostics: json(fresh.stdout).diagnostics.filter((entry: any) => entry.code === "orphaned-steal-marker").length,
      stealMarkerFact: freshStaleLock?.facts?.stealMarker,
      remedyNamesReclaim: /reclaim.*(?:progress|interrupted)|(?:progress|interrupted).*reclaim/i.test(String(freshStaleLock?.remedy)),
      remedyStatesWindow: /30[- ]second stale window/i.test(String(freshStaleLock?.remedy)),
      identityChangesWithoutMarker: freshStaleLock?.id !== unblockedStaleLock?.id,
      lockSurvives: existsSync(lockPath),
      markerSurvivesFreshAudit,
    },
    {
      statuses: [0, 0],
      markerDiagnostics: 0,
      stealMarkerFact: "fresh",
      remedyNamesReclaim: true,
      remedyStatesWindow: true,
      identityChangesWithoutMarker: true,
      lockSurvives: true,
      markerSurvivesFreshAudit: true,
    },
    `${fresh.stderr}\n${fresh.stdout}\n${unblocked.stderr}\n${unblocked.stdout}`,
  );
});

test("V3DIAG-04: an aged marker without a lock disappears after one successful mutation", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const markerPath = join(locksDir(fx.root), "op-workspace.lock.steal");
  writeFileSync(markerPath, "orphaned-stealer");
  const old = (Date.now() - 60_000) / 1_000;
  utimesSync(markerPath, old, old);

  const before = fx.grove(["--json", "doctor"]);
  const mutation = fx.grove(["new", "cleans-orphan", "--repo", "alpha"]);
  const after = fx.grove(["--json", "doctor"]);

  assert.deepEqual({
    beforeStatus: before.status,
    beforeOrphans: json(before.stdout).diagnostics.filter((entry: any) => entry.code === "orphaned-steal-marker").length,
    mutationStatus: mutation.status,
    markerSurvives: existsSync(markerPath),
    afterStatus: after.status,
    afterOrphans: json(after.stdout).diagnostics.filter((entry: any) => entry.code === "orphaned-steal-marker").length,
  }, {
    beforeStatus: 0,
    beforeOrphans: 1,
    mutationStatus: 0,
    markerSurvives: false,
    afterStatus: 0,
    afterOrphans: 0,
  }, `${before.stderr}\n${before.stdout}\n${mutation.stderr}\n${mutation.stdout}\n${after.stderr}\n${after.stdout}`);
});

test("V3DIAG-04: an aged marker beside a healthy holder waits for a successful acquisition", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const lockPath = join(locksDir(fx.root), "op-workspace.lock");
  const markerPath = `${lockPath}.steal`;
  writeFileSync(lockPath, JSON.stringify({
    token: "live-holder",
    pid: process.pid,
    host: hostname(),
    startedAt: Math.floor((Date.now() - process.uptime() * 1_000) / 1_000) * 1_000,
    heartbeatAt: Date.now(),
    op: "live mutation",
  }));
  writeFileSync(markerPath, "orphaned-stealer");
  const old = (Date.now() - 60_000) / 1_000;
  utimesSync(markerPath, old, old);

  const held = fx.grove(["--json", "doctor"]);
  const heldOrphan = json(held.stdout).diagnostics.find((entry: any) => entry.code === "orphaned-steal-marker");
  const markerSurvivesHeldAudit = existsSync(markerPath);
  unlinkSync(lockPath);
  const available = fx.grove(["--json", "doctor"]);
  const availableOrphan = json(available.stdout).diagnostics.find((entry: any) => entry.code === "orphaned-steal-marker");

  assert.deepEqual({
    statuses: [held.status, available.status],
    heldLockState: heldOrphan?.facts?.lockState,
    availableLockState: availableOrphan?.facts?.lockState,
    heldRemedyWaits: /wait.*(?:holder|lock)|(?:holder|lock).*wait/i.test(String(heldOrphan?.remedy)),
    heldRemedyNamesSuccessfulAcquisition: /successful.*acquisition|acquisition.*successful/i.test(String(heldOrphan?.remedy)),
    availableRemedyRetries: /retry.*mutation|mutation.*retry/i.test(String(availableOrphan?.remedy)),
    identityChangesWithLockState: heldOrphan?.id !== availableOrphan?.id,
    markerSurvivesHeldAudit,
    markerSurvivesAvailableAudit: existsSync(markerPath),
  }, {
    statuses: [0, 0],
    heldLockState: "held",
    availableLockState: "absent",
    heldRemedyWaits: true,
    heldRemedyNamesSuccessfulAcquisition: true,
    availableRemedyRetries: true,
    identityChangesWithLockState: true,
    markerSurvivesHeldAudit: true,
    markerSurvivesAvailableAudit: true,
  }, `${held.stderr}\n${held.stdout}\n${available.stderr}\n${available.stdout}`);
});

test("FR-016: doctor diagnoses stale workspace, Grove, and Tree agent preferences without mutating Git", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  assert.equal(fx.grove(["agent", "add", "probe", "/bin/pwd", "--default"]).status, 0);
  assert.equal(fx.grove(["configure", "work", "--default-agent", "probe"]).status, 0);
  assert.equal(fx.grove(["tree", "configure", "work", "work@alpha", "--default-agent", "probe"]).status, 0);
  assert.equal(fx.grove(["agent", "remove", "probe"]).status, 0);

  const anchor = join(fx.root, "repos", "alpha");
  const before = `${git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(anchor, ["worktree", "list", "--porcelain"])}`;
  const doctor = fx.grove(["--json", "doctor", "--strict"]);
  const diagnostics = json(doctor.stdout).diagnostics.filter((entry: any) => entry.code === "stale-agent-preference");
  const after = `${git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(anchor, ["worktree", "list", "--porcelain"])}`;

  assert.deepEqual(
    {
      status: doctor.status,
      severities: diagnostics.map((entry: any) => entry.severity),
      sources: diagnostics.map((entry: any) => entry.facts.source).sort(),
      agents: diagnostics.map((entry: any) => entry.facts.agent),
      gitUnchanged: after === before,
    },
    {
      status: 3,
      severities: ["policy", "policy", "policy"],
      sources: ["grove-default", "tree-default", "workspace-default"],
      agents: ["probe", "probe", "probe"],
      gitUnchanged: true,
    },
  );
});

test("TRUNK-12: native trunk branch changes are observed and diagnosed without config repair", () => {
  const fx = makeFixture({ repos: { alpha: ["develop"] } });
  assert.equal(fx.grove(["init"]).status, 0);
  const add = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  assert.equal(add.status, 0, `${add.stderr}\n${add.stdout}`);
  const trunk = json(add.stdout).targets[0].after.trunkPath;
  git(trunk, ["switch", "-q", "-c", "native-change", "main"]);
  const result = fx.grove(["--json", "doctor", "--repo", "alpha"]);
  // ASSERT:TRUNK-12:EACH-TRUNK-REPORTS-SAME-TYPED-TRUNK-PROBLEM-PRODUCED
  assert.deepEqual(
    { status: result.status, misplaced: json(result.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "misplaced"), observedBranch: git(trunk, ["branch", "--show-current"]) },
    { status: 0, misplaced: true, observedBranch: "native-change" },
  );
});

test("RECON-01/RECON-06: missing and prunable worktrees remain Git-owned diagnostics and are never silently repaired", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const tree = json(fx.grove(["--json", "tree", "ls", "work"]).stdout).detail.trees[0].path.value;
  renameSync(join(fx.root, "groves", "work"), join(fx.root, "groves", "moved-out-of-band"));
  const before = git(join(fx.root, "repos", "alpha"), ["worktree", "list", "--porcelain"]);
  const result = fx.grove(["--json", "reconcile", "--audit-only"]);
  // ASSERT:RECON-01:RECONCILE-REPORTS-THE-MISSING-WORKTREE-AGAINST-THE-MANIFEST
  // ASSERT:RECON-06:THE-SHARED-TYPED-PROBLEM-APPEARS-IN-REPOSITORYPROBLEMS-ITS
  assert.deepEqual(
    { status: result.status, prunable: json(result.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "prunable"), gitState: git(join(fx.root, "repos", "alpha"), ["worktree", "list", "--porcelain"]), originalTreeIdentity: tree.includes("/groves/work/") },
    { status: 0, prunable: true, gitState: before, originalTreeIdentity: true },
  );
  // Schema 3 has no `repositoryProblems`/`drift`/`clean`. Its three diagnostic consumers are the
  // machine `diagnostics` above, the human diagnostic text, and `doctor --strict`'s policy exit.
  //
  // Two diagnostics, not one: renaming the directory out of band leaves BOTH a prunable Git
  // registration (the old path is gone) AND a populated Grove directory at the new path that no
  // record accounts for. Reporting only the first is what let the moved content go unmentioned.
  const doctorHuman = fx.grove(["doctor"]).stdout;
  const reconcileHuman = fx.grove(["reconcile", "--audit-only"]).stdout;
  assert.deepEqual(
    {
      doctorHasBothCodes: /Code: prunable/.test(doctorHuman) && /Code: unregistered-grove/.test(doctorHuman),
      doctorHasBothRemedies: /Inspect and prune it explicitly with native Git/.test(doctorHuman) && /Recreate the Trees explicitly/.test(doctorHuman),
      reconcileHasBothCodes: /Code: prunable/.test(reconcileHuman) && /Code: unregistered-grove/.test(reconcileHuman),
      reconcileAuditedNoOperations: /Resumed: \[\]/.test(reconcileHuman) && /Abandoned: \[\]/.test(reconcileHuman),
      strict: fx.grove(["doctor", "--strict"]).status,
    },
    { doctorHasBothCodes: true, doctorHasBothRemedies: true, reconcileHasBothCodes: true, reconcileAuditedNoOperations: true, strict: 3 },
  );
  // Only native Git clears prunable metadata — Grove never prunes, and `fix --move` plans only
  // `misplaced`. The repair is the operator's, and every consumer must then agree the PRUNABLE
  // problem is gone. `unregistered-grove` correctly survives: pruning the stale registration does
  // not move the renamed directory back, and that content is still unaccounted for.
  git(join(fx.root, "repos", "alpha"), ["worktree", "prune"]);
  const repaired = fx.grove(["--json", "reconcile", "--audit-only"]);
  const repairedDoctorHuman = fx.grove(["doctor"]).stdout;
  const repairedReconcileHuman = fx.grove(["reconcile", "--audit-only"]).stdout;
  assert.deepEqual(
    {
      prunable: json(repaired.stdout).diagnostics.some((diagnostic: any) => diagnostic.code === "prunable"),
      doctorOnlyUnregistered: !/Code: prunable/.test(repairedDoctorHuman) && /Code: unregistered-grove/.test(repairedDoctorHuman),
      reconcileOnlyUnregistered: !/Code: prunable/.test(repairedReconcileHuman) && /Code: unregistered-grove/.test(repairedReconcileHuman),
      strict: fx.grove(["doctor", "--strict"]).status,
    },
    {
      prunable: false,
      doctorOnlyUnregistered: true,
      reconcileOnlyUnregistered: true,
      strict: 3,
    },
  );
});
