# Feature Specification: Grove CLI

**Feature Branch**: `001-grove-cli`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Create the baseline specification for the entire grove CLI, using docs/future-state.md as the authoritative source."

## Overview

Grove is a single command-line program (`grove`) that lets an engineer manage several related units of work — each spanning one or more Git repositories — without a daemon, server, IDE, or any global state. A **Grove** is one unit of work; it contains **Trees**, where each Tree is a Git worktree of one repository on one branch. All state lives inside the workspace the command is run in. Every invocation resolves the workspace, performs one operation, writes workspace files atomically when needed, and exits.

This specification is derived from and governed by `specs/001-grove-cli/contracts/` (the authoritative design) and `.specify/memory/constitution.md` (the project constitution). Section references such as §6.1 point at the contract that owns them; see `contracts/README.md`.

## Clarifications

### Session 2026-08-16

- Q: How does a linked repository establish its default branch for Tree creation and review comparisons without creating a Grove trunk? → A: `repo add` and `repo link` share one policy: use the optional `defaultBranch` override, otherwise read the selected remote's locally cached symbolic HEAD, otherwise refuse. The checkout's HEAD is never used and the derived result is not stored. Linked registration creates no trunk worktree, but an explicit `trunk add` is supported with a warning about Git's one-branch/one-worktree constraint.
- Q: Which command owns repository health, and how do other status surfaces relate to it? → A: `repo status` exposes the complete typed diagnostic defined by §8.4; `trunk ls` projects its trunk subset and `reconcile` embeds the same problem objects under `repositoryProblems` while rendering them into `drift`. `grove status` remains inventory-only. Reported problems do not change exit 0.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Establish a workspace (Priority: P1)

An engineer turns a directory into a Grove workspace so that Grove has a single, discoverable place to keep its configuration and worktrees, and so that any later `grove` command run from inside that directory tree knows which workspace it belongs to.

**Why this priority**: Nothing else in Grove works without a workspace and reliable discovery of it. This is the foundation every other story builds on.

**Independent Test**: Run `grove init` in an empty directory, then run a read-only command (e.g. `grove status`) from that directory and a nested subdirectory; both resolve to the same workspace. Running a command from an unrelated directory reports that no workspace was found and names the remedy.

**Acceptance Scenarios**:

1. **Given** an empty directory, **When** the engineer runs `grove init`, **Then** the workspace scaffolding (`.grove/config.json`, `.grove/.gitignore`, `.grove/locks/`, `.bare/`, `trunks/`, `groves/`) is created and the config marker is published atomically only after everything else validates.
2. **Given** an initialized workspace, **When** a command runs from any descendant directory, **Then** Grove resolves the nearest ancestor `.grove/config.json` as the workspace.
3. **Given** a directory with no `.grove/config.json` in it or any ancestor, **When** a command that requires a workspace runs, **Then** Grove performs no mutation and reports the exact "No Grove workspace found" error naming `grove init` as the remedy.
4. **Given** an already-initialized workspace, **When** `grove init` runs again at the same root, **Then** it is byte-for-byte idempotent.
5. **Given** the nearest `.grove/config.json` is malformed or an unsupported schema version, **When** any command runs, **Then** Grove refuses with a configuration error and does **not** fall back to an ancestor workspace or to defaults.

---

### User Story 2 - Create a unit of work and run an agent in it (Priority: P1)

An engineer registers one or more repositories, then creates a named Grove spanning those repositories — each with its own branch and worktree — and runs a coding agent inside a Tree in the foreground. This is Grove's core value: standing up an isolated, multi-repo unit of work in one command and working in it.

**Why this priority**: Registering repositories and creating a Grove with Trees is the primary job Grove exists to do; agent runs are the main way work happens inside a Tree. Together with Story 1 this is the minimum product that delivers the North Star ("golden path").

**Independent Test**: In an initialized workspace, `grove repo add <remote>` for one repository, `grove new my-work --repo <repo>`, confirm the Tree worktree exists on the derived branch, then `grove agent run my-work -- <args>` runs the configured agent in that Tree's directory and returns the child's exit code.

**Acceptance Scenarios**:

