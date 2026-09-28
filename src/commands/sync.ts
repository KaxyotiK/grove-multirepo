import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { porcelainStatus } from "../git/worktree.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { observeWorkspace, treeContainingPath, type ObservedRepository, type ObservedWorktree } from "../model/observed.ts";
import { assertTargetsAvailable, beginOperation, recordCompleted, recordPending, withOperationTargetLocks } from "../store/operation.ts";
import { commandResultExit, redactRemote, sortResultTargets, type CommandResultV1, type ResultTarget } from "../model/result.ts";
import type { SyncStrategy } from "../model/types.ts";
import { planSyncIntegration } from "../model/plan.ts";
import { refNameFromBytes } from "../model/encoding.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";
import { checkRemoteName } from "../model/validate.ts";

interface SyncTarget {
  repository: ObservedRepository;
  worktree: ObservedWorktree;
}

function reasonBeforeIntegration(target: SyncTarget, strategy: SyncStrategy): string | null {
  if (target.repository.problem || target.worktree.path.utf8 === null) return "git-failed";
  if (target.worktree.locked) return "locked";
  if (target.worktree.detached) return "detached";
  if (target.worktree.unborn) return "unborn";
  if (strategy !== "fetch-only" && target.worktree.sequencer) return "sequencer-active";
  return null;
}

