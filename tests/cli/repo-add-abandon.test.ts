import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { createGitFaultBoundary, killAndReapFaultProcess, processGroupAlive, spawnFaultProcess, waitForGitFault } from "../testkit/git-fault.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (value: string): any => JSON.parse(value);
const operationFile = (fx: Fixture, id: string): string => join(fx.root, ".grove", "operations", `${id}.json`);
const record = (fx: Fixture, id: string): any => json(readFileSync(operationFile(fx, id), "utf8"));

async function interruptedAdd(options: { layout?: string; env?: Record<string, string> } = {}): Promise<{ fx: Fixture; id: string; anchor: string; origin: string }> {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  if (options.layout) assert.equal(fx.grove(["config", "set", "--values", JSON.stringify({ layout: { repositories: options.layout } })]).status, 0);
  const origin = fx.repos[0]!.origin;
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  const command = spawnFaultProcess(process.execPath, [CLI, "repo", "add", origin, "--name", "alpha"], {
    cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env, ...options.env },
  });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  const files = readdirSync(join(fx.root, ".grove", "operations")).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 1);
  const id = files[0]!.slice(0, -5);
  const anchor = join(fx.root, ...(options.layout === "vault/{repo}/.bare" ? ["vault", "alpha", ".bare"] : ["repos", "alpha"]));
  assert.equal(record(fx, id).steps.find((step: any) => step.id === "fetch").classification, "pending");
  return { fx, id, anchor, origin };
}

async function goneRemote(options: { layout?: string; env?: Record<string, string> } = {}): Promise<{ fx: Fixture; id: string; anchor: string; origin: string; remedy: string }> {
  const state = await interruptedAdd(options);
  renameSync(state.origin, `${state.origin}.gone`);
  const resumed = state.fx.grove(["--json", "reconcile", "--operation", state.id]);
  const target = json(resumed.stdout).targets.find((entry: any) => entry.before?.operationId === state.id);
  assert.equal(resumed.status, 6);
  assert.equal(target.reason, "git-failed");
  assert.equal(record(state.fx, state.id).state, "recoverable");
  return { ...state, remedy: target.detail.remedy };
}

test("V3OPS-07: interrupted acquisition with a gone remote can be abandoned and its alias reused", async () => {
  const { fx, id, anchor, origin, remedy } = await goneRemote();
  const blocked = fx.grove(["--json", "repo", "add", `${origin}.gone`, "--name", "alpha"]);
  assert.equal(blocked.status, 4);
  assert.match(json(blocked.stdout).error.remedy, new RegExp(`reconcile --operation ${id}`));
  assert.match(json(blocked.stdout).error.remedy, new RegExp(`reconcile --abandon ${id}`));
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.deepEqual(json(closed.stdout).detail.removedAnchors, [anchor]);
  assert.equal(existsSync(anchor), false);
  assert.equal(record(fx, id).state, "abandoned");
  assert.equal(record(fx, id).secret, undefined);
  assert.equal(fx.grove(["repo", "add", `${origin}.gone`, "--name", "alpha"]).status, 0);
  assert.match(remedy, new RegExp(`reconcile --operation ${id}`));
  assert.match(remedy, new RegExp(`reconcile --abandon ${id}`));
});

test("V3OPS-07: replacement anchor remains untouched and abandonment refuses", async () => {
  const { fx, id, anchor } = await goneRemote();
  rmSync(anchor, { recursive: true });
  mkdirSync(anchor);
  const note = join(anchor, "user.txt");
  writeFileSync(note, "replacement\n");
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 4);
  assert.equal(readFileSync(note, "utf8"), "replacement\n");
  assert.equal(record(fx, id).state, "recoverable");
});

