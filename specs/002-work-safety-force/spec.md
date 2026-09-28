# Feature Specification: Derive `--force` from what each command destroys

**Feature Branch**: `002-work-safety-force`

**Created**: 2026-08-16

**Status**: Draft

**Input**: User description: "Work-safety: derive `--force` from what each command actually destroys. Implements the constitution 2.0.0 Principle IV amendment."

**Authority**: `.specify/memory/constitution.md` Principle IV (Safety by Construction) · `specs/001-grove-cli/contracts/cli-surface.md` §8.5.1 · `specs/001-grove-cli/contracts/acceptance-scenarios.md` §11 (`ARCH-*`)

**Findings addressed**: `docs/reviews/consolidated-review-20260816.md` — C1, P0-1, P0-2, P0-6, P2-4

---

## Why this feature exists

Constitution 2.0.0 replaced an _asserted_ blocker list with a _derived_ one. An operation is destructive exactly when it removes data that exists nowhere else — uncommitted state, commits reachable from no other ref, or non-git files grove did not create — and each command's blockers must follow from what that command actually removes.

The shipped implementation still enforces the superseded rule. Measured against the built binary, the gap runs in both directions:

| Operation | Actually destroys | Blocks today on | Verdict |
|---|---|---|---|
| `archive` | uncommitted work only (directory is *moved*; branch refs survive) | dirty **and unpushed** | over-strict |
| `delete` | uncommitted work, `created` refs, loose files (`rm -rf`) | dirty, unpushed (incl. `adopted`), loose files | over-strict on `adopted` |
| `repo remove` (linked) | nothing — no trunks, checkout untouched | "no remote, every branch is local-only" | over-strict |
| `repo add` rollback | a pre-existing `.bare/<name>` it did not create | nothing — no flag at all | under-gated |

Underneath all of it sits one wrong predicate: a branch is called _unpushed_ when `refs/remotes/origin/<branch>` does not exist. That reports every local-only branch as unpushed **even when its commits are already merged into `main`** — the single most common state in a worktree workflow. Users hit a refusal naming data that is in no danger, learn that `--force` is routine, and the flag stops meaning anything.

This feature makes the code match the amended principle and rewrites the two 001 requirements that restate the superseded rule instead of citing it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Archive finished work without being told it is at risk (Priority: P1)

A developer finishes a Grove: every Tree's branch is merged into the trunk, the branches were never pushed individually because the work landed through a squash merge. They run `grove archive checkout-redesign` to clear it off their active list.

Today they are refused — every Tree is reported as "not up to date with its remote: commits exist only here" — and the remedy tells them to push branches that no longer need to exist. The only way through is `--force`, which teaches them that forcing is normal.

After this change the archive succeeds silently: the commits are reachable from the trunk, so nothing exists only in those branches, and archive would not have removed the refs anyway.

**Why this priority**: This is the everyday path. The false positive fires on the most common branch state in the product's own workflow, and it is what devalues `--force` everywhere else.

**Independent Test**: Create a Grove, commit in a Tree, merge that branch into the trunk, archive without `--force`. Delivers value alone: archiving stops demanding a flag for safe work.

**Acceptance Scenarios**:

1. **Given** a Grove whose Trees are clean and whose branches are fully merged into the trunk, **When** the user runs `archive` without `--force`, **Then** it succeeds, moves the directory to `groves/.archive/<name>/`, tears down the worktrees, and leaves every branch ref in place.
2. **Given** a Grove with a clean Tree holding a commit reachable from no other ref, **When** the user runs `archive` without `--force`, **Then** it still succeeds — archive retains the branch ref, so the commit is not destroyed — and the output notes that the branch now exists only in the local object store.
3. **Given** a Grove with a dirty Tree, **When** the user runs `archive` without `--force`, **Then** it refuses, naming the Tree, its repository, its branch, and the count of uncommitted files, because tearing down the worktree destroys them.
4. **Given** a Grove containing a loose file grove did not create, **When** the user runs `archive` without `--force`, **Then** it succeeds and the file travels with the moved directory.

---

### User Story 2 - Delete refuses only for what delete removes (Priority: P1)

A developer deletes a Grove holding two Trees: one on a branch grove **created**, one on a branch grove **adopted** from an existing local branch. Both are clean and local-only.

