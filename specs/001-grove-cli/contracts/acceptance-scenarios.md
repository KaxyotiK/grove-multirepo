# Contract: Acceptance scenarios

**Owns:** §11 · **Status:** closed-to-new-behaviour

> **Closed to new behaviour.** `specs/001-grove-cli/contracts/` is the stable `§` citation authority and the home of the 180 regression scenario IDs — it is never renumbered and never deleted. It is **retired** in the sense that no new behaviour is written here: the Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which supersedes this file wherever the two disagree. Sections describing subsystems v3 deleted carry their own **Superseded** note; a `§` citation into one of those fails `tests/module/citations.test.ts`.

For schema-3 behavior, the stable scenario IDs below remain the regression keys, while the Git-native disposition overlay in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md` supersedes any expectation that depends on claims, provenance, rollback compensation, mutable Tree/trunk arrays, linked trunk ownership, or Grove-driven ref deletion. This preserves section and scenario numbering while making the approved breaking change explicit.

Section numbers are stable citation keys. Code comments, tests, and specs cite `§11`-style references; this file is where they resolve. Do not renumber sections.

---

## 11. Test scenarios

Tests use an isolated temporary home and workspace tree. No test reads the developer's actual home, config, repositories, or Git credentials. All Git fixtures are local (`file://` remotes); the whole suite runs offline.

Tests run in three layers, and all three must pass before release:

1. **Module tests** (`node:test`) against source modules — the ported §10.3 material plus the fresh §10.3.1 areas.
2. **CLI subprocess tests** that spawn the built `dist/grove.mjs`. Every scenario below that describes a command runs at this layer, against the artifact users actually install — not against in-process function calls.
3. **Artifact, install, and golden-path tests** (§11.7, §11.14) under an isolated npm prefix.

CI runs all layers on every push, on macOS (case-insensitive filesystem) and Linux (case-sensitive), with the PROC-07 exclusion scan as a gating check.

### 11.1 Discovery

| ID | Setup | Expected result |
|---|---|---|
| DISC-01 | Run from workspace root | Uses that root's `.grove/config.json`. |
| DISC-02 | Run from `trunks/main@ledger/src` | Walks upward and resolves the same workspace. |
| DISC-03 | Run from `groves/pricing-fix/trees/feature_pricing@ledger` | Resolves the owning workspace. |
| DISC-04 | Run outside any workspace | Refuses with `grove init`; creates nothing. |
| DISC-05 | Put another valid workspace in a sibling folder | Never reads the sibling config. |
| DISC-06 | Nested workspace has its own marker | Nearest marker wins. |
| DISC-07 | Nearest marker is malformed | Stops there; never falls back to ancestor. |
| DISC-08 | Use `--workspace` | Exact explicit workspace wins after validation. |
| DISC-09 | Set `GROVE_ROOT` (and other `GROVE_*` variables) to a different valid workspace | Ignored entirely; discovery from `cwd` still wins and the variable's workspace is never opened. |
| DISC-10 | Directory contains `.grove/` but no `config.json` inside it | Not a marker; the walk continues upward. |
| DISC-11 | `--workspace` points at a path with no or malformed marker | Exits `8`; no fallback to cwd discovery. |
| DISC-12 | `cwd` reached through a symlink | The canonical real path drives discovery and containment. |
| DISC-13 | Run from a marker-free path at or near the filesystem root | The walk terminates at the root and refuses; no unbounded loop. |
| DISC-14 | Run from inside `.bare/ledger` | Resolves the owning workspace like any other subdirectory. |

### 11.2 Init