test("V3OPS-07: a bare repository that replaced the recorded anchor is never removed", async () => {
  const { fx, id, anchor } = await goneRemote();
  rmSync(anchor, { recursive: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", anchor]);
  const replacement = lstatSync(anchor);
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 4);
  assert.equal(lstatSync(anchor).ino, replacement.ino);
  assert.equal(record(fx, id).state, "recoverable");
});

test("V3OPS-07: an identity-free interrupted add retains its anchor on close", async () => {
  const { fx, id, anchor } = await goneRemote();
  const current = record(fx, id);
  const init = current.steps.find((step: any) => step.id === "initialize-bare");
  delete init.postState.device;
  delete init.postState.inode;
  writeFileSync(operationFile(fx, id), JSON.stringify(current));
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(existsSync(anchor), true);
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
});

test("V3OPS-07: additional content in the owned anchor survives explicit close", async () => {
  const { fx, id, anchor } = await goneRemote();
  const note = join(anchor, "user.txt");
  writeFileSync(note, "keep me\n");
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(readFileSync(note, "utf8"), "keep me\n");
  assert.equal(record(fx, id).state, "abandoned");
  assert.deepEqual(json(closed.stdout).detail.removedAnchors, []);
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
  assert.ok(json(closed.stdout).detail.survivingArtifacts.some((entry: any) => entry.kind === "additional-content" && entry.path === note));
  assert.match(json(closed.stdout).detail.remedy, /move.*retained repository anchor/i);
});

test("V3OPS-07: nested user content is named in surviving artifacts", async () => {
  const { fx, id, anchor } = await goneRemote();
  const hook = join(anchor, "hooks", "user-hook");
  writeFileSync(hook, "nested user content\n");
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(readFileSync(hook, "utf8"), "nested user content\n");
  assert.ok(json(closed.stdout).detail.survivingArtifacts.some((entry: any) => entry.kind === "additional-content" && entry.path === hook));
});

test("V3OPS-07: modified scaffold in a custom repository layout survives abandon", async () => {
  const { fx, id, anchor } = await goneRemote({ layout: "vault/{repo}/.bare" });
  const description = join(anchor, "description");
  writeFileSync(description, "custom-layout user description\n");
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(readFileSync(description, "utf8"), "custom-layout user description\n");
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
  assert.equal(record(fx, id).state, "abandoned");
});

test("V3OPS-07: an unmodified owned anchor in a custom layout is removable", async () => {
  const { fx, id, anchor } = await goneRemote({ layout: "vault/{repo}/.bare" });
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.deepEqual(json(closed.stdout).detail.removedAnchors, [anchor]);
  assert.equal(existsSync(anchor), false);
  assert.equal(record(fx, id).state, "abandoned");
});

for (const source of ["environment", "Git configuration"] as const) {
  test(`V3OPS-07: a user Git template from ${source} makes the initial anchor non-disposable`, async () => {
    const template = tempDir("repo-add-template");
    mkdirSync(join(template, "hooks"), { recursive: true });
    writeFileSync(join(template, "hooks", "pre-commit.sample"), "template user content\n");
    const env: Record<string, string> = source === "environment"
      ? { GIT_TEMPLATE_DIR: template }
      : { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "init.templateDir", GIT_CONFIG_VALUE_0: template };
    const state = await goneRemote({ env });
    const hook = join(state.anchor, "hooks", "pre-commit.sample");
    assert.equal(readFileSync(hook, "utf8"), "template user content\n");
    const closed = state.fx.grove(["--json", "reconcile", "--abandon", state.id]);
    assert.equal(closed.status, 0, closed.stdout || closed.stderr);
    assert.equal(readFileSync(hook, "utf8"), "template user content\n");
    assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [state.anchor]);
  });
}

test("V3OPS-07: a proof-free legacy owned anchor is retained", async () => {
  const { fx, id, anchor } = await goneRemote();
  const current = record(fx, id);
  delete current.steps.find((step: any) => step.id === "configure-remote").postState.anchorContentProof;
  writeFileSync(operationFile(fx, id), JSON.stringify(current));
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
  assert.equal(existsSync(anchor), true);
});

test("V3OPS-07: final digest without its creation proof cannot authorize removal", async () => {
  const { fx, id, anchor } = await goneRemote();
  const current = record(fx, id);
  delete current.steps.find((step: any) => step.id === "initialize-bare").postState.genesisProof;
  writeFileSync(operationFile(fx, id), JSON.stringify(current));
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
  assert.equal(existsSync(anchor), true);
});

