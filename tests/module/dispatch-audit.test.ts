import { after, test } from "node:test";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerAll } from "../../src/commands/index.ts";
import { all, resolve, familyNames, inFamily } from "../../src/commands/registry.ts";

after(cleanupTempDirs);

registerAll();

type RuntimeSchema = {
  options?: Record<string, unknown>;
  positionals?: { min: number; max: number };
  forwardsExtras?: boolean;
};

function usageOptions(usage: string): string[] {
  return [...new Set(usage.match(/--[a-z][a-z0-9-]*/g) ?? [])]
    .map((name) => name.slice(2))
    .sort();
}

function groupedUsageTokens(rest: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of rest) {
    if (char === "[") depth++;
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
    if (char === "]") depth--;
  }
  if (current) tokens.push(current);
  return tokens;
}

function usagePositionals(command: { path: string; usage?: string }): string[] {
  const rest = (command.usage ?? "").slice(command.path.length).trim();
  const tokens = groupedUsageTokens(rest);
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as string;
    const bracketed = token.startsWith("[");
    const inner = bracketed ? token.slice(1, token.lastIndexOf("]")) : token.replace(/\.{3}$/, "");
    if (inner.startsWith("-")) {
      if (!bracketed && (tokens[index + 1] ?? "").startsWith("<")) index++;
      continue;
    }
    names.push((inner.match(/^<([^>]+)>/)?.[1] ?? inner).replace(/\.{3}$/, ""));
  }
  return names;
}

function optionShape(usage: string, name: string): { type: "string" | "boolean"; multiple: boolean } {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`--${escaped}(?:\\s+<[^>]+>(?:=<[^>]+>)?)?`).exec(usage);
  assert.ok(match, `usage has no --${name}`);
  const type = /\s+</.test(match[0]) ? "string" : "boolean";
  const tail = usage.slice((match.index ?? 0) + match[0].length);
  return { type, multiple: /^(?:\]\.{3}|\.{3})/.test(tail) };
}

test("every registered command has a handler and a non-empty summary", () => {
  const specs = all();
  assert.ok(specs.length >= 30, `expected the full surface, got ${specs.length}`);
  for (const s of specs) {
    assert.equal(typeof s.handler, "function", `${s.path} has no handler`);
    assert.ok(s.summary.length > 0, `${s.path} has no summary`);
  }
});