async function configuredRemote(git: Git, path: string, branch: string): Promise<string | null> {
  const result = await git.tryRun(path, ["config", "--get", `branch.${branch}.remote`]);
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

async function resultRemote(git: Git, commonGitDir: string, remote: string | null): Promise<string | null> {
  if (remote === null) return null;
  if (checkRemoteName(remote) === null && redactRemote(remote) === remote) {
    const names = await git.tryRun(commonGitDir, ["remote"]);
    if (names.exitCode === 0 && names.stdout.split(/\r?\n/).includes(remote)) return remote;
  }
  return redactRemote(remote);
}

function selector(target: SyncTarget): ResultTarget["selector"] {
  return {
    repositoryId: target.repository.registration?.id,
    repositoryAlias: target.repository.registration?.name,
    ...(target.worktree.groveName ? { grove: target.worktree.groveName } : {}),
    ...(target.worktree.treeName ? { tree: target.worktree.treeName } : {}),
    ...(target.worktree.path.utf8 ? { path: target.worktree.path.utf8 } : {}),
  };
}

export async function syncHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const groveRef = parsed.positionals[0];
  if (parsed.positionals.length > 1) throw new GroveError({ kind: "invalid-input", what: "sync accepts at most one Grove", why: "extra positional arguments were supplied", remedy: "Pass one optional Grove name." });
  if (parsed.values.branch && !parsed.values.trunks) throw new GroveError({ kind: "invalid-input", what: "--branch requires --trunks", why: "branch filtering applies only to observed trunk worktrees", remedy: "Add --trunks or remove --branch." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  // P5.4 / decision R1 (ledger V-5). `init` writes `defaults.syncStrategy` and `workspace.ts`
  // validates it, but sync hard-coded its fallback and never read it — Grove ignoring a value it
  // authors itself. No regression risk: `init` writes `ff-only`, which is also the fallback, so a
  // default workspace is unaffected and only a user who deliberately set another strategy sees a
  // change, which is the fix.
  const strategy = (parsed.values.strategy ?? ws.config.defaults.syncStrategy ?? "ff-only") as SyncStrategy;
  if (!(["fetch-only", "ff-only", "rebase"] as const).includes(strategy)) throw new GroveError({ kind: "invalid-input", what: `Unknown sync strategy "${strategy}"`, why: "supported strategies are fetch-only, ff-only, and rebase", remedy: "Choose a supported strategy." });
  const git = new Git(createGitRunner());
  await git.probeCapabilities(ws.root, ["worktree-porcelain-z", "rev-parse-end-of-options"]);
  const snapshot = await observeWorkspace(ws, git);
  let targets: SyncTarget[] = [];
  if (groveRef) {
    const grove = snapshot.groves.find((candidate) => candidate.name === groveRef || candidate.metadata?.manifest.id === groveRef);
    if (!grove) throw new GroveError({ kind: "invalid-input", what: `No Grove "${groveRef}"`, why: "no observed or advisory Grove matches", remedy: "Run `grove ls`." });
    targets.push(...grove.trees.map((worktree) => ({ repository: snapshot.repositories.find((repository) => repository.registration?.id === worktree.selector?.repositoryId) as ObservedRepository, worktree })));
  }
  if (parsed.values.trunks) {
    for (const repository of snapshot.repositories) for (const worktree of repository.worktrees) if (worktree.role === "trunk") targets.push({ repository, worktree });
  }
  if (!groveRef && !parsed.values.trunks) {
    const containing = treeContainingPath(snapshot, ctx.cwd);
    if (!containing?.groveName) throw new GroveError({ kind: "refused-precondition", what: "Sync scope is ambiguous at workspace level", why: "no Grove or --trunks scope was supplied and cwd is not inside an observed Tree", remedy: "Pass a Grove, add --trunks, or run from inside a Tree." });
    const grove = snapshot.groves.find((candidate) => candidate.name === containing.groveName) as typeof snapshot.groves[number];
    targets.push(...grove.trees.map((worktree) => ({ repository: snapshot.repositories.find((repository) => repository.registration?.id === worktree.selector?.repositoryId) as ObservedRepository, worktree })));
  }
  if (parsed.values.repo) targets = targets.filter((target) => target.repository.registration?.id === parsed.values.repo || target.repository.registration?.name === parsed.values.repo);
  if (parsed.values.branch) targets = targets.filter((target) => target.worktree.branch?.utf8 === `refs/heads/${parsed.values.branch}`);
  const unique = new Map<string, SyncTarget>();
  for (const target of targets) unique.set(`${target.repository.registration?.id}\0${target.worktree.path.display}`, target);
  targets = [...unique.values()];
  if (targets.length === 0) throw new GroveError({ kind: "invalid-input", what: "Sync selected no targets", why: "the scope and filters match no observed worktree", remedy: "Run `grove tree ls` or `grove trunk ls` and adjust the filters." });

  const targetLocks = targets.map((target) => `sync:${target.repository.registration?.id}:${target.worktree.path.display}`);
  return withOperationTargetLocks(ws.root, targetLocks, "sync-attempt", async () => {
  assertTargetsAvailable(ws.root, targetLocks);
  const operation = beginOperation(ws.root, {
    kind: "sync-attempt",
    scope: { strategy },
    targetLocks,
    targets: targets.map((target, index) => ({ selector: Object.fromEntries(Object.entries(selector(target)).filter((entry): entry is [string, string] => typeof entry[1] === "string")), steps: [{ id: `sync-${index}`, kind: "sync-target", input: { strategy } }] })),
  });
  const results: ResultTarget[] = [];
  let anyEffect = false;
  let needsUser = false;
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index]!;
    const stepId = `sync-${index}`;
    const path = target.worktree.path.utf8;
    const before = { headOid: target.worktree.headOid, upstream: target.worktree.upstream?.utf8 ?? null, dirty: target.worktree.dirty, sequencer: target.worktree.sequencer?.kind ?? null };
    recordPending(operation, stepId, before);
    let reason = reasonBeforeIntegration(target, strategy);
    let refusal: { why: string; remedy: string } | null = null;
    if (reason === "sequencer-active") needsUser = true;
    let after: Record<string, unknown> | null = null;
    if (!reason && path) {
      const branch = target.worktree.branch?.utf8?.replace(/^refs\/heads\//, "") ?? null;
      const upstream = target.worktree.upstream?.utf8 ?? null;
      let remote = branch ? await configuredRemote(git, path, branch) : null;
      if (strategy !== "fetch-only" && !upstream) reason = "no-upstream";
      if (strategy === "fetch-only" && !remote) remote = target.repository.registration?.remote ?? null;
      let fetched = false;
      // V3SEC-05: re-check where a managed repository's fetch really goes, as Git resolves it now; a
      // linked repository is exempt (`repo link` accepts its remotes as the user configured them).
      if (!reason && remote && remote !== "." && target.repository.registration?.location.kind === "managed") {
        try { refusal = await git.fetchDestinationRefusal(target.repository.commonGitDir, remote); } catch { reason = "git-failed"; }
        if (refusal) reason = "refused-policy";
      }
      if (!reason && remote && remote !== ".") {
        try { await git.fetch(target.repository.commonGitDir, remote); fetched = true; anyEffect = true; }
        catch { reason = "git-failed"; }
      } else if (!reason && strategy === "fetch-only" && !remote) reason = "no-remote";
      if (!reason && strategy === "fetch-only") after = { status: "fetched-no-integration", remote: await resultRemote(git, target.repository.commonGitDir, remote), fetched, headOid: target.worktree.headOid };
      if (!reason && strategy !== "fetch-only") {
        const headNow = await git.currentHead(path);
        const upstreamNow = await git.upstream(path);
        const statusNow = await porcelainStatus(git, path);
        const sequencerNow = await git.sequencerState(path);
        if (headNow.oid !== target.worktree.headOid || upstreamNow?.utf8 !== upstream) reason = "stale-plan";
        else if (sequencerNow) { reason = "sequencer-active"; needsUser = true; }
        else if (statusNow.problem) reason = "git-failed";
        else if (statusNow.changes.length > 0) reason = "dirty";
        else {
          const upstreamRef = upstream ? refNameFromBytes(Buffer.from(upstream)) : null;
          const upstreamOid = upstreamRef ? await git.refOid(path, upstreamRef) : null;
          const relation = upstreamOid && upstreamRef ? await git.aheadBehind(path, upstreamRef).catch(() => null) : null;
          const integrationPlan = planSyncIntegration({ strategy, ahead: relation?.ahead ?? null, behind: relation?.behind ?? null, dirty: false, sequencer: false });
          reason = integrationPlan.reason;
          if (!reason && integrationPlan.action === "none") after = { status: (relation?.ahead ?? 0) > 0 ? "ahead-no-integration" : "up-to-date", upstream, upstreamOid, integratedOid: headNow.oid, ahead: relation?.ahead, behind: relation?.behind, fetched };
          else if (!reason && (integrationPlan.action === "fast-forward" || integrationPlan.action === "rebase") && upstreamOid) {
            let integrationFailed = false;
            try {
              if (integrationPlan.action === "rebase") await git.rebase(path, upstreamOid);
              else await git.fastForward(path, upstreamOid);
            } catch { integrationFailed = true; }
            anyEffect = true;
            if (integrationFailed) {
              const sequencer = await git.sequencerState(path);
              if (sequencer) { reason = "sequencer-active"; needsUser = true; }
              else reason = "git-failed";
              after = { status: sequencer ? "needs-user" : "integration-failed", upstream, upstreamOid, sequencer: sequencer?.kind ?? null, fetched };
            } else {
              const integratedOid = (await git.currentHead(path)).oid;
              after = { status: strategy === "rebase" ? "rebased" : "fast-forwarded", upstream, upstreamOid, integratedOid, ahead: relation?.ahead, behind: relation?.behind, fetched };
            }
          }
        }
      }
    }
    const targetResult: ResultTarget = { selector: selector(target), before, action: `sync-${strategy}`, after, reason, ...(refusal ? { detail: refusal } : {}) };
    results.push(targetResult);
    recordCompleted(operation, stepId, { after, reason });
  }
  const hasReason = results.some((target) => target.reason !== null);
  const outcome: CommandResultV1["outcome"] = needsUser ? "needs-user" : hasReason ? (anyEffect ? "partial" : "blocked") : "complete";
  const result: CommandResultV1 = { schemaVersion: 1, command: "sync", outcome, operationId: operation.id, targets: sortResultTargets(results), diagnostics: snapshot.diagnostics, detail: { strategy } };
  return ctx.emit.result(result, commandResultExit(result));
  });
}

export function registerSync(): void {
  register({
    path: "sync",
    summary: "Fetch and explicitly integrate clean observed branches.",
    usage: "sync [<grove>] [--repo <repo>] [--trunks] [--branch <branch>] [--strategy <fetch-only|ff-only|rebase>]",
    args: [
      { name: "<grove>", desc: "Select observed Trees in one Grove." },
      { name: "--repo <repo>", desc: "Filter selected targets to one repository." },
      { name: "--trunks", desc: "Include primary and additional trunk worktrees." },
      { name: "--branch <branch>", desc: "Filter trunks by exact branch; requires --trunks." },
      { name: "--strategy <strategy>", desc: "fetch-only, ff-only (default), or rebase." },
    ],
    note: "Never resets divergence or touches a native sequencer; rebase conflicts are left for the user.",
    examples: ["grove sync pricing-fix", "grove sync --trunks --repo api --strategy ff-only"],
    handler: syncHandler,
    mutates: true,
  });
}
