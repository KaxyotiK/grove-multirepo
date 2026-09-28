# Contract: Single-process safety & locks

**Owns:** §6 · **Status:** closed-to-new-behaviour

> **Closed to new behaviour.** `specs/001-grove-cli/contracts/` is the stable `§` citation authority and the home of the 180 regression scenario IDs — it is never renumbered and never deleted. It is **retired** in the sense that no new behaviour is written here: the Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which supersedes this file wherever the two disagree. Sections describing subsystems v3 deleted carry their own **Superseded** note; a `§` citation into one of those fails `tests/module/citations.test.ts`.

Section numbers are stable citation keys. Code comments, tests, and specs cite `§6`-style references; this file is where they resolve. Do not renumber sections.

---

## 6. Single-process safety

There is no long-running writer. Concurrent CLI invocations coordinate with short-lived lock files under `.grove/locks/`.

For a mutation, Grove:

1. resolves the workspace;
2. acquires locks in stable ID order;
3. rereads and validates affected config/manifests;
4. checks their expected `_rev`/hash;
5. rechecks Git and dirty/running preconditions;
6. performs the filesystem/Git operation;
7. writes manifests through adjacent temporary files and atomic rename;
8. releases locks and exits.

Lock rules:

- Creation uses exclusive create, never check-then-write.
- Lock contents identify PID, process start time, operation, and affected IDs.
- A live owner is never stolen.
- A stale lock is reported and may be cleared only after process verification.
- Repository claim locks cover Git's duplicate-worktree check and `git worktree add` together.
- Multi-object commands acquire locks in sorted durable-ID order to prevent deadlocks.
- A mutation blocked by a held lock waits up to 5 seconds for release, then exits `4` naming the holder's operation.
- No lock or process remains after a successful command.

Read-only commands do not take a global lock. They validate complete files and either return a consistent snapshot or report a concurrent revision change and retry within a small bound.

### 6.1 Multi-step Git mutations and rollback journals

> **Superseded — the rollback journal is deleted.** v3 replaces compensating rollback with durable _forward_ operations (`src/store/operation.ts`): a crash resumes toward the requested end state and never deletes a ref or worktree it created. `.grove/journal/` is not created and `src/store/journal.ts` does not exist. Constitution Principle IV is the current rule; the mechanics below are retained only so an old citation resolves to something honest.

Manifest writes are atomic, but commands such as `grove new` and `grove tree add` perform several Git mutations, possibly across repositories. These cannot be made atomic; they are made _recoverable_ with a durable journal under `.grove/journal/` (created on demand):

1. Before the first Git mutation, Grove writes a journal describing the operation.
2. Immediately after each `git branch` succeeds — and before `git worktree add` is attempted — the journal records that the branch was created. Recording it afterwards leaks the branch whenever the process dies between the two steps.
3. On failure, Grove rolls the recorded steps back and clears the journal.
4. On success, Grove clears the journal.
5. `grove reconcile` finishes any journal left by an interrupted process: it completes the rollback and reports exactly what it undid.

Journal rules:

- Journal file names include the operation and target, so two concurrent operations on the same Grove (for example, two `tree add` runs against different repositories) never share a journal file. A shared file would let the loser's rollback remove the winner's worktree.
- A `tree add` journal records that the Grove directory pre-existed, so its rollback removes only the Tree being added — never the whole Grove.
- Journals are workspace-local; nothing is written outside the workspace.

This preserves the proven journal design from the pinned source (`trails.ts`, D-014) rather than reinventing crash recovery.
