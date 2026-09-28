import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAll } from "../../src/commands/index.ts";
import { all, familyNames } from "../../src/commands/registry.ts";
import { tempDir, cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);
registerAll();

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BUNDLE = join(ROOT, "dist", "grove.mjs");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  version: string;
  engines: { node: string };
};

type Run = { status: number | null; stdout: string; stderr: string };

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function npm(args: string[], cwd = ROOT): Run {
  const cli = process.env.npm_execpath;
  return cli ? run(process.execPath, [cli, ...args], { cwd }) : run("npm", args, { cwd });
}

function installArtifact(): { executable: string; prefix: string } {
  const staging = tempDir("art-install");
  const packed = npm(["pack", "--json", "--pack-destination", staging]);
  assert.equal(packed.status, 0, packed.stderr);
  const tarball = join(staging, JSON.parse(packed.stdout)[0].filename as string);
  const prefix = join(staging, "prefix");
  const installed = npm([
    "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball,
  ], staging);
  assert.equal(installed.status, 0, installed.stderr);
  return { executable: join(prefix, "bin", "grove"), prefix };
}

function node24(): string {
  const candidates = [
    process.execPath,
    "/opt/homebrew/opt/node@24/bin/node",
    "/usr/local/opt/node@24/bin/node",
  ];
  for (const candidate of candidates) {
    const version = run(candidate, ["--version"]);
    if (version.status === 0 && /^v24\./.test(version.stdout.trim())) return candidate;
  }
  throw new Error("ART-02 requires the declared Node 24 LTS runtime");
}

test("ART-01: build produces exactly one bundled Node entry point at dist/grove.mjs with a Node shebang", () => {
  assert.deepEqual(readdirSync(join(ROOT, "dist")).sort(), ["grove.mjs"]);
  // ASSERT:ART-01:PRODUCES-ONE-BUNDLED-NODE-ENTRY-POINT-DIST-GROVE
  assert.equal(readFileSync(BUNDLE, "utf8").split("\n")[0], "#!/usr/bin/env node");
});

test("ART-02: the copied bundle runs under declared Node 24 LTS without dependencies, source, Bun, Electron, or display", () => {
  const isolated = tempDir("art-clean");
  const home = join(isolated, "home");
  const copy = join(isolated, "grove.mjs");
  mkdirSync(home);
  copyFileSync(BUNDLE, copy);
  const node = node24();
  const result = run(node, [copy, "--version"], {
    cwd: isolated,
    env: {
      HOME: home,
      PATH: `${dirname(node)}${delimiter}/usr/bin${delimiter}/bin`,
      LANG: "C",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), PACKAGE.version);
  assert.deepEqual(readdirSync(isolated).sort(), ["grove.mjs", "home"]);
  const source = readFileSync(copy, "utf8");
  // ASSERT:ART-02:WORKS-WITHOUT-BUN-TYPESCRIPT-NODE-MODULES-ELECTRON-DISPLAY
  assert.doesNotMatch(source, /\bBun\b|electron|DISPLAY|node_modules/);
});

test("ART-03: grove --version prints the installed package version exactly and exits 0", () => {
  const result = run(process.execPath, [BUNDLE, "--version"]);
  // ASSERT:ART-03:PRINTS-INSTALLED-PACKAGE-VERSION-EXITS-0
  assert.deepEqual(
    { status: result.status, stdout: result.stdout, stderr: result.stderr },
    { status: 0, stdout: `${PACKAGE.version}\n`, stderr: "" },
  );
});

test("ART-04: the sole artifact has no IDE/server surface and leaves no background process", () => {
  const isolated = tempDir("art-process");
  const copy = join(isolated, "unique-grove-artifact.mjs");
  copyFileSync(BUNDLE, copy);
  const source = readFileSync(copy, "utf8");
  const forbiddenServer = new RegExp(`${"create"}Server|new Web${"Socket"}|${"listen"}\\(`);
  assert.doesNotMatch(source, forbiddenServer);
  const result = run(process.execPath, [copy, "--help"], { cwd: isolated });
  assert.equal(result.status, 0, result.stderr);
  const processes = run("ps", ["-axo", "command="]);
  assert.equal(processes.status, 0, processes.stderr);
  // ASSERT:ART-04:NO-BUNDLED-IDE-SERVER-ENTRY-POINT-NO-BACKGROUND
  assert.doesNotMatch(processes.stdout, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("ART-05: isolated global npm install puts grove on prefix/bin and every documented command starts", () => {
  const { executable, prefix } = installArtifact();
  const env = { ...process.env, PATH: `${join(prefix, "bin")}${delimiter}${process.env.PATH ?? ""}` };
  assert.equal(run("grove", ["--version"], { env }).status, 0, "installed grove is not on prefix/bin PATH");
  assert.equal(run(executable, ["--help"], { env }).status, 0);
  for (const family of familyNames()) {
    const result = run(executable, [family, "--help"], { env });
    assert.equal(result.status, 0, `grove ${family} --help: ${result.stderr}`);
  }
  for (const command of all()) {
    const result = run(executable, [...command.path.split(" "), "--help"], { env });
    assert.equal(result.status, 0, `grove ${command.path} --help: ${result.stderr}`);
    // ASSERT:ART-05:PLACES-GROVE-PREFIX-S-BIN-PATH-EVERY-DOCUMENTED
    assert.match(result.stdout, new RegExp(`^Usage:\\n  grove ${command.path.replace(" ", "\\s+")}`, "m"));
  }
});

test("ART-06: an unsupported Node runtime exits with a precise version remedy", () => {
  assert.equal(PACKAGE.engines.node, ">=24", "npm installation must enforce the same boundary");
  const isolated = tempDir("art-old-node");
  const preload = join(isolated, "node-23.mjs");
  writeFileSync(preload, [
    'Object.defineProperty(process.versions, "node", { value: "23.11.0", configurable: true });',
    'Object.defineProperty(process, "version", { value: "v23.11.0", configurable: true });',
  ].join("\n"));
  const result = run(process.execPath, ["--import", preload, BUNDLE, "--version"], { cwd: isolated });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /requires Node >=24; this process is Node 23\.11\.0/);
  // ASSERT:ART-06:NPM-REJECTS-INSTALLATION-THROUGH-DECLARED-ENGINES-REQUIREMENT-GROVE
  assert.match(result.stderr, /Install Node 24 LTS or newer, then retry/);
});

test("packaging hygiene: npm pack ships only the artifact and declared documentation", () => {
  const result = npm(["pack", "--dry-run", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const files: string[] = JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path);
  for (const file of files) {
    assert.ok(/^(dist\/|package\.json$|README\.md$|LICENSE$)/.test(file), `unexpected packed file: ${file}`);
  }
  assert.ok(files.includes("dist/grove.mjs"));
});
