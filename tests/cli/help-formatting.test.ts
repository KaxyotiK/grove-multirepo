import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = resolve(ROOT, "dist/grove.mjs");

function grove(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function assertHumanHelp(result: ReturnType<typeof grove>, sections: string[]): void {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  for (const section of sections) assert.match(result.stdout, new RegExp(`^${section}:$`, "m"));
  assert.doesNotMatch(result.stdout, /^\s*-\s*$/m);
  assert.doesNotMatch(result.stdout, /^\s+(?:Name|Desc|Path|Summary):/m);
}

test("V3HLP-04/003-git-native-grove-SC-018: top-level human help has conventional spaced and aligned sections", () => {
  const result = grove(["--help"]);
  assertHumanHelp(result, ["Usage", "Global options", "Commands", "Hint"]);
  assert.match(result.stdout, /\n\nUsage:\n  grove /);

  const workspace = result.stdout.split("\n").find((line) => line.includes("--workspace <path>"))!;
  const json = result.stdout.split("\n").find((line) => /^\s+--json\s/.test(line))!;
  assert.equal(workspace.indexOf("Select an exact workspace"), json.indexOf("Emit one stable JSON"));
});

test("V3HLP-04: noun-family human help aligns commands and retains exact usages", () => {
  const result = grove(["repo", "--help"]);
  assertHumanHelp(result, ["Usage", "Commands", "Hint"]);
  assert.match(result.stdout, /^  repo add\s+Create a managed bare repository/m);
  assert.match(result.stdout, /^    Usage: grove repo add <remote>/m);
  assert.match(result.stdout, /^  repo status\s+Report repository health/m);

  const add = result.stdout.split("\n").find((line) => /^\s+repo add\s/.test(line))!;
  const status = result.stdout.split("\n").find((line) => /^\s+repo status\s/.test(line))!;
  assert.equal(add.indexOf("Create a managed"), status.indexOf("Report repository"));
});

test("V3HLP-04: per-command human help keeps aligned entries, notes, and copyable examples", () => {
  const result = grove(["new", "--help"]);
  assertHumanHelp(result, ["Usage", "Arguments", "Options", "Notes", "Examples"]);

  const repo = result.stdout.split("\n").find((line) => /^\s+--repo <repo>\s/.test(line))!;
  const all = result.stdout.split("\n").find((line) => /^\s+--all\s/.test(line))!;
  assert.equal(repo.indexOf("Add a Tree"), all.indexOf("Add a Tree"));
  assert.match(result.stdout, /^  grove new pricing-fix --repo api\s+# Grove/m);
  assert.match(result.stdout, /Every branch is based on its repository's trunk/);
});

test("V3HLP-04: JSON help remains structured and exposes the same meaningful facts", () => {
  const top = JSON.parse(grove(["--json", "--help"]).stdout);
  const family = JSON.parse(grove(["--json", "repo", "--help"]).stdout);
  const command = JSON.parse(grove(["--json", "new", "--help"]).stdout);

  assert.deepEqual(
    {
      topUsage: top.usage,
      workspace: top.globalOptions.find((entry: any) => entry.option === "--workspace <path>")?.description,
      topNew: top.commands.find((entry: any) => entry.path === "new")?.summary,
      familyUsage: family.usage,
      repoAddUsage: family.commands.find((entry: any) => entry.path === "repo add")?.usage,
      commandUsage: command.usage,
      name: command.arguments.find((entry: any) => entry.name === "<name>")?.desc,
      all: command.options.find((entry: any) => entry.name === "--all")?.desc,
      note: command.note,
      examples: command.examples.length,
    },
    {
      topUsage: "grove [global-options] <command> [args]",
      workspace: "Select an exact workspace instead of cwd discovery.",
      topNew: "Create a named Grove and its initial Trees.",
      familyUsage: "grove repo <command> [args]",
      repoAddUsage: "repo add <remote> [--name <name>] [--trunk <branch>]",
      commandUsage: "grove new <name> [--repo <repo>]... [--all] [--branch <repo>=<branch>]... [--from <repo>=<ref>]... [--prefix <prefix>]",
      name: "Grove name (required). Also the default work-branch name; unique across active and archived Groves.",
      all: "Add a Tree for every registered repository. Required to fan out: omitting --repo creates an empty Grove, it does not select everything.",
      note: "Every branch is based on its repository's trunk. If the derived branch already exists, new refuses rather than adopt it silently — pass --branch to adopt. Interrupted work remains in a forward operation for reconcile.",
      examples: 7,
    },
  );
});

test("V3HLP-04: accepted global placements select structured help before command execution", () => {
  const cases = [
    ["new", "--help", "--json"],
    ["new", "--json", "--help"],
    ["new", "--all", "--help", "--json"],
    ["repo", "--help", "--json"],
    ["repo", "--json", "--help"],
    ["repo", "ls", "--json", "--help"],
  ];

  for (const args of cases) {
    const result = grove(args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr || result.stdout}`);
    assert.equal(result.stderr, "", args.join(" "));
    const help = JSON.parse(result.stdout);
    assert.ok(help.usage, args.join(" "));
  }
});

test("V3HLP-04: definitive scanning preserves string values, global order, and version format", () => {
  const fx = makeFixture({ repos: {} });
  assert.equal(fx.grove(["init"]).status, 0);

  const helpValue = fx.grove(["agent", "add", "helper", "echo", "--default", "--arg", "--help"]);
  assert.equal(helpValue.status, 2, helpValue.stderr || helpValue.stdout);
  assert.doesNotMatch(helpValue.stdout, /^Usage:$/m);
  assert.match(helpValue.stderr, /Invalid arguments for 'agent add'/);

  const jsonValue = fx.grove(["agent", "add", "json-helper", "echo", "--default", "--arg", "--json"]);
  assert.equal(jsonValue.status, 2, jsonValue.stderr || jsonValue.stdout);
  assert.equal(jsonValue.stdout, "", "literal --json must not select JSON output");
  assert.match(jsonValue.stderr, /Invalid arguments for 'agent add'/);

  const attachedValue = fx.grove(["agent", "add", "helper", "echo", "--default", "--arg=--help"]);
  assert.equal(attachedValue.status, 0, attachedValue.stderr || attachedValue.stdout);
  const agents = JSON.parse(fx.grove(["agent", "ls", "--json"]).stdout);
  assert.deepEqual(agents.agents.find((agent: any) => agent.name === "helper")?.args, ["--help"]);

  const other = makeFixture({ repos: {} });
  assert.equal(other.grove(["init"]).status, 0);
  const selected = fx.grove(["doctor", "--strict", "--workspace", fx.root, "--workspace", other.root, "--json"]);
  assert.equal(selected.status, 0, selected.stderr || selected.stdout);
  assert.equal(JSON.parse(selected.stdout).targets[0].selector.path, other.root, "the last explicit workspace wins");

  const version = grove(["new", "--all", "--json", "--version"]);
  assert.equal(version.status, 0, version.stderr || version.stdout);
  assert.equal(typeof JSON.parse(version.stdout), "string");

  const versionAndHelp = grove(["new", "--all", "--help", "--version", "--json"]);
  assert.equal(versionAndHelp.status, 0, versionAndHelp.stderr || versionAndHelp.stdout);
  assert.equal(typeof JSON.parse(versionAndHelp.stdout), "string", "public dispatch keeps version-before-help precedence");
});

test("V3HLP-04: malformed globals use clean human and JSON invalid-input envelopes", () => {
  const humanCases = [
    ["--workspace"],
    ["repo", "--workspace"],
    ["new", "--all", "--workspace", "--help"],
  ];
  for (const args of humanCases) {
    const result = grove(args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr || result.stdout}`);
    assert.equal(result.stdout, "", args.join(" "));
    assert.match(result.stderr, /--workspace requires a path/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s|_GroveError|node:internal/);
  }

  const jsonCases = [
    ["--workspace", "--json"],
    ["repo", "--workspace", "--json"],
    ["new", "--all", "--workspace", "--json", "--help"],
    ["--workspace", "--help", "new", "--all", "--json"],
  ];
  for (const args of jsonCases) {
    const result = grove(args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr || result.stdout}`);
    assert.equal(result.stderr, "", args.join(" "));
    const error = JSON.parse(result.stdout).error;
    assert.deepEqual({ kind: error.kind, exitCode: error.exitCode }, { kind: "invalid-input", exitCode: 2 });
    assert.match(error.what, /--workspace requires a path/);
  }
});
