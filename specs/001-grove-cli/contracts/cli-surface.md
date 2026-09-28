# Contract: `grove init` & the command surface

**Owns:** §7–§8 · **Status:** closed-to-new-behaviour

> **Closed to new behaviour.** `specs/001-grove-cli/contracts/` is the stable `§` citation authority and the home of the 180 regression scenario IDs — it is never renumbered and never deleted. It is **retired** in the sense that no new behaviour is written here: the Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which supersedes this file wherever the two disagree. Sections describing subsystems v3 deleted carry their own **Superseded** note; a `§` citation into one of those fails `tests/module/citations.test.ts`.

Section numbers are stable citation keys. Code comments, tests, and specs cite `§7–§8`-style references; this file is where they resolve. Do not renumber sections.

---

## 7. `grove init`

```text
grove init [path] [--name <name>] [--nested]
```

It must:

1. canonicalize and display the target;
2. refuse when an ancestor is already a Grove workspace unless `--nested` is explicit;
3. refuse an existing malformed `.grove/config.json`;
4. refuse conflicting `.bare/`, `trunks/`, or `groves/` paths;
5. create `.grove/config.json`, `.grove/.gitignore` (ignoring `locks/` and `journal/`), `.grove/locks/`, `.bare/`, `trunks/`, and `groves/`;
6. validate everything before publishing the config marker atomically;
7. be byte-for-byte idempotent when repeated at the same workspace root.

Without `--name`, the workspace name is the canonical target directory's basename.

There is no migration or adoption. Old Grove files are ignored as configuration and conflicting paths cause `init` to refuse.

## 8. Supported commands and syntax

### 8.1 Grammar and global options

```text
grove [global-options] <command> [positionals] [command-options]
```

The surface has exactly two layers, assigned by rule — never ad hoc:

- **Bare verbs act on the primary object — Groves — or on the workspace itself**: the Grove lifecycle (`new`, `ls`, `show`, `rename`, `archive`, `restore`, `delete`, `configure`), the Grove-scoped review verbs (`changes`, `commits`, `against-trunk`), and the git-precedented workspace verbs (`init`, `status`, `reconcile`, `completion`).
- **Noun families manage supporting resources**: `repo`, `trunk`, `tree`, `agent`, `config`, and `file`.

The primary noun is spent on the binary name (`grove grove new` would stutter), which is why Grove operations are bare verbs — the git/cargo convention. Every future command must fit one of the two layers under this rule.

Each registered command has one runtime argument schema in its `CommandSpec`: option names/types, whether an option repeats or has a default, whether tokens after `--` are forwarded, and accepted positional bounds. Global-option disambiguation and command parsing consume that schema; handlers do not supply a second copy. The human `usage` line remains display text. A gating drift test derives its option names and positional bounds and proves they agree with the schema, but production enforcement never parses documentation text. Help argument entries must likewise name only declared schema options/positionals. This refactor must preserve every command's existing accepted and refused argv, error ordering, JSON envelope, and help text.

| Option | Meaning |
|---|---|
| `--workspace <path>` | Select an exact workspace instead of cwd discovery. |
| `--json` | Emit one stable JSON success or error value. |
| `--progress=json` | Emit NDJSON progress on stderr. |
| `--help`, `-h` | Show top-level or command help. |
| `--version`, `-V` | Print the binary version. |

Rules:

- CLI flags use kebab case only.
- Repeat list flags: `--repo ledger --repo reporting`.
- JSON-valued flags parse once and validate exactly.
- `--` ends option parsing.
- With `--json`, stdout contains JSON only; progress remains on stderr.

References:

| Token | Accepted form |
|---|---|
| `<grove>` | Durable Grove ID or exact case-sensitive name. |
| `<tree>` | Durable Tree ID or exact allocated Tree directory. |
| `<repo>` | Durable repository ID or exact case-sensitive name. |
| `<branch>` | Exact case-sensitive Git branch. |

### 8.2 Workspace-independent commands

| Syntax | Behavior |
|---|---|
| `grove --help` | Show all public commands. |
| `grove <command> --help` | Show exact syntax for one command. |
| `grove --version` | Print the installed package version. |
| `grove completion <bash\|zsh\|fish>` | Generate shell completion. |
| `grove init [path] [--name <name>] [--nested]` | Create a workspace. |

