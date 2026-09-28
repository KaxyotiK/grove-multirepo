/**
 * Loose Grove content consent is a recorded per-path inventory, not a directory name (FR-023,
 * FR-023A; cli-surface-v3 "Destructive plans persist ..."; V3DES-09, V3DES-10).
 *
 * The defect these witnesses pin: `delete --allow-destructive-all` recorded consent for loose
 * content as top-level names only (`notes`) and later removed the whole directory recursively.
 * A file added inside `notes/` after the plan therefore inherited the consent and was deleted,
 * on the direct path and when `reconcile` resumed an interrupted delete.
 *
 * Every fixture carries valid central metadata (new, archive, restore), so the unrelated
 * `metadataMissing` refusal on resume cannot make a witness pass.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitGate, waitForGitGate, type GitGate } from "../testkit/git-gate.ts";
import { killAndReapFaultProcess, processGroupAlive, spawnFaultProcess, type FaultProcess } from "../testkit/git-fault.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

interface LooseGrove { fx: Fixture; groveDir: string; tree: string; notes: string; metadata: string }

/** A Grove with valid central metadata, one Tree, and loose `notes/old.txt`. */
function looseGrove(): LooseGrove {
  const fx = makeFixture();
  for (const args of [["init"], ["repo", "add", fx.repos[0]!.origin, "--name", "alpha"], ["new", "g", "--all"], ["archive", "g", "--allow-unpushed"], ["restore", "g"]]) {
    const run = fx.grove(args);
    assert.equal(run.status, 0, `${args.join(" ")}: ${run.stderr}\n${run.stdout}`);
  }
  const groveDir = join(fx.root, "groves", "g");
  const tree = join(groveDir, "trees", "g@alpha");
  const metadata = join(fx.root, ".grove", "groves", "g.json");
  assert.ok(existsSync(join(tree, ".git")), "fixture Tree is missing");
  assert.ok(existsSync(metadata), "fixture must carry central metadata so metadataMissing cannot mask the witness");
  const notes = join(groveDir, "notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "old.txt"), "old, consented\n");
  return { fx, groveDir, tree, notes, metadata };
}

function spawnDelete(fixture: LooseGrove, env: Record<string, string>): FaultProcess {
  return spawnFaultProcess(process.execPath, [CLI, "--json", "delete", "g", "--allow-destructive-all"], {
    cwd: fixture.fx.root, env: { ...process.env, HOME: fixture.fx.home, GROVE_ROOT: "/ignored", ...env },
  });
}

/** Pause the forced delete immediately before Git removes the Tree, then run `during`. */
async function pausedDelete(fixture: LooseGrove, during: (command: FaultProcess, gate: GitGate) => Promise<void>): Promise<void> {
  const gate = createGitGate(["worktree", "remove", "--force", "--", fixture.tree]);
  const command = spawnDelete(fixture, gate.env);
  try {
    await waitForGitGate(gate, command);
    await during(command, gate);
  } finally {
    gate.release();
    if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command);
    gate.dispose();
  }
}

/** Ids of the fixture's `grove-delete` operation records. */
function deleteOperations(fixture: LooseGrove): string[] {
  const directory = join(fixture.fx.root, ".grove", "operations");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json") && json(readFileSync(join(directory, name), "utf8")).kind === "grove-delete")
    .map((name) => name.slice(0, -5));
}

/** SIGKILL the forced delete while `git worktree remove` is paused, leaving its record pending. */
async function interruptedDelete(fixture: LooseGrove): Promise<string> {
  await pausedDelete(fixture, async (command) => { await killAndReapFaultProcess(command); });
  const ids = deleteOperations(fixture);
  assert.equal(ids.length, 1, `expected exactly one pending delete operation, found ${ids.join(", ")}`);
  return ids[0]!;
}

const read = (path: string): string | null => existsSync(path) ? readFileSync(path, "utf8") : null;

