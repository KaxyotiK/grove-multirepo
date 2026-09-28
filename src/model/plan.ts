import { GroveError } from "../errors.ts";
import type { OperationPlan } from "../store/operation.ts";
import type { RepositoryEntry, SyncStrategy } from "./types.ts";

/**
 * Ruling ①: an EMPTY selector selects nothing. Fanning out across every registered repository is
 * an explicit `all` opt-in, never an inference from silence.
 *
 * `grove new <name>` used to create a Tree and a branch in every repository when no `--repo` was
 * given, contradicting its own help ("Omit entirely to create an empty Grove"), its worked example,
 * and shipped `main`. A user with eight repositories got eight branches they never asked for.
 */
export function selectRepositoryRegistrations(
  repositories: readonly RepositoryEntry[],
  selectors: readonly string[],
  all = false,
): RepositoryEntry[] {
  if (all) {
    if (selectors.length > 0) {
      throw new GroveError({
        kind: "invalid-input",
        what: "--all cannot be combined with --repo",
        why: "--all selects every registered repository, so naming one is contradictory",
        remedy: "Pass --all on its own, or name each repository with --repo.",
      });
    }
    return [...repositories].sort((a, b) => a.id.localeCompare(b.id));
  }
  if (selectors.length === 0) return [];
  const selected: RepositoryEntry[] = [];
  const ids = new Set<string>();
  for (const selector of selectors) {
    const matches = repositories.filter((repository) => repository.id === selector || repository.name === selector);
    if (matches.length !== 1) {
      throw new GroveError({
        kind: "invalid-input",
        what: `No unique repository "${selector}"`,
        why: `the selector matched ${matches.length} registrations`,
        remedy: "Run `grove repo ls` and use one exact ID or alias.",
      });
    }
    const repository = matches[0] as RepositoryEntry;
    if (ids.has(repository.id)) {
      throw new GroveError({
        kind: "invalid-input",
        what: `Repository "${selector}" was selected more than once`,
        why: "aliases and IDs may not duplicate one durable repository target",
        remedy: "Remove the duplicate repository selector.",
      });
    }
    ids.add(repository.id);
    selected.push(repository);
  }
  return selected.sort((a, b) => a.id.localeCompare(b.id));
}

export interface CreationBranchEvidence {
  branch: string;
  explicit: boolean;
  localOid: string | null;
  remoteOid: string | null;
  fromProvided?: boolean;
  fromOid: string | null;
  defaultBaseOid: string | null;
  upstream: string | null;
}

export interface CreationBranchPlan {
  mode: "existing" | "remote" | "new";
  oid: string;
  upstream: string | null;
}

export interface AdvisoryBaseEvidence {
  trunk: string;
  localRef: string;
  localOid: string | null;
  remoteRef: string | null;
  remoteOid: string | null;
}

/** Resolve a repository's advisory creation base without creating a local ref. */
export function selectAdvisoryCreationBase(evidence: AdvisoryBaseEvidence): { revision: string; oid: string } {
  if (evidence.localOid !== null) return { revision: evidence.localRef, oid: evidence.localOid };
  if (evidence.remoteRef !== null && evidence.remoteOid !== null) return { revision: evidence.remoteRef, oid: evidence.remoteOid };
  throw new GroveError({
    kind: "refused-precondition",
    what: `Cannot resolve preferred trunk ${evidence.trunk}`,
    why: "neither its local branch nor configured remote-tracking branch resolves to a commit",
    remedy: "Fetch or create the preferred trunk, configure another trunk, or pass --from.",
    detail: { reason: "missing-revision", trunk: evidence.trunk, localRef: evidence.localRef, remoteRef: evidence.remoteRef },
  });
}

export function classifyCreationBranch(evidence: CreationBranchEvidence): CreationBranchPlan {
  const fromProvided = evidence.fromProvided ?? evidence.fromOid !== null;
  if (!evidence.explicit && (evidence.localOid !== null || evidence.remoteOid !== null)) {
    throw new GroveError({
      kind: "refused-conflict",
      what: `Derived branch ${evidence.branch} already exists`,
      why: "implicit naming never adopts an existing local or remote-tracking ref",
      remedy: `Pass an explicit --branch mapping for ${evidence.branch} to adopt it deliberately, or choose a different Grove/Tree name.`,
    });
  }
  if (evidence.localOid !== null) {
    if (fromProvided) {
      throw new GroveError({
        kind: "invalid-input",
        what: `--from is invalid for existing branch ${evidence.branch}`,
        why: "the explicit base would be ignored",
        remedy: "Remove --from or select an absent branch.",
      });
    }
    return { mode: "existing", oid: evidence.localOid, upstream: null };
  }
  if (evidence.remoteOid !== null) {
    if (fromProvided) {
      throw new GroveError({
        kind: "invalid-input",
        what: `--from is ambiguous for remote-only branch ${evidence.branch}`,
        why: "the exact remote ref already supplies the base",
        remedy: "Remove --from or select an absent branch.",
      });
    }
    return { mode: "remote", oid: evidence.remoteOid, upstream: evidence.upstream };
  }
  if (evidence.explicit && evidence.fromOid === null) {
    throw new GroveError({
      kind: "invalid-input",
      what: `Explicit new branch ${evidence.branch} requires --from`,
      why: "Grove does not guess a base for an explicit absent branch",
      remedy: "Pass --from <revision>.",
    });
  }
  const oid = evidence.fromOid ?? evidence.defaultBaseOid;
  if (oid === null) {
    throw new GroveError({
      kind: "refused-precondition",
      what: `Cannot plan branch ${evidence.branch}`,
      why: "neither an explicit base nor the configured default base resolves to a commit",
      remedy: "Pass --from <revision> or repair the configured trunk.",
      detail: { reason: "missing-revision" },
    });
  }
  return { mode: "new", oid, upstream: null };
}