### 8.3 Workspace commands

| Syntax | Behavior |
|---|---|
| `grove status` | Show workspace identity, config revision, repositories, Groves, and Trees. |
| `grove config get` | Print validated `.grove/config.json`. |
| `grove config set --values <json> --expect <revision>` | Update workspace configuration using CAS. |
| `grove reconcile` | Report manifest, filesystem, Git ref, repository-diagnostic, and worktree drift without guessing identity, and finish any pending §6.1 journal — the only mutation reconcile performs, under the §6 locks. |

`grove config set` changes settings only: `name`, `defaults`, and `agents`. The structural arrays — `repositories` and their `trunks` — are read-only to it and change only through the §8.4/§8.4.1 commands, which enforce the on-disk invariants (clone, trunk creation, claim and work-safety checks) that a raw JSON edit would bypass.

`--values` is a one-level settings patch, not a recursive JSON merge. `name` replaces the scalar. The keyed maps `defaults` and `agents` merge by key, so an omitted sibling survives; `null` removes the named key. Each non-null keyed value replaces as one unit. Arrays therefore replace wholesale rather than merging element by element — notably, updating an agent definition replaces its entire `args` array.

### 8.4 Repository commands

| Syntax | Behavior |
|---|---|
| `grove repo ls` | List repositories. |
| `grove repo status [<repo>]` | Report Git/object-store/trunk health. |
| `grove repo add <remote> [--name <name>] [--default-branch <branch>]` | Clone a managed repository into `.bare/` and create an initial trunk worktree at its effective default (§8.4.1). |
| `grove repo link <path> [--name <name>] [--default-branch <branch>] [--remote <name>]` | Register an existing checkout without moving it or creating a trunk worktree. |
| `grove repo configure <repo> [--default-branch <branch> \| --no-default-branch] [--remote <name> \| --no-remote]` | Set or clear repository-owned default/remote policy without rewriting Git configuration. |
| `grove repo fetch [<repo>]` | Fetch one or all repositories. |
| `grove repo remove <repo> [--force]` | Unregister a repository under the work-safety rules below; Grove references always block. |
| ~~`grove repo delete-branch <repo> <branch>`~~ | **Superseded — removed in v3.** FR-038 puts branch deletion outside Grove's surface; it is an explicit native Git action (`git branch -d`). Grove never requests ref deletion (constitution Principle IV). |

Rules:

- `repo add` without `--name` derives the repository name from the remote URL's final path segment, minus any `.git` suffix, validated against §5.2. If derivation fails or the name collides, the command refuses with a remedy to pass `--name`.
- `remote` stores the selected Git remote **name** (`origin` after `repo add`), never a URL snapshot. `defaultBranch` stores only an explicit override. With no override, the effective repository default is the branch named by `refs/remotes/<remote>/HEAD`; the corresponding local branch must resolve. With neither source, a command needing the default refuses (exit `5`). This resolver is shared by managed and linked repositories, reads local Git state only, never guesses, and never uses a linked checkout's current HEAD.
- `repo add` seeds the managed store's cached `origin/HEAD` from clone HEAD, then resolves through that same rule. `repo link` defaults its selected remote to `origin` only when that remote exists; another remote must be named explicitly. A remote-derived default is never persisted.
- `repo add` and `repo link` validate an explicit missing/invalid override identically as invalid input (exit `2`). Their structured success output separates stored policy (`remote`, `defaultBranch`) from the derived result (`effectiveDefault`, `defaultSource`).
- `repo configure` requires at least one policy option; each set/clear pair is mutually exclusive. It validates branch existence and remote-name existence locally, performs no fetch, changes no Git branch/remote/worktree, and writes all requested policy changes atomically. Clearing policy may leave no effective default; the later command that needs one then refuses precisely.
- An unresolved effective default blocks only operations that need its value. Explicit adoption of an existing branch and deletion of an unrelated branch do not resolve it first. A deletion still refuses if the branch can be identified as the configured override or as the cached remote default.
- Linked repositories are recorded with `"mode": "linked"` and the checkout's canonical path. Grove adds worktrees from the linked repository's object store but never moves, rewrites, or deletes the linked checkout itself. `repo fetch` writes only remote-tracking refs into that object store; the checkout's working tree and local branches are never touched.
- `repo link` creates no default trunk worktree: the linked checkout is the long-lived checkout, and Git refuses a second worktree on its checked-out branch. `grove trunk add` may still add trunks for available branches, but successful linked-mode creation warns that Git permits the branch to be checked out in only one worktree until that trunk is removed. Because linked mode shares Git worktree administration with the original checkout, `repo add` is the recommended choice when workspace independence is desired.
- A repository with no configured remote is judged against the refs each destructive operation actually preserves under §8.5.1; missing remote policy is not itself a work-safety blocker. `repo fetch` and `trunk sync` skip such a repository with a "no remote" report when running across all repositories, and refuse (exit `5`) when it is named explicitly.
- `repo remove` refuses while any Grove — active or archived — references the repository, with or without `--force`. Without `--force` it also refuses when any trunk worktree is dirty or, for a managed repository, when any branch in `.bare/<repo>/` is unpushed (§8.5.1). With `--force` it warns that local-only branches and uncommitted trunk changes are destroyed, removes the trunk worktrees, and deletes the managed object store. A linked repository is only unregistered; its checkout and object store are untouched.