| ID | Setup | Expected result |
|---|---|---|
| INIT-01 | `cd scratch/empty && grove init` | Creates config, locks, `.bare/`, `trunks/`, and `groves/`. |
| INIT-02 | Run init again at the same root | Byte-for-byte idempotent; ID and revision do not change. |
| INIT-03 | Run init inside `finance/test-folder` | Refuses because finance owns the ancestor. |
| INIT-04 | Repeat with `--nested` | Creates an explicit nested workspace. |
| INIT-05 | Existing malformed config | Refuses and preserves it byte-for-byte. |
| INIT-06 | Existing `.bare/`, `trunks/`, or `groves/` | Refuses; no adoption or conversion. |
| INIT-07 | Interrupt before config publication | No valid partial workspace appears; retry succeeds. |
| INIT-08 | Unwritable target | Fails without publishing a marker. |
| INIT-09 | `grove init` without `--name` | The workspace name is the canonical target directory's basename. |

### 11.3 Multiple-workspace isolation

| ID | Setup | Expected result |
|---|---|---|
| ISO-01 | Finance and quoting contain different defaults | Each command uses only its own config. |
| ISO-02 | Run mutations concurrently in both workspaces | Locks and writes remain inside each workspace. |
| ISO-03 | Make quoting config unreadable; run finance | Finance succeeds, proving quoting was not opened. |
| ISO-04 | Run outside after both were used | No remembered workspace is selected. |
| ISO-05 | Search filesystem writes after commands | No files were created under `~/.grove`. |

### 11.4 Tree paths and exact branches

| ID | Setup | Expected result |
|---|---|---|
| TREE-01 | `feature/pricing` in `ledger` | Allocates `feature_pricing@ledger`; manifest retains exact branch. |
| TREE-02 | Also add `feature_pricing` | Allocates a Tree-ID-suffixed folder; identities remain distinct. |
| TREE-03 | Allocate paths for `Feature/Login` and `feature/login` | Case-fold collision handling gives distinct portable directories. Git's files ref backend may itself alias case-only refs on case-insensitive filesystems. |
| TREE-04 | Add `team@experiment` | Allocates `team~40experiment@<repo>`. |
| TREE-05 | Encode composed/decomposed Unicode components | Their distinct UTF-8 byte sequences produce distinct ASCII identities without filesystem normalization. |
| TREE-06 | Encoded name exceeds limit | Truncates safely and appends stable Tree ID. |
| TREE-07 | Invalid Git ref | Refuses before path allocation or Git mutation. |
| TREE-08 | Add repositories `API` and `api` | Refuses the second portable-name collision. |
| TREE-09 | Rename folder to resemble another Tree | Reconcile reports mismatch; never rebinds identity. |
| TREE-10 | Concurrent colliding Tree creation | Locks produce unique directories and valid manifests. |
| TREE-11 | Create Groves named `Pricing` and `pricing` | The second refuses under ASCII case-folded uniqueness (§5.3). |
| TREE-12 | `grove new` with an invalid or reserved name (`a/b`, `.archive`) | Exits `2` before any mutation. |
| TREE-14 | After `repo fetch`, `grove tree add` for a branch existing only on the remote | Local branch is created at the remote-tracking ref with upstream configured; provenance is `adopted`; a later `grove delete --force` leaves the branch in place. |
| TREE-15 | `grove new` where the derived `<prefix><grove-name>` branch already exists, locally or on the remote | Refuses and names the branch; the remedy is explicit `--branch` adoption; no mutation occurs. |
| TREE-16 | `grove new --branch <repo>=<branch>` naming a repository not selected with `--repo` | Exits `2` before any mutation. |
| TREE-17 | `grove new` with `defaults.branchPrefix` set, and again with `--prefix` | Derived branches are `<prefix><grove-name>`; `--prefix` overrides the default; each branch is based at its repository's effective default. |
| TREE-18 | `grove new` with no name | Exits `2` before any mutation — a Grove is always named. No `groves/` entry is created. |
| TREE-19 | `grove tree add --branch` naming an existing local branch, and `--from <ref>` for a new branch | The first records `adopted` and survives `grove delete --force`; the second creates the branch at `<ref>` instead of the trunk. |
| TREE-20 | Encode a component containing `~`, and a non-UTF-8 component | `~` encodes as `~7e`; the non-UTF-8 input is refused (§5.1). Git refs themselves cannot contain `~`. |
| TREE-21 | `grove tree remove` on a clean-but-unpushed Tree | Worktree torn down, manifest drops the Tree, claim released; the branch ref survives whatever its provenance, and `tree add` can re-claim it. |
| TREE-22 | `grove tree remove` on a dirty Tree, without and with `--force` | Refuses first; forced removal warns uncommitted changes are destroyed and removes the worktree; the branch ref remains. |
| TREE-23 | `grove new <name>` with no `--repo` | Creates an empty Grove; `grove ls`/`show` report zero Trees; a later `tree add` populates it; archive and delete pass trivially. |
| TREE-24 | On a repository with no effective default, explicitly adopt existing branches with `grove new --branch` and `grove tree add --branch` | Both succeed because no branch is created from a base; provenance is `adopted`. A derived or missing branch still requires an effective default. |

