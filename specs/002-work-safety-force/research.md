# Phase 0 — Research: deriving `--force` from destruction

**Feature**: `002-work-safety-force` · **Date**: 2026-08-16

All findings below were produced by running Git against a purpose-built fixture, not by reading documentation. The fixture is reproduced in [quickstart.md](./quickstart.md) so any reviewer can re-derive them.

**Fixture shape** — one bare origin, one clone, and four branches chosen to separate the cases the old predicate conflated:

| Branch | Construction | Genuinely at risk? |
|---|---|---|
| `merged` | commit merged into `main`, never pushed under its own name | no — `main` holds the commit |
| `unique` | one commit reachable from nothing else | **yes** |
| `tagged` | one commit reachable only via tag `keep-me` | depends on scope (see R2) |
| `pushed` | one commit, pushed, has `origin/pushed` | no |

---

## R1 — The old predicate is wrong in the dangerous direction _and_ the annoying one

**Decision**: Replace "does `refs/remotes/origin/<branch>` exist" with a reachability test.

**Evidence**: `src/git/worktree.ts` `classifyWork` returns `unpushed` when `show-ref --verify refs/remotes/origin/<branch>` fails. Against the fixture that labels `merged` as unpushed — a branch whose every commit is already in `main`. In a worktree workflow where branches land by squash or `--no-ff` merge and are never individually pushed, that is the **normal** end state, so the refusal fires on almost every finished Grove.

**Rationale**: The constitution defines at-risk as "commits reachable from no other ref". Remote existence is a proxy that is neither necessary (a merged branch is safe without a remote) nor sufficient (`origin/<b>` may exist and lag far behind).

**Alternatives considered**:

- _Merge-base against the trunk_ — rejected: needs a trunk to compare against, which linked repositories and detached states may not have, and it misses commits saved by a tag or a sibling branch.
- _`@{upstream}` tracking config_ — rejected: §8.5.1 explicitly does not require a configured upstream, and grove-created branches have none.
- _Reflog as a safety net_ — rejected: a reflog is not a ref, it expires, and it is not something a user can be told to rely on. Recorded in the spec's Assumptions.

---

## R2 — The surviving-ref set is a parameter, not a constant _(changed the spec)_

**Decision**: Judge each ref against **the refs that survive the specific operation**, and pass that set in per command.

**Evidence** — the same branch gets opposite, and equally correct, answers under the two scopes:

```
scope A: --not --exclude=<b> --branches --remotes --tags     (repo survives, specific refs removed)
scope B: --not --remotes                                     (whole object store deleted)

  branch    scope A   scope B
  merged      0         0
  unique      1         1
  tagged      0         1     <- tag saves it under A; the tag dies with the store under B
  pushed      0         0
```

**Rationale**: `archive`, `delete`, and `repo delete-branch` remove named refs from a repository that continues to exist, so every _other_ ref in it still holds whatever it holds. `repo remove` on a managed repository deletes `.bare/<name>` outright — no local branch and no tag survives, so only remote-tracking refs count as elsewhere.

**Impact**: This contradicted the spec as first written. `FR-001` was rewritten to make the surviving set an explicit parameter and `FR-007` to name scope B; a new edge case records the `tagged` divergence. Caught here rather than in review because the fixture separated tag-reachability from branch-reachability.

**Alternatives considered**:

- _One global predicate for every command_ — rejected: it is provably wrong for one of the two scopes whichever way it is written, and picking scope A for `repo remove` loses tagged commits silently.
- _Always use scope B (remote-only) as the conservative choice_ — rejected: it re-creates exactly the R1 false positive for `archive`/`delete`, which is the problem this feature exists to fix.

---

## R3 — Sibling refs must be excluded together, or the check inverts _(latent data-loss bug)_

**Decision**: Exclude **all** refs the operation removes in a single `rev-list` judgment.

**Evidence** — two branches pointing at the same otherwise-unreachable commit, both slated for deletion:

```
  pairA, judged with only pairA excluded         -> 0   ("safe": pairB reaches the commit)
  pairA, judged with pairA+pairB+unique excluded -> 1   (correct: every holder is doomed)
```

**Rationale**: A per-branch loop asks "does anything else hold this commit?" while the siblings that hold it are themselves about to be deleted. Every branch vouches for the next and the whole set passes clean. `grove delete` on a Grove with several `created` Trees on related branches is exactly this shape.

**Impact**: Added `FR-001a` and an edge case. This is the one finding here that is a **silent data-loss** path rather than a usability defect, and it would have been introduced _by_ a naive implementation of this feature — the current code does not have it, because its predicate never looks at sibling branches at all.

---

## R4 — Two `rev-list` spellings that fail OPEN

**Decision**: Use `git rev-list --count <ref> --not --exclude=<name> [--exclude=<name>…] --branches --remotes --tags`, with bare branch names in `--exclude` and never `--all`.

**Evidence** — on a fixture where `unique` genuinely holds an unreachable commit (correct answer `1`):

