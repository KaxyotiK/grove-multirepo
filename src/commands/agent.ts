/**
 * Agent commands (§8.8). Agents are workspace-local command definitions (command + args only).
 * `agent run` is one foreground child process inheriting stdio and terminal size; Grove does NOT
 * detach, supervise, resume, attach, record, or background it.
 *
 * Extracted from the pinned source's agent CRUD and executable/cwd validation; the launch
 * hierarchy is replaced by a single foreground spawn with inherited stdio and signal forwarding.
 */
import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import { accessSync, constants, existsSync } from "node:fs";
import { GroveError } from "../errors.ts";
import { requireWorkspace, saveWorkspace } from "../config/workspace.ts";
import { normalisePath } from "../config/discovery.ts";
import type { AgentDefinition, WorkspaceConfig } from "../model/types.ts";
import { CONTROL_RE, visibleControl as visible } from "../model/control.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { observeWorkspace, treeContainingPath, type ObservedGrove, type ObservedWorktree } from "../model/observed.ts";
import { resolveContained } from "../paths/fs.ts";
import { completeResult } from "../model/result.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand, stringListValue } from "./args.ts";

// Agent definitions live in the COMMITTED, shared `.grove/config.json`, so a crafted value travels
// with a repo. A control character (C0/C1/DEL) or a bidi override (U+202E "Trojan Source") in a
// name/command/arg would inject or visually reorder a teammate's terminal output when rendered in
// human mode -- reject on write. See src/model/control.ts for the covered classes.
function assertNoControl(value: string, label: string): void {
  if (CONTROL_RE.test(value)) {
    throw new GroveError({
      kind: "invalid-input",
      what: `Cannot use a control character in the agent ${label}`,
      why: "the value contains a control or bidi-override character (e.g. ESC or U+202E), which could inject or reorder terminal output",
      remedy: "Remove control and bidirectional-formatting characters from the value.",
      detail: { label },
    });
  }
}

async function addHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const name = parsed.positionals[0];
  const command = parsed.positionals[1];
  if (!name || !command) throw new GroveError({ kind: "invalid-input", what: "agent add requires <name> and <command>", why: "missing positional arguments", remedy: "Use `grove agent add <name> <command> [--arg <arg>]...`." });
  assertNoControl(name, "name");
  assertNoControl(command, "command");
  const args = stringListValue(parsed.values, "arg");
  for (const a of args) assertNoControl(a, "argument");
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const replaced = ws.config.agents[name] ?? null;
  const def: AgentDefinition = { command, args };
  const makeDefault = parsed.values.default === true;
  const next: WorkspaceConfig = {
    ...ws.config,
    agents: { ...ws.config.agents, [name]: def },
    ...(makeDefault ? { defaults: { ...ws.config.defaults, agent: name } } : {}),
  };
  await saveWorkspace(ws, next);
  return ctx.emit.ok({ agent: name, command, args: def.args, replaced, default: makeDefault });
}

async function removeHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const name = parsed.positionals[0];
  if (!name) throw new GroveError({ kind: "invalid-input", what: "agent remove requires <name>", why: "no agent name given", remedy: "Pass the agent name." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  if (!(name in ws.config.agents)) throw new GroveError({ kind: "invalid-input", what: `No agent "${name}"`, why: "no agent by that name is defined", remedy: "Run `grove agent ls`." });
  const agents = { ...ws.config.agents };
  delete agents[name];
  await saveWorkspace(ws, { ...ws.config, agents });
  return ctx.emit.ok({ agent: name, removed: true });
}

function onPath(command: string): boolean {
  const executable = (path: string): boolean => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };
  if (command.includes("/")) return executable(command);
  const dirs = (process.env.PATH ?? "").split(":");
  return dirs.some((d) => d && executable(`${d}/${command}`));
}

function lsHandler(ctx: CommandContext): number {
  parseCommand(ctx); // reject unknown flags/positionals consistently
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const agents = Object.entries(ws.config.agents).map(([name, def]) => ({ name, command: def.command, args: def.args, available: onPath(def.command) }));
  return ctx.emit.ok({ agents, default: ws.config.defaults.agent ?? null });
}