### 11.5 Command surface

| ID | Setup | Expected result |
|---|---|---|
| CMD-01 | Run help for every command | Exact documented positionals and flags appear. |
| CMD-02 | Omit every required argument in turn | Exits `2` with precise remedy. |
| CMD-03 | Pass unknown or camel-case flags | Exits `2`; nothing reaches a mutating handler. |
| CMD-04 | Repeat list flags | Preserves order and validates each value. |
| CMD-05 | Use `--json` on success and each error class | Stdout contains one JSON value and no prose (`agent run` excepted, §8.8). |
| CMD-06 | Use `--progress=json` | Stderr is valid NDJSON; stdout remains the result. |
| CMD-07 | Invoke unsupported command families | Exits `2`; no hidden compatibility behavior. |
| CMD-08 | Run workspace-required commands outside a workspace | Refuses before locks, Git, or subprocesses. |
| CMD-09 | Generate bash/zsh/fish completion | Matches public commands and flags exactly. |
| CMD-10 | Verify exit table | Every typed error uses its declared code. |
| CMD-11 | `grove config set` targeting `repositories` or a `trunks` array | Exits `2`; config is unchanged; the error names the `repo`/`trunk` command to use instead. |
| CMD-12 | `grove config set` on `defaults` with the current `--expect` revision, then again with a stale revision | The first succeeds and bumps `_rev`; the stale one exits `4` and changes nothing. |
| CMD-13 | Config with an unsupported `schemaVersion`; config with an unknown key | Exit `9` and `8` respectively; the file is never rewritten. |
| CMD-14 | `grove status` and `grove config get` | Status lists workspace identity, revision, repositories, Groves, and Trees; `config get` prints the validated config as-is. |
| CMD-15 | Inspect top-level help and bash/zsh/fish completion after removing `grove diff` | `diff` is absent while `changes`, `commits`, and `against-trunk` remain; invoking `grove diff …` exits `2` as an unknown command with the standard remedy. |
| CMD-16 | Audit every registered command's runtime schema against its usage/help, then run the existing argv matrix including trailing globals, repeated options, surplus positionals, and `agent run --` extras | The drift audit passes; every pre-refactor argv keeps the same parsed meaning, output mode, error ordering, and exit code. No handler supplies its own option schema. |

### 11.6 Single-process behavior

