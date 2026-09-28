import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const SENTINEL = "FAKE-ARGV-SECRET-38c5";
const forms = [
  `https://fixture:${SENTINEL}@example.test/x.git`,
  `ssh://git:${SENTINEL}%40example.test/x.git`,
  `ssh://[x]@[git:${SENTINEL}/@example.test]/x.git`,
];

function stateText(root: string): string {
  const state = join(root, ".grove");
  const walk = (path: string): string => readdirSync(path, { withFileTypes: true }).map((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? readFileSync(child, "utf8") : "";
  }).join("\n");
  return existsSync(state) ? walk(state) : "";
}

test("V3SEC-05/V3SEC-07: malformed command and argv errors redact credentialed URL values in both output modes", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const violations: string[] = [];
  for (const [index, form] of forms.entries()) {
    for (const args of [["repo", "ad", form], ["repo", "ls", form], ["repo", "ls", `--${form}`]]) {
      for (const prefix of [[], ["--json"]]) {
        const result = fx.grove([...prefix, ...args]);
        const output = `${result.stdout}${result.stderr}`;
        if (result.status !== 2 || output.includes(SENTINEL) || stateText(fx.root).includes(SENTINEL) || (prefix.length > 0 && JSON.parse(result.stdout).error?.kind !== "invalid-input")) {
          violations.push(`form=${index} route=${args[1]} mode=${prefix.length ? "json" : "human"} status=${result.status} outputLeak=${output.includes(SENTINEL)}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("V3SEC-05/V3SEC-07: repo link errors never repeat a credentialed URL passed as its path", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const violations: string[] = [];
  for (const [index, form] of forms.entries()) {
    for (const prefix of [[], ["--json"]]) {
      const result = fx.grove([...prefix, "repo", "link", form, "--name", "external"]);
      const leaked = `${result.stdout}${result.stderr}${stateText(fx.root)}`.includes(SENTINEL);
      if (result.status === 0 || leaked || (prefix.length > 0 && typeof JSON.parse(result.stdout).error?.kind !== "string")) {
        violations.push(`form=${index} mode=${prefix.length ? "json" : "human"} status=${result.status} leaked=${leaked}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
