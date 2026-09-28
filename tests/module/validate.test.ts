import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkGroveName,
  checkRepoName,
  assertGroveName,
  checkBranchName,
  assertBranchName,
  caseFoldKey,
  checkPathLimits,
  checkRemoteCredentials,
} from "../../src/model/validate.ts";
import { GroveError } from "../../src/errors.ts";

test("Grove names: §5.2 grammar, mixed case allowed", () => {
  assert.equal(checkGroveName("pricing-fix"), null);
  assert.equal(checkGroveName("Pricing_Fix.2"), null, "uppercase is permitted (case-folded uniqueness)");
  assert.ok(checkGroveName(""), "empty rejected");
  assert.ok(checkGroveName(".hidden"), "leading dot rejected (reserved)");
  assert.ok(checkGroveName("-flag"), "leading dash rejected (argv safety)");
  assert.ok(checkGroveName("a/b"), "path separator rejected");
  assert.ok(checkGroveName("a:b"), "colon rejected");
  assert.ok(checkGroveName("a".repeat(65)), "over 64 bytes rejected");
});

test("repository names: 48-byte limit", () => {
  assert.equal(checkRepoName("ledger"), null);
  assert.ok(checkRepoName("a".repeat(49)), "over 48 bytes rejected");
});

test("case-fold key folds ASCII case for uniqueness", () => {
  assert.equal(caseFoldKey("Feature_A"), caseFoldKey("feature_a"));
});

test("assertGroveName throws a GroveError with a remedy", () => {
  try {
    assertGroveName("bad/name");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(GroveError.is(e));
    assert.equal((e as GroveError).kind, "invalid-input");
    assert.ok((e as GroveError).remedy.length > 0);
  }
});

test("branch names: argv safety and git ref-format", () => {
  assert.equal(checkBranchName("feature/pricing"), null);
  assert.equal(checkBranchName("release/2026.08"), null);
  assert.ok(checkBranchName("--allow-destructive-all"), "a flag-like branch is refused (security case)");
  assert.ok(checkBranchName("HEAD"), "a git revision is refused (would detach)");
  assert.ok(checkBranchName("a".repeat(40).replace(/./g, "a")), "sha-like is handled");
  assert.ok(checkBranchName("deadbeef"), "sha-like hex is refused (would detach)");
  assert.ok(checkBranchName("has space"), "space refused");
  assert.ok(checkBranchName("has~tilde"), "tilde refused");
  assert.ok(checkBranchName("dot..dot"), '".." refused');
  assert.ok(checkBranchName("ends/"), "trailing slash refused");
  assert.ok(checkBranchName(".hidden/branch"), "dot-leading component refused");
  assert.ok(checkBranchName("x.lock"), '".lock" refused');
});

test("assertBranchName throws for a flag-like name", () => {
  assert.throws(() => assertBranchName("-x"), (e) => GroveError.is(e));
});

test("path limits reject an over-long total path", () => {
  assert.equal(checkPathLimits("groves/x/trees/main@ledger"), null);
  assert.ok(checkPathLimits("a".repeat(1100)), "over 1024 bytes rejected");
});