| ID | Setup | Expected result |
|---|---|---|
| PROC-01 | Run any non-agent command | No child/background Grove process remains afterward. |
| PROC-02 | Run `agent run` | Agent is a foreground child with inherited terminal I/O. |
| PROC-03 | Press `Ctrl-C` during `agent run` | Signal reaches child; CLI exits after child terminates. |
| PROC-04 | Run two conflicting mutations | One holds the lock; the other completes after the release or exits `4` at the 5-second bound naming the holder's operation; no corruption either way. |
| PROC-05 | Kill a writer between temp write and rename | Original manifest remains valid; reconcile identifies incomplete filesystem work. |
| PROC-06 | Scan listening sockets and processes | Grove opens no listener and leaves no service. |
| PROC-07 | Scan dependencies/source | No Bun API, Electron, daemon, RPC, socket server, or service implementation remains. |
| PROC-08 | Kill `grove new` after `git branch` succeeds in the second repository but before its `git worktree add` | A §6.1 journal remains; `grove reconcile` rolls back the recorded steps, including the leaked branch; no partial Grove survives. |
| PROC-09 | Kill `grove tree add` mid-operation on an existing Grove | Rollback removes only the Tree being added; the Grove and its prior Trees are untouched. |
| PROC-10 | `grove new` across two repos where the second repository's Git step fails in-process | The recorded steps roll back — the first repo's created branch and worktree are gone — the journal is cleared, and the exit code reflects the Git failure. |
| PROC-11 | Kill a mutation holding a lock, then run another mutation | The stale lock is verified against its recorded PID and process start time, reported, reclaimed, and the new mutation proceeds. |
| PROC-12 | Hold a lock from a live (paused) process, then run a conflicting mutation | Never stolen: the second command exits `4` after the 5-second bound, naming the holder; the holder later completes normally. |
| PROC-13 | Run every mutating command to success | `.grove/locks/` is empty after each; lock files exist only while a command runs. |
| PROC-14 | Run two read-only commands during a concurrent mutation | Readers take no global lock and return either a consistent snapshot or a bounded-retry conflict — never a torn read. |

### 11.7 Bundled Node CLI

| ID | Setup | Expected result |
|---|---|---|
| ART-01 | Build | Produces one bundled Node entry point at `dist/grove.mjs` with a Node shebang. |
| ART-02 | Run in clean environment with the declared Node LTS | Works without Bun, TypeScript, `node_modules`, Electron, display, or source tree. |
| ART-03 | Run `grove --version` | Prints the installed package version and exits `0`. |
| ART-04 | Inspect artifact/process behavior | No bundled IDE/server entry point and no background process. |
| ART-05 | Run `npm install --global .` under an isolated npm prefix | Places `grove` on that prefix's `bin` path and every documented command starts. |
| ART-06 | Run with an unsupported Node version | npm rejects installation through the declared `engines` requirement or Grove exits with a precise version remedy. |

### 11.8 Review and file containment

| ID | Setup | Expected result |
|---|---|---|
| FILE-01 | `grove file read`/`file ls` with `..`, an absolute path, or a relative path resolving outside the selected scope | Refuses; nothing outside scope is opened. |
| FILE-02 | A symlink inside a worktree points outside the workspace | Read/list refuses after real-path resolution. |
| FILE-03 | Invoke the removed `grove diff <grove> <tree> <path>` surface | Exits `2` as an unknown command; no compatibility alias or replacement Grove diff surface exists. Use Git in the Tree worktree. |
| FILE-04 | `grove changes`/`commits`/`against-trunk` on a Grove with Trees in two repositories | Output attributes every entry to the correct Tree, repository, and exact branch. |
| FILE-05 | `grove file read` on a binary or oversized file | Bounded, typed refusal rather than a raw dump. |
| FILE-06 | `commits`/`against-trunk` on a Grove whose `defaultBase` is missing from one Tree's repository | That Tree refuses with an error naming the branch and repository; other Trees still report. |

### 11.9 Agent commands

| ID | Setup | Expected result |
|---|---|---|
| AGENT-01 | `agent ls` with one configured agent absent from `PATH` | Lists it with availability false; exits `0`. |
| AGENT-02 | `agent add` with an invalid name or command | Exits `2`; workspace config is unchanged. |
| AGENT-03 | `agent remove` for an unknown agent | Precise error; config unchanged. |
| AGENT-04 | Configure agents at workspace, Grove, and Tree level; run with and without `--agent` | The §8.8 precedence (flag, Tree, Grove, workspace default) selects the agent. |
| AGENT-05 | Fake agent exits with code `7` | `grove agent run` exits `7`. |
| AGENT-06 | `agent run` with no resolvable agent, or a resolvable agent whose executable is missing | Refuses before spawning anything. |
| AGENT-07 | `agent run` with no `<grove>` from a cwd outside any managed Tree | Refuses with a precise remedy. |
| AGENT-08 | `tree configure --working-dir` with `..`, an absolute path, or a symlinked path escaping the worktree | Exits `2`; config unchanged; `agent run` never receives an outside cwd. |
| AGENT-09 | `agent run <grove> -- --flag value` | Everything after `--` reaches the child argv verbatim, after the definition's `args`. |
| AGENT-10 | `agent add` for an existing name | Updates the definition in place under CAS; `agent ls` shows the new command. |