Today both block the delete. But delete removes only `created` refs — the adopted branch survives in the repository. Refusing on it names data that is in no danger.

After this change only the `created` Tree blocks, and the refusal says so specifically.

**Why this priority**: `delete` is the genuinely destructive command; its refusals must be exactly right or users learn to `--force` past them reflexively. Independent of Story 1 — same predicate, different derivation.

**Independent Test**: Build a Grove with one created and one adopted Tree, both clean with local-only commits, run `delete` without `--force`, and confirm the refusal names only the created one.

**Acceptance Scenarios**:

1. **Given** a Grove with a clean `adopted` Tree whose commits are reachable from no other ref, **When** the user runs `delete` without `--force`, **Then** it is not blocked by that Tree — delete retains adopted refs.
2. **Given** a Grove with a clean `created` Tree whose commits are reachable from no other ref, **When** the user runs `delete` without `--force`, **Then** it refuses, naming the Tree and stating that deleting the branch destroys commits that exist nowhere else.
3. **Given** a Grove with a dirty Tree, **When** the user runs `delete` without `--force`, **Then** it refuses, naming the Tree and its uncommitted file count.
4. **Given** a Grove containing a loose non-git file, **When** the user runs `delete` without `--force`, **Then** it refuses, naming the file, because delete removes the whole directory.
5. **Given** an archived Grove whose torn-down `created` Tree holds commits reachable from no other ref, **When** the user runs `delete` without `--force`, **Then** it refuses on the same grounds.

---

### User Story 3 - `--force` reports what it destroyed (Priority: P1)

A developer forces past a refusal. They need to know afterwards exactly what they lost, so they can recover it from a reflog or accept the loss knowingly.

Today `--force` skips classification entirely, so the command destroys the work silently and the user has no record of what went.

**Why this priority**: The constitution requires it explicitly, and a `--force` that reports nothing is indistinguishable from a `--force` that had nothing to do. Independent: testable purely by forcing a known-at-risk operation and reading the output.

**Independent Test**: Force-delete a Grove with a dirty Tree and a loose file; confirm both are itemized in the output and in `--json`.

**Acceptance Scenarios**:

1. **Given** a Grove with a dirty Tree and a loose file, **When** the user runs `delete --force`, **Then** the command succeeds and its output itemizes the discarded uncommitted files, the deleted `created` branch refs, and the removed loose files.
2. **Given** a Grove with nothing at risk, **When** the user runs `delete --force`, **Then** it succeeds and reports that nothing was discarded — no warning implying loss that did not occur.
3. **Given** a Tree whose git state cannot be read, **When** the user runs `delete --force`, **Then** it succeeds, and reports that Tree as discarded with unknown state rather than omitting it.
4. **Given** any of the above, **When** the command runs with `--json`, **Then** the same itemized discards appear as structured fields.

---

### User Story 4 - Unregistering a repository grove does not own (Priority: P2)

A developer links an existing checkout with `repo link`, then later runs `repo remove` to unregister it. Nothing of theirs is destroyed: linked repositories have no trunk worktrees and their checkout is left untouched.

Today, if the linked repository has no remote, `repo remove` refuses with "the repository has no remote, so every branch is local-only" — a refusal about branches the command never touches.

**Why this priority**: Smaller blast radius than Stories 1–3 and confined to linked repositories, but it is the clearest case of a refusal that protects nothing.

**Independent Test**: Link a remote-less local checkout, run `repo remove` without `--force`, and confirm it succeeds and the checkout is intact.

**Acceptance Scenarios**:

1. **Given** a linked repository with no remote and no trunk worktrees, **When** the user runs `repo remove` without `--force`, **Then** it succeeds and the checkout on disk is byte-identical.
2. **Given** a linked repository referenced by an active or archived Grove, **When** the user runs `repo remove` with or without `--force`, **Then** it still refuses — that refusal is about dangling references, not work-safety, and is unchanged.
3. **Given** a managed repository whose branches are all reachable from the trunk, **When** the user runs `repo remove` without `--force`, **Then** it succeeds — deleting the object store destroys no commit that exists elsewhere in it.
4. **Given** a managed repository with a dirty trunk worktree, **When** the user runs `repo remove` without `--force`, **Then** it refuses, naming the trunk and its uncommitted work.

---

### User Story 5 - A failed `repo add` does not delete a directory it found (Priority: P2)

