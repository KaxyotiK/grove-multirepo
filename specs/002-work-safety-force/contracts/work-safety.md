# Staged replacement: `cli-surface.md` §8.5.1

**Amendments**: AM-001, AM-002 · **Replaces**: the whole of §8.5.1 in `specs/001-grove-cli/contracts/cli-surface.md`

Everything below the rule is the replacement text, verbatim.

---

#### 8.5.1 Archive, delete, and work-safety checks

Work-safety answers one question: **would this operation remove data that exists nowhere else?** Data qualifies when it is uncommitted working-tree state, a commit reachable from no ref that survives the operation, or a non-git file grove did not create. An operation that would remove such data requires `--force`; an operation that would not MUST NOT ask for it.

Each command's blockers are **derived from what that command removes** — never asserted per command. The derivation table is normative:

| | uncommitted work | `created` refs | `adopted` refs | loose non-git files | object store |
|---|---|---|---|---|---|
| `archive` | **removes** | retains | retains | retains | retains |
| `restore` | — | retains | retains | retains | retains |
| `delete` | **removes** | **removes** | retains | **removes** | retains |
| `repo remove` (managed) | **removes** | **removes** | **removes** | — | **removes** |
| `repo remove` (linked) | **removes** | retains | retains | — | retains |
| `repo delete-branch` | — | **removes** | **removes** | — | retains |
| `tree remove` | **removes** | retains | retains | — | retains |
| `trunk remove` | **removes** | retains | retains | — | retains |

A command blocks without `--force` on exactly the columns marked _removes_, and only where that column holds data genuinely at risk. The table is the **only** statement of this mapping: every command that can destroy data derives its blockers by consulting it, and a destructive command absent from it is an error, not a command that blocks on nothing.

**Tree states.** Every Tree is classified into exactly one state, network-free, from refs present after the last fetch:

- **dirty** — uncommitted changes (staged, unstaged, or untracked) in the worktree.
- **at-risk-local** — clean, but the branch has at least one commit reachable from no ref that survives the operation.
- **safe** — clean, and every commit is reachable from a surviving ref.
- **detached work** — the worktree's HEAD holds commits reachable from no surviving ref, because HEAD was detached or moved off the recorded branch. Destroyed by **teardown**, not by ref removal, so it blocks every command that removes the worktree — `archive` included, which retains refs and would otherwise conclude it destroys nothing. A check that reads only the recorded branch cannot see it: the branch never moved.
- **unknown** — the state could not be read. Fails CLOSED: `unknown` blocks without `--force` and is never treated as clean. Classification reports `unknown`; it does not fail. This covers the reachability judgment as well as the worktree read: a ref that does not resolve, an unreadable object store, or a count that cannot be obtained yields `unknown`, never `safe`. An absent count reads numerically as zero, which is the optimistic answer, so the error branch must be distinguishable from a genuinely clean result rather than aliasing it.

**Surviving refs.** _At-risk-local_ is meaningless without saying what survives, and what survives differs by command:

- For `archive`, `delete`, and `repo delete-branch`, the repository itself survives. The surviving set is every local branch, remote-tracking ref, and tag in it, **less the refs the operation removes**.
- For `repo remove` on a **managed** repository, the object store is deleted outright — no local branch or tag survives. The surviving set is the remote-tracking refs alone. A commit held only by a tag is safe from `delete` and at risk from `repo remove`.

When an operation removes more than one ref, all of them are excluded from the surviving set **together, in one judgment**. Judging each ref while its doomed siblings are still in the surviving set makes every one of them vouch for the next, and the whole set passes clean while their shared commits are destroyed.

A branch's remote counterpart is _evidence_, not the test. A branch merged into the trunk and never pushed under its own name is **safe**; a branch with an `origin/` counterpart that lags behind it is **at-risk-local**.

**`grove archive <grove> [--force]`** moves the Grove's directory from `groves/<name>/` to `groves/.archive/<name>/` and tears down its worktrees. Archive refuses when `groves/.archive/<name>/` already exists (restore or delete the archived Grove first).

