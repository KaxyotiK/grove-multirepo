import assert from "node:assert/strict";
import { test } from "node:test";
import { nativePathFromBytes, refNameFromBytes, valueBytesJson } from "../../src/model/encoding.ts";
import { Git, parseWorktreePorcelainZ, type GitRunner } from "../../src/git/adapter.ts";
import { porcelainStatus, porcelainStatusRaw } from "../../src/git/worktree.ts";
import { assertNoNestedGitOwnership } from "../../src/paths/fs.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("V3DES-01 round6: ignored file inventory preserves non-UTF8 bytes and text fallback lists children", async () => {
  const rawName = Buffer.concat([Buffer.from("ignored/raw-"), Buffer.from([0xff]), Buffer.from(".txt")]);
  const ignoredBytes = Buffer.concat([rawName, Buffer.from("\0ignored/valid.txt\0")]);
  const statusBytes = Buffer.from("?? ordinary.txt\0");
  const raw = new Git({
    async run() { throw new Error("raw runner must be used"); },
    async runBytes(_cwd, args) { return { stdout: args[0] === "status" ? statusBytes : ignoredBytes, stderr: new Uint8Array(), exitCode: 0 }; },
  });
  const entries = await porcelainStatusRaw(raw, "/worktree");
  assert.equal(entries.problem, null);
  assert.deepEqual(entries.changes.map((entry) => [entry.status, entry.path.utf8, entry.path.display]), [
    ["??", "ordinary.txt", "ordinary.txt"],
    ["!!", null, "ignored/raw-\\xff.txt"],
    ["!!", "ignored/valid.txt", "ignored/valid.txt"],
  ]);
  const projected = await porcelainStatus(raw, "/worktree");
  assert.deepEqual(projected.changes[1], { status: "!!", path: "ignored/raw-\\xff.txt", rawPathBase64: rawName.toString("base64") });
  const textRunner = new Git({ async run(_cwd, args) { return { stdout: args[0] === "status" ? "?? ordinary.txt\0" : "ignored/valid.txt\0", stderr: "", exitCode: 0 }; } });
  assert.deepEqual((await porcelainStatus(textRunner, "/worktree")).changes, [
    { status: "??", path: "ordinary.txt" }, { status: "!!", path: "ignored/valid.txt" },
  ]);
});