A developer has an existing `.bare/api` directory in their workspace — recovered by hand, or left by an earlier tool. They run `grove repo add api <remote>`. The clone fails partway.

Today the rollback removes `.bare/api` unconditionally, destroying a directory the command did not create, with no flag involved at all.

**Why this priority**: Rare, but it is unrecoverable data loss on a path the user never opted into. Fully independent of the classification work.

**Independent Test**: Place a directory at the target object-store path, run `repo add` with an unreachable remote, confirm the pre-existing directory survives.

**Acceptance Scenarios**:

1. **Given** a pre-existing directory at the target object-store path, **When** `repo add` fails, **Then** the rollback leaves that directory untouched and the error explains that the path was already occupied.
2. **Given** no directory at the target path, **When** `repo add` fails after cloning, **Then** the rollback removes the store it created, exactly as today.

---

### Edge Cases

- **Repository with no remote at all.** "Reachable from no other ref" is evaluated against every local branch, remote-tracking ref, and tag in that repository. A branch merged into a local trunk is therefore not at risk even with zero remotes configured — replacing today's blanket "no remote, so everything is local-only" refusal.
- **A branch that is its own only ref, with commits.** Genuinely at risk. Blocks `delete` (which removes `created` refs); does not block `archive` (which retains them).
- **A branch whose commits are reachable only from a tag.** Safe for `archive`/`delete`, which leave the tag alone. **At risk** for `repo remove` on a managed repository, which deletes the object store and the tag with it. Same branch, opposite answers — this is why FR-001's surviving set is a parameter rather than a constant.
- **Deleting a Grove with two `created` Trees whose branches point at the same commit.** Each branch is reachable from the other, so judged individually both look safe and the shared commit is lost. FR-001a requires them judged together.
- **Detached HEAD or a branch pointing at the same commit as the trunk.** Zero unique commits → not at risk.
- **Worktree whose git state cannot be read.** Fails CLOSED: classified "unknown", which blocks without `--force` and is itemized as an unknown-state discard under `--force`. `--force` must not skip classification, so an unreadable worktree must not make classification throw.
- **Worktree directory missing (removed out of band).** No uncommitted work can exist; only the branch is evaluated, in the object store.
- **Empty Grove (no Trees) with loose files.** Blocks `delete`, not `archive`.
- **A trunk worktree with uncommitted work.** `trunk remove --force` tears it down and discards the work while retaining the branch ref — the same shape as `tree remove`. Its refusal is already correct; only its discard report is missing.
- **Archived Grove being deleted.** Trees are already torn down, so nothing is dirty; the `created` vs `adopted` derivation still applies to the refs.
- **`--force` where nothing is at risk.** Succeeds and says nothing was discarded.

## Requirements _(mandatory)_

### Functional Requirements

**Classification**

- **FR-001**: The work-safety classifier MUST label a branch **at-risk-local** when, and only when, it has at least one commit reachable from **no ref that survives the operation**. The surviving-ref set is a parameter of the operation, because what survives differs by command:
  - `archive`, `delete`, `repo delete-branch` remove specific refs from a repository that itself survives, so the surviving set is every local branch, remote-tracking ref, and tag in that repository **except the refs the operation removes**.
  - `repo remove` on a **managed** repository deletes the whole object store, so no local branch or tag survives it; the surviving set is the remote-tracking refs alone.

  The existence or absence of a remote counterpart MUST NOT by itself determine the label.

- **FR-001a**: When an operation removes **more than one** ref, all of them MUST be excluded from the surviving set **together**, in a single judgment. Evaluating each ref against a set that still contains its doomed siblings reports every one of them as safe and silently destroys the commits they share.
- **FR-002**: Classification MUST remain network-free, judging only refs present after the last fetch (§8.5.1), and MUST fail CLOSED: a state that cannot be read is **unknown**, never clean.
- **FR-002a**: Failing closed applies to the **reachability judgment itself**, not only to reading the worktree. When the query that counts unreachable commits cannot be completed — a ref that does not resolve, an unreadable or absent object store, a non-zero exit, or output that is not a count — the branch MUST be classified **unknown**. It MUST NOT be classified **safe**. An absent or unparseable count reads numerically as zero, which is the _optimistic_ answer; treating it as "nothing at risk" is the fail-open defect this feature exists to remove, reintroduced in the one predicate the whole feature rests on.
- **FR-003**: Classification MUST NOT throw on an unreadable worktree. It MUST return **unknown** for that Tree so both the refusal path and the `--force` reporting path can name it.