export interface CreationTargetPlan {
  repositoryId: string;
  repositoryAlias: string;
  commonGitDir: string;
  grove?: string;
  tree?: string;
  path: string;
  branch: string;
  oid: string;
  mode: CreationBranchPlan["mode"];
  upstream: string | null;
  sourceRevision?: string | null;
  upstreamOid?: string | null;
}

export function buildCreationOperationPlan(
  kind: "new-grove" | "tree-add" | "trunk-add",
  scope: Record<string, string>,
  targets: readonly CreationTargetPlan[],
): OperationPlan {
  const ordered = [...targets].sort((left, right) =>
    `${left.repositoryId}\0${left.path}`.localeCompare(`${right.repositoryId}\0${right.path}`),
  );
  const locks = new Set<string>();
  if (scope.grove) locks.add(`grove:${scope.grove}`);
  for (const target of ordered) {
    locks.add(`repository:${target.repositoryId}:branch:${target.branch}`);
    locks.add(`worktree:${target.path}`);
  }
  return {
    kind,
    scope,
    targetLocks: [...locks].sort(),
    targets: ordered.map((target) => ({
      selector: {
        repositoryId: target.repositoryId,
        repositoryAlias: target.repositoryAlias,
        ...(target.grove ? { grove: target.grove } : {}),
        ...(target.tree ? { tree: target.tree } : {}),
        path: target.path,
      },
      steps: [
        {
          id: `worktree-${target.repositoryId}`,
          kind: "worktree-add",
          input: { path: target.path, commonGitDir: target.commonGitDir, branch: target.branch, oid: target.oid, mode: target.mode, sourceRevision: target.sourceRevision ?? null },
        },
        ...(target.upstream === null ? [] : [{
          id: `upstream-${target.repositoryId}`,
          kind: "set-upstream",
          input: { commonGitDir: target.commonGitDir, branch: target.branch, upstream: target.upstream, oid: target.oid, upstreamOid: target.upstreamOid ?? target.oid },
        }]),
      ],
    })),
  };
}

export interface SyncPlanningEvidence {
  strategy: SyncStrategy;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  sequencer: boolean;
}

export interface SyncIntegrationPlan {
  action: "fetch-only" | "none" | "fast-forward" | "rebase";
  reason: "dirty" | "sequencer-active" | "git-failed" | "diverged" | null;
}

export function planSyncIntegration(evidence: SyncPlanningEvidence): SyncIntegrationPlan {
  if (evidence.strategy === "fetch-only") return { action: "fetch-only", reason: null };
  if (evidence.sequencer) return { action: "none", reason: "sequencer-active" };
  if (evidence.dirty) return { action: "none", reason: "dirty" };
  if (evidence.ahead === null || evidence.behind === null) return { action: "none", reason: "git-failed" };
  if (evidence.behind === 0) return { action: "none", reason: null };
  if (evidence.strategy === "ff-only" && evidence.ahead > 0) return { action: "none", reason: "diverged" };
  return evidence.strategy === "rebase"
    ? { action: "rebase", reason: null }
    : { action: "fast-forward", reason: null };
}

export interface LifecycleSafetyEvidence { path: string; headOid: string | null; dirty: boolean | null; sequencer: boolean; detached: boolean; reachable: boolean | null; allowDestructive: boolean }
export interface LifecycleTargetPlan { action: "remove-worktree" | "refuse"; reason: "dirty" | "sequencer-active" | "unreachable-detached" | "git-failed" | null }
export function planLifecycleRemoval(evidence: LifecycleSafetyEvidence): LifecycleTargetPlan {
  if (evidence.detached && evidence.reachable !== true) return { action: "refuse", reason: "unreachable-detached" };
  if (evidence.sequencer && !evidence.allowDestructive) return { action: "refuse", reason: "sequencer-active" };
  if (evidence.dirty === null) return { action: "refuse", reason: "git-failed" };
  if (evidence.dirty && !evidence.allowDestructive) return { action: "refuse", reason: "dirty" };
  return { action: "remove-worktree", reason: null };
}

export interface MoveEvidence { diagnosticId: string; currentDiagnosticId: string | null; from: string; to: string; sourcePresent: boolean; destinationPresent: boolean }
export function planObservedMove(evidence: MoveEvidence): { action: "move-worktree" | "refuse"; reason: "stale-plan" | null; from: string; to: string } {
  return evidence.currentDiagnosticId === evidence.diagnosticId && evidence.sourcePresent && !evidence.destinationPresent
    ? { action: "move-worktree", reason: null, from: evidence.from, to: evidence.to }
    : { action: "refuse", reason: "stale-plan", from: evidence.from, to: evidence.to };
}