1. **Given** an initialized workspace, **When** `grove repo add <remote>` runs, **Then** the repository is cloned into `.bare/`, its default trunk worktree is created under `trunks/`, and its durable identity is recorded in workspace config.
2. **Given** an existing checkout whose selected remote's cached HEAD resolves to `main`, while the checkout itself is on another branch, **When** `grove repo link <path>` runs, **Then** Grove selects the remote, stores no derived branch snapshot, creates no trunk, and resolves `main` as the effective repository default without consulting checkout HEAD.
3. **Given** a registered repository, **When** `grove new pricing-fix --repo ledger` runs, **Then** Grove creates the branch `<prefix>pricing-fix` from the repository's effective default branch, creates the Tree worktree under `groves/pricing-fix/trees/`, and records the Grove and Tree with durable IDs as one journaled operation.
4. **Given** a `--branch <repo>=<existing-branch>` override, **When** `grove new` runs, **Then** the existing branch is adopted and recorded with provenance `adopted`; a branch Grove itself creates is recorded with provenance `created`.
5. **Given** a derived branch name that already exists locally or on the remote, **When** `grove new` runs without an explicit `--branch`, **Then** Grove refuses and names the branch rather than adopting it silently.
6. **Given** a Grove with a single Tree, **When** `grove agent run <grove> -- <args>` runs, **Then** the configured agent runs in the foreground in that Tree's working directory, inherits stdio and terminal size, and Grove returns the child's exit code without creating any background, detached, or recorded session.

---

### User Story 3 - Review work across a Grove without leaving the CLI (Priority: P2)

An engineer inspects what changed across a Grove's Trees — uncommitted changes, commits ahead of trunk, files changed relative to trunk, and contained file contents — using workspace/Grove/Tree-scoped, path-contained read-only commands.

**Why this priority**: Reviewing multi-repo work is a frequent need, but it depends on Groves and Trees already existing (Stories 1–2).

**Independent Test**: In a Grove with committed and uncommitted changes, `grove changes`, `grove commits`, and `grove against-trunk` report the expected aggregate results; file reads remain contained, and the removed `grove diff` surface is absent from help and completion.

**Acceptance Scenarios**:

1. **Given** a Grove with uncommitted edits, **When** `grove changes <grove>` runs, **Then** it lists the uncommitted changes per Tree.
2. **Given** a Grove with commits ahead of its base, **When** `grove commits <grove>` and `grove against-trunk <grove>` run, **Then** they report commits and changed files relative to the per-Tree comparison base (the Grove's `defaultBase` if set, otherwise the Tree repository's effective default branch).
3. **Given** a request for a file outside the selected scope (absolute path or a resolved escape), **When** any review or file command runs, **Then** Grove refuses the path.
4. **Given** a `defaultBase` that is missing from a Tree's repository, **When** a comparison runs for that Tree, **Then** Grove refuses that Tree's comparison and names the branch and repository rather than silently falling back.

---

### User Story 4 - Archive, restore, and delete safely (Priority: P2)

An engineer archives a finished Grove to reclaim worktree space, restores it later, or deletes it permanently — with work-safety checks that never destroy data existing nowhere else without an explicit override, and never demand one for data the command preserves.

**Why this priority**: Lifecycle management keeps a workspace clean, and the safety guarantees are core to trust, but it applies only once Groves exist.

**Independent Test**: Archive a Grove with a dirty Tree (refused), commit and retry (worktrees torn down, manifest and Grove-level files moved to `groves/.archive/`), restore it (worktrees re-created on the recorded branches), and delete it under the same checks.

**Work-safety model** (shared by archive and delete): a Grove is safe to process without `--force` only when nothing it holds would be irrecoverably destroyed. Three conditions each require `--force`, and a refusal **itemizes every one that applies** in a single message — each naming the specific Tree/file and **why** forcing would lose it — so the user sees the full cost before overriding:

- a **dirty** Tree (uncommitted changes, saved in no commit);
- an **at-risk-local** branch (a commit reachable from no ref that survives the operation) — for the commands that remove that ref;
- **loose local content** the user placed in the Grove directory that grove did not create (`delete` only — it `rm -rf`s the directory; `archive` MOVES the directory, preserving such files, so it never blocks on them);
- **unreadable** state, which fails closed. Which of these block a given command is derived from the §8.5.1 destruction table, not asserted here. `--force` overrides every applicable condition and reports what it destroyed.

**Acceptance Scenarios**:

1. **Given** a Grove with a dirty Tree, **When** `grove archive <grove>` runs without `--force`, **Then** it refuses and lists each blocking Tree, its state, its exact branch, and why `--force` would be required to proceed. A clean Tree whose branch holds local-only commits does **not** block: archive retains every ref, so it destroys nothing there.
2. **Given** a Grove with dirty Trees, **When** `grove archive <grove> --force` runs, **Then** every such Tree is torn down, its uncommitted work discarded and itemized in the output; loose files in the Grove directory are preserved because archive moves the directory rather than deleting it.
3. **Given** an archived Grove, **When** `grove restore <grove>` runs and no active Grove holds the name, **Then** the directory moves back and every worktree is re-created on the exact recorded branch at the recorded directory.
4. **Given** a Grove with dirty Trees, `created` branches holding commits reachable from nothing else, or loose non-git files beside its scaffolding, **When** `grove delete <grove>` runs without `--force`, **Then** it blocks and itemizes each blocker with why deletion would destroy it — while `adopted` branches, which delete retains, never appear; **and with** `--force`, worktrees and any loose content are deleted and only `created` branch refs are removed while `adopted` branches are left in place.
5. **Given** an interruption mid-archive, mid-restore, or mid-`grove new`, **When** `grove reconcile` runs, **Then** the pending §6.1 journal is finished or rolled back and exactly what it undid is reported, leaving no partial state.

---

### User Story 5 - Maintain trunks, agents, and configuration (Priority: P3)

An engineer manages long-lived trunk worktrees (release/integration branches), defines workspace-local agents, and reads/updates workspace and Grove settings.

**Why this priority**: These are supporting-resource operations that improve day-to-day work but are not required for the golden path.

> **Sequencing note**: Although agent management is described here for narrative grouping, the `agent add`/`ls`/`remove` definitions and `agent run` are a prerequisite of User Story 2's golden path (a Grove's agent must be defined before it can be run). Implementation therefore schedules the agent commands with US2, not with this story (see `tasks.md` T044). This story's remaining scope is trunk maintenance, destructive repository operations, and `completion`.

**Independent Test**: `grove trunk add <repo> <branch>` creates a trunk worktree and claims the branch; `grove trunk sync` fast-forwards clean trunks; `grove agent add/ls/remove` manages agent definitions; `grove config get/set` reads and CAS-updates settings.

**Acceptance Scenarios**:

1. **Given** a managed or linked repository, **When** `grove trunk add <repo> <branch>` runs, **Then** a trunk worktree is created, the branch is claimed, and `grove new`/`tree add` refuse that branch and name the trunk; linked success output also warns about shared Git worktree administration.
2. **Given** clean trunk worktrees behind their remotes, **When** `grove trunk sync` runs, **Then** each is fast-forwarded only; dirty or diverged trunks are skipped and reported, never rebased or reset.
3. **Given** a workspace, **When** `grove agent add`, `grove agent ls`, and `grove agent remove` run, **Then** agent definitions (command + args only) are stored workspace-locally and their executable availability is reported.
4. **Given** a workspace config at a known revision, **When** `grove config set --values <json> --expect <revision>` runs, **Then** only `name`, `defaults`, and `agents` change via compare-and-swap; the structural `repositories`/`trunks` arrays are read-only to it and a stale `--expect` is refused.

---

### Edge Cases