**Derived blockers**

- **FR-004**: Each command's blockers MUST be derived from what that command removes. A command MUST NOT refuse on account of data it preserves.
- **FR-004a**: The destruction table MUST exist in exactly one place in the implementation, as data, and every command that can destroy data MUST obtain its blockers by consulting it — not by open-coding an equivalent list in its own handler. A command that removes data and has no entry in the table MUST fail loudly rather than default to removing nothing, so a newly added destructive command cannot silently opt out of work-safety. Re-implementing the derivation per handler is what let `tree remove` and `trunk remove` be overlooked while four other commands were corrected.
- **FR-005**: `grove archive` MUST block without `--force` on dirty or unknown-state Trees only. It MUST NOT block on at-risk-local branches (it retains the refs) or on loose non-git files (it moves the directory). It MUST report, on success, any branch left existing only in the local object store.
- **FR-006**: `grove delete` MUST block without `--force` on dirty or unknown-state Trees, on at-risk-local branches whose Tree provenance is `created`, and on loose non-git files in the Grove directory. It MUST NOT block on at-risk-local branches whose provenance is `adopted`.
- **FR-007**: `grove repo remove` MUST block without `--force` only on dirty or unknown-state trunk worktrees, and on at-risk-local branches in a **managed** object store it is about to delete — judged against the remote-tracking surviving set of FR-001, since deleting the store destroys every local branch and tag in it. A **linked** repository MUST NOT be blocked by work-safety, because the command removes nothing of it. The existing refusal for repositories referenced by a Grove is unchanged and still blocks with `--force`.
- **FR-008**: `grove repo delete-branch` MUST block without `--force` only when the branch is at-risk-local by FR-001.
- **FR-009**: `grove repo add` MUST NOT remove a pre-existing object-store directory it did not create. It MUST refuse before cloning when the target path is already occupied, stating the occupied path; its rollback MUST remove only what it created.

**Reporting**

- **FR-010**: Every work-safety refusal MUST itemize each blocker individually — the repository, branch, and Tree at issue; for dirty Trees the uncommitted file count; for loose files their names — and MUST state why `--force` is required to lose each one. A message that only says `--force` is needed does not satisfy this.
- **FR-011**: `--force` MUST classify before acting and MUST report every item it discarded: uncommitted files, deleted branch refs, removed loose files, and unknown-state Trees. When nothing was at risk it MUST say so rather than warning of loss that did not occur. This applies to **every** command whose `--force` can destroy data — `archive`, `delete`, `repo remove`, `repo delete-branch`, `tree remove`, and `trunk remove` — not only to the commands whose blockers this feature changes. `tree remove --force` and `trunk remove --force` both already discard uncommitted work while reporting only that the Tree or trunk was removed; a `--force` that reports its damage on some commands and stays silent on others is the same inconsistency this feature exists to remove.
- **FR-012**: Both the refusal detail (FR-010) and the discard report (FR-011) MUST be present as structured fields under `--json`, not only in human-readable text.

**Traceability**

- **FR-013**: Every test added or changed by this feature MUST name the §11 acceptance-scenario ID it covers in its test title, so coverage is greppable — e.g. `test("ARCH-04: forced archive discards a dirty Tree and itemizes it", …)`.

### Amendments to `001-grove-cli`

This feature changes behaviour, so the contracts and the 001 spec change with it (constitution, "Development Workflow & Quality Gates"; `contracts/README.md`, "Changing a contract"):