### 11.10 Trunks

| ID | Setup | Expected result |
|---|---|---|
| TRUNK-01 | `grove repo add` | Creates the bare store and the default trunk worktree at `trunks/<trunk-slug>@<repo-slug>/`, recorded in config. |
| TRUNK-02 | `grove trunk add` for an existing long-running branch | Creates the worktree with §5 encoding; config updated under CAS. |
| TRUNK-03 | `grove trunk add` for a branch claimed by a Tree, and `grove tree add` for a branch checked out as a trunk | Both refuse and name the claimant. |
| TRUNK-04 | Commit upstream on the fixture remote, then `grove trunk sync` | Clean trunks fast-forward; `against-trunk` reflects the new trunk tip. |
| TRUNK-05 | Dirty one trunk and diverge another, then `grove trunk sync` | Both are skipped and reported by state; neither is rebased, reset, or lost. |
| TRUNK-06 | `grove trunk remove` on a dirty trunk, without and with `--force` | Refuses first; forced removal warns the change is destructive, removes the worktree, and leaves the branch ref intact. |
| TRUNK-07 | `grove trunk remove` on a worktree whose branch is the effective repository default | Succeeds when clean and leaves the branch ref and repository policy intact. |
| TRUNK-08 | After `repo fetch`, `grove trunk add` for a branch existing only on the remote | Creates the local branch at its remote-tracking ref with upstream configured, then the trunk worktree; the branch is claimed. |
| TRUNK-09 | `grove trunk add` for two branches whose slugs collide | The second directory gets the shortest unique trunk-ID suffix (§5.2); both worktrees are healthy. |

### 11.11 Repository lifecycle