1. Archive removes **only working-tree state**. It retains every branch ref, and it _moves_ the Grove directory, so loose files travel with it. Without `--force` it therefore blocks on dirty and unknown-state Trees only — never on at-risk-local branches, never on loose files.
2. Every Tree is torn down with `git worktree remove` before the move; `grove.json`, `NOTES.md`, and any other Grove-level file moves to the archive intact. The branch refs stay in the repository's object store, and the manifest keeps each exact branch, repository ID, and allocated directory — everything restore needs.
3. `--force` tears down dirty and unknown-state Trees, discarding their uncommitted work, and reports each one it discarded. On success — forced or not — archive reports any branch now reachable from no other ref, so the user knows what exists only in the local object store.
4. The whole operation is journaled per §6.1; an interrupted archive is finished or rolled back by `grove reconcile`.

**`grove restore <grove>`** is the inverse: it refuses if an active Grove already holds the name, moves the directory back, and re-creates every worktree with `git worktree add` on the exact recorded branch at the recorded directory. Restore removes nothing and takes no `--force`. It is journaled per §6.1 exactly like archive.

**`grove delete <grove> [--force]`** is destructive and says so. Without `--force` it blocks on:

1. any **dirty** or **unknown-state** Tree — the worktree and its uncommitted files are removed;
2. any **at-risk-local** branch whose Tree provenance is `created` — delete removes those refs. Adopted branches pre-existed the Grove and are retained, so they never block;
3. any **loose non-git file** in the Grove directory — delete `rm -rf`s the whole directory.

With `--force`, delete proceeds and reports every item it discarded: uncommitted files, deleted refs that held at-risk commits, removed loose files, and unknown-state Trees. Refs deleted whose commits survive elsewhere are not discards and are not reported as such. Delete accepts archived Groves under the same rules — a torn-down Tree cannot be dirty, so only its branch is judged, in the object store — and releases their claims permanently.

**Refusal and report shape.** Every refusal itemizes each blocker individually — the repository, branch, and Tree at issue; for dirty Trees the uncommitted file count; for loose files their paths — and states why `--force` is needed to lose each one. A message that only says `--force` is required does not satisfy this rule. Symmetrically, `--force` classifies **before** acting and reports what it destroyed; when nothing was at risk it says so plainly rather than warning of loss that did not occur. Both the refusal detail and the discard report appear as structured fields under `--json`.

Archived Trees retain their branch claims: `grove new` and `grove tree add` refuse a branch claimed by an archived Grove and name that Grove.

---

## What changed from the superseded text, and why

| Superseded | Replacement | Reason |
|---|---|---|
| *unpushed* = "no remote counterpart, or commits ahead of it" | *at-risk-local* = "reachable from no surviving ref" | The old test called a branch merged into `main` unsafe — the normal end state of a finished Grove. Constitution IV defines destruction as "exists nowhere else", not "absent from a remote". |
| archive blocks on unpushed Trees | archive never blocks on branches | Archive retains every ref. Demanding `--force` for data it preserves is what trained the reflexive `--force` habit. |
| "A dirty Tree refuses even with `--force`" | `--force` discards dirty work and itemizes it | Constitution 2.0.0: the only override is each command's `--force` flag. 001's FR-023 already said forced archive discards dirty work — the two have contradicted each other since they were written. Resolved toward the constitution. |
| delete blocks on any unpushed Tree | delete blocks only on `created` at-risk branches | Delete retains adopted refs, and its teardown already consults `provenance`; the check simply did not. |
| single implicit ref universe | explicit surviving-ref set per command | A tag saves a commit from `delete` and not from `repo remove`; one universe is provably wrong for one of them. |
| *(absent)* | sibling refs judged together | Judging deletions one at a time lets each vouch for the next and destroys their shared commits silently. |
| *(absent)* | the destruction table is data, consulted once | Four handlers each deriving their own blocker list is a convention, not a chokepoint; conventions drift. It is how `tree remove` and `trunk remove` were overlooked while four sibling commands were corrected. |
| *(absent)* | `trunk remove` in the table | It takes `--force`, tears down a trunk worktree, and discards uncommitted work while reporting only that the trunk was removed — the same gap as `tree remove`. |
| *(absent)* | `unknown` state | The classifier used to throw, which is why `--force` skipped classification entirely and could report nothing. |
