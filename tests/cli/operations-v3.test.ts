/**
 * Phase 7 (ledger E-1…E-9). Constitution IV: *"every non-recoverable record can be explicitly
 * closed without inferred cleanup."* Several of these made that impossible.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitGate } from "../testkit/git-gate.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { beginOperation, recordPending } from "../../src/store/operation.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

function initialized(): Fixture {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  return fx;
}

test("V3OPS-02: a failed repo add can be abandoned and the alias reused", () => {
  const fx = initialized();
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  let failed;
  try { failed = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }); }
  finally { gate.dispose(); }
  const operationId = json(failed.stdout).operationId;

  const abandoned = fx.grove(["--json", "reconcile", "--abandon", operationId]);
  const reused = fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);

  // A failed acquisition was hardcoded `recoverable-intermediate`, which abandon refuses — so the
  // alias was locked forever and the remedy named a state the record could never reach.
  assert.deepEqual(
    { failedStatus: failed.status, abandonStatus: abandoned.status, reuseStatus: reused.status },
    { failedStatus: 6, abandonStatus: 0, reuseStatus: 0 },
  );
});

test("V3OPS-02: abandon never follows a symlinked failed-acquisition anchor", () => {
  const fx = initialized();
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  let failed;
  try { failed = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }); }
  finally { gate.dispose(); }
  const operationId = json(failed.stdout).operationId;
  const anchor = join(fx.root, "repos", "alpha");
  const victim = join(fx.root, "notes", "victim");
  const important = join(victim, "important.txt");
  rmSync(anchor, { recursive: true, force: true });
  mkdirSync(victim, { recursive: true });
  writeFileSync(important, "must survive\n");
  symlinkSync(victim, anchor);

  const abandoned = fx.grove(["--json", "reconcile", "--abandon", operationId]);
  const reused = fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);

  assert.deepEqual(
    {
      status: abandoned.status,
      operationAbandoned: json(abandoned.stdout).detail.abandoned,
      anchorReportedRemoved: json(abandoned.stdout).detail.removedAnchors,
      anchorStillSymlink: existsSync(anchor) && lstatSync(anchor).isSymbolicLink(),
      victimIntact: existsSync(important),
      aliasReusable: reused.status,
    },
    {
      status: 0,
      operationAbandoned: [operationId],
      anchorReportedRemoved: [anchor],
      anchorStillSymlink: false,
      victimIntact: true,
      aliasReusable: 0,
    },
  );
});

test("V3OPS-02: abandon refuses a user directory that replaced a failed-acquisition anchor", () => {
  const fx = initialized();
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  let failed;
  try { failed = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }); }
  finally { gate.dispose(); }
  const operationId = json(failed.stdout).operationId;
  const anchor = join(fx.root, "repos", "alpha");
  const notes = join(anchor, "notes.txt");
  rmSync(anchor, { recursive: true, force: true });
  mkdirSync(anchor, { recursive: true });
  writeFileSync(notes, "user replacement\n");

  const abandoned = fx.grove(["--json", "reconcile", "--abandon", operationId]);

  assert.deepEqual(
    {
      refused: abandoned.status,
      directorySurvives: existsSync(anchor),
      notesSurvive: existsSync(notes) ? readFileSync(notes, "utf8") : null,
    },
    { refused: 4, directorySurvives: true, notesSurvive: "user replacement\n" },
  );
});

test("V3DIAG-02: doctor --strict exits non-zero when only blocking diagnostics are present", () => {
  const fx = initialized();
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  // Corrupt the advisory metadata: `invalid-central-metadata` is severity `blocking`.
  mkdirSync(join(fx.root, ".grove", "groves"), { recursive: true });
  writeFileSync(join(fx.root, ".grove", "groves", "broken.json"), "{ not json");

  const machine = json(fx.grove(["--json", "doctor"]).stdout);
  const strict = fx.grove(["doctor", "--strict"]);

  // The flag whose entire purpose is "fail if anything is wrong" exited 0 while its own JSON said
  // `{blocking: 1}`. Both facts asserted in the same test, per the plan.
  assert.deepEqual(
    { blocking: machine.detail.counts.blocking > 0, policy: machine.detail.counts.policy, strictExit: strict.status },
    { blocking: true, policy: 0, strictExit: 3 },
  );
});

test("V3OPS-03: repo link never infers managed trunk consent from repository-layout position", () => {
  const fx = initialized();
  const anchor = join(fx.root, "repos", "alpha");
  execFileSync("git", ["clone", "-q", "--bare", fx.repos[0]!.origin, anchor]);

  const relinked = fx.grove(["--json", "repo", "link", anchor, "--name", "alpha"]);
  const config = JSON.parse(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  const kind = config.repositories[0]?.location?.kind;
  const trunkMutations = [
    fx.grove(["trunk", "add", "alpha", "develop", "--from", "main"]),
    fx.grove(["trunk", "remove", "alpha", "main"]),
    fx.grove(["trunk", "sync", "alpha"]),
  ];
  assert.deepEqual(
    { relinkStatus: relinked.status, kind, trunkMutationStatuses: trunkMutations.map((result) => result.status) },
    { relinkStatus: 0, kind: "linked", trunkMutationStatuses: [3, 3, 3] },
  );
});

test("V3ARC-05: an archive directory with no metadata is reported, not silently invisible", () => {
  const fx = initialized();
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);
  assert.equal(existsSync(join(fx.root, "archives", "work")), true);

  // Lose the advisory record while the content stays on disk.
  rmSync(join(fx.root, ".grove", "groves", "work.json"));

  const doctor = json(fx.grove(["--json", "doctor"]).stdout);
  const strict = fx.grove(["doctor", "--strict"]);
  // All four of these previously said "nothing here" while the content sat on disk: archived Groves
  // have NO Git representation, so one unbacked-up JSON was their sole authority.
  assert.deepEqual(
    {
      reported: doctor.diagnostics.some((d: any) => d.code === "orphaned-archive"),
      severity: doctor.diagnostics.filter((d: any) => d.code === "orphaned-archive").map((d: any) => d.severity),
      strictExit: strict.status,
      contentUntouched: existsSync(join(fx.root, "archives", "work")),
    },
    { reported: true, severity: ["policy"], strictExit: 3, contentUntouched: true },
  );
});

test("V3OPS-04: a pending operation is reported by a read-only command", () => {
  const fx = initialized();
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  try { fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }); }
  finally { gate.dispose(); }

  const doctor = json(fx.grove(["--json", "doctor"]).stdout);
  // A pending operation holds target locks, so the next mutating command refuses citing an
  // operation the user had no read-only way to discover.
  assert.deepEqual(
    {
      reported: doctor.diagnostics.some((d: any) => d.code === "pending-operation"),
      remedyNamesReconcile: doctor.diagnostics.filter((d: any) => d.code === "pending-operation").every((d: any) => /reconcile/.test(d.remedy)),
      diagnosticCount: doctor.diagnostics.length,
      detailTotal: doctor.detail.counts.total,
      detailPolicy: doctor.detail.counts.policy,
    },
    { reported: true, remedyNamesReconcile: true, diagnosticCount: 1, detailTotal: 1, detailPolicy: 1 },
  );
});

test("V3OPS-05: a completed repo-add record retains no raw remote URL", () => {
  const fx = initialized();
  const secretish = fx.repos[0]!.origin;
  assert.equal(fx.grove(["repo", "add", secretish, "--name", "alpha"]).status, 0);

  const dir = join(fx.root, ".grove", "operations");
  const records = readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
  const completed = records.filter((r: any) => r.state === "completed");
  // json-results-v1.md permits retaining a raw remote (credentials and all) only for a RESUMABLE
  // operation. A completed record is not resumable.
  assert.deepEqual(
    {
      completedCount: completed.length > 0,
      anySecret: completed.some((r: any) => r.secret !== undefined),
      rawRemoteAnywhere: JSON.stringify(completed).includes(secretish),
    },
    { completedCount: true, anySecret: false, rawRemoteAnywhere: false },
  );
});

test("V3DIAG-03: stale-metadata is cleared by the remedy its diagnostic names", () => {
  const fx = initialized();
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  // Materialize advisory Tree state, then remove the worktree with native Git so the record is
  // stranded — exactly the condition `stale-metadata` reports.
  assert.equal(fx.grove(["tree", "reorder", "work", "--tree", "work@alpha"]).status, 0);
  execFileSync("git", ["worktree", "remove", "--force", join(fx.root, "groves", "work", "trees", "work@alpha")], { cwd: join(fx.root, "repos", "alpha") });

  const before = json(fx.grove(["--json", "doctor"]).stdout);
  const stale = before.diagnostics.filter((d: any) => d.code === "stale-metadata");
  const remedyRuns = fx.grove(["tree", "remove", "work", "work@alpha", "--forget-settings"]);
  const after = json(fx.grove(["--json", "doctor"]).stdout);

  // The remedy resolved only over OBSERVED worktrees, so it could never run for the state it was
  // recommended for: `stale-metadata` fires precisely when no worktree is observed.
  assert.deepEqual(
    {
      reportedBefore: stale.length > 0,
      remedyNamesForget: stale.every((d: any) => /forget-settings/.test(d.remedy)),
      remedyStatus: remedyRuns.status,
      clearedAfter: after.diagnostics.some((d: any) => d.code === "stale-metadata"),
    },
    { reportedBefore: true, remedyNamesForget: true, remedyStatus: 0, clearedAfter: false },
  );
});

test("V3OPS-02: abandon refuses an anchor the layout does not expand to", () => {
  // The first B4 implementation guarded its `rm -rf` with "is it inside the workspace?" — and
  // `isSubpath(p, p)` is true, so a durable record naming the workspace ROOT authorised deleting
  // the entire workspace. Operation records are JSON on disk that a crash, a hand-edit, or a
  // degenerate layout template can shape, so containment is not a sufficient guard for deletion.
  //
  // Verified against the old guard: it removed `.grove/config.json` and everything else.
  const fx = initialized();
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  let failed;
  try { failed = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }); }
  finally { gate.dispose(); }
  const operationId = json(failed.stdout).operationId;

  const dir = join(fx.root, ".grove", "operations");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const path = join(dir, name);
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.id !== operationId) continue;
    // The record carries the step input TWICE — the plan under `targets[].steps` and the
    // classified list under `steps`. A corrupt record would have both; tampering only one leaves
    // the code reading a clean value and proves nothing.
    for (const target of record.targets) for (const step of target.steps) {
      if (step.kind === "repository-init-bare") step.input.anchor = fx.root;
    }
    for (const step of record.steps) {
      if (step.kind === "repository-init-bare") step.input.anchor = fx.root;
    }
    writeFileSync(path, JSON.stringify(record, null, 2));
  }

  const abandoned = fx.grove(["--json", "reconcile", "--abandon", operationId]);
  assert.deepEqual(
    {
      workspaceSurvived: existsSync(join(fx.root, ".grove", "config.json")),
      removedNothing: json(abandoned.stdout).detail.removedAnchors,
    },
    { workspaceSurvived: true, removedNothing: [] },
  );
});

test("V3OPS-02: delete refuses an archived looseContentPath the layout does not expand to", () => {
  // `archiveSnapshot.looseContentPath` is ADVISORY metadata, and the constitution explicitly
  // invites users to repair or remove advisory metadata — so it is accident- and tamper-shaped
  // input to an `rm -rf`. The guard was containment (`isSubpath`), which is true for a path against
  // itself, so the workspace ROOT passed it.
  //
  // Verified against the old guard: `delete --allow-destructive-all` removed the entire workspace at
  // exit 0. Archive always writes exactly the archive-role path and `rename` keeps it that way.
  const fx = initialized();
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);

  const manifestPath = join(fx.root, ".grove", "groves", "work.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.archiveSnapshot = { ...manifest.archiveSnapshot, looseContentPath: fx.root };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const refused = fx.grove(["--json", "delete", "work", "--allow-destructive-all"]);
  assert.deepEqual(
    {
      status: refused.status,
      workspaceSurvived: existsSync(join(fx.root, ".grove", "config.json")),
      archiveSurvived: existsSync(join(fx.root, "archives", "work")),
    },
    { status: 5, workspaceSurvived: true, archiveSurvived: true },
  );
});

test("V3OPS-02: restore and rename refuse a tampered archive root too", () => {
  // The same advisory key reaches THREE destructive call sites — delete (`rmSync`), restore
  // (`renameSync`) and rename (`renameSync`) — and all three were guarded only by containment.
  // Moving the workspace root elsewhere is destruction as surely as deleting it.
  const build = (): Fixture => {
    const fx = initialized();
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
    assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);
    const manifestPath = join(fx.root, ".grove", "groves", "work.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.archiveSnapshot = { ...manifest.archiveSnapshot, looseContentPath: fx.root };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return fx;
  };

  const restoring = build();
  const restored = restoring.grove(["restore", "work"]);
  const renaming = build();
  const renamed = renaming.grove(["rename", "work", "renamed"]);

  assert.deepEqual(
    {
      restoreStatus: restored.status,
      restoreWorkspaceSurvived: existsSync(join(restoring.root, ".grove", "config.json")),
      renameStatus: renamed.status,
      renameWorkspaceSurvived: existsSync(join(renaming.root, ".grove", "config.json")),
    },
    { restoreStatus: 5, restoreWorkspaceSurvived: true, renameStatus: 5, renameWorkspaceSurvived: true },
  );
});

test("V3OPS-02: abandoning a COMPLETED acquisition never touches its live repository", () => {
  // P0 regression. B4's cleanup ran BEFORE `abandonOperation` checked eligibility and fired for any
  // record of kind `repo-add` — so abandoning a COMPLETED acquisition deleted a live bare
  // repository, every ref and object, and then exited 5 saying it had done nothing.
  //
  // The route is ordinary, not contrived: `repo remove` is documented unregister-only ("all Git
  // state remains"), so `repo add` -> `repo remove` -> `reconcile --abandon <that id>` is a
  // sequence a user reaches by following the help. `doctor` exited 0 afterwards, noticing nothing,
  // and `trunks/main@alpha` was left pointing at a deleted gitdir.
  const fx = initialized();
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  const anchor = join(fx.root, "repos", "alpha");
  const refsBefore = execFileSync("git", ["for-each-ref", "--format=%(refname)"], { cwd: anchor, encoding: "utf8" }).trim();
  assert.equal(fx.grove(["repo", "remove", "alpha"]).status, 0);

  const dir = join(fx.root, ".grove", "operations");
  const record = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")))
    .find((r: any) => r.kind === "repo-add");
  assert.equal(record.state, "completed");

  const abandoned = fx.grove(["reconcile", "--abandon", record.id]);
  assert.deepEqual(
    {
      // Ineligible, so it must refuse — and refusing must mean nothing happened.
      status: abandoned.status,
      anchorSurvived: existsSync(anchor),
      refsIntact: existsSync(anchor) ? execFileSync("git", ["for-each-ref", "--format=%(refname)"], { cwd: anchor, encoding: "utf8" }).trim() : "(anchor destroyed)",
    },
    { status: 5, anchorSurvived: true, refsIntact: refsBefore },
  );
});

test("V3OPS-02: a symlink at the archive layout path is refused, not followed", () => {
  // P0. `resolveContained` returns the REALPATH and only checks containment; `resolveLayoutTarget`
  // additionally refuses when the lexical and canonical paths differ — config-v3's stated
  // symlink-safety guarantee. delete/restore/rename each chose the containment resolver whenever
  // an advisory `looseContentPath` was recorded, and an archived Grove ALWAYS has one, so the
  // unsafe branch was the normal path. The exact-path guards added earlier are lexical and pass
  // straight through a symlink.
  //
  // Before the fix: delete --allow-destructive-all recursively destroyed the symlink target, rename
  // moved it, and restore moved it into the Grove WITH NO DESTRUCTIVE FLAG — all at exit 0.
  const build = (): { fx: Fixture; victim: string } => {
    const fx = initialized();
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    assert.equal(fx.grove(["new", "feat", "--repo", "alpha"]).status, 0);
    writeFileSync(join(fx.root, "groves", "feat", "precious.txt"), "loose\n");
    assert.equal(fx.grove(["archive", "feat", "--allow-unpushed"]).status, 0);
    const victim = join(fx.root, "victim");
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, "unrelated.txt"), "do not touch\n");
    rmSync(join(fx.root, "archives", "feat"), { recursive: true, force: true });
    symlinkSync(victim, join(fx.root, "archives", "feat"));
    return { fx, victim };
  };

  const deleting = build();
  const deleted = deleting.fx.grove(["delete", "feat", "--allow-destructive-all"]);
  const restoring = build();
  const restored = restoring.fx.grove(["restore", "feat"]);
  const renaming = build();
  const renamed = renaming.fx.grove(["rename", "feat", "renamed"]);

  assert.deepEqual(
    {
      deleteRefused: deleted.status !== 0,
      deleteVictimIntact: existsSync(join(deleting.victim, "unrelated.txt")),
      restoreRefused: restored.status !== 0,
      restoreVictimIntact: existsSync(join(restoring.victim, "unrelated.txt")),
      renameRefused: renamed.status !== 0,
      renameVictimIntact: existsSync(join(renaming.victim, "unrelated.txt")),
    },
    {
      deleteRefused: true, deleteVictimIntact: true,
      restoreRefused: true, restoreVictimIntact: true,
      renameRefused: true, renameVictimIntact: true,
    },
  );
});

test("V3OPS-05: no terminal operation record retains the raw remote", () => {
  // E-9 scrubbed only on `completed`, which is the one ending a FAILED acquisition never reaches.
  // Decision B3 routes those to `conflicted`, `resumeOperation` returns immediately on a conflicted
  // step, and `abandon` did not scrub — so a raw remote (in the real world,
  // https://user:token@host/repo.git) persisted indefinitely in a record nothing could ever resume.
  // json-results-v1.md permits that retention ONLY for a resumable operation.
  const fx = initialized();
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], { failExitCode: 42 });
  let failed;
  try { failed = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { env: gate.env }); }
  finally { gate.dispose(); }
  const operationId = json(failed.stdout).operationId;
  const dir = join(fx.root, ".grove", "operations");
  const record = () => readdirSync(dir).filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")))
    .find((r: any) => r.id === operationId);

  const conflicted = record();
  assert.equal(fx.grove(["reconcile", "--abandon", operationId]).status, 0);
  const abandoned = record();

  assert.deepEqual(
    { conflictedState: conflicted.state, conflictedSecret: conflicted.secret ?? null, abandonedState: abandoned.state, abandonedSecret: abandoned.secret ?? null },
    { conflictedState: "conflicted", conflictedSecret: null, abandonedState: "abandoned", abandonedSecret: null },
  );
});

test("V3ARC-04: restore refuses when the archived content directory is gone", () => {
  // It reported `outcome: "complete"` at exit 0, manufactured an empty Grove, and cleared
  // `archiveSnapshot` — destroying the only record that loose content had ever existed. Trees are
  // rebuildable from Git; files that were never in Git are not.
  const fx = initialized();
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  writeFileSync(join(fx.root, "groves", "work", "design-notes.md"), "only copy\n");
  assert.equal(fx.grove(["archive", "work", "--allow-unpushed"]).status, 0);
  rmSync(join(fx.root, "archives", "work"), { recursive: true, force: true });

  const refused = fx.grove(["--json", "restore", "work"]);
  assert.deepEqual(
    {
      status: refused.status,
      namesTheMissingDirectory: String(json(refused.stdout).error.why).includes("archives"),
      noEmptyGroveManufactured: existsSync(join(fx.root, "groves", "work")) === false,
      recordStillArchived: JSON.parse(readFileSync(join(fx.root, ".grove", "groves", "work.json"), "utf8")).state,
    },
    { status: 5, namesTheMissingDirectory: true, noEmptyGroveManufactured: true, recordStillArchived: "archived" },
  );
});

test("V3OPS-02: a central-metadata-remove record cannot unlink outside the layout", () => {
  // `paths/layout.ts` re-exported the VALIDATING `centralGroveManifest` from `config/layout.ts` and
  // then shadowed it with a local `join(...)` that never calls `assertGroveName`. Every importer of
  // paths/layout.ts silently got the unvalidated one, and reconcile's `central-metadata-remove`
  // replay used it to unlink a caller-supplied path — the one destructive replay with no
  // re-derivation and no containment check at all. The shadow is deleted.
  const fx = initialized();
  const victim = join(fx.home, "pwn-target.json");
  writeFileSync(victim, "{}\n");
  const operation = beginOperation(fx.root, {
    kind: "grove-delete",
    scope: { grove: "../../pwn" },
    targetLocks: ["grove:pwn"],
    targets: [{ selector: { grove: "../../pwn" }, steps: [{ id: "delete-metadata", kind: "central-metadata-remove", input: { path: victim } }] }],
  });
  recordPending(operation, "delete-metadata", { revision: null, present: true });

  const reconciled = fx.grove(["reconcile"]);
  assert.deepEqual(
    { refused: reconciled.status !== 0, victimSurvives: existsSync(victim) },
    { refused: true, victimSurvives: true },
  );
});

test("a recorded step kind this build cannot run exits 4 as unsupported-step on every reconcile", () => {
  // json-results-v1: `unsupported-step` contributes 4, the exit reconcile gives the same record
  // (as `stale-plan`) on first contact. A later run reported the conflicted step and exited 0.
  const fx = initialized();
  const record = beginOperation(fx.root, { kind: "future-operation", scope: {}, targetLocks: [], targets: [{ selector: {}, steps: [{ id: "only", kind: "future-step-kind", input: {} }] }] });
  const first = fx.grove(["--json", "reconcile", "--operation", record.id]);
  const second = fx.grove(["--json", "reconcile", "--operation", record.id]);
  const persisted = JSON.parse(readFileSync(record.file, "utf8"));
  assert.deepEqual(
    {
      first: { status: first.status, reason: json(first.stdout).targets[0].reason },
      recorded: { state: persisted.state, reason: persisted.steps[0].error?.reason },
      second: { status: second.status, outcome: json(second.stdout).outcome, reason: json(second.stdout).targets[0].reason },
    },
    {
      first: { status: 4, reason: "stale-plan" },
      recorded: { state: "conflicted", reason: "unsupported-step" },
      second: { status: 4, outcome: "partial", reason: "unsupported-step" },
    },
  );
});