| ID | Setup | Expected result |
|---|---|---|
| REPO-01 | `repo link` an existing checkout | Recorded as `linked`; no default trunk worktree is created; the checkout is untouched; Trees can be created from it. |
| REPO-02 | Commit on the fixture remote, then `repo fetch` | Remote-tracking refs advance; no local branch or worktree moves. |
| REPO-03 | `repo delete-branch` on an unclaimed branch, a Tree-claimed branch, and the effective repository default | Deletes the first; refuses the others and names the claimant or effective default. |
| REPO-04 | `repo remove` while an active or archived Grove references the repository | Refuses with and without `--force`. |
| REPO-05 | `repo remove` a managed repository holding a branch whose commits are reachable from no remote-tracking ref | Refuses without `--force`, naming that branch; forced removal destroys it and itemizes it. A branch merged into the trunk does **not** refuse — deleting the object store still loses it, so it is judged against remote-tracking refs alone (§8.5.1 scope B). |
| REPO-06 | `repo remove --force` a linked repository | Unregisters only; the linked checkout on disk is byte-for-byte untouched. |
| REPO-07 | Archive a Grove whose Tree's repository has no configured remote | **Succeeds** without `--force`. Reachability is evaluated against the refs present, so a missing remote is not by itself risk, and archive retains every ref regardless. *(Supersedes the previous "refuses, stating the repository has no remote".)* |
| REPO-08 | `grove tree add`/`trunk add` for the branch checked out in a linked repository's checkout | Refuses with a policy error naming the checkout; no raw Git duplicate-checkout error surfaces. |
| REPO-09 | `repo fetch` and `trunk sync` across all repositories where one has no remote | The no-remote repository is skipped and reported; naming it explicitly exits `5`. |
| REPO-10 | `repo add` without `--name` | The name derives from the URL's final path segment minus `.git`; a second repository with the same derived name refuses with a `--name` remedy. |
| REPO-11 | `repo remove` a linked repository with no remote and no trunk worktrees, without `--force` | Succeeds; the checkout on disk is unchanged. |
| REPO-12 | `repo remove` a linked repository still referenced by an active or archived Grove, **with** `--force` | Still refuses. This is referential integrity, not work-safety, and `--force` is not an answer to it. |
| REPO-13 | `repo remove` a managed repository whose branches are all reachable from remote-tracking refs, without `--force` | Succeeds. |
| REPO-14 | `repo add` fails while a directory already occupies the target object-store path | Refuses **before** cloning, naming the occupied path; the pre-existing directory is bit-for-bit unchanged afterwards. |
| REPO-15 | `repo add` fails after cloning, with no pre-existing directory at the target | Rollback removes the store it created, as today. |
| REPO-16 | Corrupt a Grove manifest, then `repo remove` or `repo delete-branch` that Grove's repository, with `--force` | Both refuse, naming the unreadable manifest. An unreadable Grove's references and claims cannot be seen, so they cannot be proven irrelevant; `grove reconcile` is the way through, not `--force`. |
| REPO-20 | Link a checkout on `feature/wip` whose selected remote HEAD is `main`, with no override | Effective default is `main`; checkout HEAD is ignored; no default trunk worktree is created. |
| REPO-21 | Add and link equivalent repositories with the same cached remote HEAD and no overrides | Both resolve the same effective default through the shared resolver; only managed mode creates an initial trunk worktree. |
| REPO-22 | Link a remote-less repository with `--default-branch local-main`, then clear the override | The override resolves while set; clearing succeeds; the next default-dependent command refuses without guessing or network access. |
| REPO-23 | Configure a repository's default override and selected remote, including invalid branch/remote attempts | Valid local policy changes persist atomically; invalid changes persist nothing; no Git remotes, branches, or worktrees change. |
| REPO-24 | Select a local remote whose cached symbolic HEAD is absent, with no override | Configuration remains valid; a default-dependent command refuses with a remedy to set an override or repair cached Git metadata. |
| REPO-25 | Inspect `repo link --help` | Says no default trunk is created, warns that Git worktree state is shared, and recommends `repo add` for workspace independence. |
| REPO-26 | Register through `repo add` and `repo link` with a missing explicit override, then inspect successful structured registration output | Both invalid overrides exit `2` without registration; success output separately reports `remote`, nullable `defaultBranch`, `effectiveDefault`, and `defaultSource`. |
| REPO-27 | Select a non-`origin` remote, then fetch and adopt remote-only branches through `trunk add`, `grove new --branch`, and `tree add --branch` | Only the selected remote's tracking refs advance; every adopted local branch tracks that selected remote, never hardcoded `origin`. |
| REPO-28 | Leave repository default policy unresolved, then delete an unrelated unclaimed branch whose commits survive elsewhere | Deletion succeeds; a command that does not need the effective default is not blocked merely because it is unresolved. |
| REPO-29 | Delete a branch whose commits are reachable from no surviving ref, first without and then with `--force` | Refuses without force; forced deletion succeeds and itemizes the discarded branch. A branch whose commits survive through another ref deletes without force. |
| REPO-30 | Corrupt one repository at a time by removing its object store, making its effective default unresolved, deleting a recorded trunk worktree, checking out the wrong trunk branch, and making the trunk branch unreadable | `repo status --json` exits `0`, sets `healthy:false`, and returns the corresponding typed problem for every condition; a healthy repository returns an empty problem list. |

Additional trunk scenarios:

| ID | Setup | Expected result |
|---|---|---|
| TRUNK-10 | Add an available branch as a trunk in a linked repository in human and JSON modes | Both succeed; human output contains the one-location warning; JSON contains the structured warning and remains one value. |
| TRUNK-11 | Remove a clean trunk worktree whose branch is also the effective repository default | Succeeds and retains the branch ref; default resolution still succeeds. |
| TRUNK-12 | Run `trunk ls --json` against the missing, mismatched, and unreadable recorded-trunk states from REPO-30 | Each trunk reports the same typed trunk problem produced by `repo status`; no independent boolean check disagrees with it. |

### 11.12 Archive and delete safety

| ID | Setup | Expected result |
|---|---|---|
| ARCH-01 | Archive a Grove with `NOTES.md` and another Grove-level file, Trees all synced | Directory moves to `groves/.archive/<name>/` with the Grove-level files intact; every worktree is torn down; branch refs remain; the manifest keeps each exact branch and directory. |
| ARCH-02 | Restore it | Directory moves back; every worktree is re-created on the exact recorded branch at the recorded directory; `grove show` matches pre-archive state. |
| ARCH-03 | Archive with one dirty Tree and one clean Tree whose branch is at-risk-local | Refuses **naming only the dirty Tree**. The at-risk-local branch is not a blocker — archive retains the ref. |
| ARCH-04 | Same with `--force` | **Archives.** The dirty Tree is torn down, its uncommitted work discarded, and the output itemizes the discarded files by repository and branch. *(Supersedes the previous "still refuses even when forced".)* |
| ARCH-05 | `grove new`/`tree add` claiming a branch held by an archived Grove | Refuses and names the archived Grove. |
| ARCH-06 | Archive a Grove, then try to create or rename an active Grove to that reserved archived name before restoring it | Creation/rename refuses and names the archived claimant; restore therefore cannot collide and succeeds once its worktrees can be materialized. |
| ARCH-07 | Kill archive mid-operation | The §6.1 journal completes or rolls back via `grove reconcile`; no half-archived state survives. |
| ARCH-08 | Delete a Grove with a `created` Tree whose branch is at-risk-local, without `--force` | Blocks, naming that Tree and stating that deleting its branch destroys commits reachable from no other ref. |
| ARCH-09 | Same with `--force` | Warns, deletes worktrees, deletes `created` branches, leaves adopted branches in place, and itemizes what was discarded. |
| ARCH-10 | Delete an archived Grove whose torn-down `created` Tree is at-risk-local | Blocks without `--force`; forced delete releases all claims and itemizes the discarded refs. |
| ARCH-11 | Kill restore mid-operation | The §6.1 journal completes or rolls back via `grove reconcile`; no half-restored state survives. |
| ARCH-12 | Archive when `groves/.archive/<name>/` already exists | Refuses with a restore-or-delete remedy. |
| ARCH-14 | Archive a Grove whose only change is one untracked file | Refuses — the Tree is dirty per §8.5.1, untracked files count, and archive tears the worktree down. |
| ARCH-15 | Delete a Grove with a dirty Tree, without `--force` | Blocks, listing the Tree and its uncommitted file count. |
| ARCH-16 | Same with `--force` | Warns, deletes the worktrees and `created` branches; modified and untracked files are gone and are itemized in the discard report. |
| ARCH-17 | Archive a Grove whose Trees are clean and whose commits are all reachable from the trunk, **without** `--force` | **Succeeds.** No refusal. This is the false positive the old predicate produced on every finished Grove. |
| ARCH-18 | Archive a Grove with a clean, at-risk-local Tree, without `--force` | Succeeds, and reports that the branch now exists only in the local object store. Archive retains the ref, so nothing is destroyed. |
| ARCH-19 | Archive a Grove containing a loose non-git file, without `--force` | Succeeds; the file is present in `groves/.archive/<name>/` afterwards. |
| ARCH-20 | Delete a Grove with a clean, at-risk-local **adopted** Tree, without `--force` | Not blocked by that Tree — delete retains adopted refs. |
| ARCH-21 | Delete a Grove with **two `created` Trees whose branches point at the same otherwise-unreachable commit**, without `--force` | Blocks, naming both. Judged individually each would appear safe because its sibling holds the commit; both are doomed, so both are at risk. |
| ARCH-22 | Force-delete a Grove with nothing at risk | Succeeds and reports that nothing was discarded — no warning implying loss that did not occur. |
| ARCH-23 | Archive or delete a Grove with a Tree whose git state cannot be read, without `--force` | Blocks, naming the Tree and the reason its state is unknown. Fails CLOSED. |
| ARCH-24 | Same with `--force` | Succeeds, and the discard report lists that Tree as discarded with unknown state rather than omitting it. |
| ARCH-25 | A branch whose commits are reachable only from a tag: `delete` the Grove, then `repo remove` the managed repository | `delete` does not block on it (the tag survives); `repo remove` does (the tag dies with the object store). Same branch, opposite answers. |
| ARCH-26 | Detach HEAD in a Tree, commit, then `archive` or `delete` without `--force` | Both block, naming the commits held on no branch. Found adversarially: the unforced delete previously succeeded while reporting that nothing was discarded. |
| ARCH-27 | Same with `--force` | Succeeds and lists the detached commits in the discard report. |
| ARCH-28 | A branch and a tag sharing one name, pointing at different commits | The branch is judged, not the tag. A bare ref name resolves to the tag, which would report the branch as safe while deleting it destroys its commits. |
| ARCH-29 | A Grove spanning two repositories where a branch name in one matches a `created` Tree branch in the other | The unrelated branch stays in its own repository's surviving set. The refs an operation removes are scoped per object store, never applied as a flat list of names across repositories. |