test("every command carries help syntax: a usage string starting with its own path", () => {
  for (const s of all()) {
    assert.ok(s.usage && s.usage.length > 0, `${s.path} has no usage string`);
    // Usage is rendered as `grove <usage>`, so it must lead with the command path itself.
    assert.ok(
      s.usage === s.path || s.usage.startsWith(`${s.path} `),
      `${s.path} usage "${s.usage}" does not start with its command path`,
    );
    // Every arg entry is a terse name+desc pair (no essays); a command with placeholders in its
    // usage must document them — a `<foo>` or `--foo` in the usage means at least one arg entry.
    for (const a of s.args ?? []) {
      assert.ok(a.name.length > 0 && a.desc.length > 0, `${s.path} has an empty arg entry`);
      assert.ok(!a.desc.includes("\n"), `${s.path} arg "${a.name}" description must be one line`);
    }
    const hasPlaceholder = /[<[]|--/.test((s.usage ?? "").slice(s.path.length));
    if (hasPlaceholder) assert.ok((s.args ?? []).length > 0, `${s.path} usage has args but none are documented`);
    // Every command shows at least one runnable example, each a copy-pasteable `grove …` line.
    assert.ok((s.examples ?? []).length > 0, `${s.path} has no examples`);
    for (const ex of s.examples ?? []) {
      assert.ok(ex.startsWith(`grove ${s.path}`), `${s.path} example "${ex}" must start with \`grove ${s.path}\``);
    }
  }
});

test("CMD-16: every command owns one runtime schema matching its usage and help", () => {
  for (const command of all()) {
    const schema = command as typeof command & RuntimeSchema;
    assert.ok(schema.options, `${command.path} has no registered option schema`);
    assert.ok(schema.positionals, `${command.path} has no registered positional schema`);
    assert.deepEqual(
      Object.keys(schema.options ?? {}).sort(),
      usageOptions(command.usage ?? ""),
      `${command.path} option schema drifts from usage`,
    );
    for (const [name, rawDescriptor] of Object.entries(schema.options ?? {})) {
      const descriptor = rawDescriptor as { type?: string; multiple?: boolean; default?: unknown };
      const documented = optionShape(command.usage ?? "", name);
      assert.equal(descriptor.type, documented.type, `${command.path} --${name} type drifts from usage`);
      assert.equal(Boolean(descriptor.multiple), documented.multiple, `${command.path} --${name} repetition drifts from usage`);
      if (documented.multiple) {
        assert.deepEqual(descriptor.default, [], `${command.path} --${name} repeatable default must be []`);
      } else if (documented.type === "boolean") {
        assert.equal(descriptor.default, false, `${command.path} --${name} boolean default must be false`);
      } else {
        assert.equal(descriptor.default, undefined, `${command.path} --${name} single-string option must have no default`);
      }
    }

    const documentedOptions = (command.args ?? [])
      .filter((arg) => arg.name.startsWith("--"))
      .map((arg) => arg.name.match(/^--([a-z][a-z0-9-]*)/)?.[1])
      .filter((name): name is string => name !== undefined)
      .sort();
    assert.deepEqual(
      [...new Set(documentedOptions)],
      Object.keys(schema.options ?? {}).sort(),
      `${command.path} help options drift from its runtime schema`,
    );

    const documentedPositionals = (command.args ?? [])
      .filter((arg) => !arg.name.startsWith("-"))
      .map((arg) => arg.name.match(/^<([^>]+)>/)?.[1] ?? arg.name);
    assert.equal(
      documentedPositionals.length,
      usagePositionals(command).length,
      `${command.path} help positional count drifts from usage`,
    );

    assert.equal(
      schema.forwardsExtras ?? false,
      command.path === "agent run",
      `${command.path} has the wrong forwarded-extras policy`,
    );
  }
});

test("CMD-16: every registered handler enters the one command parser", () => {
  for (const command of all()) {
    assert.match(String(command.handler), /parseCommand\(ctx\)/, `${command.path} bypasses parseCommand(ctx)`);
  }
});

test("every noun family exposes its subcommands for family help", () => {
  const fams = familyNames();
  for (const f of ["repo", "trunk", "tree", "agent", "config", "file"]) {
    assert.ok(fams.includes(f), `family "${f}" not detected`);
    assert.ok(inFamily(f).length >= 2, `family "${f}" should list its subcommands`);
  }
  // A bare verb is not a family.
  assert.ok(!fams.includes("new"), "bare verb 'new' must not be treated as a family");
});

test("the two-layer §8.1 surface resolves bare verbs and noun families", () => {
  // Bare verbs.
  for (const verb of ["init", "status", "new", "ls", "show", "reconcile", "archive", "restore", "delete", "rename", "configure", "changes", "commits", "against-trunk", "completion"]) {
    assert.ok(resolve([verb]), `bare verb "${verb}" is not registered`);
  }
  // Noun families (two-token wins over one-token).
  for (const [head, sub] of [["repo", "add"], ["trunk", "sync"], ["tree", "remove"], ["agent", "run"], ["config", "set"], ["file", "read"]] as const) {
    const m = resolve([head, sub]);
    assert.ok(m && m.consumed === 2, `noun-family command "${head} ${sub}" is not registered`);
  }
});

test("CMD-15: the removed diff command is absent while aggregate review commands remain", () => {
  // ASSERT:CMD-15:DIFF-ABSENT-REVIEW-COMMANDS-REMAIN
  assert.deepEqual(
    {
      diff: resolve(["diff"]),
      changes: Boolean(resolve(["changes"])),
      commits: Boolean(resolve(["commits"])),
      againstTrunk: Boolean(resolve(["against-trunk"])),
    },
    { diff: undefined, changes: true, commits: true, againstTrunk: true },
  );
});

test("every mutation is reachable from a command definition (no hidden surface)", () => {
  const paths = new Set(all().map((s) => s.path));
  for (const required of ["repo remove", "tree add", "tree reorder", "agent add"]) {
    assert.ok(paths.has(required), `missing command ${required}`);
  }
});

// ---------------------------------------------------------------------------
// 002-work-safety-force-SC-008 — the chokepoint gate.
//
// `docs/retro-failure-analysis.md` Mode 3 (in git history at b3f4951): a canonical-correct implementation existed and other
// call sites open-coded weaker versions, because work-safety was a CONVENTION rather than a
// function every destructive path is forced through. This test is what converts it into a
// chokepoint: a command that accepts `--force` and can destroy data must appear in DESTRUCTION.
//
// It is not hypothetical. `tree remove` and `trunk remove` were both overlooked during 002's
// planning while four sibling commands were being corrected, precisely because nothing forced
// them to declare what they remove.
// ---------------------------------------------------------------------------

/**
 * Command path → exact content `--allow-destructive-all` may discard. Refs are intentionally absent:
 * ruling ④ separates destroying content (this flag) from proceeding with unpushed work
 * (`--allow-unpushed`), and no lifecycle command deletes a ref under either.
 */
const DESTRUCTIVE_COMMANDS: Record<string, readonly string[]> = {
  archive: ["dirty worktree files"],
  delete: ["dirty worktree files", "loose Grove content"],
  "tree remove": ["dirty worktree files"],
  "trunk remove": ["dirty worktree files"],
};

test("002-work-safety-force-SC-008/V3DES-03: both destructive permission levels are audited", () => {
  const withForce = all()
    .filter((s) => (s.args ?? []).some((a) => a.name === "--allow-destructive-all"))
    .map((s) => s.path);

  assert.ok(withForce.length > 0, "the audit found no --allow-destructive-all commands at all — it is not actually looking");

  assert.deepEqual(all().filter((s) => (s.args ?? []).some((a) => a.name === "--allow-destructive-git-ignored")).map((s) => s.path).sort(), [...withForce].sort());
  // The old flags must be gone everywhere, or the chokepoint has a second door (V3DES-03).
  assert.deepEqual(
    all().filter((s) => (s.args ?? []).some((a) => a.name === "--force" || a.name === "--allow-destructive") || / --force(?:\s|$)| --allow-destructive(?:\s|$)/.test(s.usage ?? "")).map((s) => s.path),
    [],
    "--force and --allow-destructive are removed; content-loss flags and --allow-unpushed are distinct",
  );

  for (const path of withForce) {
    assert.ok(
      Object.hasOwn(DESTRUCTIVE_COMMANDS, path),
      `\`grove ${path}\` accepts --allow-destructive-all but has no explicit content-discard disposition.`,
    );
    assert.ok((DESTRUCTIVE_COMMANDS[path] ?? []).length > 0, `${path} must name the content --allow-destructive-all can discard`);
  }
});

test("ARCH-08/ARCH-09/ARCH-10/ARCH-20/ARCH-21/ARCH-25/ARCH-26/ARCH-27/ARCH-28/ARCH-29/002-work-safety-force-SC-008/FR-035: every force-capable implementation retains refs regardless of legacy reachability classification", () => {
  const sourceFiles = ["lifecycle.ts", "tree.ts", "trunk.ts"].map((file) =>
    readFileSync(new URL(`../../src/commands/${file}`, import.meta.url), "utf8"),
  );
  assert.ok(sourceFiles.every((source) => !/\.deleteRef\(|\["update-ref",\s*"-d"|\["branch",\s*"-(?:d|D)"/.test(source)), "a force-capable command contains a ref-deletion path");
  assert.ok(sourceFiles.every((source) => /refsRetained|retains its branch|retained/.test(source)), "each force-capable command must report ref retention");
});

// P3-6: `workspaceIndependent` was declared, set by two commands, and read nowhere — commands
// avoided workspace discovery only by convention. It is now enforced by `requireWorkspace`, so
// these tests pin both halves: the declaration is accurate, and it is actually load-bearing.

test("P3-6/003-git-native-grove-SC-013: every command declaring workspaceIndependent really runs without a workspace", async () => {
  const independent = all().filter((s) => s.workspaceIndependent);
  assert.ok(independent.length > 0, "no command declares workspaceIndependent — drop the field instead");

  for (const spec of independent) {
    // An empty directory with no workspace anywhere above it would make discovery throw.
    const empty = tempDir("indep");
    const ctx = {
      globals: { workspace: undefined, json: true, progressJson: false },
      argv: spec.path === "completion" ? ["bash"] : [],
      emit: { json: true, setJson: () => {}, ok: () => 0, fail: () => 1, result: (_value: unknown, exit: number) => exit },
      cwd: empty,
      spec,
    };
    // The assertion is that this does not throw the enforcement Error. A handler that needs a
    // workspace would hit `requireWorkspace` and fault immediately.
    await spec.handler(ctx as never);
  }
});

test("P3-6: requireWorkspace faults if a workspaceIndependent command asks for a workspace", async () => {
  const { requireWorkspace } = await import("../../src/config/workspace.ts");
  const lying = { path: "lying", summary: "", usage: "lying", handler: () => 0, workspaceIndependent: true };
  const ctx = {
    globals: { workspace: undefined, json: false, progressJson: false },
    argv: [],
    emit: { json: false, ok: () => 0, fail: () => 1 },
    cwd: process.cwd(),
    spec: lying,
  };
  // A programming defect, not a user error: a plain Error, which §9 routes to exit 1 (internal).
  assert.throws(() => requireWorkspace(ctx as never), /declared workspaceIndependent but required a workspace/);
});

test("P1.1: migrate is not a registered command", () => {
  // Deletion is proven by absence, so this is a gate rather than a behaviour test: it fails the
  // moment anything re-registers a migration entry point.
  const registered = all().map((spec) => spec.path);
  assert.equal(registered.includes("migrate"), false);
  assert.equal(registered.some((path) => path.startsWith("migrate ")), false);
});