Repository health has one authority: a read-only, network-free diagnostic over the object store, effective default, and recorded trunk worktrees. It emits typed problems with these stable kinds: `object-store-unreadable`, `default-unresolved`, `trunk-missing`, `trunk-branch-mismatch`, and `trunk-branch-unreadable`. Each problem names the repository and carries the relevant path, branch, actual branch, and remedy fields when known. A repository is `healthy` exactly when this list is empty; there is no separate degraded/unusable taxonomy.

`repo status` returns the complete diagnostic. `trunk ls` returns each recorded trunk plus the trunk-related problems from the same result; it does not implement a second health check. `reconcile` returns the same typed problems under `repositoryProblems`, renders each into its existing `drift` list, and cannot report `clean: true` while any repository problem exists. All three commands remain diagnostic: unhealthy state is reported at exit `0`, while failure to load the workspace configuration still follows §9.

#### 8.4.1 Trunk commands

Trunks are long-lived branch worktrees at `trunks/<branch-slug>@<repo-slug>/` — the initial effective-default worktree created by `repo add` plus any long-running branch worth keeping checked out: release lines, integration branches, long-lived feature branches. A trunk entry is a worktree, not repository-default policy. They belong to the workspace, not to any Grove, and are recorded in the repository's `trunks` list in `.grove/config.json`.

| Syntax | Behavior |
|---|---|
| `grove trunk ls [<repo>]` | List trunk worktrees, their exact branches, and the trunk-related subset of the shared repository diagnostic. |
| `grove trunk add <repo> <branch>` | Create a trunk worktree for an existing exact branch; a branch existing only on the remote (per the last fetch) is first created locally at its remote-tracking ref with upstream configured. |
| `grove trunk remove <repo> <branch> [--force]` | Remove a trunk worktree. Refuses dirty worktrees without `--force`; a forced removal warns that uncommitted changes are destroyed. The branch ref itself is never deleted. |
| `grove trunk sync [<repo>] [--trunk <branch>]` | Fetch, then fast-forward each clean trunk worktree to its remote counterpart. Dirty or diverged trunks are skipped and reported, never rebased or reset. |

Rules:

- Trunk directories use the §5 encoding and collision rules, with the trunk entry's durable ID for suffixes.
- A branch checked out as a trunk is claimed: `grove new`/`grove tree add` refuse it and name the trunk, and `grove trunk add` refuses a branch claimed by any Tree.
- A branch checked out in any other worktree of the repository — including a linked repository's checkout — is claimed the same way: `grove new`, `tree add`, and `trunk add` refuse it and name the worktree, instead of surfacing Git's duplicate-checkout error.
- `grove trunk sync` is the only command that moves a trunk's checkout; it fast-forwards only, and it is how `against-trunk` comparisons stay current after remote changes wherever a trunk worktree exists.
- Removing a clean trunk worktree is allowed even when its branch is the effective repository default: the branch ref survives and repository policy is unchanged. Dirty-work refusal/force reporting still applies.
- Removing a repository removes its trunk worktrees under `repo remove`'s dirty-work rules.