- **AM-001**: `contracts/cli-surface.md` §8.5.1 — replace the three-state definition (dirty / unpushed / synced, where _unpushed_ means "no remote counterpart") with the FR-001 at-risk derivation, and replace each command's asserted blocker list with its derived one.
- **AM-002**: `contracts/cli-surface.md` §8.5.1 item 3 currently states that a dirty Tree refuses archive **even with `--force`**. This is superseded. The constitution now states that the only override is each command's `--force` flag; and 001's own FR-023 already says the opposite ("a forced archive discards dirty work just as a forced delete does") — the two have contradicted each other since they were written. Resolve in favour of the constitution and FR-023: forced archive discards dirty work and itemizes it per FR-011.
- **AM-003**: `contracts/acceptance-scenarios.md` ARCH-04 must be rewritten to match AM-002, and ARCH-03, ARCH-08, ARCH-09, ARCH-10 re-expressed in terms of derived blockers.
- **AM-004**: `001-grove-cli/spec.md` FR-023 and 002-work-safety-force-SC-003 MUST be rewritten to **cite** §8.5.1 rather than restate it. Restating the rule in a third place is what let it drift (finding C1); the contracts are the single statement.
- **AM-005**: `001-grove-cli/plan.md` Constitution Check predates constitution 2.0.0 and must be re-run against the amended Principle IV.

### Key Entities

- **Tree safety record**: per Tree — repository name, branch, provenance (`created` | `adopted`), state (`dirty` | `at-risk-local` | `safe` | `unknown`), and for dirty Trees the uncommitted file count. Consumed by both the refusal and the discard report.
- **Loose entry**: a path inside a Grove directory that grove did not create. Destroyed only by `delete`.
- **Discard report**: what a `--force` run actually destroyed — uncommitted files, branch refs, loose entries, unknown-state Trees. Emitted on success.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **002-work-safety-force-SC-001**: A Grove whose Trees are clean and whose commits are all reachable from the trunk can be archived and deleted with **zero** uses of `--force`. Today both refuse.
- **002-work-safety-force-SC-002**: Across the documented command surface, the number of refusals naming data the command would not have removed is **zero** — verifiable by, for each refusal a test can provoke, confirming the named data is absent after a forced run of the same command.
- **002-work-safety-force-SC-003**: Every work-safety refusal names at least one specific repository, branch, Tree, or file path; **no** refusal consists only of "pass `--force`".
- **002-work-safety-force-SC-004**: Every successful `--force` run that destroyed something enumerates it; every successful `--force` run that destroyed nothing says so. A user can reconstruct what they lost from the output alone, without re-running anything.
- **002-work-safety-force-SC-005**: A `repo add` that fails against a workspace containing a pre-existing object-store directory leaves that directory bit-for-bit unchanged.
- **002-work-safety-force-SC-006**: 100% of tests touching work-safety cite their §11 scenario ID in the test title, and every `ARCH-*` scenario has at least one citing test — raising `ARCH-*` coverage from partial to complete.
- **002-work-safety-force-SC-007**: The work-safety judgment issues no network operation, verifiable by running the full suite with no network reachable.
- **002-work-safety-force-SC-008**: Every command that accepts `--force` and can destroy data has exactly one entry in the single destruction table, and derives its blockers from it. A destructive command with no entry fails a test rather than silently blocking on nothing — verifiable mechanically by enumerating the dispatch surface, not by reading handlers.
- **002-work-safety-force-SC-009**: An adversarial round finds no new work-safety defect. The stop condition is a fresh round returning nothing, not a fixed number of rounds.

## Assumptions

- **Reachability, not merge-base, is the test.** "Exists nowhere else" is evaluated by ref reachability across local branches, remote-tracking refs, and tags. Commits reachable from a reflog entry or a dangling object are **not** counted as safe: a reflog is not a ref, expires, and is not something a user can be told to rely on.
- **Tags count as refs.** A commit reachable only from a tag is not at risk. This follows the constitution's wording ("reachable from no other ref") rather than narrowing to branches.
- **The repository is the reachability scope.** Refs in a _different_ repository never make a commit safe, even for a linked repository sharing an object store with the user's own checkout.
- **`created` vs `adopted` is already recorded** per Tree in the Grove manifest and is authoritative for FR-006; this feature reads it and does not change how it is set.
- **Linked repositories have no trunk worktrees.** `repo link` records `trunks: []`. FR-007's dirty-trunk clause is therefore reachable only for managed repositories today; it is written generally so it stays correct if that changes.
- **Grove-reference refusals are out of scope.** `repo remove` refusing because an active or archived Grove references the repository is a referential-integrity rule, not work-safety. It blocks with `--force` and this feature does not touch it.
- **Concurrency, locking, and journaling are unchanged.** §6 and §6.1 behaviour is out of scope; the classification simply happens inside the existing lock and journal envelope.
- **No new commands or flags.** This feature changes when existing `--force` flags are required and what the commands print. It adds no surface.