| Spelling | Result | Why |
|---|---:|---|
| `--exclude=unique --branches --remotes --tags` | `1` ✅ | correct |
| `--exclude=refs/heads/unique --branches …` | `0` ❌ | `--exclude` matches against what the *next* selector yields; `--branches` yields short names, so the fully-qualified pattern matches nothing and the branch is never excluded |
| `--exclude=unique --all` | `0` ❌ | `--all` re-includes per-worktree `HEAD`, which `--exclude` does not cover; a checked-out branch is always reachable from its own worktree `HEAD` |

**Rationale**: Both wrong spellings report **0 — safe** for a branch that is genuinely at risk. They fail open, in the direction that destroys work, and they do so silently on exactly the branches a user cares most about. This is why the classifier needs a test whose fixture contains a genuinely unreachable commit; a fixture of only-safe branches passes under all three spellings.

**Implementation note**: `--exclude` applies only to the **next** ref-selector and accumulates until consumed. `--exclude=a --exclude=b --branches --remotes --tags` therefore excludes `a` and `b` from `--branches` only — which is precisely right, since a local branch name should not suppress `origin/a` from the surviving set.

**Alternatives considered**:

- _`--not --branches --remotes --tags` with the ref filtered in TypeScript_ — rejected: requires enumerating and shelling per ref, and re-implements globbing Git already does.
- _`for-each-ref` + `merge-base --is-ancestor` per pair_ — rejected: O(refs²) process spawns, and ancestry is not the question; reachability from a _set_ is.

---

## R5 — Classification must not throw, because `--force` now depends on it

**Decision**: `classifyWork` returns an `unknown` state instead of throwing; `--force` classifies first and reports.

**Evidence**: `src/git/worktree.ts` throws `refused-precondition` when `isDirty` cannot read the worktree. `src/commands/lifecycle.ts` therefore guards with `parsed.values.force ? [] : await classifyGrove(...)`, whose own comment explains the reason: _"an unreadable worktree makes classifyGrove throw and blocks the very --force meant to force past it."_

That guard is why `--force` today destroys work silently — it never classifies, so it has nothing to report. FR-011 requires the report, so the throw has to go.

**Rationale**: Fail-closed and never-throw are compatible: `unknown` blocks without `--force` (fail-closed, per the constitution) and is itemized as an unknown-state discard with `--force`. The throw conflated "cannot read" with "cannot proceed".

**Alternatives considered**:

- _Keep the throw and catch it at each call site_ — rejected: three call sites, each needing the same recovery, and a caught-and-ignored error is how the state becomes invisible again.
- _Report `unknown` as `dirty`_ — rejected: violates Principle V (refuse, never guess) and produces a refusal message naming a file count it does not have.

---

## R6 — `repo remove` on a linked repository destroys nothing

**Decision**: Skip work-safety entirely for linked repositories; keep the Grove-reference refusal.

**Evidence**: `src/commands/repo.ts:177` records `trunks: []` for every linked repository, and the teardown at `repo.ts:277-283` removes trunk worktrees and then `rmSync`s the object store **only when `mode === "managed"`**. So for a linked repo the command removes nothing but the registry entry. Yet `repo.ts:271-273` refuses when `repo.remote === null` — a branch-safety refusal on a repository whose branches it never touches.

**Rationale**: Derivation, applied literally. Nothing is removed, so nothing may be demanded.

**Boundary**: The refusal for a repository still referenced by an active or archived Grove (`repo.ts:243-250`) is **not** work-safety — it prevents dangling references, destroys nothing, and correctly blocks even with `--force`. Out of scope, and must not be swept into this change.

---

## R7 — Provenance is already recorded; nothing new to persist

**Decision**: Read `TreeEntry.provenance` for FR-006; no manifest schema change, no migration.

**Evidence**: `src/model/types.ts:10` declares `type Provenance = "created" | "adopted"` and `types.ts:60` puts `provenance: Provenance` on every `TreeEntry`. `grove.ts:213` and `tree.ts:90` confirm adoption keeps `"adopted"` through the failure paths.

**Rationale**: `delete` already deletes only `created` refs at teardown — the manifest field driving that decision is the same one that should drive the refusal. Today the teardown consults it and the _check_ does not, which is the whole of finding P0-2's delete half.

**Consequence**: `schemaVersion` is unchanged. This feature adds no persisted state, so there is no compatibility surface (Principle V: unknown keys are refused, so adding one would be breaking).

---

## Resolved unknowns

| Unknown from Technical Context | Resolution |
|---|---|
| Exact reachability predicate | R4 — verified spelling, with two fail-open traps documented |
| Whether one predicate serves all commands | R2 — no; surviving-ref set is a per-command parameter |
| Multi-ref operations | R3 — must be judged as one set; per-ref looping inverts the result |
| Unknown/unreadable worktree handling | R5 — return `unknown`, never throw |
| Linked-repository scope | R6 — no work-safety; Grove-reference refusal untouched |
| Persistence/migration needs | R7 — none; `provenance` already exists |

No `NEEDS CLARIFICATION` items remain.
