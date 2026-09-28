# Phase 1 — Data model: work-safety classification

**Feature**: `002-work-safety-force` · **Date**: 2026-08-16

Nothing here is persisted. Every entity below is in-memory, computed per invocation, and discarded on exit — consistent with Principle I (nothing survives a successful command) and Principle II (the only files Grove writes for its own state are the manifest, config, locks, and §6.1 journals). The Grove manifest schema is **unchanged**; `schemaVersion` does not move (research R7).

---

## Entity: `SurvivingRefs`

The refs that still exist after the operation completes. Supplied by the command, consumed by the classifier. This is the parameter that makes one predicate serve every command (research R2).

| Field | Type | Meaning |
|---|---|---|
| `scope` | `"repository"` \| `"remote-only"` | Which universe of refs is consulted |
| `removed` | `string[]` | Bare branch names the operation deletes; excluded from the universe |

**Values by command:**

| Command | `scope` | `removed` |
|---|---|---|
| `archive` | — | *not applicable*: archive removes no ref, so no branch can be at risk |
| `delete` | `repository` | every `created` Tree branch in the Grove |
| `repo delete-branch` | `repository` | the one named branch |
| `repo remove` (managed) | `remote-only` | *(unused — the whole store goes)* |
| `repo remove` (linked) | — | *not applicable*: removes nothing |

**Invariants**

- `removed` MUST contain **every** ref the operation deletes, populated before any judgment is made. Judging a ref against a set that still contains its doomed siblings inverts the result (FR-001a, research R3).
- `scope: "remote-only"` MUST be used when the object store itself is deleted, because no local branch or tag survives to hold anything.
- `removed` is meaningless under `scope: "remote-only"` and MUST be empty there.

---

## Entity: `TreeSafety` _(extends the existing shape in `src/model/safety.ts`)_

One record per Tree, produced by classification and consumed by **both** the refusal path and the `--force` discard report. Today's shape already carries the first five fields.

| Field | Type | Change | Meaning |
|---|---|---|---|
| `treeId` | `string` | — | Durable Tree ID |
| `branch` | `string` | — | Exact, case-sensitive branch |
| `repoName` | `string` | — | For itemization |
| `state` | `WorkState` | **redefined** | See state table below |
| `files` | `number` | — | Uncommitted file count; meaningful only when `state === "dirty"` |
| `provenance` | `"created"` \| `"adopted"` | **new** | Read from `TreeEntry.provenance`; drives FR-006 |
| `problem` | `string \| null` | **new** | Why the state is `unknown`; carried into the message |

### `WorkState` — redefined

| Value | Was | Now |
|---|---|---|
| `dirty` | uncommitted changes | unchanged |
| `unpushed` | no `origin/<b>` ref, or commits ahead of it | **removed** |
| `at-risk-local` | — | **new**: has ≥1 commit reachable from no surviving ref (FR-001) |
| `safe` | `synced` | renamed: every commit is reachable from a surviving ref |
| `unknown` | *(thrown as an error)* | **new**: state could not be read; fails CLOSED |

The rename `synced` → `safe` is deliberate. "Synced" names a relationship to a remote, which is precisely the wrong mental model — a merged local branch with no remote counterpart is safe, and this feature exists because that case was being called unsafe.

**State determination order** (first match wins):

1. Worktree missing → skip dirtiness; evaluate the branch in the object store.
2. Dirtiness unreadable → `unknown` with `problem` set. **Never throws** (FR-003, research R5).
3. Dirty → `dirty` with `files`.
4. Reachability judgment unreadable → `unknown` with `problem` set (FR-002a). A ref that does not resolve, an unreadable object store, a non-zero exit, or output that is not a count all land here. **Not** `safe`: an absent count parses as zero, which is the optimistic answer.
5. At-risk under the supplied `SurvivingRefs` → `at-risk-local`.
6. Otherwise → `safe`.

**Invariants**