- **Nested workspaces**: `grove init --nested` is required to initialize inside an existing workspace; without it, initialization refuses. The nearest marker always wins on discovery.
- **Concurrent invocations**: A mutation blocked by a live lock waits up to 5 seconds, then exits with the concurrency code naming the holder's operation; a stale lock is reported and cleared only after process verification, never stolen from a live owner.
- **Crash between temp-write and rename**: The original manifest remains valid; reconcile identifies incomplete filesystem work.
- **Crash after `git branch` before `git worktree add`**: The §6.1 journal records the created branch so reconcile rolls it back; no leaked branch or partial Grove survives.
- **Out-of-band folder rename/move**: Treated as drift — Grove never discovers and rebinds; the branch remains claimed by Git at the old worktree path; reconcile reports the mismatch and does not repair it.
- **Name/slug collisions**: `feature/a` vs `feature_a`, and case-only differences on case-insensitive filesystems, resolve by appending the shortest unique Tree-ID suffix; the allocated directory is recorded and stays stable.
- **Repository with no remote**: Reachability is evaluated against every local branch, tag, and remote-tracking ref present, so a branch merged into a local trunk is safe even with no remote configured. `repo fetch`/`trunk sync` skip it across-all and refuse when named.
- **Linked repository default branch cannot be resolved**: registration succeeds without inventing policy; later default-dependent work refuses and directs the engineer to set `repo configure --default-branch <branch>` or select a remote with cached HEAD. It never guesses from checkout HEAD or branch names such as `main` and `master`.
- **Empty Grove**: `grove new` with no `--repo` records a Grove with no Trees; Tree-level work-safety checks trivially pass. `delete` still refuses without `--force` if the user has left loose (non-git) files in the Grove directory, since `rm -rf` would destroy them and no Tree check would ever see them; `archive` moves the directory and so preserves them without `--force`.
- **Named Grove**: Every Grove is named — `grove new` requires a name and refuses (exit 2) without one. The name is the directory under `groves/`; there is no unnamed/ID-only Grove.
- **`agent run` with `--json`**: The single JSON result (agent, working directory, child exit code) is written to stdout after the child terminates — the one documented exception to JSON-only stdout purity, because the child owns the inherited terminal.
- **Unsupported command families** (daemon/attach/session/global-registry/migration/legacy `trail`): exit with the invalid-command code; no alias maps a legacy command onto a new one.

## Requirements _(mandatory)_

### Functional Requirements

**Workspace discovery & init**

- **FR-001**: Grove MUST resolve the workspace as `--workspace <path>` if given, otherwise the nearest ancestor `.grove/config.json` walking upward from `cwd`; it MUST NOT scan siblings or descendants, read any `GROVE_*` environment variable, or read `~/.grove`.
- **FR-002**: For a command requiring a workspace with no marker found, Grove MUST perform no mutation and emit the exact "No Grove workspace found" error naming `grove init`.
- **FR-003**: An unreadable, malformed, or unsupported-schema-version nearest config MUST be an error; Grove MUST NOT bind to an ancestor or substitute defaults.
- **FR-004**: `grove init [path] [--name <name>] [--nested]` MUST canonicalize and display the target, refuse an ancestor workspace unless `--nested`, refuse an existing malformed marker or conflicting `.bare/`/`trunks/`/`groves/` paths, create the full scaffolding, validate everything before publishing the config marker atomically, and be byte-for-byte idempotent when repeated.
- **FR-005**: There MUST be no migration, adoption, import, or upgrade path; existing/legacy layouts are unsupported and conflicting paths cause `init` to refuse.

**Configuration & manifests (single source of truth)**

- **FR-006**: The only configuration files Grove reads or writes MUST be `<workspace>/.grove/config.json` and `groves/*/grove.json`, plus locks and §6.1 journals under `.grove/`; a full run MUST create nothing outside the workspace.
- **FR-007**: Durable IDs (workspace, repository, Grove, Tree) MUST be the identity authority and MUST NOT be derived from folder names; directory existence MUST NEVER prove identity or state.
- **FR-008**: Unknown keys and unsupported schema versions MUST be errors; invalid configuration MUST NEVER be replaced by defaults or rewritten.
- **FR-009**: Manifest writes MUST use compare-and-swap on `_rev`; a stale expected revision MUST be refused.
- **FR-010**: Archived-vs-active and materialized-vs-not MUST be derived from filesystem location (`groves/.archive/`), not a stored flag; the Grove name MUST be the directory under `groves/`; `grove.json` has no `name` field, and a manifest containing a `name` key MUST be refused as an unknown key (§4.1) rather than tolerated or derived.