for (const [label, relativePath] of [["description", "description"], ["nested exclude", "info/exclude"]] as const) {
  test(`V3OPS-07: user ${label} written while remote-add is paused is never adopted as owned`, async () => {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    const origin = join(fx.home, "empty-origin.git");
    execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", origin]);
    const anchor = join(fx.root, "repos", "alpha");
    const trunk = join(fx.root, "trunks", "main@alpha");
    const gate = createGitGate(["remote", "add", "--", "origin", origin]);
    const command = spawnFaultProcess(process.execPath, [CLI, "--json", "repo", "add", origin, "--name", "alpha", "--trunk", "main"], {
      cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env },
    });
    const userText = `user ${label} inserted during remote add\n`;
    const userPath = join(anchor, relativePath);
    try {
      await waitForGitGate(gate, command);
      assert.equal(existsSync(anchor), true);
      writeFileSync(userPath, userText);
      mkdirSync(trunk, { recursive: true });
      writeFileSync(join(trunk, "blocker"), "user blocker\n");
      gate.release();
      await command.closed;
    } finally {
      gate.release();
      if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command);
      gate.dispose();
    }
    const id = readdirSync(join(fx.root, ".grove", "operations")).find((name) => name.endsWith(".json"))!.slice(0, -5);
    assert.equal(record(fx, id).state, "conflicted");
    const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
    assert.equal(closed.status, 0, closed.stdout || closed.stderr);
    assert.equal(readFileSync(userPath, "utf8"), userText);
    assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
    assert.deepEqual(json(closed.stdout).detail.removedAnchors, []);
    assert.equal(record(fx, id).state, "abandoned");
  });
}

async function crashedAcquisitionBoundary(boundaryKind: "initialize-bare" | "configure-remote", editDescription: boolean): Promise<{ fx: Fixture; id: string; anchor: string; description: string }> {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const origin = join(fx.home, "empty-origin.git");
  execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", origin]);
  const anchor = join(fx.root, "repos", "alpha");
  const trunk = join(fx.root, "trunks", "main@alpha");
  const args = boundaryKind === "initialize-bare"
    ? ["init", "--bare", "--initial-branch=main", "--", anchor]
    : ["remote", "add", "--", "origin", origin];
  const boundary = createGitFaultBoundary({ exactGitArgs: args, sentinelTiming: "after" });
  const command = spawnFaultProcess(process.execPath, [CLI, "repo", "add", origin, "--name", "alpha", "--trunk", "main"], {
    cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...boundary.env },
  });
  const description = join(anchor, "description");
  try {
    const intercepted = await waitForGitFault(boundary, command);
    assert.equal(intercepted.realGitExitCode, 0);
    if (editDescription) writeFileSync(description, "user description after Git mutation, before acknowledgement\n");
    await killAndReapFaultProcess(command);
  } finally {
    if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command);
    boundary.dispose();
  }
  mkdirSync(trunk, { recursive: true });
  writeFileSync(join(trunk, "blocker"), "user blocker\n");
  const id = readdirSync(join(fx.root, ".grove", "operations")).find((name) => name.endsWith(".json"))!.slice(0, -5);
  const resumed = fx.grove(["--json", "reconcile", "--operation", id]);
  assert.notEqual(resumed.status, 0);
  assert.equal(record(fx, id).state, "conflicted");
  return { fx, id, anchor, description };
}

test("V3OPS-07: a post-init crash cannot give user-edited initial content deletion authority", async () => {
  const { fx, id, anchor, description } = await crashedAcquisitionBoundary("initialize-bare", true);
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(readFileSync(description, "utf8"), "user description after Git mutation, before acknowledgement\n");
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
});

for (const edited of [false, true]) {
  test(`V3OPS-07: post-remote-add crash ${edited ? "retains user edits" : "cleans a pristine owned anchor"} after replay`, async () => {
    const { fx, id, anchor, description } = await crashedAcquisitionBoundary("configure-remote", edited);
    const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
    assert.equal(closed.status, 0, closed.stdout || closed.stderr);
    if (edited) {
      assert.equal(readFileSync(description, "utf8"), "user description after Git mutation, before acknowledgement\n");
      assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
    } else {
      assert.equal(existsSync(anchor), false);
      assert.deepEqual(json(closed.stdout).detail.removedAnchors, [anchor]);
    }
  });
}

for (const [label, relativePath, replacement] of [
  ["description bytes", "description", "Unique user description content\n"],
  ["exclude bytes", "info/exclude", "Unique user exclude content\n"],
  ["new sample hook", "hooks/precious.sample", "Unique user hook sample content\n"],
  ["existing sample hook bytes", "hooks/pre-commit.sample", "Unique user hook body\n"],
  ["HEAD bytes", "HEAD", "ref: refs/heads/other\n"],
] as const) {
  test(`V3OPS-07: ${label} in the owned Git scaffold survives abandon`, async () => {
    const { fx, id, anchor } = await goneRemote();
    const path = join(anchor, relativePath);
    writeFileSync(path, replacement);
    const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
    assert.equal(closed.status, 0, closed.stdout || closed.stderr);
    assert.equal(readFileSync(path, "utf8"), replacement);
    assert.deepEqual(json(closed.stdout).detail.removedAnchors, []);
    assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
    assert.equal(record(fx, id).state, "abandoned");
  });
}