test("V3DES-10: resumed delete refuses a file added inside a consented loose directory after interruption", async () => {
  const fixture = looseGrove();
  const id = await interruptedDelete(fixture);
  writeFileSync(join(fixture.notes, "new.txt"), "added after the plan\n");

  const reconciled = fixture.fx.grove(["--json", "reconcile"]);
  const target = json(reconciled.stdout).targets.find((candidate: any) => candidate.before?.operationId === id);
  assert.deepEqual(
    {
      newFile: read(join(fixture.notes, "new.txt")),
      oldFile: read(join(fixture.notes, "old.txt")),
      status: reconciled.status,
      reason: target?.reason ?? null,
      metadataRetained: existsSync(fixture.metadata),
    },
    {
      newFile: "added after the plan\n",
      oldFile: "old, consented\n",
      status: 4,
      reason: "stale-plan",
      metadataRetained: true,
    },
    `${reconciled.stderr}\n${reconciled.stdout}`,
  );
  // Both sets are itemized per path, and the added file is named.
  const evidence = target.after.evidence;
  assert.deepEqual(
    { recorded: evidence.recordedLoose, added: evidence.addedLoose },
    { recorded: ["notes/", "notes/old.txt"], added: ["notes/new.txt"] },
  );
  assert.ok(evidence.currentLoose.includes("notes/new.txt") && evidence.currentLoose.includes("notes/old.txt"), JSON.stringify(evidence));
  assert.match(target.detail?.remedy ?? "", new RegExp(`grove reconcile --abandon ${id}`));
});

test("V3DES-10 control: resumed delete removes exactly the recorded loose content and itemizes it per path", async () => {
  const fixture = looseGrove();
  await interruptedDelete(fixture);
  const reconciled = fixture.fx.grove(["--json", "reconcile"]);
  assert.equal(reconciled.status, 0, `${reconciled.stderr}\n${reconciled.stdout}`);
  assert.equal(existsSync(fixture.groveDir), false);
  assert.equal(existsSync(fixture.metadata), false);
  const discarded = json(reconciled.stdout).targets[0].after.discarded.find((item: any) => item.step === "delete-content").evidence;
  assert.deepEqual(
    { recorded: discarded.recordedLoose, discarded: discarded.discardedLoose },
    { recorded: ["notes/", "notes/old.txt"], discarded: ["notes/", "notes/old.txt"] },
  );
});

test("V3DES-10: a pre-fix record naming only a loose directory gives no consent for its descendants", async () => {
  const fixture = looseGrove();
  writeFileSync(join(fixture.groveDir, "NOTES.md"), "top-level loose file\n");
  const id = await interruptedDelete(fixture);
  // Rewrite the pending record to the exact shape f143968 persisted: top-level names only and no
  // per-path inventory. Nothing is added afterwards; the old consent still cannot prove per-file
  // consent for `notes/old.txt`, and no inventory may be manufactured from current content.
  const file = join(fixture.fx.root, ".grove", "operations", `${id}.json`);
  const record = json(readFileSync(file, "utf8"));
  const legacy = (step: any) => {
    if (step.id !== "delete-content") return;
    delete step.input.looseInventory;
    step.input.discardedLoose = ["NOTES.md", "notes"];
  };
  for (const target of record.targets) for (const step of target.steps) legacy(step);
  for (const step of record.steps) legacy(step);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  const reconciled = fixture.fx.grove(["--json", "reconcile"]);
  const target = json(reconciled.stdout).targets.find((candidate: any) => candidate.before?.operationId === id);
  assert.deepEqual(
    {
      oldFile: read(join(fixture.notes, "old.txt")),
      topLevelFile: read(join(fixture.groveDir, "NOTES.md")),
      status: reconciled.status,
      reason: target?.reason ?? null,
      legacy: target?.after?.evidence?.legacyLooseConsent ?? null,
      unconsented: target?.after?.evidence?.addedLoose ?? null,
    },
    {
      oldFile: "old, consented\n",
      topLevelFile: "top-level loose file\n",
      status: 4,
      reason: "stale-plan",
      legacy: true,
      unconsented: ["notes/old.txt"],
    },
    `${reconciled.stderr}\n${reconciled.stdout}`,
  );
  assert.match(target.detail.remedy, new RegExp(`grove reconcile --abandon ${id}`));
  assert.match(target.detail.remedy, /grove delete g --allow-destructive-all/);

  // The remedy works: abandon, then a fresh forced delete records and removes a per-path set.
  assert.equal(fixture.fx.grove(["--json", "reconcile", "--abandon", id]).status, 0);
  const deleted = fixture.fx.grove(["--json", "delete", "g", "--allow-destructive-all"]);
  assert.equal(deleted.status, 0, `${deleted.stderr}\n${deleted.stdout}`);
  // The Tree was removed before the refusal, so its empty `trees/` container is loose content now.
  assert.deepEqual(json(deleted.stdout).targets[0].after.discardedLoose, ["NOTES.md", "notes/", "notes/old.txt", "trees/"]);
  assert.equal(existsSync(fixture.groveDir), false);
});

