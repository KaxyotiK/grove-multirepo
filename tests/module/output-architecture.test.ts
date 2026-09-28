import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { registerAll } from "../../src/commands/index.ts";
import { all } from "../../src/commands/registry.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMMANDS = join(ROOT, "src", "commands");

registerAll();

test("V3OUT-03: every registered command is covered by the source architecture audit", () => {
  const registered = all();
  assert.ok(registered.length > 0);
  assert.equal(new Set(registered.map((command) => command.path)).size, registered.length);

  const index = readFileSync(join(COMMANDS, "index.ts"), "utf8");
  const productionModules = readdirSync(COMMANDS)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !["args.ts", "globals.ts", "index.ts", "registry.ts"].includes(name));
  for (const module of productionModules) {
    assert.match(index, new RegExp(`from \\"\\./${module.replace(/\.ts$/, "")}\\.ts\\"`), `${module} is outside registerAll and therefore outside the audit`);
  }
});

test("V3OUT-03/003-git-native-grove-SC-017: handlers cannot define a second rendering or bypass the emitter", () => {
  const findings: string[] = [];
  for (const name of readdirSync(COMMANDS).filter((file) => file.endsWith(".ts"))) {
    const source = readFileSync(join(COMMANDS, name), "utf8");
    const sourceFile = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.getText(sourceFile) === "ctx.emit"
      ) {
        const method = node.expression.name.text;
        if (method === "help") findings.push(`${name}: command code can invoke the help-only emitter path`);
        const expected = method === "ok" ? 1 : method === "result" ? 2 : node.arguments.length;
        if (node.arguments.length !== expected) findings.push(`${name}: ${method} has ${node.arguments.length} arguments, expected ${expected}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (/process\.(?:stdout|stderr)\.write|console\.(?:log|error)/.test(source)) findings.push(`${name}: direct process/console output`);
  }

  const output = readFileSync(join(ROOT, "src", "output.ts"), "utf8");
  if (/human\??\s*:|human\s*\?/.test(output)) findings.push("output.ts: emitter accepts a human-only projection");

  const cli = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
  if (/process\.stdout\.write/.test(cli)) findings.push("cli.ts: help/version bypasses the emitter");

  assert.deepEqual(findings, [], `output architecture gaps:\n  ${findings.join("\n  ")}`);
});

test("V3HLP-04: registry help uses one explicit presentation path without weakening result architecture", () => {
  const output = readFileSync(join(ROOT, "src", "output.ts"), "utf8");
  const cli = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
  const registry = readFileSync(join(ROOT, "src", "commands", "registry.ts"), "utf8");
  const globals = readFileSync(join(ROOT, "src", "commands", "globals.ts"), "utf8");
  const help = readFileSync(join(ROOT, "src", "help.ts"), "utf8");
  const completion = readFileSync(join(ROOT, "src", "commands", "completion.ts"), "utf8");

  assert.match(output, /export interface CommandEmitter/);
  assert.match(output, /help\(value:\s*HelpDocument\): number/);
  assert.match(output, /function writeHelp\([^)]*\)[^{]*\{[^}]*renderHumanHelp/s);
  assert.match(output, /help\(value\)\s*\{\s*writeHelp\(value, asJson, process\.stdout\)/);
  for (const builder of ["topHelp", "familyHelp", "commandHelp"]) {
    assert.match(cli, new RegExp(`emit\\.help\\(${builder}\\(`));
    assert.doesNotMatch(cli, new RegExp(`emit\\.ok\\(${builder}\\(`));
  }
  assert.match(cli, /const preliminary = scanGlobals\(raw\)\.scan/);
  assert.match(cli, /const definitive = scanGlobals\(raw, preliminaryMatch\?\.spec\.options/);
  assert.doesNotMatch(cli, /scanGlobals\(preliminary\.rest/);
  assert.doesNotMatch(cli, /preliminary\.version/);
  assert.match(cli, /if \(definitive\.scan\.version\) return emit\.ok\(VERSION\)/);
  assert.match(registry, /import type \{ CommandEmitter \}/);
  assert.match(registry, /emit:\s*CommandEmitter/);
  assert.doesNotMatch(registry, /emit:\s*Emitter/);
  assert.match(globals, /GLOBAL_OPTION_DEFINITIONS/);
  assert.match(help, /GLOBAL_OPTION_DEFINITIONS\.map\(\(\{ help \}\)/);
  assert.match(completion, /GLOBAL_OPTION_DEFINITIONS\.flatMap\(\(\{ completion \}\)/);
});

test("json-results-v1 names every raw-value (non-CommandResult) emission", () => {
  // The contract lists `config get`, `config set`, `agent add`/`remove`/`ls`, and `completion` as the
  // raw-value command results (`--version` is emitted by the dispatcher). A new `emit.ok` call must
  // be added to that list, or become a CommandResult.
  const rawEmissions = Object.fromEntries(readdirSync(COMMANDS)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => [name, readFileSync(join(COMMANDS, name), "utf8").match(/\bemit\.ok\(/g)?.length ?? 0] as const)
    .filter(([, count]) => count > 0));
  assert.deepEqual(rawEmissions, { "agent.ts": 3, "completion.ts": 1, "workspace.ts": 2 });
});