async function spawnAgent(ctx: CommandContext, definition: AgentDefinition, extra: string[], workingDir: string): Promise<number> {
  const childStdio: import("node:child_process").StdioOptions = ctx.emit.json ? ["inherit", 2, "inherit"] : "inherit";
  return new Promise<number>((resolve, reject) => {
    const child = spawn(definition.command, [...definition.args, ...extra], { cwd: workingDir, stdio: childStdio });
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", (error) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      reject(new GroveError({
        kind: "io",
        what: `Cannot start agent "${visible(definition.command)}"`,
        why: error.message,
        remedy: "Install or fix the configured executable, then retry.",
        detail: { command: definition.command },
        cause: error,
      }));
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      resolve(signal ? 128 + (osConstants.signals[signal] ?? 0) : (code ?? 0));
    });
  });
}

async function runAgent(ctx: CommandContext, groveRef: string | undefined, treeRef: string | undefined, agentOverride: string | undefined, extra: string[]): Promise<number> {
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, new Git(createGitRunner()));
  let grove: ObservedGrove | undefined;
  let tree: ObservedWorktree | null | undefined;
  if (groveRef) {
    grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
    if (!grove || grove.metadata?.state === "archived") throw new GroveError({ kind: "invalid-input", what: `No active Grove "${groveRef}"`, why: "no active observed or advisory Grove matches", remedy: "Run `grove ls`." });
    const trees = treeRef === undefined ? grove.trees : grove.trees.filter((candidate) => candidate.treeName === treeRef || candidate.selector?.tree === treeRef || `${candidate.selector?.repositoryId}/${candidate.treeName}` === treeRef);
    // U-11 (§8.8). The remedy used to be "Run `grove tree ls` and pass --tree", which sends the
    // user to another command for information this one already has in hand. List the Trees here.
    if (trees.length !== 1) {
      const names = grove.trees.map((candidate) => candidate.treeName ?? candidate.selector?.tree).filter(Boolean).sort();
      throw new GroveError({
        kind: "invalid-input",
        what: `${grove.name} has ${trees.length} selected Trees`,
        why: treeRef ? "the Tree selector is missing or ambiguous" : "no --tree was given for a Grove without exactly one Tree",
        remedy: names.length === 0 ? "Add a Tree with `grove tree add`." : `Pass one of --tree ${names.join(", --tree ")}.`,
        detail: { grove: grove.name, trees: names },
      });
    }
    tree = trees[0];
  } else {
    tree = treeContainingPath(snapshot, normalisePath(ctx.cwd));
    if (!tree?.groveName) throw new GroveError({ kind: "refused-precondition", what: "Not inside a Grove Tree", why: "the current directory is not inside an observed Tree worktree", remedy: "Run from inside a Tree, or pass <grove> [--tree]." });
    grove = snapshot.groves.find((candidate) => candidate.name === tree?.groveName);
    if (!grove) throw new GroveError({ kind: "config", what: "Cannot resolve the containing Grove", why: "the observed Tree has no Grove catalog entry", remedy: "Run `grove doctor`." });
  }
  if (!tree || tree.path.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot address the Tree path", why: "the native path is not valid UTF-8", remedy: "Use native Git with `grove doctor` path evidence." });
  const settings = tree.selector ? grove.metadata?.manifest.treeSettings.find((entry) => entry.selector.repositoryId === tree.selector?.repositoryId && entry.selector.tree === tree.selector?.tree) : undefined;
  const agentName = agentOverride ?? settings?.defaultAgent ?? grove.metadata?.manifest.defaultAgent ?? ws.config.defaults.agent;
  if (!agentName) throw new GroveError({ kind: "refused-precondition", what: "No agent to run", why: "no explicit, Tree, Grove, or workspace default agent resolved", remedy: "Pass --agent or configure a default." });
  const definition = ws.config.agents[agentName];
  if (!definition) throw new GroveError({ kind: "invalid-input", what: `No agent "${visible(agentName)}"`, why: "no agent by that name is defined", remedy: "Run `grove agent ls`." });
  if (!onPath(definition.command)) throw new GroveError({ kind: "refused-precondition", what: `Agent "${agentName}" is unavailable`, why: `its executable "${visible(definition.command)}" is absent from PATH or is not executable`, remedy: "Install/fix the executable or choose another configured agent." });
  const workingDir = settings?.workingDir ? resolveContained(tree.path.utf8, settings.workingDir, "Cannot use the Tree working directory") : tree.path.utf8;
  const exitCode = await spawnAgent(ctx, definition, extra, workingDir);
  const after = { agent: agentName, workingDir, exitCode };
  const result = completeResult("agent run", [{ selector: { repositoryId: tree.selector?.repositoryId, grove: grove.name, tree: tree.treeName ?? undefined, path: tree.path.utf8 }, before: null, action: "run-agent", after, reason: exitCode === 0 ? null : "agent-failed" }], snapshot.diagnostics, after);
  return ctx.emit.result(result, exitCode);
}

