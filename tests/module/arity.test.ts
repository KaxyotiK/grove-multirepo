/**
 * P0-7: positional arity is DERIVED from each command's declared usage line, so a command cannot
 * document one surface and accept another. These tests pin the derivation itself; the CLI-level
 * refusals live in tests/cli/regressions.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { booleanValue, stringListValue, stringValue } from "../../src/commands/args.ts";
import { registerAll } from "../../src/commands/index.ts";
import { all, register, usageArity, type CommandSpec } from "../../src/commands/registry.ts";

registerAll();

const spec = (path: string, usage: string): CommandSpec => ({
  path,
  usage,
  summary: "",
  options: {},
  positionals: { min: 0, max: 0 },
  handler: () => 0,
});

test("P0-7: usageArity reads required, optional, and variadic positionals off the usage line", () => {
  const cases: [string, string, number, number][] = [
    // path, usage, min, max
    ["status", "status", 0, 0],
    ["show", "show <grove>", 1, 1],
    ["rename", "rename <grove> <name>", 2, 2],
    ["repo status", "repo status [<repo>]", 0, 1],
    ["init", "init [path] [--name <name>] [--nested]", 0, 1],
    // Bracketed option groups are not positionals, even when they carry `<value>` and repeat.
    ["new", "new <name> [--repo <repo>]... [--branch <repo>=<branch>]... [--prefix <prefix>]", 1, 1],
    ["agent add", "agent add <name> <command> [--arg <arg>]...", 2, 2],
    // A BARE option consumes the `<value>` token that follows it.
    ["config set", "config set --values <json> [--expect <revision>]", 0, 0],
    ["tree reorder", "tree reorder <grove> --tree <tree>...", 1, 1],
    // The `--` passthrough group is option material, not a positional.
    ["agent run", "agent run [<grove>] [--tree <tree>] [--agent <agent>] [-- <extra-args>...]", 0, 1],
    // An alternation is one token.
    ["completion", "completion <bash|zsh|fish>", 1, 1],
  ];
  for (const [path, usage, min, max] of cases) {
    assert.deepEqual(usageArity(spec(path, usage)), { min, max }, `${usage} → ${min}..${max}`);
  }
});

test("P0-7: a variadic positional tail is unbounded, not counted", () => {
  assert.deepEqual(usageArity(spec("x", "x <a> <b>...")), { min: 2, max: Infinity });
  assert.deepEqual(usageArity(spec("x", "x [<a>]...")), { min: 0, max: Infinity });
});

test("P0-7: every registered command yields a finite, non-negative arity", () => {
  for (const s of all()) {
    const { min, max } = usageArity(s);
    assert.ok(min >= 0, `${s.path} has a negative minimum`);
    assert.ok(max >= min, `${s.path} has max ${max} below min ${min}`);
    // No command on the current surface is variadic. If one becomes so, state it here deliberately
    // — an accidental `...` in a usage line would otherwise silently disable the surplus check.
    assert.notEqual(max, Infinity, `${s.path} declares an unbounded positional tail`);
  }
});

// A handler that passes its own schema as parseCommand's second argument owns a command schema
// the central registry cannot see.
const HANDLER_LOCAL_SCHEMA = /parseCommand\(\s*\w+\s*,/;

test("CMD-16: every registered positional schema matches the display-only usage line", () => {
  for (const command of all()) {
    const positionals = (command as CommandSpec & { positionals?: { min: number; max: number } }).positionals;
    // Consolidated: a field per clause. The "no handler supplies its own option schema" clause was
    // enforced only by `legacy-scan.sh` and had no witness here, so the obligations rested on the
    // positional-drift check alone.
    // ASSERT:CMD-16:POSITIONAL-SCHEMA-MATCHES-USAGE-AND-NO-HANDLER-OWNS-ITS-OWN-SCHEMA
    assert.deepEqual(
      {
        registered: positionals !== undefined,
        matchesUsage: positionals,
        handlerLocalSchemas: readdirSync("src/commands")
          .filter((file) => file.endsWith(".ts") && file !== "args.ts")
          .filter((file) => HANDLER_LOCAL_SCHEMA.test(readFileSync(join("src/commands", file), "utf8"))),
      },
      { registered: true, matchesUsage: usageArity(command), handlerLocalSchemas: [] },
      `${command.path} positional schema drifts from usage`,
    );
  }
});

test("P0-7: a command with no declared usage is not given invented bounds", () => {
  const undeclared: CommandSpec = { path: "x", summary: "", options: {}, positionals: { min: 0, max: 0 }, handler: () => 0 };
  assert.deepEqual(usageArity(undeclared), { min: 0, max: Infinity });
});

test("CMD-16: parsed-value helpers narrow strings, booleans, and repeated strings", () => {
  const values = { name: "api", force: true, repo: ["api", "web"], absent: undefined };
  assert.equal(stringValue(values, "name"), "api");
  assert.equal(stringValue(values, "absent"), undefined);
  assert.equal(booleanValue(values, "force"), true);
  assert.deepEqual(stringListValue(values, "repo"), ["api", "web"]);
  assert.deepEqual(stringListValue(values, "absent"), []);
  assert.throws(() => stringValue(values, "force"), /Option schema defect/);
  assert.throws(() => booleanValue(values, "name"), /Option schema defect/);
  assert.throws(() => stringListValue(values, "name"), /Option schema defect/);
});

test("CMD-16: registry validation refuses malformed runtime schemas", () => {
  assert.throws(
    () => register({ ...spec("bad bound", "bad bound"), positionals: { min: 2, max: 1 } }),
    /Invalid positional schema/,
  );
  assert.throws(
    () => register({ ...spec("bad option", "bad option"), options: { camelCase: { type: "string" } } }),
    /Invalid option name/,
  );
});
