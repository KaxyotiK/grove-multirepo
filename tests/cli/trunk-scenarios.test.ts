import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);
const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function setup(branches: string[] = []) {
  const fx = makeFixture({ repos: { ledger: branches } });
  assert.equal(fx.grove(["init"]).status, 0);
  const added = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "ledger"]);
  assert.equal(added.status, 0, `${added.stderr}\n${added.stdout}`);
  return { fx, anchor: join(fx.root, "repos", "ledger"), initial: json(added.stdout).targets[0].after.trunkPath as string };
}

const trunks = (fx: ReturnType<typeof makeFixture>): any[] => json(fx.grove(["--json", "trunk", "ls", "ledger"]).stdout).detail.trunks;

test("TRUNK-01: repo add creates the readable initial peer trunk without a stored trunks array", () => {
  const { fx, initial } = setup();
  // Consolidated: readable path, checked-out branch, no persisted trunk inventory, exactly one
  // trunk. Three obligations previously rested on the path equality alone.
  // ASSERT:TRUNK-01:REPO-ADD-CREATES-THE-READABLE-PEER-TRUNK-WITH-NO-PERSISTED-INVENTORY
  assert.deepEqual(
    {
      initialPath: initial,
      checkedOutBranch: git(initial, ["branch", "--show-current"]),
      persistsTrunkInventory: "trunks" in json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8")).repositories[0],
      trunkCount: trunks(fx).length,
    },
    { initialPath: join(fx.root, "trunks", "main@ledger"), checkedOutBranch: "main", persistsTrunkInventory: false, trunkCount: 1 },
  );
  const config = json(readFileSync(join(fx.root, ".grove", "config.json"), "utf8"));
  assert.equal("trunks" in config.repositories[0], false);
  assert.equal(trunks(fx).length, 1);
});

test("TRUNK-02: trunk add creates a native peer while workspace policy revision remains unchanged", () => {
  const { fx } = setup(["release/2026.08"]);
  const configPath = join(fx.root, ".grove", "config.json");
  const before = readFileSync(configPath, "utf8");
  const added = fx.grove(["--json", "trunk", "add", "ledger", "release/2026.08"]);
  // Consolidated. NOTE: the config is asserted UNCHANGED here, so the previous
  // `ASSERT:TRUNK-02:CONFIG-UPDATED-UNDER-CAS` marker named the opposite of what this witness
  // observes — schema 3 persists no trunk inventory, which is the point of the row.
  // ASSERT:TRUNK-02:TRUNK-ADD-CREATES-A-NATIVE-PEER-AND-PERSISTS-NO-TRUNK-STATE
  assert.deepEqual(
    {
      status: added.status,
      configUnchanged: readFileSync(configPath, "utf8") === before,
      peerBranch: git(json(added.stdout).targets[0].after.path, ["branch", "--show-current"]),
    },
    { status: 0, configUnchanged: true, peerBranch: "release/2026.08" },
    `${added.stderr}\n${added.stdout}`,
  );
});

test("TRUNK-03: native one-branch/one-worktree refusal replaces Tree/trunk claim metadata", () => {
  const { fx, anchor } = setup();
  assert.equal(fx.grove(["new", "held", "--repo", "ledger", "--branch", "ledger=tree-held", "--from", "ledger=main"]).status, 0);
  assert.equal(fx.grove(["new", "empty", "--all"]).status, 0);
  const beforeRefs = git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)"]);
  const trunkRefused = fx.grove(["--json", "trunk", "add", "ledger", "tree-held"]);
  const treeRefused = fx.grove(["--json", "tree", "add", "empty", "ledger", "--name", "main-claim", "--branch", "main"]);
  const trunkClaimant = json(trunkRefused.stdout).error.detail.claimantPath;
  const treeClaimant = json(treeRefused.stdout).error.detail.claimantPath;
  // ASSERT:TRUNK-03:BOTH-REFUSE-NAME-CLAIMANT
  assert.deepEqual(
    {
      trunkStatus: trunkRefused.status,
      trunkClaimant,
      treeStatus: treeRefused.status,
      treeClaimant,
      refs: git(anchor, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
    },
    {
      trunkStatus: 4,
      trunkClaimant: join(fx.root, "groves", "held", "trees", "held@ledger"),
      treeStatus: 4,
      treeClaimant: join(fx.root, "trunks", "main@ledger"),
      refs: beforeRefs,
    },
  );
});

