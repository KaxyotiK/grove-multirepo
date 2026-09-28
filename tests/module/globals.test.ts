/**
 * P1-6: global options are recognised anywhere in argv (§8.1), including after one of the
 * command's own BOOLEAN flags.
 *
 * The regression these pin: the scanner used to assume every non-global option consumed the next
 * token, so `grove delete x --force --json` read `--json` as `--force`'s value and then rejected it
 * as an unknown option. Only the command's option schema separates that case from
 * `grove agent add a cmd --arg --json`, where `--json` really IS the value — so the scan runs twice
 * at two precisions, and both are tested here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGlobals, GLOBAL_OPTION_DEFINITIONS, scanGlobals } from "../../src/commands/globals.ts";
import { GroveError } from "../../src/errors.ts";
import { EarlyExit, parseCommand } from "../../src/commands/args.ts";
import type { CommandContext } from "../../src/commands/registry.ts";

const BOOL_AND_STRING = { force: { type: "boolean" }, arg: { type: "string" } } as const;
const REPEATED = { repo: { type: "string", multiple: true, default: [] as string[] } } as const;

test("P1-6: a global after a boolean flag is a global, not that flag's value", () => {
  const scan = extractGlobals(["doomed", "--allow-destructive-all", "--json"], BOOL_AND_STRING);
  assert.equal(scan.globals.json, true);
  assert.deepEqual(scan.rest, ["doomed", "--allow-destructive-all"]);
});

test("P1-6: a global after a STRING option is that option's value and is left alone", () => {
  const scan = extractGlobals(["a", "cmd", "--arg", "--json"], BOOL_AND_STRING);
  assert.equal(scan.globals.json, false, "--json belongs to --arg");
  assert.deepEqual(scan.rest, ["a", "cmd", "--arg", "--json"]);
});

test("CMD-16: repeated string options keep each option-looking value while trailing globals remain global", () => {
  const scan = extractGlobals(["--repo", "--first", "--repo=second", "--json"], REPEATED);
  // ASSERT:CMD-16:PRE-REFACTOR-ARGV-KEEPS-PARSED-MEANING-AND-OUTPUT-MODE
  assert.equal(scan.globals.json, true);
  assert.deepEqual(scan.rest, ["--repo", "--first", "--repo=second"]);
});

test("P1-6: without a schema an ambiguous position is LEFT for the schema-aware pass", () => {
  // This is what cli.ts does: it cannot know whether --force takes a value, so it must not guess.
  const scan = extractGlobals(["delete", "doomed", "--allow-destructive-all", "--json"]);
  assert.equal(scan.globals.json, false, "conservative: not decided here");
  assert.deepEqual(scan.rest, ["delete", "doomed", "--allow-destructive-all", "--json"], "passed through intact");
});

test("P1-6: an unambiguous global is taken by both passes alike", () => {
  for (const options of [undefined, BOOL_AND_STRING]) {
    const scan = extractGlobals(["ls", "--json"], options);
    assert.equal(scan.globals.json, true, `options=${options ? "schema" : "none"}`);
    assert.deepEqual(scan.rest, ["ls"]);
  }
});

test("P1-6: an option value that itself looks like an option cannot claim the next token", () => {
  // `--arg --tree` consumes `--tree` as a value; `--json` after it is a global, not `--tree`'s
  // value. A backwards-looking "is the previous token an option" test gets this wrong.
  const scan = extractGlobals(["--arg", "--tree", "--json"], BOOL_AND_STRING);
  assert.equal(scan.globals.json, true);
  assert.deepEqual(scan.rest, ["--arg", "--tree"]);
});

test("P1-6: an option the schema does not declare does not swallow the global after it", () => {
  // The user should see "Unknown option '--bogus'" — and see it through the envelope they asked
  // for. Treating the unknown option as value-taking would hide the --json instead.
  const scan = extractGlobals(["--bogus", "--json"], BOOL_AND_STRING);
  assert.equal(scan.globals.json, true);
  assert.deepEqual(scan.rest, ["--bogus"]);
});

test("P1-6: nothing at or after a literal `--` is examined (§8.1/§8.8 forwarded extras)", () => {
  const scan = extractGlobals(["run", "g", "--", "--json", "--help"], BOOL_AND_STRING);
  assert.equal(scan.globals.json, false);
  assert.equal(scan.help, false);
  assert.deepEqual(scan.rest, ["run", "g", "--", "--json", "--help"], "separator included");
});

test("P1-6: help and version are found in ambiguous positions too", () => {
  assert.equal(extractGlobals(["x", "--allow-destructive-all", "--help"], BOOL_AND_STRING).help, true);
  assert.equal(extractGlobals(["x", "--allow-destructive-all", "-V"], BOOL_AND_STRING).version, true);
  // …but not when they are genuinely a value.
  assert.equal(extractGlobals(["x", "--arg", "-h"], BOOL_AND_STRING).help, false);
});

test("CMD-16/P1-6: --workspace still requires a path with exit code 2 in either pass", () => {
  for (const options of [undefined, BOOL_AND_STRING]) {
    // ASSERT:CMD-16:PARSER-ERROR-RETAINS-EXIT-CODE-2
    assert.throws(
      () => extractGlobals(["ls", "--workspace"], options),
      (e: unknown) => GroveError.is(e) && e.exitCode === 2,
    );
    assert.throws(
      () => extractGlobals(["ls", "--workspace", "--json"], options),
      (e: unknown) => GroveError.is(e) && e.exitCode === 2,
    );
  }
  const scan = extractGlobals(["ls", "--workspace", "/w"], BOOL_AND_STRING);
  assert.equal(scan.globals.workspace, "/w");
  assert.equal(scan.workspaceGiven, true);
  assert.deepEqual(scan.rest, ["ls"]);
});

test("P1-6: tolerant scanning retains a malformed-global error while finding its JSON envelope", () => {
  const result = scanGlobals(["new", "--all", "--workspace", "--json", "--help"], BOOL_AND_STRING);
  assert.ok(GroveError.is(result.error));
  assert.equal(result.error.exitCode, 2);
  assert.equal(result.scan.globals.json, true);
  assert.equal(result.scan.help, true);
});

test("global definitions drive every accepted exact spelling", () => {
  assert.deepEqual(GLOBAL_OPTION_DEFINITIONS.map(({ kind }) => kind), ["workspace", "json", "progress-json", "version", "help"]);
  assert.deepEqual(GLOBAL_OPTION_DEFINITIONS.flatMap(({ flags }) => flags), ["--workspace", "--json", "--progress=json", "--version", "-V", "--help", "-h"]);
  for (const definition of GLOBAL_OPTION_DEFINITIONS) {
    for (const flag of definition.flags) {
      const scan = extractGlobals(definition.kind === "workspace" ? [flag, "/w"] : [flag]);
      if (definition.kind === "workspace") assert.equal(scan.globals.workspace, "/w");
      if (definition.kind === "json") assert.equal(scan.globals.json, true);
      if (definition.kind === "progress-json") assert.equal(scan.globals.progressJson, true);
      if (definition.kind === "version") assert.equal(scan.version, true);
      if (definition.kind === "help") assert.equal(scan.help, true);
    }
    if (definition.attachedPrefix) {
      assert.equal(extractGlobals([`${definition.attachedPrefix}/attached`]).globals.workspace, "/attached");
    }
  }
});

test("direct handler parsing uses the public CLI's version-before-help precedence", () => {
  const ctx: CommandContext = {
    globals: { workspace: undefined, json: false, progressJson: false },
    argv: ["--help", "--version"],
    emit: {
      json: false,
      setJson() {},
      ok: () => 0,
      fail: () => 1,
      result: (_value, exitCode) => exitCode,
    },
    cwd: process.cwd(),
    spec: { path: "sample", summary: "", usage: "sample", options: {}, positionals: { min: 0, max: 0 }, handler: () => 0 },
  };
  assert.throws(() => parseCommand(ctx), (error: unknown) => EarlyExit.is(error) && error.which === "version");
});