- Classification is **network-free** (FR-002). Every judgment reads refs already on disk.
- Classification MUST run whether or not `--force` was passed (FR-011); `--force` changes what is done with the result, never whether it is computed.
- `unknown` MUST NOT be collapsed into `dirty` or `safe` (Principle V).
- The success and error branches of every read MUST be **distinguishable**. Returning the same shape from both — an empty string, a zero count, a false boolean — is the fail-open defect this feature removes; it must not be reintroduced by the predicate that replaces it.

---

## Entity: `LooseEntry`

A path inside a Grove directory that grove did not create — the existing `unmanagedEntries()` return. Unchanged in shape; changed in who consumes it.

| Consumer | Before | After |
|---|---|---|
| `delete` | blocks without `--force` | unchanged — `rm -rf` really destroys these |
| `archive` | passed `[]` (already correct) | unchanged — the directory is *moved* |

---

## Entity: `DiscardReport` _(new)_

What a `--force` run actually destroyed. Emitted on success, in human-readable text and as structured `--json` fields (FR-011, FR-012). This entity has no counterpart today, because `--force` currently skips classification and therefore knows nothing.

| Field | Type | Meaning |
|---|---|---|
| `uncommitted` | `{ repo, branch, files }[]` | Dirty Trees whose worktrees were torn down |
| `branches` | `{ repo, branch }[]` | Refs deleted that held commits reachable from no surviving ref |
| `loose` | `string[]` | Non-git paths removed |
| `unknown` | `{ repo, branch, problem }[]` | Trees discarded without a readable state |
| `nothing` | `boolean` | True when all of the above are empty |

**Invariants**

- `nothing === true` MUST produce a plain "nothing was discarded" statement, never a warning implying loss (FR-011, spec Story 3 scenario 2).
- An `unknown` Tree MUST appear here rather than being omitted — it was destroyed, and the user cannot be told what was in it (Story 3 scenario 3).
- `branches` lists only refs whose commits were genuinely at risk. A `created` ref deleted while its commits live on in `main` is not a discard and MUST NOT be reported as one.

---

## Derivation table — the normative mapping

This table is the feature. Each cell is "does this command remove this kind of data?", and the blockers follow mechanically. It belongs in `contracts/cli-surface.md` §8.5.1 as part of AM-001.

| | uncommitted work | `created` refs | `adopted` refs | loose non-git files | object store |
|---|---|---|---|---|---|
| `archive` | **removes** (worktree teardown) | retains | retains | retains (directory moved) | retains |
| `restore` | — | retains | retains | retains | retains |
| `delete` | **removes** | **removes** | retains | **removes** (`rm -rf`) | retains |
| `repo remove` (managed) | **removes** (trunk worktrees) | **removes** | **removes** | — | **removes** |
| `repo remove` (linked) | removes (trunk worktrees — none exist today) | retains | retains | — | retains |
| `repo delete-branch` | — | **removes** (the named ref) | **removes** (the named ref) | — | retains |
| `tree remove` | **removes** | retains | retains | — | retains |
| `trunk remove` | **removes** (trunk worktree teardown) | retains | retains | — | retains |

**Where it lives in code**: as a single exported constant in `src/model/safety.ts`, keyed by command identity, consulted by one `blockersFor(command, …)` function that every destructive path calls (FR-004a). It is _not_ re-expressed per handler. A destructive command with no entry throws rather than returning an empty blocker list, so a command added later cannot opt out of work-safety by omission — the failure mode that hid `tree remove` and `trunk remove` when four sibling commands were being corrected.

**Reading the table**: a command blocks without `--force` on exactly the columns where it says _removes_, and only when that column's data is genuinely at risk under the operation's `SurvivingRefs`. `archive`'s row is why it must stop blocking on branches and loose files; `delete`'s `adopted` cell is why it must stop blocking on those; `repo remove` (linked) has no _removes_ cell that can hold at-risk data, which is why it must stop blocking entirely.
