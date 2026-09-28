/**
 * A forced archive or delete that fails partway reports what its completed steps already destroyed
 * (constitution IV ruling ④; FR-023A; json-results-v1 and cli-surface-v3 receipts; V3DES-11,
 * V3DES-12). Assessment-18 §8c: the partial result named only the failing target and the
 * completed `worktree-remove` step recorded `{registered: false, refsRetained: true}` only.
 *
 * Every fixture has two Trees (alpha removed first, beta second), each holding a tracked edit,
 * ordinary untracked files and an ignored file, plus loose `NOTES.md`, and valid central metadata.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { killAndReapFaultProcess, processGroupAlive, spawnFaultProcess } from "../testkit/git-fault.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());
const ALPHA_WORK = [".gitignore", "README.md", "alpha-debug.log", "alpha-untracked.txt"];
const BETA_WORK = [".gitignore", "README.md", "beta-debug.log", "beta-untracked.txt"];

interface TwoTreeGrove { fx: Fixture; groveDir: string; alpha: string; beta: string; metadata: string }

function twoTreeGrove(): TwoTreeGrove {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["repo", "add", fx.repos[1]!.origin, "--name", "beta"], ["new", "g", "--all"], ["archive", "g", "--allow-unpushed"], ["restore", "g"]]) {
    const run = fx.grove(args);
    assert.equal(run.status, 0, `${args.join(" ")}: ${run.stderr}\n${run.stdout}`);
  }
  const groveDir = join(fx.root, "groves", "g");
  const metadata = join(fx.root, ".grove", "groves", "g.json");
  assert.ok(existsSync(metadata), "fixture needs central metadata");
  const trees = { alpha: join(groveDir, "trees", "g@alpha"), beta: join(groveDir, "trees", "g@beta") };
  for (const [name, tree] of Object.entries(trees)) {
    writeFileSync(join(tree, "README.md"), `${readFileSync(join(tree, "README.md"), "utf8")}${name} tracked edit\n`);
    writeFileSync(join(tree, `${name}-untracked.txt`), `${name} untracked\n`);
    writeFileSync(join(tree, ".gitignore"), "*.log\n");
    writeFileSync(join(tree, `${name}-debug.log`), `${name} ignored\n`);
  }
  writeFileSync(join(groveDir, "NOTES.md"), "loose notes\n");
  return { fx, groveDir, metadata, ...trees };
}

const removeBeta = (fixture: TwoTreeGrove): string[] => ["worktree", "remove", "--force", "--", fixture.beta];
const paths = (changes: Array<{ path: string }> | undefined): string[] | null => changes ? changes.map((change) => change.path).sort() : null;
const treeTarget = (result: any, tree: string) => result.targets?.find((target: any) => target.selector?.tree === tree && target.action === "worktree-remove");

/** The newest record of `kind` (ULID names sort by time); the fixture's own archive is older. */
function operationRecord(fixture: TwoTreeGrove, kind: string): any {
  const directory = join(fixture.fx.root, ".grove", "operations");
  const records = readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => json(readFileSync(join(directory, name), "utf8"))).filter((record) => record.kind === kind);
  assert.ok(records.length > 0, `expected a ${kind} record`);
  return records.at(-1);
}