test("P2.10: the path-limit guard is wired into every worktree-allocating command", () => {
  // The guard itself was already unit-tested; what was missing was any CALLER. It is now invoked
  // by all four allocation sites (`new`, `tree add`, `trunk add`, `repo add`).
  //
  // Deliberately asserted here rather than through the CLI: on macOS the reachable failure cannot
  // be provoked end to end, because the OS enforces PATH_MAX=1024 when creating the workspace and
  // git enforces its own ref-name limit on long branches — both fire before grove's check. The
  // wiring still matters on platforms with a larger PATH_MAX, and it turns an incidental
  // ENAMETOOLONG into a refusal that names the rule; it is simply not CLI-demonstrable here.
  const sources = ["grove.ts", "tree.ts", "trunk.ts", "repo.ts"].map((f) =>
    readFileSync(new URL(`../../src/commands/${f}`, import.meta.url), "utf8"),
  );
  for (const [i, src] of sources.entries()) {
    assert.match(src, /assertPathLimits\(/, `src/commands/${["grove.ts", "tree.ts", "trunk.ts", "repo.ts"][i]} allocates a worktree but never checks path limits`);
  }
  // And every allocateDir call is paired with a check.
  for (const [i, src] of sources.entries()) {
    const allocs = (src.match(/allocateDir\(/g) ?? []).length;
    const checks = (src.match(/assertPathLimits\(/g) ?? []).length;
    assert.ok(checks >= allocs, `${["grove.ts", "tree.ts", "trunk.ts", "repo.ts"][i]}: ${allocs} allocateDir call(s) but only ${checks} path check(s)`);
  }
});

test("remote URL credentials: userinfo is refused except an SSH account name (V3SEC-05)", () => {
  const refused = [
    "https://alice:TOKEN@github.com/acme/api.git",
    "https://TOKEN@github.com/acme/api.git",
    "HTTPS://TOKEN@github.com/acme/api.git",
    "http://alice:hunter2@127.0.0.1:8080/api.git",
    "https::https://TOKEN@github.com/acme/api.git",
    "ftp://alice:hunter2@example.test/api.git",
    "ftps://alice@example.test/api.git",
    "git://TOKEN@example.test/api.git",
    "file://alice@localhost/srv/api.git",
    "ssh://git:hunter2@github.com/acme/api.git",
    "git+ssh://git:hunter2@github.com/acme/api.git",
    // curl collapses extra slashes after the scheme and still sends the userinfo.
    "http:///TOKEN:hunter2@127.0.0.1:8080/api.git",
    "https:///TOKEN@github.com/acme/api.git",
    "https:////TOKEN@github.com/acme/api.git",
    "https:\\\\TOKEN@github.com/acme/api.git",
    // Git and curl end the authority only at / ? #, so a backslash before "@" is still userinfo.
    "https://TOKEN\\@github.com/acme/api.git",
    "https://TOKEN:hunter2\\@github.com/acme/api.git",
    "HTTP://x:TOKEN\\@127.0.0.1:8080/api.git",
    "ftp://TOKEN\\@example.test/api.git",
    "http::http://TOKEN\\@example.test/api.git",
    // Every <transport>:: prefix is stripped, and a helper address without "://" is scheme-guessed
    // by curl, so an "@" before its first "/" is userinfo.
    "a::b::c::http://TOKEN@example.test/api.git",
    "http::TOKEN@127.0.0.1:9/api.git",
    "https::alice:hunter2@example.test/api.git",
    // "://" later in a helper address does not make it a URL: curl still scheme-guesses the head.
    "http::TOKEN@example.test/api.git/a://../..",
    "http::TOKEN@example.test/api.git?u=http://y",
    // A percent-encoded ':' is a password in an SSH user name's clothing.
    "ssh://git%3ATOKEN@github.com/acme/api.git",
    // Git's SSH transport keeps reading the login through ?/# up to the first path slash.
    "ssh://git:TOKEN?@github.com/acme/api.git",
    "ssh://git:TOKEN#@github.com/acme/api.git",
    // Git percent-decodes before parsing the SSH login and skips slashes inside brackets.
    "ssh://git:TOKEN%40127.0.0.1/acme/api.git",
    "ssh://git%3ATOKEN%40127.0.0.1/acme/api.git",
    "ssh://[git:TOKEN/@127.0.0.1]/acme/api.git",
    "ssh://%5Bgit:TOKEN/@127.0.0.1%5D/acme/api.git",
    "[git:TOKEN/@127.0.0.1]:/acme/api.git",
    "[git:TOKEN@127.0.0.1]:/acme/api.git",
    // Git's host_end prefers the first "@[" over a leading bracket.
    "ssh://[x]@[git:TOKEN/@host]/x.git",
    "[x]@[git:TOKEN:@host]:/x.git",
    "ssh://[a]b@[c/d:TOKEN@e]/x.git",
    "ssh://[]@[/TOKEN:@[]:@:/x.git",
    // Git does not percent-decode scp-like input before reading its login.
    "git#TOKEN@h%2Fx:/x.git",
  ];
  const accepted = [
    "git@github.com:acme/api.git",
    "ssh://git@github.com/acme/api.git",
    "git+ssh://git@github.com/acme/api.git",
    "ssh+git://deploy@example.test:2222/api.git",
    "https://github.com/acme/api.git",
    "https://github.com/acme/api@v2.git",
    "https://github.com/acme/api.git?ref=a@b",
    "https://@github.com/acme/api.git",
    "file:///srv/api.git",
    "file:///srv/a@b/api.git",
    "/srv/api.git",
    "/srv/a@b/api.git",
    "../api.git",
    "../team@2/api.git",
    "host:path@with-at.git",
    // Git reads a single slash after `host:` as scp-like SSH and never hands it to curl.
    "myhost:/team@2/api.git",
    "git.example.com:/srv@x/api.git",
    "host:\\a@b",
    "http::https://example.test/api.git",
    "http::example.test/api.git",
    "ssh://git@[::1]:22/x",
    "[git@::1]:x",
    "ssh://[git@::1]:22/x",
    "git@[::1]:x",
    "ssh://[::1]/x",
    "[::1]:x",
    "git@github.com:org/repo.git",
    "ssh://git@host:2222/x",
    "ssh://git@host/a%20b.git",
  ];
  assert.deepEqual(refused.filter((remote) => checkRemoteCredentials(remote) === null), [], "refused forms accepted");
  assert.deepEqual(accepted.filter((remote) => checkRemoteCredentials(remote) !== null), [], "accepted forms refused");
  for (const remote of refused) assert.doesNotMatch(JSON.stringify(checkRemoteCredentials(remote)), /TOKEN|hunter2|alice/, remote);
});