### 11.13 Reconcile

| ID | Setup | Expected result |
|---|---|---|
| RECON-01 | Delete a Tree's worktree directory out-of-band | Reconcile reports the missing worktree against the manifest; nothing is guessed or rebound. |
| RECON-02 | Delete a `created` branch ref out-of-band | Reconcile reports the missing ref for the exact Tree. |
| RECON-03 | Create a stray directory under a Grove's `trees/` | Reported as unknown to the manifest; never adopted as a Tree. |
| RECON-04 | Run reconcile on a fully consistent workspace | Reports no drift, performs no mutation, exits `0`. |
| RECON-05 | Rename a Grove's directory out-of-band (plain `mv`, not `grove rename`) | The Grove lists under its new directory name — the path is the name (§5.3) and the durable ID is unchanged; reconcile reports each worktree whose Git linkage no longer matches its recorded path, and rebinds nothing. |
| RECON-06 | Introduce each repository/trunk problem from REPO-30, then run `reconcile --json` | The shared typed problem appears in `repositoryProblems`, its human-readable form appears in `drift`, and `clean` is false; fixing the state removes it from all three diagnostic consumers. |

### 11.14 Golden path

These run against the built artifact, scripted end to end with local `file://` fixture remotes.

| ID | Setup | Expected result |
|---|---|---|
| E2E-01 | `init` → `repo add` ×2 → `trunk add` a release branch → `new` with two repos and branch overrides → edit and commit files → push one Tree, leave one unpushed → `changes`/`commits`/`against-trunk` → `agent run` (fake agent) → `trunk sync` after an upstream commit → push the rest → `archive` → `restore` → `delete` | Every step exits `0` (or refuses exactly where §8.5.1 says it must); after every step the on-disk layout, manifests, and Git state match §3–§5. |
| E2E-02 | The same script through the globally installed `grove` from ART-05's isolated prefix | Identical results. |
| E2E-03 | The same script with `--json` on every step | Each stdout is one valid JSON value (the fake agent writes only to stderr, so `agent run`'s trailing JSON result is stdout's sole content per §8.8); the script drives itself from the JSON alone, proving the machine interface is complete. |
| E2E-04 | Against the built artifact, `archive` a dirty Grove without `--force`, then with `--force`; separately commit the same change and archive without force | Dirty archive first refuses and itemizes the work; forced archive succeeds and reports the discarded work. Once committed, archive succeeds without force because it retains the branch ref. |
