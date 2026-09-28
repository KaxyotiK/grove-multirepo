import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanupTempDirs } from "../testkit/tmp.ts";
import { makeFixture } from "../testkit/fixture.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text);

test("REPO-14/REPO-16: an occupied managed anchor refuses before Git or registration mutation", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const occupied = join(fx.root, "repos", "alpha");
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "sentinel"), "keep\n");
  const before = readFileSync(join(fx.root, ".grove", "config.json"), "utf8");
  const result = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  // Consolidated: refuses, leaves the occupant untouched, writes no config. Three obligations
  // previously rested on the config equality alone, including one about naming the occupied path.
  // ASSERT:REPO-14:AN-OCCUPIED-ANCHOR-REFUSES-BEFORE-GIT-AND-TOUCHES-NOTHING
  assert.deepEqual(
    {
      status: result.status,
      namesTheOccupiedPath: String(result.stdout + result.stderr).includes(occupied),
      occupantUntouched: readFileSync(join(occupied, "sentinel"), "utf8"),
      configUnchanged: readFileSync(join(fx.root, ".grove", "config.json"), "utf8") === before,
    },
    { status: 4, namesTheOccupiedPath: true, occupantUntouched: "keep\n", configUnchanged: true },
    `${result.stderr}\n${result.stdout}`,
  );
});

test("REPO-15: a missing remote trunk is rejected before an anchor or operation exists", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const result = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha", "--trunk", "missing"]);
  assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
  assert.equal(existsSync(join(fx.root, "repos", "alpha")), false);
  // ASSERT:REPO-15:ROLLBACK-REMOVES-STORE-CREATED-TODAY
  assert.deepEqual(readdirSync(join(fx.root, ".grove", "operations")), []);
});

test("successful repo add publishes a bare anchor, peer trunk, restrictive operation, and no staging clone", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const result = fx.grove(["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const output = json(result.stdout);
  const operation = join(fx.root, ".grove", "operations", `${output.operationId}.json`);
  assert.equal(statSync(operation).mode & 0o777, 0o600);
  assert.equal(statSync(join(fx.root, ".grove", "operations")).mode & 0o777, 0o700);
  assert.equal(json(readFileSync(operation, "utf8")).state, "completed");
  assert.equal(existsSync(join(fx.root, "repos", "alpha", "HEAD")), true);
  assert.equal(existsSync(output.targets[0].after.trunkPath), true);
  assert.equal(readdirSync(join(fx.root, "repos")).some((name) => name.includes("staging")), false);
});