### 8.5 Grove commands

| Syntax | Behavior |
|---|---|
| `grove new <name> [--repo <repo>]... [--branch <repo>=<branch>]... [--prefix <prefix>]` | Create a named Grove and its initial Trees as one journaled operation (§6.1). A name is required — the name is the Grove's handle and the base for its derived branches; `grove new` with no name is refused (exit 2) before any mutation. |
| `grove ls [--archived]` | List Groves and Trees; Groves in name order, Trees in manifest order. |
| `grove show <grove>` | Show one Grove manifest, Trees, and changes. |
| `grove rename <grove> <name>` | Rename a Grove without changing identity: the directory moves and each worktree moves via `git worktree move`, journaled per §6.1. Refuses a name held by any active or archived Grove; an archived Grove renames in place under the same rules. |
| `grove archive <grove> [--force]` | Move a Grove — manifest, notes, and all Grove-level files — to `groves/.archive/` and tear down its worktrees; the manifest makes them restorable (§8.5.1). |
| `grove restore <grove>` | Move an archived Grove back and re-create its worktrees from the manifest (§8.5.1). |
| `grove delete <grove> [--force]` | Permanently delete a Grove — active or archived — its worktrees, and its created branches; blocks on uncommitted or unpushed work without `--force` (§8.5.1). |
| `grove configure <grove> [--default-agent <agent>\|--clear-default-agent] [--default-base <branch>\|--clear-default-base]` | Change Grove-owned settings. |

Branch overrides use `--branch <repo>=<exact-branch>`. Repository names cannot contain `=`; the branch portion is everything after the first `=`. A `--branch` override must name a repository selected with `--repo`; otherwise the command exits `2`.

A Grove may be created empty: `grove new` with no `--repo` records a Grove with no Trees, populated later by `grove tree add`. Every §8.5.1 operation on an empty Grove trivially passes its work-safety checks.

Example:

```text
grove new pricing-fix \
  --repo ledger \
  --repo reporting \
  --branch ledger=feature/pricing \
  --branch reporting=feature/quote-api
```

Created branches and provenance:

- For each `--repo` without a `--branch` override, `grove new` creates the branch `<prefix><grove-name>`, where the prefix is `--prefix` if given, otherwise `defaults.branchPrefix`, otherwise empty. The base is the repository's effective default.
- A derived branch never adopts silently: if `<prefix><grove-name>` already exists locally or on the remote, `grove new` refuses and names the branch; adopting it requires an explicit `--branch <repo>=<branch>`.
- A `--branch` (or `tree add --branch`) naming an existing branch adopts it and records `"provenance": "adopted"`; a branch Grove creates records `"provenance": "created"`. `grove delete --force` deletes only `created` branches (§8.5.1). Adoption does not require repository-default policy because it does not create a branch from a base; an unresolved repository default therefore does not block explicit adoption.
- A branch that exists only on the remote is adopted too: when `refs/heads/<branch>` is absent but `refs/remotes/<remote>/<branch>` is known from the last fetch, Grove creates the local branch at the remote-tracking ref with its upstream configured and records `"provenance": "adopted"` — the work pre-existed remotely, so Grove never deletes it. Neither command touches the network; run `grove repo fetch` first. Only a branch that exists in neither place is `created`.
- `grove tree add --from <ref>` selects the base for a created branch; it defaults to the repository's effective default.

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

##### Work-safety `--json` shapes

**Refusal — inside the §9 error object**

Work-safety refusals exit `5` (failed precondition) via `GroveError` kind `refused-precondition`, and carry their itemization in `detail`, so a script can act on the blockers without parsing prose.

