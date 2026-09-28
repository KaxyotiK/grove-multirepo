/**
 * Review commands (§8.7): `changes`, `commits`, `against-trunk`, `diff`. Read-only, no global
 * lock. The per-Tree comparison base is the Grove's `defaultBase` if set, otherwise the Tree
 * repository's trunk; a `defaultBase` missing from a Tree's repository refuses that Tree's
 * comparison rather than silently falling back.
 *
 * Extracted from the pinned source's change/commit/diff calculation as direct functions — no
 * transport or handler layer.
 */
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { commitsAhead, changedAgainst, porcelainStatus } from "../git/worktree.ts";
import { resolveContained } from "../paths/fs.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { observeWorkspace, type ObservedWorktree, type ObservedRepository, type ObservedGrove } from "../model/observed.ts";
import { completeResult, commandResultExit, type ResultTarget } from "../model/result.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";

const git = () => new Git(createGitRunner());

interface ReviewTree {
  grove: ObservedGrove;
  tree: ObservedWorktree;
  repository: ObservedRepository;
  path: string;
  base: string;
}

async function reviewTrees(ctx: CommandContext, groveRef: string | undefined, treeRef?: string): Promise<{ snapshot: Awaited<ReturnType<typeof observeWorkspace>>; trees: ReviewTree[] }> {
  if (!groveRef) throw new GroveError({ kind: "invalid-input", what: "a Grove is required", why: "no <grove> was given", remedy: "Run `grove ls` and pass a Grove name." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
  if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${groveRef}"`, why: "no observed or advisory Grove matches", remedy: "Run `grove ls`." });
  const selected = treeRef === undefined ? grove.trees : grove.trees.filter((tree) => tree.treeName === treeRef || tree.selector?.tree === treeRef || `${tree.selector?.repositoryId}/${tree.treeName}` === treeRef);
  if (treeRef !== undefined && selected.length !== 1) throw new GroveError({ kind: "invalid-input", what: `No unambiguous Tree "${treeRef}"`, why: selected.length === 0 ? "the selector matches no observed Tree" : "the selector matches multiple observed Trees", remedy: "Run `grove tree ls`." });
  const trees = selected.map((tree): ReviewTree => {
    const repository = snapshot.repositories.find((candidate) => candidate.registration?.id === tree.selector?.repositoryId);
    if (!repository?.registration) throw new GroveError({ kind: "config", what: "Cannot resolve the Tree repository", why: "the observed Tree has no unique repository registration", remedy: "Run `grove doctor` and repair the repository registration." });
    if (tree.path.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot address the Tree path", why: "the native path is not valid UTF-8", remedy: "Use native Git with the path evidence from `grove doctor`." });
    return { grove, tree, repository, path: tree.path.utf8, base: grove.metadata?.manifest.defaultBase ?? repository.registration.trunk };
  });
  return { snapshot, trees };
}

async function baseProblem(g: Git, tree: ReviewTree): Promise<string | null> {
  const check = await g.tryRun(tree.path, ["show-ref", "--verify", "--quiet", `refs/heads/${tree.base}`]);
  return check.exitCode === 0 ? null : `the comparison base "${tree.base}" does not exist in repository ${tree.repository.registration?.name}`;
}

function reviewResult(command: string, trees: ReviewTree[], after: unknown[], diagnostics: Awaited<ReturnType<typeof observeWorkspace>>["diagnostics"]): ReturnType<typeof completeResult> {
  const targets: ResultTarget[] = trees.map((item, index) => ({
    selector: { repositoryId: item.repository.registration?.id, repositoryAlias: item.repository.registration?.name, grove: item.grove.name, tree: item.tree.treeName ?? undefined, path: item.path },
    before: null,
    action: command,
    after: after[index] ?? null,
    reason: (after[index] as { problem?: unknown } | undefined)?.problem ? "git-failed" : null,
  }));
  const result = completeResult(command, targets, diagnostics, { grove: trees[0]?.grove.name ?? null, trees: after });
  const failed = targets.filter((target) => target.reason !== null).length;
  return failed === 0 ? result : { ...result, outcome: failed === targets.length ? "blocked" : "partial" };
}

async function changesHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const { snapshot, trees } = await reviewTrees(ctx, parsed.positionals[0], parsed.values.tree);
  const g = git();
  const out = await Promise.all(trees.map(async (item) => {
    const status = await porcelainStatus(g, item.path);
    return { repository: item.repository.registration?.name ?? null, tree: item.tree.treeName, branch: item.tree.branch?.utf8 ?? null, changes: status.changes, problem: status.problem };
  }));
  const result = reviewResult("changes", trees, out, snapshot.diagnostics);
  return ctx.emit.result(result, commandResultExit(result));
}

async function commitsHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  // Validate --limit up front: an unvalidated NaN/negative would otherwise be silently ignored or
  // fail deep in `git log -n…`, surfacing as a false "0 commit(s)" instead of an invalid-input error.
  let limit: number | undefined;
  if (parsed.values.limit !== undefined) {
    const n = Number(parsed.values.limit);
    if (!Number.isInteger(n) || n <= 0) {
      throw new GroveError({ kind: "invalid-input", what: "commits --limit must be a positive integer", why: `got "${parsed.values.limit}"`, remedy: "Pass a positive integer, e.g. --limit 10.", detail: { limit: parsed.values.limit } });
    }
    limit = n;
  }
  const { snapshot, trees } = await reviewTrees(ctx, parsed.positionals[0], parsed.values.tree);
  const g = git();
  const out: Array<{ tree: string | null; repository: string | null; branch: string | null; base: string } & Awaited<ReturnType<typeof commitsAhead>>> = [];
  for (const item of trees) {
    const missing = await baseProblem(g, item);
    const observed = missing ? { commits: [], problem: missing } : await commitsAhead(g, item.path, item.base, limit);
    out.push({ tree: item.tree.treeName, repository: item.repository.registration?.name ?? null, branch: item.tree.branch?.utf8 ?? null, base: item.base, ...observed } as typeof out[number]);
  }
  const result = reviewResult("commits", trees, out, snapshot.diagnostics);
  return ctx.emit.result(result, commandResultExit(result));
}

async function againstTrunkHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const { snapshot, trees } = await reviewTrees(ctx, parsed.positionals[0], parsed.values.tree);
  const g = git();
  const out: Array<{ tree: string | null; repository: string | null; branch: string | null; base: string } & Awaited<ReturnType<typeof changedAgainst>>> = [];
  for (const item of trees) {
    const missing = await baseProblem(g, item);
    const observed = missing ? { files: [], problem: missing } : await changedAgainst(g, item.path, item.base);
    out.push({ tree: item.tree.treeName, repository: item.repository.registration?.name ?? null, branch: item.tree.branch?.utf8 ?? null, base: item.base, ...observed } as typeof out[number]);
  }
  const result = reviewResult("against-trunk", trees, out, snapshot.diagnostics);
  return ctx.emit.result(result, commandResultExit(result));
}