**Naming, slugs & collisions**

- **FR-011**: Tree and trunk worktree directories MUST use the §5 encoding (`<branch-slug>@<repo-slug>`) with the exact slug rules, byte limits, and boundary-only truncation, rejecting non-UTF-8 refs rather than rewriting them lossily.
- **FR-012**: Colliding or truncated directory bases MUST receive the shortest unique durable-ID suffix; the allocated directory MUST be recorded and remain stable.
- **FR-013**: Repository names, Grove names, and branch identity MUST follow the §5.2/§5.3 patterns and uniqueness rules (ASCII case-folded uniqueness; reserved `.`-prefixed directories refused); branch identity is the exact case-sensitive string, verified against the real Git ref.

**Single-process safety**

- **FR-014**: Mutations MUST acquire short-lived locks under `.grove/locks/` via exclusive-create in sorted durable-ID order, re-read and revalidate affected config/manifests and their `_rev`/hash and Git preconditions after locking, then perform the operation and release locks; nothing MUST survive a successful command.
- **FR-015**: A live lock owner MUST NEVER be stolen; a stale lock MUST be reported and cleared only after process verification; a mutation blocked by a held lock MUST wait up to 5 seconds then exit with the concurrency code naming the holder's operation.
- **FR-016**: Read-only commands MUST NOT take a global lock; they MUST validate complete files and return a consistent snapshot or report a concurrent revision change and retry within a small bound.
- **FR-017**: Multi-step Git mutations MUST be made recoverable by a durable §6.1 rollback journal under `.grove/journal/`, recording each branch creation before the subsequent `git worktree add`, rolling back on failure, and clearing on success; journal file names MUST be per operation+target so concurrent operations never share a file.
- **FR-018**: `grove reconcile` MUST report manifest/filesystem/Git-ref/worktree drift without guessing identity, and MUST finish or roll back any pending §6.1 journal — its only mutation — under the §6 locks; on a fully consistent workspace it reports no drift and performs no mutation.

**Repository & trunk commands**

- **FR-019**: `grove repo add`/`link`/`configure`/`ls`/`status`/`fetch`/`remove`/`delete-branch` MUST behave per §8.4: managed repositories clone into `.bare/` and gain a default trunk worktree; linked repositories are registered in place, never moved/rewritten/deleted, and gain no automatic trunk. Both modes MUST store only an optional `defaultBranch` override and selected remote name; effective defaults resolve as override → cached selected-remote HEAD → refusal, never checkout HEAD. `repo configure` MUST atomically set/clear that override and selected remote using local validation only. Explicit linked `trunk add` remains supported and warns about shared worktree administration. `repo remove` refuses while any active or archived Grove references the repository (even with `--force`) and applies §8.5.1 work-safety otherwise — for a **linked** repository that is nothing, since the command removes none of it. `repo delete-branch` removes one unclaimed ref that is neither a recorded trunk-worktree branch nor the effective repository default via `git branch -D`, and MUST refuse without `--force` a branch holding a commit reachable from no surviving ref (so the forced delete cannot silently destroy it).
- **FR-020**: `grove trunk add`/`ls`/`remove`/`sync` MUST manage long-lived trunk worktrees per §8.4.1 for managed and linked repositories: a trunk (or any other worktree, including a linked checkout) claims its branch so `new`/`tree add`/`trunk add` refuse it and name the holder; `trunk sync` fast-forwards clean trunks only and skips/reports dirty or diverged ones; branch refs are never deleted by trunk removal, including when the branch is the effective repository default. Successful linked trunk creation reports the §8.4 warning.

**Grove & Tree commands**