async function runHandler(ctx: CommandContext): Promise<number> {
  // Split off the extra args after `--`.
  const dd = ctx.argv.indexOf("--");
  const extra = dd >= 0 ? ctx.argv.slice(dd + 1) : [];
  const parsed = parseCommand(ctx);
  const groveRef = parsed.positionals[0];

  return runAgent(ctx, groveRef, parsed.values.tree, parsed.values.agent, parsed.extras.length > 0 ? parsed.extras : extra);
}

export function registerAgent(): void {
  register({
    path: "agent add",
    summary: "Define a workspace-local agent.",
    usage: "agent add <name> <command> [--arg <arg>]... [--default]",
    args: [
      { name: "<name>", desc: "Name to reference the agent by." },
      { name: "<command>", desc: "Executable to run." },
      { name: "--default", desc: "Also make this the workspace default agent, so `agent run` needs no --agent." },
      { name: "--arg <arg>", desc: "A fixed argument passed to the command (repeatable)." },
    ],
    note: "Stores a command + fixed args only (no shell); control/bidi-override characters are rejected on write.",
    examples: [
      "grove agent add claude claude                              # define agent \"claude\" running the claude executable",
      "grove agent add review codex --arg exec --arg=--full-auto  # dash-leading arg values need = (run `codex exec --full-auto`)",
    ],
    handler: addHandler,
    mutates: true,
  });
  register({
    path: "agent ls",
    summary: "List agents and executable availability.",
    usage: "agent ls",
    examples: ["grove agent ls"],
    handler: lsHandler,
  });
  register({
    path: "agent remove",
    summary: "Remove an agent definition.",
    usage: "agent remove <name>",
    args: [{ name: "<name>", desc: "Agent to remove." }],
    examples: ["grove agent remove review"],
    handler: removeHandler,
    mutates: true,
  });
  register({
    path: "agent run",
    summary: "Run an agent in the foreground.",
    usage: "agent run [<grove>] [--tree <tree>] [--agent <agent>] [-- <extra-args>...]",
    args: [
      { name: "<grove>", desc: "Grove to run in (default: the Grove whose Tree contains the cwd)." },
      { name: "--tree <tree>", desc: "Tree to run in (required for a multi-Tree Grove)." },
      { name: "--agent <agent>", desc: "Agent to run (default: the Tree/Grove/workspace default)." },
      { name: "-- <extra-args>", desc: "Arguments forwarded to the agent verbatim." },
    ],
    note: "One foreground child in the Tree's worktree; its exit code passes through unchanged under §9.1, and grove does not detach or supervise it (with --json agent stdout is routed to stderr).",
    examples: [
      "grove agent run                                                    # inside a Tree, run its default agent",
      "grove agent run pricing-fix --tree pricing-fix@web --agent claude  # run claude in the web Tree of pricing-fix",
      "grove agent run pricing-fix --tree pricing-fix@api -- --model opus # forward --model opus to the agent",
    ],
    handler: runHandler,
    forwardsExtras: true,
  });
}
