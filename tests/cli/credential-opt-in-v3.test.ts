import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { CLI, makeFixture, type Fixture } from "../testkit/fixture.ts";
import { createGitArgvRecorder, killAndReapFaultProcess, processGroupAlive, spawnFaultProcess } from "../testkit/git-fault.ts";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { linkExecutable } from "../testkit/shim.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const ENV_NAME = "GROVE_ALLOW_GIT_CONFIG_CREDENTIALS";
const SENTINEL = "FAKE-CREDENTIAL-91e7";
const credentialedBase = `http://fixture:${SENTINEL}@127.0.0.1:1/r/`;

function run(fx: Fixture, args: string[], configPath: string, permission?: string, extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", GIT_CONFIG_GLOBAL: configPath, GIT_CONFIG_NOSYSTEM: "1", ...extraEnv };
  delete env[ENV_NAME];
  if (permission !== undefined) env[ENV_NAME] = permission;
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: fx.root, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function rewriteConfig(fx: Fixture): string {
  const config = join(fx.home, "credential-rewrite.gitconfig");
  writeFileSync(config, `[url "${credentialedBase}"]\n\tinsteadOf = ${dirname(fx.repos[0]!.origin)}/\n`);
  return config;
}

function groveState(fx: Fixture): string {
  const state = join(fx.root, ".grove");
  const walk = (path: string): string => readdirSync(path, { withFileTypes: true }).map((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? readFileSync(child, "utf8") : "";
  }).join("\n");
  return existsSync(state) ? walk(state) : "";
}

function networkCalls(args: string[][]): number {
  return args.filter((argv) => argv.includes("fetch") || (argv.includes("ls-remote") && !argv.includes("--get-url"))).length;
}

function reason(output: string, alias: string): string | null {
  const result = JSON.parse(output);
  return result.targets?.find((target: { selector?: { repositoryAlias?: string }; reason?: string }) => target.selector?.repositoryAlias === alias)?.reason
    ?? result.targets?.[0]?.reason ?? result.detail?.resumed?.[0]?.problem ?? result.error?.kind ?? null;
}

test("V3SEC-05: only value 1 opts into Git-config credentials for acquisition; typed credentials always refuse", () => {
  const violations: string[] = [];
  for (const permission of [undefined, "", "0", "true", "1"]) {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    const config = rewriteConfig(fx);
    const recorder = createGitArgvRecorder();
    try {
      const acquired = run(fx, ["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], config, permission, recorder.env);
      const observed = {
        refusedAsCredential: acquired.status === 2 && acquired.stdout ? JSON.parse(acquired.stdout).error?.kind === "invalid-input" : false,
        network: networkCalls(recorder.argv()) > 0,
        leaked: `${acquired.stdout}${acquired.stderr}${groveState(fx)}`.includes(SENTINEL),
      };
      if (permission === "1") {
        if (observed.refusedAsCredential || !observed.network || observed.leaked) violations.push(`rewrite permission=1 ${JSON.stringify(observed)}`);
      } else {
        if (acquired.status !== 2 || !observed.refusedAsCredential || observed.network || observed.leaked) violations.push(`rewrite permission=${String(permission)} status=${acquired.status} ${JSON.stringify(observed)}`);
      }
      const directForms = [
        `https://fixture:${SENTINEL}@127.0.0.1:1/direct.git`,
        `ssh://git:${SENTINEL}%40127.0.0.1/direct.git`,
        `ssh://[x]@[git:${SENTINEL}/@127.0.0.1]/direct.git`,
      ];
      for (const [index, directForm] of directForms.entries()) {
        const before = recorder.argv().length;
        const direct = run(fx, ["--json", "repo", "add", directForm, "--name", "direct"], config, permission, recorder.env);
        const directObserved = { status: direct.status, kind: JSON.parse(direct.stdout).error?.kind, gitCalls: recorder.argv().length - before, leaked: `${direct.stdout}${direct.stderr}${groveState(fx)}`.includes(SENTINEL) };
        if (directObserved.status !== 2 || directObserved.kind !== "invalid-input" || directObserved.gitCalls !== 0 || directObserved.leaked) {
          violations.push(`direct form=${index} permission=${String(permission)} ${JSON.stringify(directObserved)}`);
        }
      }
    } finally { recorder.dispose(); }
  }
  assert.deepEqual(violations, []);
});

test("V3SEC-05: acquisition rechecks Git's destination before its in-lock remote inspection", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const config = join(fx.home, "mid-add-rewrite.gitconfig");
  const marker = join(fx.home, "mid-add-rewrite.marker");
  const networkLog = join(fx.home, "mid-add-network.log");
  const bin = join(fx.home, "mid-add-bin");
  mkdirSync(bin);
  writeFileSync(config, "");
  const proxy = join(bin, "git");
  linkExecutable(proxy, `#!/bin/sh
if [ "$1" = ls-remote ] && [ "$2" = --symref ]; then
  if [ -f "$GROVE_TEST_MARKER" ]; then
    resolved=$("$GROVE_TEST_REAL_GIT" ls-remote --get-url -- "$4")
    case "$resolved" in *${SENTINEL}*) printf 'credentialed-second-network\\n' >> "$GROVE_TEST_NETWORK_LOG";; *) printf 'other-second-network\\n' >> "$GROVE_TEST_NETWORK_LOG";; esac
  else
    printf 'first-network\\n' >> "$GROVE_TEST_NETWORK_LOG"
    "$GROVE_TEST_REAL_GIT" "$@"
    code=$?
    printf '[url "%s"]\\n\\tinsteadOf = %s/\\n' "$GROVE_TEST_FAKE_BASE" "$GROVE_TEST_ORIGIN_DIR" > "$GIT_CONFIG_GLOBAL"
    touch "$GROVE_TEST_MARKER"
    exit "$code"
  fi
fi
exec "$GROVE_TEST_REAL_GIT" "$@"
`);
  const result = run(fx, ["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], config, undefined, {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    GROVE_TEST_MARKER: marker,
    GROVE_TEST_NETWORK_LOG: networkLog,
    GROVE_TEST_REAL_GIT: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    GROVE_TEST_FAKE_BASE: credentialedBase,
    GROVE_TEST_ORIGIN_DIR: dirname(fx.repos[0]!.origin),
  });
  const events = existsSync(networkLog) ? readFileSync(networkLog, "utf8").trim().split("\n") : [];
  const body = JSON.parse(result.stdout);
  const operationDir = join(fx.root, ".grove", "operations");
  const recordCreated = existsSync(operationDir) && readdirSync(operationDir).some((name) => name.endsWith(".json"));
  assert.deepEqual({ status: result.status, kind: body.error?.kind, events, recordCreated, leaked: `${result.stdout}${result.stderr}${groveState(fx)}`.includes(SENTINEL) },
    { status: 2, kind: "invalid-input", events: ["first-network"], recordCreated: false, leaked: false });
});

test("V3SEC-05: managed fetch and sync recheck this invocation's Git-config credential opt-in", () => {
  const violations: string[] = [];
  for (const command of [["repo", "fetch"], ["sync", "--trunks", "--strategy", "fetch-only"]]) {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
    const config = rewriteConfig(fx);
    for (const permission of [undefined, "0", "1"]) {
      const recorder = createGitArgvRecorder();
      try {
        const result = run(fx, ["--json", ...command], config, permission, recorder.env);
        const observed = { reason: reason(result.stdout, "alpha"), network: networkCalls(recorder.argv()) > 0, leaked: `${result.stdout}${result.stderr}${groveState(fx)}`.includes(SENTINEL) };
        if (observed.reason !== (permission === "1" ? "git-failed" : "refused-policy") || observed.network !== (permission === "1") || observed.leaked) {
          violations.push(`${command.join(" ")} permission=${String(permission)} ${JSON.stringify(observed)}`);
        }
      } finally { recorder.dispose(); }
    }
  }
  assert.deepEqual(violations, []);
});

test("V3SEC-05: a store-only Git-config credential opt-in never reaches output or a partial record", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const include = join(fx.home, "store-only.gitconfig");
  writeFileSync(include, `[url "${credentialedBase}"]\n\tinsteadOf = ${dirname(fx.repos[0]!.origin)}/\n`);
  const config = join(fx.home, "store-only-global.gitconfig");
  writeFileSync(config, `[includeIf "gitdir:${realpathSync(fx.root)}/repos/"]\n\tpath = ${include}\n`);
  const recorder = createGitArgvRecorder();
  try {
    const result = run(fx, ["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], config, "1", recorder.env);
    const body = JSON.parse(result.stdout);
    assert.deepEqual({ status: result.status, step: body.targets?.[0]?.action, reason: body.targets?.[0]?.reason, fetched: recorder.argv().some((argv) => argv.includes("fetch")), leaked: `${result.stdout}${result.stderr}${groveState(fx)}`.includes(SENTINEL), registered: body.outcome === "complete" },
      { status: 6, step: "fetch", reason: "git-failed", fetched: true, leaked: false, registered: false });
  } finally { recorder.dispose(); }
});

test("V3SEC-05: a permitted store fetch cannot retain Git stderr containing a config credential", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const include = join(fx.home, "store-only.gitconfig");
  writeFileSync(include, `[url "${credentialedBase}"]\n\tinsteadOf = ${dirname(fx.repos[0]!.origin)}/\n`);
  const config = join(fx.home, "store-only-global.gitconfig");
  writeFileSync(config, `[includeIf "gitdir:${realpathSync(fx.root)}/repos/"]\n\tpath = ${include}\n`);
  const bin = join(fx.home, "git-stderr-bin");
  mkdirSync(bin);
  const proxy = join(bin, "git");
  linkExecutable(proxy, "#!/bin/sh\nif [ \"$1\" = fetch ]; then printf 'fatal: %s\\n' \"$GROVE_TEST_FAKE_STDERR\" >&2; exit 128; fi\nexec \"$GROVE_TEST_REAL_GIT\" \"$@\"\n");
  const result = run(fx, ["--json", "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], config, "1", {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    GROVE_TEST_REAL_GIT: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    GROVE_TEST_FAKE_STDERR: SENTINEL,
  });
  const body = JSON.parse(result.stdout);
  assert.deepEqual({ status: result.status, reason: body.targets?.[0]?.reason, outputLeaked: `${result.stdout}${result.stderr}`.includes(SENTINEL), stateLeaked: groveState(fx).includes(SENTINEL) },
    { status: 6, reason: "git-failed", outputLeaked: false, stateLeaked: false });
});

test("V3SEC-05: resumed acquisition rechecks the retained remote and current opt-in (#24)", async () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env };
  delete env[ENV_NAME];
  const interrupted = spawnFaultProcess(process.execPath, [CLI, "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { cwd: fx.root, env });
  try { await waitForGitGate(gate, interrupted); await killAndReapFaultProcess(interrupted); }
  finally { if (processGroupAlive(interrupted.child.pid!)) await killAndReapFaultProcess(interrupted); gate.dispose(); }
  const recordFile = readdirSync(join(fx.root, ".grove", "operations")).find((name) => name.endsWith(".json"));
  assert.ok(recordFile);
  const recordId = recordFile.slice(0, -5);
  const config = rewriteConfig(fx);
  const recorder = createGitArgvRecorder();
  try {
    const resumed = run(fx, ["--json", "reconcile", "--operation", recordId], config, "1", recorder.env);
    const record = JSON.parse(readFileSync(join(fx.root, ".grove", "operations", recordFile), "utf8"));
    const withOptIn = { reason: reason(resumed.stdout, "alpha"), network: networkCalls(recorder.argv()) > 0, stepReason: record.steps.find((step: { id: string }) => step.id === "fetch")?.error?.reason, leaked: `${resumed.stdout}${resumed.stderr}${groveState(fx)}`.includes(SENTINEL), persistedOptIn: groveState(fx).includes(ENV_NAME) };
    const before = recorder.argv().length;
    const resumedWithoutOptIn = run(fx, ["--json", "reconcile", "--operation", recordId], config, undefined, recorder.env);
    const updated = JSON.parse(readFileSync(join(fx.root, ".grove", "operations", recordFile), "utf8"));
    const withoutOptIn = { reason: reason(resumedWithoutOptIn.stdout, "alpha"), network: networkCalls(recorder.argv().slice(before)) > 0, stepReason: updated.steps.find((step: { id: string }) => step.id === "fetch")?.error?.reason, leaked: `${resumedWithoutOptIn.stdout}${resumedWithoutOptIn.stderr}${groveState(fx)}`.includes(SENTINEL), persistedOptIn: groveState(fx).includes(ENV_NAME) };
    assert.deepEqual({ withOptIn, withoutOptIn }, {
      withOptIn: { reason: "git-failed", network: true, stepReason: "git-failed", leaked: false, persistedOptIn: false },
      withoutOptIn: { reason: "refused-policy", network: false, stepReason: "refused-policy", leaked: false, persistedOptIn: false },
    });
  } finally { recorder.dispose(); }
});

test("V3SEC-05: recovery rechecks the store destination after its remote inspection", async () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  const gate = createGitGate(["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env };
  delete env[ENV_NAME];
  const interrupted = spawnFaultProcess(process.execPath, [CLI, "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { cwd: fx.root, env });
  try { await waitForGitGate(gate, interrupted); await killAndReapFaultProcess(interrupted); }
  finally { if (processGroupAlive(interrupted.child.pid!)) await killAndReapFaultProcess(interrupted); gate.dispose(); }
  const recordFile = readdirSync(join(fx.root, ".grove", "operations")).find((name) => name.endsWith(".json"));
  assert.ok(recordFile);
  const config = join(fx.home, "recovery-race.gitconfig");
  const marker = join(fx.home, "recovery-race.marker");
  const networkLog = join(fx.home, "recovery-race-network.log");
  const bin = join(fx.home, "recovery-race-bin");
  mkdirSync(bin);
  writeFileSync(config, "");
  const proxy = join(bin, "git");
  linkExecutable(proxy, `#!/bin/sh
if [ "$1" = ls-remote ] && [ "$2" = --symref ] && [ ! -f "$GROVE_TEST_MARKER" ]; then
  "$GROVE_TEST_REAL_GIT" "$@"
  code=$?
  printf 'first-network\\n' >> "$GROVE_TEST_NETWORK_LOG"
  printf '[url "%s"]\\n\\tinsteadOf = %s/\\n' "$GROVE_TEST_FAKE_BASE" "$GROVE_TEST_ORIGIN_DIR" > "$GIT_CONFIG_GLOBAL"
  touch "$GROVE_TEST_MARKER"
  exit "$code"
fi
if [ "$1" = fetch ] && [ -f "$GROVE_TEST_MARKER" ]; then
  resolved=$("$GROVE_TEST_REAL_GIT" ls-remote --get-url -- origin)
  case "$resolved" in *${SENTINEL}*) printf 'credentialed-fetch\\n' >> "$GROVE_TEST_NETWORK_LOG";; *) printf 'other-fetch\\n' >> "$GROVE_TEST_NETWORK_LOG";; esac
fi
exec "$GROVE_TEST_REAL_GIT" "$@"
`);
  const resumed = run(fx, ["--json", "reconcile", "--operation", recordFile.slice(0, -5)], config, undefined, {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    GROVE_TEST_MARKER: marker,
    GROVE_TEST_NETWORK_LOG: networkLog,
    GROVE_TEST_REAL_GIT: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    GROVE_TEST_FAKE_BASE: credentialedBase,
    GROVE_TEST_ORIGIN_DIR: dirname(fx.repos[0]!.origin),
  });
  const record = JSON.parse(readFileSync(join(fx.root, ".grove", "operations", recordFile), "utf8"));
  const events = existsSync(networkLog) ? readFileSync(networkLog, "utf8").trim().split("\n") : [];
  assert.deepEqual({ reason: reason(resumed.stdout, "alpha"), events, stepReason: record.steps.find((step: { id: string }) => step.id === "fetch")?.error?.reason, leaked: `${resumed.stdout}${resumed.stderr}${groveState(fx)}`.includes(SENTINEL) },
    { reason: "refused-policy", events: ["first-network"], stepReason: "refused-policy", leaked: false });
});

for (const { boundary, gateArgs, permission } of [
  { boundary: "remote-add", gateArgs: ["remote", "add", "--", "origin"], permission: undefined },
  { boundary: "fetch", gateArgs: ["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], permission: "1" },
] as const) {
  test(`V3SEC-05: recovery refuses a legacy direct credential before ${boundary} with opt-in ${String(permission)}`, async () => {
    const fx = makeFixture();
    assert.equal(fx.grove(["init"]).status, 0);
    const intercepted = boundary === "remote-add" ? [...gateArgs, fx.repos[0]!.origin] : [...gateArgs];
    const gate = createGitGate(intercepted);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.home, GROVE_ROOT: "/ignored", ...gate.env };
    delete env[ENV_NAME];
    const interrupted = spawnFaultProcess(process.execPath, [CLI, "repo", "add", fx.repos[0]!.origin, "--name", "alpha"], { cwd: fx.root, env });
    try { await waitForGitGate(gate, interrupted); await killAndReapFaultProcess(interrupted); }
    finally { if (processGroupAlive(interrupted.child.pid!)) await killAndReapFaultProcess(interrupted); gate.dispose(); }
    const operationDir = join(fx.root, ".grove", "operations");
    const recordFile = readdirSync(operationDir).find((name) => name.endsWith(".json"));
    assert.ok(recordFile);
    const recordPath = join(operationDir, recordFile);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const anchor = record.steps.find((step: { kind: string }) => step.kind === "repository-init-bare")?.input?.anchor;
    assert.equal(typeof anchor, "string");
    record.secret.remote = `http://fixture:${SENTINEL}@127.0.0.1:1/legacy.git`;
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    const config = join(fx.home, `legacy-${boundary}.gitconfig`);
    writeFileSync(config, "");
    const recorder = createGitArgvRecorder();
    try {
      const resumed = run(fx, ["--json", "reconcile", "--operation", recordFile.slice(0, -5)], config, permission, recorder.env);
      const updated = JSON.parse(readFileSync(recordPath, "utf8"));
      assert.deepEqual({ status: resumed.status, reason: reason(resumed.stdout, "alpha"), network: networkCalls(recorder.argv()), gitArgvSecret: recorder.argv().some((argv) => argv.some((arg) => arg.includes(SENTINEL))), storeConfigSecret: readFileSync(join(anchor, "config"), "utf8").includes(SENTINEL), outputLeaked: `${resumed.stdout}${resumed.stderr}`.includes(SENTINEL), stateLeaked: groveState(fx).includes(SENTINEL), recordRetained: existsSync(recordPath), stepReason: updated.steps.find((step: { classification: string }) => step.classification === "conflicted")?.error?.reason },
        { status: 3, reason: "refused-policy", network: 0, gitArgvSecret: false, storeConfigSecret: false, outputLeaked: false, stateLeaked: false, recordRetained: true, stepReason: "refused-policy" });
    } finally { recorder.dispose(); }
  });
}