- **FR-021**: `grove new`/`ls`/`show`/`rename`/`archive`/`restore`/`delete`/`configure` MUST behave per §8.5, including derived-branch creation from the repository's effective default branch with `created`/`adopted` provenance, refusal to silently adopt an existing branch, empty Groves, and identity-preserving `rename` that moves the directory and each worktree via `git worktree move`, journaled per §6.1. Explicit adoption of an existing branch MUST NOT require an effective default, because it creates no branch from a base.
- **FR-022**: `grove tree add`/`ls`/`remove`/`configure`/`reorder` MUST behave per §8.6: `tree add` creates or adopts one Tree; `tree remove` tears down the worktree and releases the claim but never deletes the branch ref; `--working-dir` MUST resolve inside the worktree after real-path resolution; Tree order persists as the `trees` array order.
- **FR-023**: Every command that can destroy data MUST derive its work-safety behaviour — the states, the surviving-ref set, which conditions block it, the itemized refusal, and the `--force` discard report — from **contracts §8.5.1**, which states the rule once and normatively.

  This requirement deliberately restates none of it. An earlier version of FR-023 reproduced the blocker list here, and the copy and the contract drifted apart into a direct contradiction over whether a forced archive discards dirty work (review finding C1). A rule stated in two places is a rule that will eventually be stated two ways; the contract is the single statement, and this requirement is the pointer to it.

**Review, file & agent commands**

