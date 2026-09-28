import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkRemoteCredentials } from "../../src/model/validate.ts";
import { redactRemote } from "../../src/model/result.ts";

/** `--diag-url` asks the installed Git to parse the SSH destination without contacting it. */
function gitLogin(remote: string): string | null {
  const result = spawnSync("git", ["fetch-pack", "--diag-url", remote], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(result.status, 0, `git fetch-pack --diag-url exited ${result.status}`);
  const field = result.stdout.match(/^Diag: userandhost=(.*)$/m)?.[1];
  assert.ok(field, "Git did not report userandhost");
  const at = field.lastIndexOf("@");
  return at < 0 ? null : field.slice(0, at);
}

test("V3SEC-05: SSH credential decisions match local Git fetch-pack --diag-url login parsing", () => {
  const cases: Array<[remote: string, login: string | null, refused: boolean]> = [
    ["git@github.com:org/repo.git", "git", false],
    ["ssh://git@host:2222/x.git", "git", false],
    ["ssh://git@[::1]:22/x.git", "git", false],
    ["[git@::1]:x.git", "git", false],
    ["git@[::1]:x.git", "git", false],
    ["ssh://[::1]/x.git", null, false],
    ["ssh://git@host/a%20b.git", "git", false],
    ["ssh://git:FAKE%40127.0.0.1/x.git", "git:FAKE", true],
    ["ssh://git%3AFAKE%40127.0.0.1/x.git", "git:FAKE", true],
    ["ssh://[x]@[git:FAKE/@127.0.0.1]/x.git", "[x]@git:FAKE/", true],
    ["[x]@[git:FAKE:@127.0.0.1]:/x.git", "[x]@git:FAKE:", true],
    ["ssh://[a]b@[c/d:FAKE@e]/x.git", "[a]b@c/d:FAKE", true],
    ["ssh://[]@[/FAKE:@[]:@:/x.git", "[]@/FAKE:", true],
    ["git#FAKE@h%2Fx:/x.git", "git#FAKE", true],
  ];
  const mismatches: string[] = [];
  for (const [index, [remote, expectedLogin, refused]] of cases.entries()) {
    const login = gitLogin(remote);
    assert.equal(login, expectedLogin, `Git login for case ${index}`);
    const actualRefusal = checkRemoteCredentials(remote) !== null;
    if (actualRefusal !== refused) mismatches.push(`case=${index} Git credential=${refused} Grove refusal=${actualRefusal}`);
    if (refused && redactRemote(remote) !== "<redacted-remote>") mismatches.push(`case=${index} redaction missed Git login`);
  }
  assert.deepEqual(mismatches, []);
});
