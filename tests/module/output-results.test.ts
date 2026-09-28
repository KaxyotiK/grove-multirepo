import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EXIT_BY_REASON,
  commandResultExit,
  redactRemote,
  sortResultTargets,
  type CommandResultV1,
} from "../../src/model/result.ts";

const result = (outcome: CommandResultV1["outcome"], reasons: Array<string | null>): CommandResultV1 => ({
  schemaVersion: 1,
  command: "sync",
  outcome,
  targets: reasons.map((reason, i) => ({
    selector: { repositoryId: `r${reasons.length - i}` },
    before: null,
    action: "sync",
    after: null,
    reason,
  })),
  diagnostics: [],
});

test("targets have deterministic selector ordering", () => {
  assert.deepEqual(sortResultTargets(result("complete", [null, null]).targets).map((t) => t.selector.repositoryId), ["r1", "r2"]);
});

test("needs-user preserves outcome while a higher classified failure wins exit", () => {
  assert.equal(commandResultExit(result("needs-user", ["sequencer-active"])), 5);
  assert.equal(commandResultExit(result("needs-user", ["sequencer-active", "io-failed"])), 7);
});

test("missing-revision is a stable exit-5 target precondition", () => {
  assert.equal(commandResultExit(result("blocked", ["missing-revision"])), 5);
});

test("remote redaction strips parseable credentials and fully masks unparseable URL-like input", () => {
  // Userinfo by Git's reading masks the whole value; see the backslash test below for why.
  assert.equal(redactRemote("https://user:secret@example.test/repo.git?token=x#frag"), "<redacted-remote>");
  assert.equal(redactRemote("https://user:%zz@example.test/repo"), "<redacted-remote>");
});

test("json-results-v1's stable reason table and the exit classification agree in both directions", () => {
  const contract = readFileSync(new URL("../../specs/003-git-native-grove/contracts/json-results-v1.md", import.meta.url), "utf8");
  const section = contract.slice(contract.indexOf("Stable target reasons"), contract.indexOf("Overall exit uses"));
  const rows = new Map<string, string>();
  for (const line of section.split("\n").filter((row) => row.startsWith("| `"))) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    for (let i = 0; i + 1 < cells.length; i += 2) if (cells[i]) rows.set(cells[i]!.replace(/`/g, ""), cells[i + 1]!);
  }
  const classified = [...rows].filter(([, exit]) => /^\d/.test(exit)).map(([reason, exit]) => [reason, Number.parseInt(exit, 10)] as const);
  const passthrough = [...rows].filter(([, exit]) => !/^\d/.test(exit)).map(([reason]) => reason);
  assert.deepEqual(
    {
      // Every classified row is what a single target with that reason exits with.
      mismatched: classified.filter(([reason, exit]) => commandResultExit(result("partial", [reason])) !== exit),
      // Every reason the classification knows is documented.
      undocumented: Object.keys(EXIT_BY_REASON).filter((reason) => !rows.has(reason)),
      // A reason whose exit is not classified must not have a classification.
      passthroughClassified: passthrough.filter((reason) => reason in EXIT_BY_REASON),
      // Reasons emitted by `agent run` and `reconcile` that the table used to omit.
      documented: ["agent-failed", "unsupported-step"].filter((reason) => rows.has(reason)),
    },
    { mismatched: [], undocumented: [], passthroughClassified: [], documented: ["agent-failed", "unsupported-step"] },
  );
});

test("remote redaction never echoes userinfo Git would find, even where WHATWG disagrees", () => {
  // WHATWG treats "\\" as "/" in special schemes, so `http://TOKEN\\@host` parsed with TOKEN as
  // the host. Git and curl end the authority only at / ? #, so the token is userinfo.
  const inputs = [
    "http://SECRET3\\@127.0.0.1:9/x.git",
    "https://SECRET3:pw\\@example.test/x.git",
    "https://example.test\\SECRET3@x/y.git",
    "https://SECRET3@example.test/x.git",
    "web:SECRET3:pw@example.test/x.git",
    "a::b::c::http://SECRET3@example.test/x.git",
    "http::SECRET3@example.test/x.git",
    "ssh://git:SECRET3@example.test/x.git",
    "ssh://git:SECRET3?@example.test/x.git",
    "ssh://git:SECRET3#@example.test/x.git",
    "ssh://git:SECRET3%40127.0.0.1/x.git",
    "ssh://git%3ASECRET3%40127.0.0.1/x.git",
    "ssh://[git:SECRET3/@127.0.0.1]/x.git",
    "ssh://%5Bgit:SECRET3/@127.0.0.1%5D/x.git",
    "[git:SECRET3/@127.0.0.1]:/x.git",
    "[git:SECRET3@127.0.0.1]:/x.git",
    "ssh://[x]@[git:SECRET3/@host]/x.git",
    "[x]@[git:SECRET3:@host]:/x.git",
    "ssh://[a]b@[c/d:SECRET3@e]/x.git",
    "ssh://[]@[/SECRET3:@[]:@:/x.git",
    "http:///SECRET3@example.test/x.git",
  ];
  assert.deepEqual(inputs.map(redactRemote).filter((out) => /SECRET3/i.test(out)), []);
  assert.equal(redactRemote("https://example.test/acme/api.git?token=x#frag"), "https://example.test/acme/api.git");
});

test("plain scp echo requires exactly one @ and brackets only an IPv6 literal host", () => {
  assert.deepEqual(
    ["SEC@h@22git:/x.git", "[SEC@h]:/x.git"].map(redactRemote),
    ["<redacted-remote>", "<redacted-remote>"],
  );
  assert.equal(redactRemote("git@[::1]:x"), "git@[::1]:x");
});

test("remote redaction echoes an SSH remote verbatim, user name included (FR-011)", () => {
  // An SSH user name is not a secret and Git stores it as typed; dropping it would change the login.
  assert.deepEqual(
    ["ssh://git@github.com/org/x.git", "git@github.com:org/x.git", "git+ssh://deploy@example.test:2222/x.git"].map(redactRemote),
    ["ssh://git@github.com/org/x.git", "git@github.com:org/x.git", "git+ssh://deploy@example.test:2222/x.git"],
  );
  assert.deepEqual(["ssh://git:pw@github.com/org/x.git", "ssh://git@github.com\\x/y.git", "git@github.com:org/x\u0007.git"].map(redactRemote), ["<redacted-remote>", "<redacted-remote>", "<redacted-remote>"]);
});

test("a plain SSH remote URL is echoed without its query and fragment, like every parsed URL", () => {
  assert.equal(redactRemote("ssh://git@github.com/org/x.git?ref=a#frag"), "ssh://git@github.com/org/x.git");
});