test("TRUNK-05: dirty and diverged trunks are skipped without reset, rebase, or loss", () => {
  const { fx, anchor, initial } = setup();
  writeFileSync(join(initial, "dirty.txt"), "dirty\n");
  const before = git(initial, ["rev-parse", "HEAD"]);
  const dirty = fx.grove(["--json", "trunk", "sync", "ledger"]);
  const dirtyOutcome = { status: dirty.status, reason: json(dirty.stdout).targets[0].reason, head: git(initial, ["rev-parse", "HEAD"]), filePresent: existsSync(join(initial, "dirty.txt")) };
  unlinkSync(join(initial, "dirty.txt"));
  git(initial, ["config", "user.email", "trunk@grove.test"]);
  git(initial, ["config", "user.name", "Trunk Test"]);
  writeFileSync(join(initial, "local.txt"), "local\n");
  git(initial, ["add", "local.txt"]);
  git(initial, ["commit", "-qm", "local advance"]);
  const localOid = git(initial, ["rev-parse", "HEAD"]);
  const seed = join(fx.root, "..", "diverged-seed");
  git(join(seed, ".."), ["clone", "-q", fx.repos[0]!.origin, seed]);
  git(seed, ["config", "user.email", "trunk@grove.test"]);
  git(seed, ["config", "user.name", "Trunk Test"]);
  writeFileSync(join(seed, "remote.txt"), "remote\n");
  git(seed, ["add", "remote.txt"]);
  git(seed, ["commit", "-qm", "remote advance"]);
  git(seed, ["push", "-q", "origin", "HEAD:main"]);
  const diverged = fx.grove(["--json", "trunk", "sync", "ledger"]);
  const divergedResult = json(diverged.stdout).targets[0];
  // ASSERT:TRUNK-05:BOTH-SKIPPED
  assert.deepEqual(
    { dirtyStatus: dirtyOutcome.status, divergedStatus: diverged.status },
    { dirtyStatus: 5, divergedStatus: 5 },
  );
  // ASSERT:TRUNK-05:REPORTED-BY-STATE
  assert.deepEqual(
    { dirtyReason: dirtyOutcome.reason, divergedReason: divergedResult.reason },
    { dirtyReason: "dirty", divergedReason: "diverged" },
  );
  // ASSERT:TRUNK-05:NEITHER-REBASED-RESET-OR-LOST
  assert.deepEqual(
    {
      dirtyHead: dirtyOutcome.head,
      dirtyFilePresent: dirtyOutcome.filePresent,
      divergedHead: git(initial, ["rev-parse", "HEAD"]),
      localFilePresent: existsSync(join(initial, "local.txt")),
    },
    { dirtyHead: before, dirtyFilePresent: true, divergedHead: localOid, localFilePresent: true },
  );
});

test("TRUNK-06/TRUNK-07: every peer trunk uses the same dirty-removal contract and retains its branch", () => {
  const { fx, anchor, initial } = setup(["release"]);
  const cleanAdded = fx.grove(["--json", "trunk", "add", "ledger", "release"]);
  const cleanPath = json(cleanAdded.stdout).targets[0].after.path;
  const cleanOid = git(anchor, ["rev-parse", "refs/heads/release"]);
  const configBefore = readFileSync(join(fx.root, ".grove", "config.json"), "utf8");
  const cleanRemoved = fx.grove(["trunk", "remove", "ledger", "release"]);
  // ASSERT:TRUNK-07:SUCCEEDS-WHEN-CLEAN-LEAVES-BRANCH-REF-REPOSITORY-POLICY
  assert.deepEqual(
    { status: cleanRemoved.status, worktreePresent: existsSync(cleanPath), retainedOid: git(anchor, ["rev-parse", "refs/heads/release"]), config: readFileSync(join(fx.root, ".grove", "config.json"), "utf8") },
    { status: 0, worktreePresent: false, retainedOid: cleanOid, config: configBefore },
  );
  writeFileSync(join(initial, "dirty.txt"), "dirty\n");
  const refused = fx.grove(["trunk", "remove", "ledger", "main"]);
  const oid = git(anchor, ["rev-parse", "refs/heads/main"]);
  const forced = fx.grove(["trunk", "remove", "ledger", "main", "--allow-destructive-all"]);
  // ASSERT:TRUNK-06:REFUSES-FIRST-FORCED-REMOVAL-WARNS-CHANGE-DESTRUCTIVE-REMOVES
  assert.deepEqual(
    { refusedStatus: refused.status, forcedStatus: forced.status, worktreePresent: existsSync(initial), retainedOid: git(anchor, ["rev-parse", "refs/heads/main"]) },
    { refusedStatus: 5, forcedStatus: 0, worktreePresent: false, retainedOid: oid },
  );
});