/** Run a forced command paused at beta's `worktree remove`; `during` acts, then the run continues. */
async function pausedAtBeta(fixture: TwoTreeGrove, args: string[], during: () => void): Promise<{ status: number | null; stdout: string }> {
  const gate = createGitGate(removeBeta(fixture), { timeoutMs: 60_000 });
  const command = spawnFaultProcess(process.execPath, [CLI, "--json", ...args], { cwd: fixture.fx.root, env: { ...process.env, HOME: fixture.fx.home, GROVE_ROOT: "/ignored", ...gate.env } });
  try {
    await waitForGitGate(gate, command);
    during();
    gate.release();
    const closed = await command.closed;
    return { status: closed.code, stdout: command.stdout() };
  } finally { gate.release(); if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
}

async function interruptAtBeta(fixture: TwoTreeGrove, args: string[]): Promise<void> {
  const gate = createGitGate(removeBeta(fixture), { timeoutMs: 60_000 });
  const command = spawnFaultProcess(process.execPath, [CLI, "--json", ...args], { cwd: fixture.fx.root, env: { ...process.env, HOME: fixture.fx.home, GROVE_ROOT: "/ignored", ...gate.env } });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { gate.release(); if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
}

for (const [command, args] of [["delete", ["delete", "g", "--allow-destructive-all"]], ["archive", ["archive", "g", "--allow-destructive-all", "--allow-unpushed"]]] as const) {
  test(`V3DES-11: a direct ${command} that fails at the second Tree reports the first Tree's discarded files`, () => {
    const fixture = twoTreeGrove();
    const gate = createGitGate(removeBeta(fixture), { failExitCode: 1, timeoutMs: 60_000 });
    let run;
    try { run = fixture.fx.grove(["--json", ...args], { env: gate.env }); } finally { gate.dispose(); }
    const result = json(run.stdout);
    const alpha = treeTarget(result, "g@alpha");
    const beta = result.targets.find((target: any) => target.reason === "git-failed");
    const record = operationRecord(fixture, `grove-${command}`);
    const remove0 = record.steps.find((step: any) => step.id === "remove-0");
    assert.deepEqual(
      {
        status: run.status,
        alphaRemoved: !existsSync(fixture.alpha),
        betaKept: existsSync(join(fixture.beta, "beta-untracked.txt")),
        looseKept: existsSync(join(fixture.groveDir, "NOTES.md")),
        failing: beta ? { path: beta.selector.path, action: beta.action } : null,
        alphaReceipt: alpha ? { reason: alpha.reason, discarded: paths(alpha.after?.discardedWork) } : null,
        alphaRecorded: paths(remove0.postState?.discardedWork),
        nothingElseClaimed: result.targets.filter((target: any) => target.reason === null).length,
      },
      {
        status: 6,
        alphaRemoved: true,
        betaKept: true,
        looseKept: true,
        failing: { path: fixture.beta, action: "worktree-remove" },
        alphaReceipt: { reason: null, discarded: ALPHA_WORK },
        alphaRecorded: ALPHA_WORK,
        nothingElseClaimed: 1,
      },
      run.stdout,
    );
    assert.deepEqual(alpha.after.discardedWork.find((change: any) => change.path === "alpha-debug.log"), { status: "!!", path: "alpha-debug.log" });
  });
}

test("V3DES-11: the human partial result names the completed Tree's discarded files", () => {
  const fixture = twoTreeGrove();
  const gate = createGitGate(removeBeta(fixture), { failExitCode: 1, timeoutMs: 60_000 });
  let run;
  try { run = fixture.fx.grove(["delete", "g", "--allow-destructive-all"], { env: gate.env }); } finally { gate.dispose(); }
  assert.equal(run.status, 6, `${run.stdout}\n${run.stderr}`);
  for (const file of ALPHA_WORK) assert.ok(run.stdout.includes(file), `human output omits ${file}:\n${run.stdout}`);
});

test("V3DES-11: a direct delete that fails after removing loose content reports every completed removal", async () => {
  const fixture = twoTreeGrove();
  const gate = createGitGate(removeBeta(fixture), { timeoutMs: 60_000 });
  const command = spawnFaultProcess(process.execPath, [CLI, "--json", "delete", "g", "--allow-destructive-all"], { cwd: fixture.fx.root, env: { ...process.env, HOME: fixture.fx.home, GROVE_ROOT: "/ignored", ...gate.env } });
  let closed: { code: number | null } = { code: null };
  try {
    await waitForGitGate(gate, command);
    // The metadata step is the only step after the loose removal. Make it refuse at its point of
    // use: the metadata path becomes a symlink, which destructive helpers never follow.
    const copy = `${fixture.metadata}.copy`;
    copyFileSync(fixture.metadata, copy);
    renameSync(fixture.metadata, `${fixture.metadata}.moved`);
    symlinkSync(copy, fixture.metadata);
    gate.release();
    closed = await command.closed;
  } finally { gate.release(); if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  const stdout = command.stdout();
  const result = json(stdout);
  const content = result.targets?.find((target: any) => target.action === "directory-remove");
  const failing = result.targets?.find((target: any) => target.reason !== null);
  assert.deepEqual(
    {
      status: closed.code,
      contentRemoved: !existsSync(fixture.groveDir),
      alpha: paths(treeTarget(result, "g@alpha")?.after?.discardedWork),
      beta: paths(treeTarget(result, "g@beta")?.after?.discardedWork),
      loose: content?.after?.discardedLoose ?? null,
      failingAction: failing?.action ?? null,
      recordedLoose: operationRecord(fixture, "grove-delete").steps.find((step: any) => step.id === "delete-content").postState?.discardedLoose ?? null,
    },
    { status: 4, contentRemoved: true, alpha: ALPHA_WORK, beta: BETA_WORK, loose: ["NOTES.md"], failingAction: "central-metadata-remove", recordedLoose: ["NOTES.md"] },
    `${stdout}\n${command.stderr()}`,
  );
});

test("V3DES-12: a resumed delete that fails reports removals from the interrupted run and the resume", async () => {
  const fixture = twoTreeGrove();
  await interruptAtBeta(fixture, ["delete", "g", "--allow-destructive-all"]);
  assert.equal(existsSync(fixture.alpha), false, "alpha was removed before the interruption");
  // Rebind the metadata file (new inode): the resume removes beta and the loose content, then the
  // metadata step refuses at its identity check.
  copyFileSync(fixture.metadata, `${fixture.metadata}.tmp`);
  renameSync(`${fixture.metadata}.tmp`, fixture.metadata);
  const reconciled = fixture.fx.grove(["--json", "reconcile"]);
  const after = json(reconciled.stdout).targets[0].after;
  const step = (id: string) => after.discarded.find((item: any) => item.step === id);
  assert.deepEqual(
    {
      status: reconciled.status,
      problem: after.problem,
      alpha: paths(step("remove-0")?.evidence?.discardedWork),
      alphaEarlier: step("remove-0")?.completedEarlier ?? false,
      beta: paths(step("remove-1")?.evidence?.discardedWork),
      loose: step("delete-content")?.evidence?.discardedLoose ?? null,
    },
    { status: 4, problem: "stale-plan", alpha: ALPHA_WORK, alphaEarlier: true, beta: BETA_WORK, loose: ["NOTES.md"] },
    reconciled.stdout,
  );
  const human = fixture.fx.grove(["reconcile"]);
  for (const file of ["alpha-untracked.txt", "beta-untracked.txt", "NOTES.md"]) assert.ok(human.stdout.includes(file), `human reconcile omits ${file}:\n${human.stdout}`);
});

test("V3DES-12: a resumed archive that fails reports the Tree removed by the interrupted run", async () => {
  const fixture = twoTreeGrove();
  await interruptAtBeta(fixture, ["archive", "g", "--allow-destructive-all", "--allow-unpushed"]);
  assert.equal(existsSync(fixture.alpha), false, "alpha was removed before the interruption");
  writeFileSync(join(fixture.beta, "late.txt"), "added after the plan\n");
  const reconciled = fixture.fx.grove(["--json", "reconcile"]);
  const after = json(reconciled.stdout).targets[0].after;
  const remove0 = after.discarded?.find((item: any) => item.step === "remove-0");
  assert.deepEqual(
    {
      status: reconciled.status,
      problem: after.problem,
      lateKept: existsSync(join(fixture.beta, "late.txt")),
      alpha: paths(remove0?.evidence?.discardedWork),
      alphaEarlier: remove0?.completedEarlier ?? false,
      betaClaimed: after.discarded?.some((item: any) => item.step === "remove-1") ?? false,
    },
    { status: 4, problem: "stale-plan", lateKept: true, alpha: ALPHA_WORK, alphaEarlier: true, betaClaimed: false },
    reconciled.stdout,
  );
});

test("V3DES-12 control: a successful resume reports each step's discards once, earlier ones marked", async () => {
  const fixture = twoTreeGrove();
  await interruptAtBeta(fixture, ["delete", "g", "--allow-destructive-all"]);
  const reconciled = fixture.fx.grove(["--json", "reconcile"]);
  assert.equal(reconciled.status, 0, reconciled.stdout);
  const discarded = json(reconciled.stdout).targets[0].after.discarded;
  assert.deepEqual(
    discarded.map((item: any) => [item.step, item.completedEarlier ?? false, paths(item.evidence.discardedWork) ?? item.evidence.discardedLoose]),
    [["remove-0", true, ALPHA_WORK], ["remove-1", false, BETA_WORK], ["delete-content", false, ["NOTES.md"]]],
  );
  // Review F10: a Tree removed during the resume is named as well as one removed earlier.
  assert.deepEqual(
    discarded.filter((item: any) => item.step !== "delete-content").map((item: any) => [item.step, item.tree, item.evidence.path]),
    [["remove-0", "g@alpha", fixture.alpha], ["remove-1", "g@beta", fixture.beta]],
  );
});

test("V3DES-11: a file that vanishes before its Tree is removed is not in that Tree's receipt", async () => {
  const fixture = twoTreeGrove();
  // Beta's point-of-use check runs after alpha's removal. Delete a consented beta file while the
  // run is paused at alpha's removal: it is in the recorded consent but was never discarded.
  const gate = createGitGate(["worktree", "remove", "--force", "--", fixture.alpha], { timeoutMs: 60_000 });
  const command = spawnFaultProcess(process.execPath, [CLI, "--json", "delete", "g", "--allow-destructive-all"], { cwd: fixture.fx.root, env: { ...process.env, HOME: fixture.fx.home, GROVE_ROOT: "/ignored", ...gate.env } });
  let status: number | null = null;
  try {
    await waitForGitGate(gate, command);
    rmSync(join(fixture.beta, "beta-untracked.txt"));
    gate.release();
    status = (await command.closed).code;
  } finally { gate.release(); if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  assert.equal(status, 0, command.stdout());
  const remove1 = operationRecord(fixture, "grove-delete").steps.find((step: any) => step.id === "remove-1").postState;
  const betaResult = json(command.stdout()).targets[0].after.discardedWork.find((item: any) => item.tree === "g@beta");
  assert.deepEqual(
    { recorded: paths(remove1.recordedWork), discarded: paths(remove1.discardedWork), result: paths(betaResult?.changes) },
    { recorded: BETA_WORK, discarded: [".gitignore", "README.md", "beta-debug.log"], result: [".gitignore", "README.md", "beta-debug.log"] },
  );
});

for (const mode of ["direct", "resume"] as const) {
  test(`V3DES-${mode === "direct" ? "09" : "10"}: content recreated at a removed Tree's path is new loose content (${mode})`, async () => {
    const fixture = twoTreeGrove();
    const recreate = () => { mkdirSync(fixture.alpha); writeFileSync(join(fixture.alpha, "recreated.txt"), "not consented\n"); };
    let status: number | null;
    let evidence: any;
    if (mode === "direct") {
      const run = await pausedAtBeta(fixture, ["delete", "g", "--allow-destructive-all"], () => { assert.equal(existsSync(fixture.alpha), false); recreate(); });
      status = run.status;
      evidence = json(run.stdout).targets.find((target: any) => target.action === "directory-remove")?.before;
    } else {
      await interruptAtBeta(fixture, ["delete", "g", "--allow-destructive-all"]);
      assert.equal(existsSync(fixture.alpha), false);
      recreate();
      const reconciled = fixture.fx.grove(["--json", "reconcile"]);
      status = reconciled.status;
      evidence = json(reconciled.stdout).targets[0].after.evidence;
    }
    assert.deepEqual(
      { status, survives: existsSync(join(fixture.alpha, "recreated.txt")), notes: existsSync(join(fixture.groveDir, "NOTES.md")), added: evidence?.addedLoose ?? null },
      { status: 4, survives: true, notes: true, added: ["trees/g@alpha/", "trees/g@alpha/recreated.txt"] },
      JSON.stringify(evidence),
    );
  });
}

for (const [kind, args, finish] of [
  ["delete", ["delete", "g", "--allow-destructive-all"], "plain"],
  ["archive", ["archive", "g", "--allow-destructive-all", "--allow-unpushed"], "plain"],
  ["archive", ["archive", "g", "--allow-destructive-all", "--allow-unpushed"], "remedy"],
  ["delete", ["delete", "g", "--allow-destructive-all"], "remedy"],
] as const) {
  test(`V3DES-13: after a ${kind} metadata-step I/O failure is fixed, ${finish === "plain" ? "a plain reconcile" : "the stated remedy"} finishes it with receipts kept`, async () => {
    const fixture = twoTreeGrove();
    const metadataDirectory = join(fixture.fx.root, ".grove", "groves");
    let run: { status: number | null; stdout: string };
    try { run = await pausedAtBeta(fixture, [...args], () => chmodSync(metadataDirectory, 0o555)); }
    finally { chmodSync(metadataDirectory, 0o755); }
    const result = json(run.stdout);
    const failing = result.targets.find((target: any) => target.reason !== null);
    const direct = {
      status: run.status,
      outcome: result.outcome,
      failing: failing ? [failing.action, failing.reason] : null,
      alpha: paths(treeTarget(result, "g@alpha")?.after?.discardedWork),
      beta: paths(treeTarget(result, "g@beta")?.after?.discardedWork),
      remedyNamesReconcile: String(failing?.detail?.remedy ?? "").includes(`grove reconcile --operation ${result.operationId}`),
    };
    // The cause is fixed (permissions restored above); recovery must now finish forward.
    const reconciled = fixture.fx.grove(["--json", "reconcile", ...(finish === "remedy" ? ["--operation", result.operationId] : [])]);
    const after = json(reconciled.stdout).targets[0]?.after ?? {};
    const metadata = existsSync(fixture.metadata) ? json(readFileSync(fixture.metadata, "utf8")) : null;
    assert.deepEqual(
      {
        direct,
        reconcileStatus: reconciled.status,
        state: after.state ?? null,
        finished: kind === "delete" ? !existsSync(fixture.metadata) && !existsSync(fixture.groveDir) : metadata?.state === "archived" && metadata?.archiveSnapshot?.recipes?.length === 2 && existsSync(join(fixture.fx.root, "archives", "g", "NOTES.md")),
        earlier: (after.discarded ?? []).filter((item: any) => item.completedEarlier).map((item: any) => [item.step, paths(item.evidence.discardedWork) ?? item.evidence.discardedLoose]),
      },
      {
        direct: {
          status: 7,
          outcome: "partial",
          failing: [kind === "delete" ? "central-metadata-remove" : "central-metadata-update", "io-failed"],
          alpha: ALPHA_WORK,
          beta: BETA_WORK,
          remedyNamesReconcile: true,
        },
        reconcileStatus: 0,
        state: "completed",
        finished: true,
        earlier: [["remove-0", ALPHA_WORK], ["remove-1", BETA_WORK], ...(kind === "delete" ? [["delete-content", ["NOTES.md"]]] : [])],
      },
      `${run.stdout}\n--- reconcile ---\n${reconciled.stdout}`,
    );
  });
}

/** Fail the metadata step: `.grove/groves` is read-only from beta's removal on. Caller restores it. */
async function metadataFailure(fixture: TwoTreeGrove, args: string[]): Promise<any> {
  const run = await pausedAtBeta(fixture, args, () => chmodSync(join(fixture.fx.root, ".grove", "groves"), 0o555));
  const result = json(run.stdout);
  assert.equal(run.status, 7, run.stdout);
  return result;
}

for (const [kind, args] of [["archive", ["archive", "g", "--allow-destructive-all", "--allow-unpushed"]], ["delete", ["delete", "g", "--allow-destructive-all"]]] as const) {
  test(`V3DES-13: a ${kind} reconcile tried before the metadata cause is fixed stays recoverable, and the next one completes`, async () => {
    const fixture = twoTreeGrove();
    const metadataDirectory = join(fixture.fx.root, ".grove", "groves");
    let premature: { status: number; stdout: string };
    let id: string;
    try {
      id = (await metadataFailure(fixture, [...args])).operationId;
      premature = fixture.fx.grove(["--json", "reconcile"]);
    } finally { chmodSync(metadataDirectory, 0o755); }
    const early = json(premature.stdout);
    const target = early.targets?.find((candidate: any) => candidate.before?.operationId === id);
    const record = operationRecord(fixture, `grove-${kind}`);
    const facts = {
      status: premature.status,
      reason: target?.reason ?? early.error?.kind ?? null,
      why: typeof target?.detail?.why === "string" && target.detail.why.length > 0,
      remedy: String(target?.detail?.remedy ?? "").includes(`grove reconcile --operation ${id}`),
      remedyOffersNoAbandon: !String(target?.detail?.remedy ?? "--abandon").includes("--abandon"),
      recordState: record.state,
    };
    const finished = fixture.fx.grove(["--json", "reconcile"]);
    const metadata = existsSync(fixture.metadata) ? json(readFileSync(fixture.metadata, "utf8")) : null;
    assert.deepEqual(
      { premature: facts, finishedStatus: finished.status, finished: kind === "delete" ? !existsSync(fixture.metadata) : metadata?.state === "archived" && metadata?.archiveSnapshot?.recipes?.length === 2 },
      { premature: { status: 7, reason: "io-failed", why: true, remedy: true, remedyOffersNoAbandon: true, recordState: "recoverable" }, finishedStatus: 0, finished: true },
      `${premature.stdout}\n--- second reconcile ---\n${finished.stdout}`,
    );
  });
}

test("V3DES-13: archive refused by its own pending archive names the operation and never advises deleting the archive", async () => {
  const fixture = twoTreeGrove();
  let id: string;
  try { id = (await metadataFailure(fixture, ["archive", "g", "--allow-destructive-all", "--allow-unpushed"])).operationId; }
  finally { chmodSync(join(fixture.fx.root, ".grove", "groves"), 0o755); }
  const again = fixture.fx.grove(["--json", "archive", "g", "--allow-destructive-all", "--allow-unpushed"]);
  const error = json(again.stdout).error ?? {};
  assert.deepEqual(
    {
      status: again.status,
      namesOperation: `${error.why} ${error.remedy}`.includes(id),
      namesReconcile: String(error.remedy).includes(`grove reconcile --operation ${id}`),
      advisesDeletion: /delete/i.test(String(error.remedy)),
      archiveKept: existsSync(join(fixture.fx.root, "archives", "g", "NOTES.md")),
    },
    { status: 4, namesOperation: true, namesReconcile: true, advisesDeletion: false, archiveKept: true },
    again.stdout,
  );
});

test("V3OPS-08: doctor's pending-operation remedy follows the operation state", async () => {
  const recoverable = twoTreeGrove();
  let recoverableId: string;
  try { recoverableId = (await metadataFailure(recoverable, ["archive", "g", "--allow-destructive-all", "--allow-unpushed"])).operationId; }
  finally { chmodSync(join(recoverable.fx.root, ".grove", "groves"), 0o755); }
  const conflicted = twoTreeGrove();
  await interruptAtBeta(conflicted, ["delete", "g", "--allow-destructive-all"]);
  writeFileSync(join(conflicted.groveDir, "LATE.md"), "added after the plan\n");
  assert.equal(conflicted.fx.grove(["--json", "reconcile"]).status, 4);
  const conflictedId = operationRecord(conflicted, "grove-delete").id;
  const remedy = (fixture: TwoTreeGrove, id: string) => json(fixture.fx.grove(["--json", "doctor"]).stdout).diagnostics.find((diagnostic: any) => diagnostic.code === "pending-operation" && diagnostic.subject?.operationId === id)?.remedy ?? "";
  const recoverableRemedy = remedy(recoverable, recoverableId);
  const conflictedRemedy = remedy(conflicted, conflictedId);
  assert.deepEqual(
    {
      recoverableResumes: recoverableRemedy.includes(`grove reconcile --operation ${recoverableId}`),
      recoverableOffersAbandon: recoverableRemedy.includes("--abandon"),
      conflictedAbandons: conflictedRemedy.includes(`grove reconcile --abandon ${conflictedId}`),
      conflictedOffersResume: /to resume|--operation/.test(conflictedRemedy),
    },
    { recoverableResumes: true, recoverableOffersAbandon: false, conflictedAbandons: true, conflictedOffersResume: false },
    `${recoverableRemedy}\n${conflictedRemedy}`,
  );
  // The advice is true: the recoverable operation resumes, the conflicted one closes.
  assert.equal(recoverable.fx.grove(["--json", "reconcile", "--operation", recoverableId]).status, 0);
  assert.equal(conflicted.fx.grove(["--json", "reconcile", "--abandon", conflictedId]).status, 0);
});