test("V3DES-09: direct delete refuses a file added inside a consented loose directory before removal", async () => {
  const fixture = looseGrove();
  let closed: { code: number | null } = { code: null };
  let stdout = "";
  await pausedDelete(fixture, async (command, gate) => {
    // The plan and its consent are durable and the Tree removal has not run yet: this is the
    // window between the plan/consent point and the recursive removal in one delete run.
    assert.equal(deleteOperations(fixture).length, 1);
    writeFileSync(join(fixture.notes, "new.txt"), "added after the plan\n");
    gate.release();
    closed = await command.closed;
    stdout = command.stdout();
  });
  const result = json(stdout);
  assert.deepEqual(
    {
      newFile: read(join(fixture.notes, "new.txt")),
      oldFile: read(join(fixture.notes, "old.txt")),
      status: closed.code,
      reason: result.targets?.[0]?.reason ?? null,
      treeRemoved: !existsSync(fixture.tree),
      metadataRetained: existsSync(fixture.metadata),
    },
    {
      newFile: "added after the plan\n",
      oldFile: "old, consented\n",
      status: 4,
      reason: "stale-plan",
      treeRemoved: true,
      metadataRetained: true,
    },
    stdout,
  );
  assert.deepEqual(result.targets[0].before.addedLoose, ["notes/new.txt"]);
  assert.deepEqual(result.targets[0].before.recordedLoose, ["notes/", "notes/old.txt"]);
});

test("V3DES-09 control: an uninterrupted forced delete removes loose content and itemizes it per path", () => {
  const fixture = looseGrove();
  writeFileSync(join(fixture.groveDir, "NOTES.md"), "top-level loose file\n");
  mkdirSync(join(fixture.notes, "empty"));
  const deleted = fixture.fx.grove(["--json", "delete", "g", "--allow-destructive-all"]);
  assert.equal(deleted.status, 0, `${deleted.stderr}\n${deleted.stdout}`);
  assert.deepEqual(json(deleted.stdout).targets[0].after.discardedLoose, ["NOTES.md", "notes/", "notes/empty/", "notes/old.txt"]);
  assert.equal(existsSync(fixture.groveDir), false);
  const human = looseGrove();
  const run = human.fx.grove(["delete", "g", "--allow-destructive-all"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /notes\/old\.txt/);
});

test("V3DES-09 control: the refusal without consent itemizes loose content per path", () => {
  const fixture = looseGrove();
  const refused = fixture.fx.grove(["--json", "delete", "g"]);
  assert.equal(refused.status, 5, refused.stdout);
  assert.deepEqual(json(refused.stdout).error.detail.loose, ["notes/", "notes/old.txt"]);
  assert.equal(read(join(fixture.notes, "old.txt")), "old, consented\n");
});

test("V3DES-09: loose content past the inventory bound is refused, never consented", () => {
  const fixture = looseGrove();
  const bulk = join(fixture.notes, "bulk");
  mkdirSync(bulk);
  for (let index = 0; index < 10_000; index++) writeFileSync(join(bulk, `f${index}`), "");
  const before = deleteOperations(fixture).length;
  const refused = fixture.fx.grove(["--json", "delete", "g", "--allow-destructive-all"]);
  const error = json(refused.stdout).error;
  assert.deepEqual(
    { status: refused.status, operations: deleteOperations(fixture).length - before, oldFile: read(join(fixture.notes, "old.txt")), treeKept: existsSync(fixture.tree), incomplete: error?.detail?.looseInventoryIncomplete?.length ?? 0 },
    { status: 5, operations: 0, oldFile: "old, consented\n", treeKept: true, incomplete: 1 },
    refused.stdout,
  );
  assert.match(error.why, /more than 10000 loose entries/);
});