- **FR-024**: `grove changes`/`commits`/`against-trunk` and `grove file ls`/`read` MUST be read-only, scope- and path-contained (absolute paths and resolved escapes refused), with the per-Tree comparison base resolved as `defaultBase` else the Tree repository's effective default, refusing a `defaultBase` missing from a Tree's repository rather than falling back. Grove MUST expose no per-file diff command; ordinary Git in the Tree worktree owns patch display.
- **FR-025**: `grove agent add`/`ls`/`remove`/`run` MUST manage workspace-local agent definitions (command + args only, inheriting the invoking shell's environment untouched) and run the agent as a foreground child inheriting stdio/terminal size, returning the child's exit code, with the agent chosen as `--agent` → Tree `defaultAgent` → Grove `defaultAgent` → workspace `defaults.agent`, refusing if none resolves; Grove MUST NOT detach, supervise, resume, attach, record, or background the child.

**CLI surface, output & exit codes**

- **FR-026**: The command surface MUST have exactly the two layers of §8.1 (bare verbs for Groves and the workspace; noun families `repo`/`trunk`/`tree`/`agent`/`config`/`file` for supporting resources); flags MUST be kebab-case; `--` MUST end option parsing; list flags repeat.
- **FR-027**: `--json` MUST emit exactly one stable JSON success or error value on stdout with progress kept on stderr; the sole exception is `agent run`, which writes its single JSON result to stdout after the child terminates. Errors MUST always state what failed, why, and the next action.
- **FR-028**: Grove MUST use the §9 exit-code taxonomy exactly (`0` success; `2` invalid input; `3` refused by policy; `4` concurrent/conflicting; `5` failed precondition; `6` Git; `7` filesystem; `8` missing/invalid workspace config; `9` unsupported config version; `1` internal), and MUST carry the same fields and code in `--json` errors.
- **FR-029**: Grove MUST provide `--help`/`-h`, `--version`/`-V`, and `grove completion <bash|zsh|fish>` generated directly from the CLI command definitions.

**No background & no legacy creep**

- **FR-030**: Grove MUST NOT run or create any daemon, server, socket, listener, RPC, background service, event bus, projection, hook, detached/supervised process, transcript, or session; the only journal is the §6.1 rollback journal; unsupported command families (§8.9) exit with the invalid-command code and no alias maps a legacy command onto a new one.

### Key Entities

- **Workspace**: The single configuration authority rooted at `<workspace>/.grove/config.json`. Owns durable ID, name, defaults, agent definitions, and the structural repositories/trunks arrays.
- **Repository**: A managed (cloned into `.bare/`) or linked (registered in place) Git repository, identified by a durable ID. It stores a selected remote name and optional explicit `defaultBranch` override; its effective default is derived from those and local Git metadata. Either mode may have Grove-managed trunk worktrees, but linked registration creates none.
- **Trunk**: A long-lived branch worktree at `trunks/<branch-slug>@<repo-slug>/` owned by the workspace (not a Grove); claims its branch but does not own repository-default policy or a Grove's comparison base.
- **Grove**: A unit of work under `groves/<name>/` (or `groves/.archive/<name>/` when archived), with a `grove.json` manifest holding durable ID, Grove-owned settings (`defaultAgent`, `defaultBase`), and its Trees.
- **Tree**: One Git worktree of one repository on one exact branch inside a Grove, identified by a durable Tree ID, with a recorded allocated `directory`, `provenance` (`created`/`adopted`), and Tree-owned settings (`workingDir`, `defaultAgent`).
- **Agent**: A workspace-local command definition (command + arguments) run as a foreground child process; no session or activity is recorded.
- **Lock**: A short-lived exclusive file under `.grove/locks/` identifying PID, process start time, operation, and affected IDs, held only for the duration of a mutation.
- **Journal**: A durable §6.1 rollback record under `.grove/journal/` describing an in-progress multi-step Git mutation so it can be finished or rolled back after interruption.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **001-grove-cli-SC-001**: An engineer can go from an empty directory to a working multi-repo unit of work — `init`, `repo add`, `new`, and an `agent run` in a Tree — using only documented `grove` commands, with every step exiting `0` or refusing exactly where the safety rules require.
- **001-grove-cli-SC-002**: 100% of commands are driveable from `--json` alone: for every command, `--json` stdout is exactly one valid JSON value, and an end-to-end script can complete the full golden path reading only that JSON.
- **001-grove-cli-SC-003**: No command destroys data that exists nowhere else without an explicit `--force`, and no command demands `--force` for data it preserves. Both halves are measured against the §8.5.1 destruction table: for every refusal the suite can provoke, forcing the same command must in fact destroy the data the refusal named — a refusal naming data that survives forcing is a false positive by definition. State that cannot be read fails CLOSED and is never assumed clean.
- **001-grove-cli-SC-004**: After any interrupted multi-step operation, a single `grove reconcile` returns the workspace to a consistent state (finishing or rolling back the journal) and reports exactly what it changed, leaving no partial Grove, leaked branch, or half-archived state.
- **001-grove-cli-SC-005**: A full command run creates nothing outside its workspace(s): zero files under `~/.grove`, `~/.config`, or any path outside the temporary workspaces, and no `GROVE_*` environment variable changes any behavior.
- **001-grove-cli-SC-006**: After any successful command, no Grove-created process, lock file, or listening socket remains.
- **001-grove-cli-SC-007**: Two independent workspaces on the same machine never read or affect each other's configuration.
- **001-grove-cli-SC-008**: Every error output states what failed, why, and the next action, and returns the correct code from the §9 taxonomy (verifiable per command).

## Assumptions

- **Actors** are software engineers using the CLI directly (or scripts driving it via `--json`); there are no other user roles, accounts, or permission tiers.
- **Platforms** are macOS and Linux; Windows is out of scope and untested at launch.
- **Network** is used only by explicit fetch/clone operations (`repo add`, `repo fetch`); all work-safety and comparison judgments use remote-tracking state from the last fetch and never touch the network.
- **Grove-name authority**: the constitution's Single Source of Truth resolves the one open design ambiguity — the filesystem owns the Grove name and `grove.json` carries no `name` field (a manifest containing one is an unknown-key error, refused per §4.1); this spec assumes that resolution.
- **Git and a supported runtime** are present on the engineer's machine; Grove drives Git through standard worktree/branch operations and runs agents as ordinary child processes.
- The authoritative behavioral contract and exhaustive acceptance scenarios live in `specs/001-grove-cli/contracts/` (§8 command surface, §9 exit codes, §11 acceptance criteria); this spec captures the user-facing WHAT and WHY and defers exhaustive per-scenario detail to that document.

## Out of Scope

- Any daemon, server, socket, RPC, background service, event bus, projection, hook, session, activity, or attention machinery.
- Attach/resume/send/resize/take-control/stop/close of agent processes; transcripts or session recording.
- Global workspace registry, "recent workspaces", cross-invocation remembered selection, or any global/user-level Grove configuration.
- Migration, import, upgrade, rollback, or compatibility modes; legacy `trail`/object-level `branch` commands.
- IDE, desktop, or GUI surfaces; Windows support.
