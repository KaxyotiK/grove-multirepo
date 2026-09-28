/**
 * Ruling ⑥ (P1.3, ledger E-7). There is no N-1 compatibility and no migration path, so refusing a
 * foreign-schema workspace is correct — but the refusal has to be diagnosable. This finding came
 * from a real session in which several Grove builds were installed and the error named none of
 * them, so there was no way to tell which binary had refused.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

function skewedWorkspace(schemaVersion: number) {
  const fx = makeFixture();
  mkdirSync(join(fx.root, ".grove"), { recursive: true });
  writeFileSync(
    join(fx.root, ".grove", "config.json"),
    `${JSON.stringify({ kind: "workspace", schemaVersion, _rev: 0, id: "ws", name: "workspace", defaults: {}, agents: {}, repositories: [] }, null, 2)}\n`,
  );
  return fx;
}

test("V3VER-01: a schema-mismatched workspace names the running binary, its path, and both schema versions", () => {
  const fx = skewedWorkspace(2);
  const result = fx.grove(["--json", "ls"]);
  const error = JSON.parse(result.stdout.trim()).error;
  const detail = error.detail as Record<string, unknown>;
  const human = fx.grove(["ls"]);

  assert.deepEqual(
    {
      status: result.status,
      kind: error.kind,
      runningVersion: typeof detail.runningVersion === "string" && detail.runningVersion.length > 0,
      executableNamesGrove: /grove(\.mjs)?$/.test(String(detail.executablePath)),
      workspaceSchema: detail.workspaceSchema,
      supported: detail.supported,
      humanNamesVersion: String(human.stderr).includes(String(detail.runningVersion)),
      humanNamesPath: String(human.stderr).includes(String(detail.executablePath)),
      humanNamesBothSchemas:
        /\b2\b/.test(String(human.stderr)) && /\b3\b/.test(String(human.stderr)),
    },
    {
      status: 9,
      kind: "version-skew",
      runningVersion: true,
      executableNamesGrove: true,
      workspaceSchema: 2,
      supported: 3,
      humanNamesVersion: true,
      humanNamesPath: true,
      humanNamesBothSchemas: true,
    },
  );
});

test("V3VER-01: the refusal carries no migration remedy, because there is no migration", () => {
  const fx = skewedWorkspace(1);
  const result = fx.grove(["--json", "ls"]);
  const error = JSON.parse(result.stdout.trim()).error;
  // A schema-1 workspace used to be told to run `grove migrate --dry-run`, a command that no
  // longer exists. A remedy naming an unreachable command is worse than no remedy.
  assert.equal(result.status, 9);
  assert.doesNotMatch(String(error.remedy), /migrat/i);
});