```json
{
  "error": {
    "what": "Cannot delete \"checkout-redesign\" without --force — delete would permanently destroy:",
    "why": "api:feat/pricing — dirty: 3 uncommitted files, saved in no commit\n  web:feat/nav — commits reachable from no other ref",
    "remedy": "Save what you need first (commit and push the work; move the content out), or pass --force to delete anyway and lose it.",
    "exitCode": 5,
    "detail": {
      "subject": "checkout-redesign",
      "blockers": [
        { "kind": "dirty",         "repo": "api", "branch": "feat/pricing", "treeId": "01J…", "files": 3 },
        { "kind": "at-risk-local", "repo": "web", "branch": "feat/nav",     "treeId": "01J…", "provenance": "created" },
        { "kind": "unknown",       "repo": "ops", "branch": "feat/deploy",  "treeId": "01J…", "problem": "worktree unreadable: EACCES" },
        { "kind": "loose",         "path": "scratch-notes.md" }
      ]
    }
  }
}
```

_Rules_

- `blockers` MUST contain one entry per blocking item — never a summary count, never an empty array on a refusal (FR-010).
- `kind` is one of `dirty` | `at-risk-local` | `unknown` | `loose`.
- `files` appears only on `dirty`; `provenance` only on `at-risk-local`; `problem` only on `unknown`; `path` only on `loose`.
- A Tree that is not a blocker MUST NOT appear. The array is the itemization, not a classification dump.
- `why` remains the human-readable rendering of the same list, so text and JSON cannot disagree.

**Discard report — inside the success object**

Emitted by every `--force` run of `archive`, `delete`, `repo remove`, `repo delete-branch`, `tree remove`, and `trunk remove`, and by unforced `archive` for the branch notice of §8.5.1 item 3.

`tree remove` and `trunk remove` are included even though their blockers are already correct — each removes uncommitted work and no ref, which is exactly what it refuses on. Only their _reporting_ is missing. The list is derived from the destruction table, not maintained by hand: any command whose row marks a column _removes_ emits `discarded`.

```json
{
  "grove": "checkout-redesign",
  "archived": true,
  "path": "/ws/groves/.archive/checkout-redesign",
  "discarded": {
    "nothing": false,
    "uncommitted": [ { "repo": "api", "branch": "feat/pricing", "files": 3 } ],
    "branches":    [ { "repo": "web", "branch": "feat/nav" } ],
    "loose":       [ "scratch-notes.md" ],
    "unknown":     [ { "repo": "ops", "branch": "feat/deploy", "problem": "worktree unreadable: EACCES" } ]
  }
}
```

_Rules_

- `discarded` MUST be present on every command that can destroy data, forced or not.
- `nothing` MUST be `true` exactly when all four arrays are empty, and the human-readable output MUST then say nothing was discarded rather than warning of loss (FR-011).
- `branches` lists only refs whose commits were genuinely at risk. A `created` ref deleted while its commits survive in the trunk is not a discard.
- `unknown` entries MUST be listed, not omitted — they were destroyed and their contents are unknowable after the fact.
- `archive`'s "this branch now exists only locally" notice is **not** a discard — archive retains the ref. It is a separate sibling field so the two are never conflated:

  ```json
  "localOnly": [ { "repo": "web", "branch": "feat/nav" } ]
  ```

  `localOnly` is informational and never affects `nothing`, which reports destruction only. An archive that discards nothing emits `"discarded": { "nothing": true, … }` alongside a populated `localOnly`.

### 8.6 Tree commands

| Syntax | Behavior |
|---|---|
| `grove tree ls <grove>` | List Tree IDs, exact branches, repositories, directories, and health. |
| `grove tree add <grove> <repo> [--branch <branch>] [--from <ref>]` | Create or adopt one Tree. |
| `grove tree remove <grove> <tree> [--force]` | Remove a Tree from its Grove: tear down the worktree and release the branch claim. Refuses a dirty worktree without `--force`; a forced removal warns that uncommitted changes are destroyed. |
| `grove tree configure <grove> <tree> [--default-agent <agent>\|--clear-default-agent] [--working-dir <path>\|--clear-working-dir]` | Change Tree-owned settings. |
| `grove tree reorder <grove> --tree <tree>...` | Set Tree order. |

Rules:

- `tree remove` never deletes the branch ref, whatever its provenance — that is `repo delete-branch` or `grove delete` territory. It mirrors `trunk remove`: the worktree is removed, the manifest drops the Tree, and the released branch is immediately claimable by `tree add` or `trunk add`. A clean-but-unpushed Tree removes without `--force`: the branch survives in the object store, so only a dirty worktree holds at-risk work.
- `tree reorder` persists order as the order of the `trees` array in `grove.json`. Grove order is not stored anywhere: `grove ls` lists in name order, and there is no `grove reorder`.
- `--working-dir` is relative to the Tree's worktree root and must resolve inside it after real-path resolution (the §8.7 containment rules); `tree configure` refuses an escaping value.

### 8.7 Review and file commands

| Syntax | Behavior |
|---|---|
| `grove changes <grove> [--tree <tree>]` | List uncommitted changes. |
| `grove commits <grove> [--tree <tree>] [--limit <n>]` | List commits ahead of trunk/base. |
| `grove against-trunk <grove> [--tree <tree>]` | List all changed files relative to trunk. |
| `grove file ls [<path>] [--grove <grove>] [--tree <tree>]` | List one contained directory level. |
| `grove file read <path> [--grove <grove>] [--tree <tree>]` | Read one contained text file. |

Paths are relative to the selected workspace/Grove/Tree scope. Absolute paths and filesystem- resolved escapes refuse.

Grove deliberately has no per-file `diff` command. Inside a Tree worktree, ordinary Git is the authority for working-tree, staged, committed, and arbitrary-ref patches (`git diff -- <path>`, `git diff --cached -- <path>`, or `git diff <ref>...HEAD -- <path>`). Grove retains `changes`, `commits`, and `against-trunk` because they aggregate and attribute results across repositories. Invoking the removed `grove diff` surface is an unknown-command error (exit `2`); help and generated completion omit it.

The comparison base for `commits` and `against-trunk` is resolved per Tree: the Grove's `defaultBase` if set, otherwise the Tree repository's effective default at invocation time — always a local branch ref. A `defaultBase` missing from a Tree's repository refuses that Tree's comparison with an error naming the branch and repository — never a silent fallback; `grove configure --default-base` warns at set time, listing repositories that lack the branch.

### 8.8 Agent commands

Agents are workspace-local command definitions. Runs are foreground child processes.

| Syntax | Behavior |
|---|---|
| `grove agent ls` | List configured agents and executable availability. |
| `grove agent add <name> <command> [--arg <arg>]...` | Add or update an agent definition in workspace config. A definition is command and arguments only; the child inherits the invoking shell's environment untouched. |
| `grove agent remove <name>` | Remove an agent definition. |
| `grove agent run [<grove>] [--tree <tree>] [--agent <agent>] [-- <extra-args>...]` | Run an agent in the foreground and return its exit code — the one exception to §9's "exactly one of these codes"; see §9.1. |

`agent run` inherits stdin/stdout/stderr and terminal size. `Ctrl-C` reaches the child. Grove does not create a detached process, transcript, session, activity record, or background supervisor.

`agent run` is the one exception to §8.1's `--json` stdout purity: the child owns the inherited terminal, so Grove cannot guarantee a JSON-only stdout. With `--json`, Grove writes its single JSON result (agent, working directory, child exit code) to stdout after the child terminates.

Scope resolution for `agent run`:

- With `<grove>` and `--tree`, the agent runs in that Tree's working directory (the Tree's `workingDir` if set, otherwise the worktree root).
- With `<grove>` but no `--tree`, a single-Tree Grove selects its only Tree; a multi-Tree Grove refuses and lists the Trees.
- With no `<grove>`, Grove uses the Tree that contains `cwd`; if `cwd` is not inside a managed Tree, the command refuses with a precise remedy.

The agent choice is the first of `--agent`, the Tree's `defaultAgent`, the Grove's `defaultAgent`, then the workspace's `defaults.agent`; if none resolves, the command refuses.

### 8.9 Unsupported commands

There are no commands for:

- daemons, servers, sockets, RPC, or background services;
- attach, resume, send, resize, take-control, stop, or close;
- sessions, terminals, activity, events, delegations, hooks, or projections;
- global workspace list/add/open/locate/forget operations;
- migration, import, upgrade, rollback, or compatibility modes;
- legacy `trail` or object-level `branch` commands.