test("V3DES-01 round7: Git's collapsed ignored repository is explicitly refused as independent ownership", async () => {
  const root = mkdtempSync(join(tmpdir(), "grove-nested-inventory-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(join(root, ".gitignore"), "nested/\n");
    mkdirSync(join(root, "nested"));
    execFileSync("git", ["init", "-q", join(root, "nested")]);
    writeFileSync(join(root, "nested/old.txt"), "old\n");
    const git = new Git({
      async run(cwd, args) { const result = execFileSync("git", args, { cwd, encoding: "utf8" }); return { stdout: result, stderr: "", exitCode: 0 }; },
      async runBytes(cwd, args) { const result = execFileSync("git", args, { cwd }); return { stdout: result, stderr: new Uint8Array(), exitCode: 0 }; },
    });
    const status = await porcelainStatusRaw(git, root);
    assert.equal(status.problem, null);
    const ignored = status.changes.filter((entry) => entry.status === "!!").map((entry) => entry.path.utf8);
    assert.deepEqual(ignored, ["nested/"]);
    assert.throws(() => assertNoNestedGitOwnership(root, [root]), (error: unknown) => {
      const detail = (error as { detail?: { nestedGitOwners?: Array<{ path: string }> } }).detail;
      assert.ok(detail?.nestedGitOwners?.[0]?.path.endsWith("/nested"));
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ref JSON preserves invalid UTF-8 without replacement-character identity", () => {
  const raw = Buffer.from([0x72, 0x65, 0x66, 0x73, 0x2f, 0xff]);
  const ref = refNameFromBytes(raw);
  assert.equal(ref.utf8, null);
  assert.deepEqual(valueBytesJson(ref), {
    encoding: "base64",
    value: raw.toString("base64"),
    display: "refs/\\xff",
  });
  assert.equal(ref.display.includes("�"), false);
});

test("valid UTF-8 native paths containing newlines remain UTF-8 and addressable", () => {
  const path = nativePathFromBytes(Buffer.from("/tmp/tree\nname"));
  assert.equal(path.utf8, "/tmp/tree\nname");
  assert.equal(path.identity.kind, "canonical-utf8");
  assert.deepEqual(valueBytesJson(path), { encoding: "utf8", value: "/tmp/tree\nname" });
});

test("worktree porcelain -z parses raw path and ref bytes", () => {
  const raw = Buffer.concat([
    Buffer.from("worktree /tmp/a\nname\0HEAD 0123456789012345678901234567890123456789\0branch refs/heads/feature/x\0\0"),
    Buffer.from("worktree /tmp/raw-"),
    Buffer.from([0xff]),
    Buffer.from("\0bare\0\0"),
  ]);
  const entries = parseWorktreePorcelainZ(raw);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.path.utf8, "/tmp/a\nname");
  assert.equal(entries[0]?.branch?.utf8, "refs/heads/feature/x");
  assert.equal(entries[1]?.path.utf8, null);
  assert.equal(entries[1]?.bare, true);
});

test("a missing required capability refuses with exit 9 before callers may persist", async () => {
  const runner: GitRunner = { async run(_cwd, args) { return args[0] === "--version" ? { stdout: "git version 2.50.1\n", stderr: "", exitCode: 0 } : { stdout: "", stderr: "unknown option -z", exitCode: 129 }; } };
  const git = new Git(runner);
  await assert.rejects(() => git.probeCapabilities("/tmp", ["worktree-porcelain-z"]), (error: unknown) => (error as { exitCode?: number }).exitCode === 9);
});

test("missing or unexecutable Git cannot masquerade as recognized capability failures", async () => {
  for (const result of [
    { stdout: "", stderr: "spawn git ENOENT", exitCode: 128 },
    { stdout: "", stderr: "spawn git EACCES", exitCode: 128 },
    { stdout: "", stderr: "", exitCode: 0 },
  ]) {
    const git = new Git({ async run() { return result; } });
    await assert.rejects(() => git.probeCapabilities("/tmp", ["rev-parse-end-of-options"]), (error: unknown) => (error as { exitCode?: number }).exitCode === 9);
  }
});

test("remote inspection preserves exact advertised refs and produces a stable generation", async () => {
  const advertisement = Buffer.from([
    ...Buffer.from("ref: refs/heads/main\tHEAD\n0123456789012345678901234567890123456789\tHEAD\n0123456789012345678901234567890123456789\trefs/heads/main\n"),
    ...Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/raw-"),
    0xff,
    0x0a,
  ]);
  const runner: GitRunner = {
    async run() { return { stdout: advertisement.toString("utf8"), stderr: "", exitCode: 0 }; },
    async runBytes() { return { stdout: advertisement, stderr: new Uint8Array(), exitCode: 0 }; },
  };
  const git = new Git(runner);
  const first = await git.inspectRemote("/tmp", "example", refNameFromBytes(Buffer.from("refs/heads/main")));
  const second = await git.inspectRemote("/tmp", "example", refNameFromBytes(Buffer.from("refs/heads/main")));
  assert.equal(first.empty, false);
  assert.equal(first.symbolicHead?.utf8, "refs/heads/main");
  assert.equal(first.requested?.oid, "0123456789012345678901234567890123456789");
  assert.equal(first.refs[1]?.ref.utf8, null);
  assert.equal(first.advertisementGeneration, second.advertisementGeneration);
});

test("native mutation helpers use exact OIDs and never request ref deletion", async () => {
  const calls: string[][] = [];
  const runner: GitRunner = {
    async run(_cwd, args) {
      calls.push(args);
      if (args[0] === "rev-parse") return { stdout: "0123456789012345678901234567890123456789\n", stderr: "", exitCode: 0 };
      if (args[0] === "for-each-ref") return { stdout: "refs/heads/main\n", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  const git = new Git(runner);
  assert.equal((await git.resolveCommit("/repo", "main")).oid, "0123456789012345678901234567890123456789");
  assert.equal(await git.isCommitReachableFromRef("/repo", "0123456789012345678901234567890123456789"), true);
  await git.fastForward("/repo/tree", "0123456789012345678901234567890123456789");
  await git.rebase("/repo/tree", "0123456789012345678901234567890123456789");
  assert.ok(calls.every((args) => !args.some((arg) => arg === "-d" || arg === "-D" || arg === "delete")));
});

test("raw Git adapter calls cannot invoke worktree remove or move", async () => {
  const calls: string[][] = [];
  const git = new Git({
    async run(_cwd, args) { calls.push(args); return { stdout: "", stderr: "", exitCode: 0 }; },
    async runBytes(_cwd, args) { calls.push(args); return { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0 }; },
  });
  const remove = await git.tryRun("/repo", ["worktree", "remove", "--force", "--", "/raw"]);
  const move = await git.tryRun("/repo", ["worktree", "move", "--", "/raw", "/next"]);
  const globalOption = await git.tryRunBytes("/repo", ["-C", ".", "-c", "safe=value", "worktree", "remove", "--", "/raw"]);
  const optionLikeDestination = await git.tryRunBytes("/repo", ["worktree", "move", "--", "/raw", "-h"]);
  await assert.rejects(() => git.run("/repo", ["-c", "safe=value", "worktree", "move", "--", "/raw", "/next"], "must refuse"), (error: unknown) => (error as { kind?: string }).kind === "git");
  assert.deepEqual(
    { remove: remove.exitCode, move: move.exitCode, globalOption: globalOption.exitCode, optionLikeDestination: optionLikeDestination.exitCode, calls },
    { remove: 128, move: 128, globalOption: 128, optionLikeDestination: 128, calls: [] },
  );
});

for (const prefix of [["--no-optional-locks"], ["--literal-pathspecs"], ["--glob-pathspecs"], ["--noglob-pathspecs"], ["--icase-pathspecs"], ["--exec-path=/tmp"], ["--no-advice"], ["--attr-source=HEAD"], ["-c", "alias.zap=worktree remove --force"], ["-calias.zap=worktree remove"], ["--config-env", "alias.zap=ZAP"], ["--config-env=alias.zap=ZAP"]]) {
  test(`round5: runtime gate refuses ${prefix.join(" ")}`, async () => {
    const calls: string[][] = [];
    const git = new Git({ async run(_cwd, args) { calls.push(args); return { stdout: "", stderr: "", exitCode: 0 }; } });
    const args = prefix.some(p => p.includes("alias.")) ? [...prefix, "zap"] : [...prefix, "worktree", "remove", "--", "/not-a-real-target"];
    const text = await git.tryRun("/tmp", args);
    const bytes = await git.tryRunBytes("/tmp", args);
    assert.deepEqual({text:text.exitCode, bytes:bytes.exitCode, calls}, {text:128,bytes:128,calls:[]});
  });
}

test("round5: exported raw runner refuses unchecked mutation argv", async () => {
  const { createGitRunner } = await import("../../src/git/adapter.ts");
  const runner = createGitRunner();
  const args = ["--no-optional-locks", "worktree", "remove", "--", "/not-a-real-target"];
  const result = await runner.run("/tmp", args);
  const bytes = await runner.runBytes!("/tmp", args);
  assert.match(result.stderr, /typed ContainedPath/);
  assert.match(Buffer.from(bytes.stderr).toString(), /typed ContainedPath/);
});
