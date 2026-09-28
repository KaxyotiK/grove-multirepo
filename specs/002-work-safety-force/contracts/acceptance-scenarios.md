# Staged replacement: `acceptance-scenarios.md` `ARCH-*`

**Amendment**: AM-003 · **Replaces**: the `ARCH-*` rows in `specs/001-grove-cli/contracts/acceptance-scenarios.md`

Existing IDs keep their numbers — they are stable citation keys. `ARCH-13` is absent from 001 and stays absent; renumbering to close the gap would break citations. New cases take `ARCH-17` onward.

## Rewritten rows

| ID | Scenario | Expected |
|---|---|---|
| ARCH-03 | Archive with one dirty Tree and one clean Tree whose branch is at-risk-local | Refuses **naming only the dirty Tree**. The at-risk-local branch is not a blocker — archive retains the ref. |
| ARCH-04 | Same with `--force` | **Archives.** The dirty Tree is torn down, its uncommitted work discarded, and the output itemizes the discarded files by repository and branch. *(Supersedes the previous "still refuses even when forced".)* |
| ARCH-08 | Delete a Grove with a `created` Tree whose branch is at-risk-local, without `--force` | Blocks, naming that Tree and stating that deleting its branch destroys commits reachable from no other ref. |
| ARCH-09 | Same with `--force` | Warns, deletes worktrees, deletes `created` branches, leaves adopted branches in place, and itemizes what was discarded. |
| ARCH-10 | Delete an archived Grove whose torn-down `created` Tree is at-risk-local | Blocks without `--force`; forced delete releases all claims and itemizes the discarded refs. |
| ARCH-14 | Archive a Grove whose only change is one untracked file | Refuses — the Tree is dirty per §8.5.1, untracked files count, and archive tears the worktree down. |
| ARCH-15 | Delete a Grove with a dirty Tree, without `--force` | Blocks, listing the Tree and its uncommitted file count. |
| ARCH-16 | Same with `--force` | Warns, deletes the worktrees and `created` branches; modified and untracked files are gone and are itemized in the discard report. |

Unchanged: ARCH-01, ARCH-02, ARCH-05, ARCH-06, ARCH-07, ARCH-11, ARCH-12.

## New rows

| ID | Scenario | Expected |
|---|---|---|
| ARCH-17 | Archive a Grove whose Trees are clean and whose commits are all reachable from the trunk, **without** `--force` | **Succeeds.** No refusal. This is the false positive the old predicate produced on every finished Grove. |
| ARCH-18 | Archive a Grove with a clean, at-risk-local Tree, without `--force` | Succeeds, and reports that the branch now exists only in the local object store. Archive retains the ref, so nothing is destroyed. |
| ARCH-19 | Archive a Grove containing a loose non-git file, without `--force` | Succeeds; the file is present in `groves/.archive/<name>/` afterwards. |
| ARCH-20 | Delete a Grove with a clean, at-risk-local **adopted** Tree, without `--force` | Not blocked by that Tree — delete retains adopted refs. |
| ARCH-21 | Delete a Grove with **two `created` Trees whose branches point at the same otherwise-unreachable commit**, without `--force` | Blocks, naming both. Judged individually each would appear safe because its sibling holds the commit; both are doomed, so both are at risk. |
| ARCH-22 | Force-delete a Grove with nothing at risk | Succeeds and reports that nothing was discarded — no warning implying loss that did not occur. |
| ARCH-23 | Archive or delete a Grove with a Tree whose git state cannot be read, without `--force` | Blocks, naming the Tree and the reason its state is unknown. Fails CLOSED. |
| ARCH-24 | Same with `--force` | Succeeds, and the discard report lists that Tree as discarded with unknown state rather than omitting it. |
| ARCH-25 | A branch whose commits are reachable only from a tag: `delete` the Grove, then `repo remove` the managed repository | `delete` does not block on it (the tag survives); `repo remove` does (the tag dies with the object store). Same branch, opposite answers. |
| REPO-11 | `repo remove` a linked repository with no remote and no trunk worktrees, without `--force` | Succeeds; the checkout on disk is unchanged. |
| REPO-12 | `repo remove` a linked repository still referenced by an active or archived Grove, **with** `--force` | Still refuses. This is referential integrity, not work-safety, and `--force` is not an answer to it. |
| REPO-13 | `repo remove` a managed repository whose branches are all reachable from remote-tracking refs, without `--force` | Succeeds. |
| REPO-14 | `repo add` fails while a directory already occupies the target object-store path | Refuses **before** cloning, naming the occupied path; the pre-existing directory is bit-for-bit unchanged afterwards. |
| REPO-15 | `repo add` fails after cloning, with no pre-existing directory at the target | Rollback removes the store it created, as today. |

## Traceability requirement

Per the constitution's scenario-traceability rule, every test covering one of these MUST name the ID in its title:

```
test("ARCH-21: sibling created branches sharing a commit both block delete", …)
```

`ARCH-*` coverage before this feature is partial. On completion every `ARCH-*` and every `REPO-1x` ID above must have at least one citing test (002-work-safety-force-SC-006), verifiable by grepping the suite for each ID.