export function registerReview(): void {
  register({
    path: "changes",
    summary: "List uncommitted changes.",
    usage: "changes <grove> [--tree <tree>]",
    args: [
      { name: "<grove>", desc: "Grove to inspect." },
      { name: "--tree <tree>", desc: "Limit to one Tree (default: every Tree)." },
    ],
    examples: [
      "grove changes pricing-fix                         # uncommitted changes across every Tree in the Grove",
      "grove changes pricing-fix --tree pricing-fix@web  # just the web Tree",
    ],
    handler: changesHandler,
  });
  register({
    path: "commits",
    summary: "List commits ahead of the base.",
    usage: "commits <grove> [--tree <tree>] [--limit <n>]",
    args: [
      { name: "<grove>", desc: "Grove to inspect." },
      { name: "--tree <tree>", desc: "Limit to one Tree (default: every Tree)." },
      { name: "--limit <n>", desc: "Cap commits listed per Tree (must be a positive integer)." },
    ],
    note: "Compares against the base (the Grove's default-base, else the repo's trunk); every selected Tree is reported, including a per-target missing-base problem.",
    examples: [
      "grove commits pricing-fix             # commits each Tree is ahead of its base",
      "grove commits pricing-fix --limit 20  # cap the list at 20 commits per Tree",
    ],
    handler: commitsHandler,
  });
  register({
    path: "against-trunk",
    summary: "List files changed relative to the base.",
    usage: "against-trunk <grove> [--tree <tree>]",
    args: [
      { name: "<grove>", desc: "Grove to inspect." },
      { name: "--tree <tree>", desc: "Limit to one Tree (default: every Tree)." },
    ],
    note: "Committed changes only — HEAD vs base since the merge-base (three-dot); uncommitted changes are not shown (use `changes`).",
    examples: [
      "grove against-trunk pricing-fix  # files each Tree has changed vs its base",
    ],
    handler: againstTrunkHandler,
  });
}
