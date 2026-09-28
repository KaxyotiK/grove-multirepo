import assert from "node:assert/strict";
import { test } from "node:test";
import { commandHelp as buildCommandHelp, familyHelp, renderHumanHelp, topHelp, type CommandHelpDocument } from "../../src/help.ts";
import { registerAll } from "../../src/commands/index.ts";
import { all, familyNames, resolve } from "../../src/commands/registry.ts";
import { GLOBAL_OPTION_DEFINITIONS } from "../../src/commands/globals.ts";

registerAll();

const commandHelp: CommandHelpDocument = {
  usage: "grove sample <name> [--short] [--very-long-option <value>]",
  command: "sample",
  summary: "Show that help is formatted for a terminal.",
  arguments: [{ name: "<name>", desc: "A positional name with a description that wraps beneath the description column." }],
  options: [
    { name: "--short", desc: "A short option." },
    { name: "--very-long-option <value>", desc: "A longer option whose prose wraps cleanly at a narrow terminal width." },
  ],
  note: "This note is prose and should wrap beneath the Notes section without becoming an object field.",
  examples: ["grove sample demo --short # copyable example"],
};

test("top-level global help is derived from the parser-owned definitions", () => {
  assert.deepEqual(topHelp().globalOptions, GLOBAL_OPTION_DEFINITIONS.map(({ help }) => help));
});

test("V3HLP-04: human command help uses conventional sections without object-dump leakage", () => {
  const human = renderHumanHelp(commandHelp, 60);

  for (const heading of ["Usage:", "Arguments:", "Options:", "Notes:", "Examples:"]) {
    assert.match(human, new RegExp(`^${heading}$`, "m"));
  }
  assert.doesNotMatch(human, /^\s*-\s*$/m);
  assert.doesNotMatch(human, /^\s+(?:Name|Desc|Path|Summary):/m);
  assert.match(human, /^  grove sample <name>/m);
  assert.match(human, /^  grove sample demo --short # copyable example$/m);
});

test("V3HLP-04: names align and wrapped prose stays within the terminal width", () => {
  const human = renderHumanHelp(commandHelp, 60);
  const lines = human.split("\n");
  const short = lines.find((line) => line.includes("--short"))!;
  const long = lines.find((line) => line.includes("--very-long-option"))!;

  assert.equal(short.indexOf("A short option."), long.indexOf("A longer option"));
  assert.ok(lines.filter((line) => !line.includes("# copyable example")).every((line) => line.length <= 60));
  assert.ok(lines.some((line) => /^\s{2,}terminal width\.$/.test(line)), human);
});

test("V3HLP-04: real registry titles and usage syntax wrap with controlled indentation at 80 columns", () => {
  const reconcile = resolve(["reconcile"])?.spec;
  assert.ok(reconcile);

  const documents = [buildCommandHelp(reconcile), familyHelp("tree")];
  for (const document of documents) {
    const lines = renderHumanHelp(document, 80).split("\n");
    assert.ok(lines.every((line) => line.length <= 80), lines.filter((line) => line.length > 80).join("\n"));
  }

  const command = renderHumanHelp(buildCommandHelp(reconcile), 80);
  assert.match(command, /^grove reconcile — Resume pending structural operations, then audit observed Git$/m);
  assert.match(command, /^  state\.$/m);

  const family = renderHumanHelp(familyHelp("tree"), 80);
  assert.match(family, /^\s{11}\[--working-dir <path>\|--clear-working-dir\]$/m);
});

test("V3HLP-04: every registry help document remains controlled at the 40-column floor", () => {
  const created = resolve(["new"])?.spec;
  const sync = resolve(["sync"])?.spec;
  assert.ok(created);
  assert.ok(sync);

  const command = renderHumanHelp(buildCommandHelp(created), 40);
  const family = renderHumanHelp(familyHelp("tree"), 40);
  const synchronized = renderHumanHelp(buildCommandHelp(sync), 40);
  const documents = [topHelp(), ...familyNames().map(familyHelp), ...all().map(buildCommandHelp)];
  for (const document of documents) {
    const human = renderHumanHelp(document, 40);
    const lines = human.split("\n");
    const examples = lines.indexOf("Examples:");
    const controlled = examples === -1 ? lines : lines.slice(0, examples + 1);
    assert.ok(controlled.every((line) => line.length <= 40), controlled.filter((line) => line.length > 40).join("\n"));
  }

  assert.match(command, /^  --prefix <prefix>\n    Prefix for the derived branch name/m);
  assert.match(command, /^    defaults\.branchPrefix, usually$/m);
  assert.match(family, /^           <tree> \[--default-agent$/m);
  assert.match(family, /^           <agent>\|$/m);
  assert.match(family, /^           --clear-default-agent\]$/m);
  assert.match(synchronized, /^    <fetch-only\|ff-only\|rebase>\]$/m);
  assert.doesNotMatch(synchronized, /fetch-only\|\s+ff-only/);
});