test("TRUNK-08: a fetched remote-only branch becomes a tracking local peer trunk", () => {
  const { fx, anchor } = setup(["remote-trunk"]);
  const added = fx.grove(["--json", "trunk", "add", "ledger", "remote-trunk"]);
  // ASSERT:TRUNK-08:CREATES-LOCAL-BRANCH-REMOTE-TRACKING-REF-UPSTREAM-CONFIGURED
  assert.deepEqual(
    { status: added.status, branch: git(json(added.stdout).targets[0].after.path, ["branch", "--show-current"]), upstream: git(anchor, ["for-each-ref", "--format=%(upstream:short)", "refs/heads/remote-trunk"]), worktreePresent: existsSync(json(added.stdout).targets[0].after.path) },
    { status: 0, branch: "remote-trunk", upstream: "origin/remote-trunk", worktreePresent: true },
  );
});

test("TRUNK-09: readable allocation hashes only the colliding branch's canonical full ref", () => {
  const { fx } = setup(["feature/a", "feature_a"]);
  for (const branch of ["feature/a", "feature_a"]) assert.equal(fx.grove(["trunk", "add", "ledger", branch]).status, 0);
  const paths = trunks(fx).filter((trunk) => ["refs/heads/feature/a", "refs/heads/feature_a"].includes(trunk.branch.value)).map((trunk) => trunk.path.value);
  assert.equal(paths.length, 2);
  assert.equal(new Set(paths.map((path) => path.toLowerCase())).size, 2);
  assert.ok(paths.includes(join(fx.root, "trunks", "feature_a@ledger")));
  const suffix = createHash("sha256").update(Buffer.from("refs/heads/feature_a")).digest("hex").slice(0, 8);
  // ASSERT:TRUNK-09:THE-SECOND-DIRECTORY-GETS-THE-SHORTEST-UNIQUE-TRUNK
  assert.deepEqual(
    { count: paths.length, uniqueCaseFolded: new Set(paths.map((path) => path.toLowerCase())).size, readablePresent: paths.includes(join(fx.root, "trunks", "feature_a@ledger")), hashedCollisionPresent: paths.includes(join(fx.root, "trunks", `feature_a@ledger~${suffix}`)) },
    { count: 2, uniqueCaseFolded: 2, readablePresent: true, hashedCollisionPresent: true },
  );
});

test("truncated trunk allocations carry the canonical full-ref hash suffix", () => {
  const branch = "x".repeat(110);
  const { fx } = setup([branch]);
  const added = fx.grove(["--json", "trunk", "add", "ledger", branch]);
  assert.equal(added.status, 0, `${added.stderr}\n${added.stdout}`);
  const suffix = createHash("sha256").update(Buffer.from(`refs/heads/${branch}`)).digest("hex").slice(0, 8);
  assert.equal(json(added.stdout).targets[0].after.path, join(fx.root, "trunks", `${"x".repeat(96)}@ledger~${suffix}`));
});

test("a registered historical v1 ULID-suffixed trunk remains observable without a live trunk array", () => {
  const { fx, anchor } = setup(["legacy/a"]);
  const path = join(fx.root, "trunks", "legacy_a@ledger~01K9F3Q2");
  git(anchor, ["branch", "legacy/a", "origin/legacy/a"]);
  git(anchor, ["worktree", "add", "-q", path, "legacy/a"]);
  const observed = trunks(fx).find((trunk) => trunk.branch.value === "refs/heads/legacy/a");
  assert.equal(observed.path.value, path);
  assert.equal(observed.role, "trunk");
});

test("TRUNK-10/TRUNK-11: every linked trunk mutation, including preferred-trunk removal, refuses before refs or worktree registrations change", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "link", fx.repos[0]!.origin, "--name", "linked", "--base", "main"]).status, 0);
  const before = `${git(fx.repos[0]!.origin, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(fx.repos[0]!.origin, ["worktree", "list", "--porcelain"])}`;
  for (const args of [["trunk", "add", "linked", "future", "--from", "main"], ["trunk", "remove", "linked", "main"], ["trunk", "sync", "linked"]]) {
    const result = fx.grove(args);
    // ASSERT:TRUNK-10:BOTH-SUCCEED-MATERIAL-CLAUSE
    // ASSERT:TRUNK-11:SUCCEEDS-MATERIAL-CLAUSE
    assert.deepEqual(
      {
        refused: result.status !== 0,
        advisoryReason: /linked|advisory/i.test(result.stderr + result.stdout),
        gitSnapshot: `${git(fx.repos[0]!.origin, ["for-each-ref", "--format=%(refname)%00%(objectname)"])}\n${git(fx.repos[0]!.origin, ["worktree", "list", "--porcelain"])}`,
      },
      { refused: true, advisoryReason: true, gitSnapshot: before },
    );
  }
});