test("V3OPS-07: changed remote config bytes survive abandon even with familiar keys", async () => {
  const { fx, id, anchor, origin } = await goneRemote();
  const path = join(anchor, "config");
  const before = readFileSync(path, "utf8");
  const changed = before.replace(origin, `${origin}.user-edited`);
  assert.notEqual(changed, before);
  writeFileSync(path, changed);
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(readFileSync(path, "utf8"), changed);
  assert.deepEqual(json(closed.stdout).detail.removedAnchors, []);
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
  assert.equal(record(fx, id).state, "abandoned");
});

test("V3OPS-07: successful Git refs and worktrees in an owned anchor survive close", async () => {
  const { fx, id, anchor, origin } = await goneRemote();
  const oid = execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: `${origin}.gone`, encoding: "utf8" }).trim();
  execFileSync("git", ["-C", anchor, "fetch", "--", `${origin}.gone`, "refs/heads/main"]);
  execFileSync("git", ["-C", anchor, "update-ref", "refs/heads/main", oid]);
  const trunk = join(fx.root, "trunks", "main@alpha");
  execFileSync("git", ["-C", anchor, "worktree", "add", "--", trunk, "main"]);
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(execFileSync("git", ["-C", anchor, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim(), oid);
  assert.equal(existsSync(join(trunk, "README.md")), true);
  assert.equal(record(fx, id).state, "abandoned");
  assert.deepEqual(json(closed.stdout).detail.removedAnchors, []);
  assert.ok(json(closed.stdout).detail.survivingArtifacts.some((entry: any) => entry.kind === "ref" && entry.ref === "refs/heads/main"));
  assert.ok(json(closed.stdout).detail.survivingArtifacts.some((entry: any) => entry.kind === "worktree" && entry.path === trunk));
});

test("V3OPS-07: refs fetched before interruption survive a later recoverable Git failure", async () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const origin = fx.repos[0]!.origin;
  const anchor = join(fx.root, "repos", "alpha");
  const trunk = join(fx.root, "trunks", "main@alpha");
  const gate = createGitGate(["worktree", "add", "--", trunk, "main"]);
  const command = spawnFaultProcess(process.execPath, [CLI, "repo", "add", origin, "--name", "alpha"], {
    cwd: fx.root, env: { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env },
  });
  try { await waitForGitGate(gate, command); await killAndReapFaultProcess(command); }
  finally { if (processGroupAlive(command.child.pid!)) await killAndReapFaultProcess(command); gate.dispose(); }
  const id = readdirSync(join(fx.root, ".grove", "operations")).find((name) => name.endsWith(".json"))!.slice(0, -5);
  const oid = execFileSync("git", ["-C", anchor, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
  const failure = createGitGate(["worktree", "add", "--", trunk, "main"], { failExitCode: 42 });
  let resumed;
  try { resumed = fx.grove(["--json", "reconcile", "--operation", id], { env: failure.env }); }
  finally { failure.dispose(); }
  assert.equal(resumed.status, 6);
  assert.equal(record(fx, id).state, "recoverable");
  const closed = fx.grove(["--json", "reconcile", "--abandon", id]);
  assert.equal(closed.status, 0, closed.stdout || closed.stderr);
  assert.equal(execFileSync("git", ["-C", anchor, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim(), oid);
  assert.deepEqual(json(closed.stdout).detail.retainedAnchors, [anchor]);
});

test("V3OPS-07: running and unrelated recoverable records remain ineligible", async () => {
  const { fx, id } = await interruptedAdd();
  assert.equal(fx.grove(["reconcile", "--abandon", id]).status, 5);
  assert.equal(record(fx, id).state, "running");
  const path = operationFile(fx, id);
  const other = record(fx, id);
  other.kind = "grove-archive";
  other.state = "recoverable";
  other.steps.find((step: any) => step.id === "fetch").classification = "recoverable-intermediate";
  other.steps.find((step: any) => step.id === "fetch").error = { reason: "git-failed" };
  writeFileSync(path, JSON.stringify(other));
  assert.equal(fx.grove(["reconcile", "--abandon", id]).status, 5);
  assert.equal(record(fx, id).state, "recoverable");
  other.kind = "repo-add";
  other.steps.find((step: any) => step.id === "fetch").error = { reason: "stale-plan" };
  writeFileSync(path, JSON.stringify(other));
  assert.equal(fx.grove(["reconcile", "--abandon", id]).status, 5);
  assert.equal(record(fx, id).state, "recoverable");
});
