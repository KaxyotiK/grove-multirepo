# Contract: CLI Surface v3

**Normative content**: this file. The command table below and its grammar are exact and exhaustive; nothing outside `specs/` is normative for them.

_Historical input (not normative):_ `docs/git-native-grove-proposal.md` (deleted; kept in the private development history, not in this repository) §8.0–8.3, as superseded by Decisions 001–003. It is a 1835-line non-contract document outside `specs/` carrying three stacked supersession banners, so citing it as the normative source made this contract's authority depend on a document nobody maintains against it (ledger G-13).

## New families

```text
grove doctor [--repo <repo>] [--grove <grove>] [--strict]
grove sync [<grove>] [--repo <repo>] [--trunks] [--branch <branch>]
  [--strategy <fetch-only|ff-only|rebase>]
grove fix --move [--diagnostic <id>] [--repo <repo>] [--grove <grove>] [--dry-run]
```

There is no `migrate` family. Any historical proposal grammar for it is void under ruling ⑤.

The creation and recovery grammar is:

```text
grove new <name> [--repo <repo>]... [--all] [--branch <repo>=<branch>]... [--from <repo>=<ref>]...
  [--prefix <prefix>]
grove tree add <grove> <repo> [--name <tree>] [--branch <branch>] [--from <ref>]
grove tree remove <grove> <tree> [--allow-destructive-all | --allow-destructive-git-ignored] [--forget-settings]
grove trunk add <repo> <branch> [--from <ref>]
grove reconcile [--operation <id>] [--audit-only] [--abandon <id>]
```

`tree add --name <tree>` supplies the exact final Tree identity; only an omitted name expands the default `{grove}@{repo}` convention.

### Creation selection

- `new` with neither `--repo` nor `--all` creates an empty Grove (ruling ①). `--repo` selects exactly the named repositories in option order; `--all` selects every registered repository in config order; the two together are invalid. A repository selected twice, a duplicate `--branch` or `--from` key, or a key naming an unselected repository is invalid (exit 2).
- `--prefix` overrides `defaults.branchPrefix` for derived branch names.
- Every selected repository, target path, ref mapping, and branch occupancy is preflighted before the first mutation. Predictable invalidity blocks the whole plan; a later native failure can still produce an honest `partial` result.

### Creation matrix

For `new` and `tree add`, the Tree name is expanded first; the branch is then either the explicit `--branch` value or the naming-convention result ("derived").

| Branch state | Source | `--from` | Behavior |
|---|---|---|---|
| Existing local or remote-only | Derived | Any | Refuse naming the branch; implicit naming never adopts a ref (`TREE-15`). |
| Existing local | Explicit | Absent | Adopt the branch; native Git refuses if another worktree holds it. |
| Existing local | Explicit | Present | Invalid: the base would be ignored. |
| Remote-only | Explicit | Absent | Create the local branch at the exact remote-tracking OID, then set its upstream in a separately recorded step. |
| Remote-only | Explicit | Present | Invalid: the two bases are ambiguous. |
| Absent | Derived | Absent | Create at the configured trunk's exact OID; `missing-revision` (exit 5) when it resolves through neither its local nor configured remote-tracking ref. |
| Absent | Derived | Present | Create at the `--from` commit. |
| Absent | Explicit | Absent | Refuse: an explicit new branch requires `--from`. |
| Absent | Explicit | Present | Create at the `--from` commit. |

`trunk add` always names its branch explicitly, so the explicit rows apply. An occupied default Tree path requires `tree add --name`; Grove never allocates a suffix.

"Remote-only" means `refs/remotes/<preferred-remote>/<branch>` exists and the local branch does not. Grove never searches other remotes or picks a unique-looking match; with no preferred remote, or a match only on another remote, the branch is absent. An explicit `--from` does not configure an upstream.

Every base is resolved with native `rev-parse --verify --end-of-options <input>^{commit}`, recorded as raw input plus OID, and revalidated immediately before mutation. The worktree command receives the exact OID after `--`, never the moving revision. The later upstream step verifies that the remote-tracking ref still denotes the recorded OID or returns `stale-plan`.

### Removal and recovery

- `doctor` and `reconcile --audit-only` use one diagnostic audit over the same workspace state, including observed conformance, stale locks, orphaned steal markers, and pending operations. With no mode, `reconcile` runs this audit after recovery.
- `reconcile --audit-only` acquires no operation workspace lock and neither reclaims nor writes a lock. Dead same-machine, legacy, and foreign-machine lock holders therefore yield the same diagnostic identities as `doctor` while their lock records remain unchanged (`V3REL-03`–`V3REL-05`). Other reconcile modes retain operation locking.
- An interrupted `grove-delete` of a Grove without central metadata remains resumable: the durable delete record and recorded directory identity bind its content path, and absence of metadata is an expected state. Recovery still checks layout binding, directory identity, registered worktrees, and exact destructive consent. Completed deletion removes an empty Grove root and its `trees` scaffold. Abandonment leaves artifacts visible; an explicit later `delete` may select an identity-matched Grove root from an abandoned delete record, then inventory current loose content and apply ordinary destructive consent. An empty Grove and `trees` scaffold may be removed directly after the same point-of-use identity check. Older abandoned records do not bind a recreated Grove.
- A retry of a lifecycle command against a Grove held by a pending operation names the operation ID and `grove reconcile --operation <id>`; failures at a `new`, `restore`, or `rename` metadata step give the same exact forward remedy.
- A resumed `repo add` rereads the current workspace config immediately before registration. A changed global config revision alone is not a conflict. A real conflict is an existing registration with the same case-folded alias or repository ID, a managed store path equal to the recorded anchor, or a registered trunk path equal to the recorded initial trunk path, when that registration is not the already-completed registration for this operation. A missing/rebound recorded store or trunk, or a changed layout binding, also conflicts. Independent pending acquisitions may finish in one reconcile run.

- `tree remove` retains the branch. Advisory settings and order are kept by default and become stale metadata. With `--forget-settings`, successful worktree removal is followed by a recorded compare-and-swap step that deletes the exact `{repositoryId, tree}` settings entry and removes it from `treeOrder`; a failure there is `partial` and resumable without repeating the removal.
- `reconcile` modes `--operation`, `--audit-only`, and `--abandon` are mutually exclusive (exit 2). With no mode it resumes every eligible pending operation, then runs the `doctor` audit. A native Git failure while one operation is resumed is recorded under that operation's target lock as recoverable `git-failed`, with `detail.why` and `detail.remedy`; the fixed explanation names the Git exit and step but never copies Git's stderr. For an interrupted `repo add` it names both `grove reconcile --operation <operationId>` and eligible explicit `grove reconcile --abandon <operationId>`. Its `completed` list includes steps completed earlier in that resume run. The failure does not prevent later selected operations or the audit from running. A missing planned repository store is conflicted `stale-plan`, and its remedy names `grove reconcile --abandon <operationId>`. A creation command whose target lock names a pending operation refuses with that operation's ID.
- `--abandon` applies to an operation already classified `conflicted`, or an interrupted `repo add` classified `recoverable` whose unfinished step has durable `recoverable-intermediate` and `git-failed` evidence. Running records and all other recoverable failures remain ineligible. It marks the record abandoned, releases its target locks, performs no compensation or ref/worktree deletion, and lists every surviving artifact. Exception: a failed `repo add` may remove its unregistered managed anchor only while the recorded device/inode still matches, it remains a bare Git directory, and point-of-use inspection proves no surviving ref, object, worktree, or additional content. A matching scaffold pathname/type is insufficient: Grove must have recorded a bounded, content-sensitive genesis proof when it created the default-template anchor and checked that initial scaffold against a separate pristine Git initialization. Only the exact `git remote add` config transition from that genesis may produce the cleanup proof, including when recovery observes the remote after a crash; a late snapshot cannot adopt intervening user bytes. The complete proof must match again immediately before removal. A user Git template, missing/legacy genesis, unreadable entry, or changed scaffold byte retains the anchor. The durable proof contains no raw config, hook, template, or credential bytes; retained content includes nested paths in `survivingArtifacts`, with an explicit incomplete inventory marker if inspection cannot enumerate them all; otherwise an owned anchor is retained and reported for explicit user disposition while the operation closes. Abandoning a recoverable add scrubs its retained remote; a replacement directory or different repository is refused. For previously conflicted adds a replacement symlink is unlinked without following its target; a recoverable add refuses it. Records lacking identity (including interruption between bare init and completion recording) retain even a bare-shaped directory because its ownership cannot be proved. A new plan on those targets may start only after this explicit close and disposition of any retained path.
- Destructive plans persist the per-path loose inventory (FR-023) and per-Tree porcelain status entries. Recovery consent covers only those sets: a current entry absent from the recorded set causes terminal `stale-plan`, with recorded and current sets itemized in the result. Missing recorded sets authorize no dirty work or loose content. Replay must recheck after its last observation. Loose receipts and refusals name every path, directories with a trailing `/`; the inventory records path and type only and is not a content fingerprint (`V3DES-09`, `V3DES-10`).
- An interrupted `grove-delete` replays the same empty structural Tree-slot classification used by delete at planning and point of use, including grouped `{repo}` slots. A slot that remains empty does not expand recorded consent or block resumption, whether the Grove has central metadata or was created by `new --all`; files within a slot remain loose content and require exact recorded consent (`V3REL-01`, `V3REL-02`).
- `unsafe-tree-location` is a blocking diagnostic for an inferred Tree whose filesystem identity equals or contains protected layout roots, Grove roots, repository anchors or other worktrees. Facts are `currentPath`, `protectedKind`, `protectedPath`, and `unresolvable: true` when a path cannot be resolved (including a symlink loop). Such a worktree is demoted from Tree selection; mutations with the same conflict refuse with `stale-plan`. Identity uses native filesystem resolution, including case and Unicode normalization, rather than lexical path spelling.

### Sync and fix selection

- `sync <grove>` selects that Grove's observed Trees; `--trunks` adds observed trunk worktrees; `--repo` filters the set; `--branch` requires `--trunks` and byte-compares the exact trunk branch. With neither a Grove nor `--trunks`, sync resolves the containing Grove from the working directory and refuses at workspace level rather than integrating every branch.
- `fix --move` applies one rescanned `--diagnostic`, or every unambiguous move within its `--repo`/`--grove` filters, or with neither every unambiguous move in the workspace. It always rescans under target locks; a diagnostic ID that no longer exists is stale (exit 4).

The retained repository grammar is:

```text
grove repo add <remote> [--name <alias>] [--trunk <branch>]
grove repo link <path> [--name <alias>] [--base <branch>]
grove repo configure <repo> [--remote <name>] [--no-remote] [--base <branch>]
```

The option that sets a repository's advisory preferred trunk is named for what it does. On `repo add` it is `--trunk`, because that command creates the branch's trunk worktree. On `repo link` and `repo configure` it is `--base`, because those commands only record the default creation and comparison base for new Trees and never create, check out, or reserve a trunk; `--trunk` is not accepted there and is refused as an unknown option before any mutation (`V3ACQ-03`). The recorded value, its inference, and its result fields (`trunk`, `preferredTrunk`) are unchanged.

`repo add` preflights the remote, creates a managed bare common repository under `layout.repositories`, configures the remote name as `origin`, and records `origin` as preferred. It then creates and verifies the selected branch as a real worktree under `layout.trunks`; the default readable path is `trunks/<branch-slug>@<repo-slug>` and that initial trunk and all later trunks are peers. With no trunk override it uses the exact remote symbolic HEAD and refuses when none exists. For a non-empty remote, an override must already exist remotely unless a separately documented explicit creation base is supplied. An empty remote requires an explicit override and produces a verified unborn trunk worktree.

A `<remote>` that Git itself treats as a local path (no `<transport>::` helper, no `scheme://` URL, and no `:` unless a `/` precedes it), or a `file://` URL that Git cannot use as written (no `/` after `file://`, or a first segment of `.` or `..`; Git ignores the host of any other `file://` form, which is used unchanged), is resolved against the directory the command runs in, once, after the credential check and before preflight. An absolute local path is used as given. The resolved absolute path is the one validated, echoed, recorded for recovery, stored as `origin`, and fetched, so `reconcile` resumes against it from any directory. A relative local path that does not exist is refused as `invalid-input` (exit 2) with a remedy, before any Git invocation, repository directory, operation record, or config change. URLs and scp-like `host:path` remotes are never treated as local paths, and the credential rules below apply to them unchanged (issue #22, `V3ACQ-02`).

`repo add` refuses a remote URL that embeds credentials before any mutation and before any Git invocation that carries the URL: userinfo (`user[:password]@` before the host, found as Git and curl find it: every `<transport>::` prefix stripped, two or more slashes after the scheme, and for non-SSH schemes authority up to the first `/`, `?`, or `#`, so a backslash does not end it) in any scheme, including `https://TOKEN@host/…`, except a bare user name in an SSH URL (`ssh://git@host/…` or scp-like `git@host:path`). For SSH, Git percent-decodes only a `scheme://` SSH URL before it splits host and path; scp-like input is parsed raw. Git looks for the first `@[` and then, only if it is absent, a leading `[` to select a bracketed host field, skips slashes inside a bracketed host field, and takes the login through the last `@`. `:`, `?`, or `#` in that login makes it credential-shaped and refused. Git's own answer to where the URL goes after its `url.<base>.insteadOf` rules (`git ls-remote --get-url`, local only) is checked too, in the context of each network call: at the workspace root for the preflight, and in the new store after `git remote add` and before its first fetch, because conditional includes are evaluated against the repository Git runs in. The SSH exemption holds only if Git's answer is still SSH. Credentials introduced only through Git configuration are refused by default for managed network calls; `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` permits them for this invocation only. An absent variable or any other value refuses them. A directly supplied credentialed URL is refused even with the opt-in. The current setting and Git resolution are rechecked before `repo fetch`, `sync`, and `reconcile` resume; neither the setting nor the resolved credentialed URL is stored. A refusal from the store's context comes after the store exists: the result is `partial` with the `fetch` target's reason `refused-policy` (exit 3), and its remedy requires `grove reconcile --abandon <operationId>` to close the conflicted record before retrying. The same check runs again before every later network call for a managed repository (`repo fetch`, `sync`, `reconcile` resuming an interrupted add), which reports that target as `refused-policy` without fetching when the current invocation has not opted in; linked repositories are exempt. This covers network calls made by Git itself; it does not cover an independently configured third-party checkout filter such as Git LFS smudge. The pre-mutation refusal is `invalid-input` (exit 2), echoes neither the userinfo nor the unredacted URL, and names the remedy: an SSH URL, or an HTTPS URL without credentials together with a Git credential helper. Git stores a remote URL verbatim in the managed repository's config, where no result redaction applies (feature `009-file-surface-state-exclusion`, `V3SEC-05`).

Each `repo add` advertisement performs its own destination check, including the second inspection under the target lock after the first network call. A resumed acquisition checks the workspace destination before its remote inspection, then checks the store destination again after that inspection and before its fetch. A Git-config rewrite introduced by an earlier network call therefore follows the current invocation's opt-in policy at the next call.

Recovery also validates the retained **original** URL before any unfinished `repo-add` step can pass it to Git or store it in managed config. An old operation record with a directly credentialed original URL is marked conflicted with `refused-policy` and a safe abandon remedy, even when the current invocation sets `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1`; the record remains available for explicit closure and its retained secret is scrubbed. The opt-in authorizes only credentials that Git configuration introduces to a credential-free original URL.

Errors for unknown or malformed commands and options, surplus positionals, and `repo link` paths redact credentialed URL arguments from every human and JSON field and from Grove records. Ordinary plain SSH account names remain visible in non-secret output.

`repo link` never creates a ref, trunk, or worktree. It records the canonical external common directory and records `origin` when present, otherwise the sole remote, otherwise no preferred remote. An explicit valid `--base` is stored as the advisory preferred trunk even if absent; otherwise Grove chooses an attached/unborn input branch, then common-repository HEAD, then the preferred-remote symbolic HEAD, and refuses detached ambiguity. It never chooses among multiple non-`origin` remotes. Bare input uses common-repository HEAD; remote-dependent operations with no preference report the existing stable `no-remote` reason. Trunk mutation commands refuse every linked repository before mutation, including a linked bare common directory. Tree creation remains available and relies on Git's native occupied-branch refusal without force. If the advisory trunk has no local branch, Grove may resolve the configured preferred remote's tracking ref to an exact base OID; it creates neither a local trunk ref nor a trunk worktree as a side effect. If neither local nor configured remote-tracking advisory ref resolves, default creation refuses before mutation with `missing-revision` (exit 5) and requires `--from` or advisory repair.

`repo link` accepts a repository whose remote URLs embed credentials. Grove does not write that config and records only the preferred remote name. If `sync` reads a URL-valued `branch.<name>.remote`, it redacts that value before placing it in a result or operation record; only a value that passes the remote-name check, is listed by `git remote`, and is unchanged by remote redaction is echoed as a name. Git's own messages do not reliably hide remote credentials (Git 2.50 strips a user name and password on an authentication failure, but prints a user-name-only URL verbatim in `could not read Password for '<url>'`), and Grove does not surface them: `repo fetch` and `sync` classify a failed fetch as `git-failed` and discard its stderr; a linked repository's Git directory inside the workspace is off the file surface (`V3SEC-06`). Refusing it would reject valid Git state created outside Grove (constitution I).

## Behavioral guarantees

- Default, explicit, and compatibility selections include every target exactly once in deterministic order independent of equivalent selector input order.
- Duplicate selectors/overrides refuse; all predictable target errors preflight before first multi-target mutation.
- Existing-local, preferred-remote-only, convention-derived absent, and explicit absent branches follow the creation matrix above. Moving revision inputs resolve and revalidate to exact commit identity before mutation.
- Managed repository storage is never classified as a trunk. Every managed trunk occupies the configured trunk layout and follows one lifecycle contract; there is no primary-checkout exception.
- Linked checkouts and their existing worktrees remain observations, not Grove-managed trunks. Their preferred trunk is a comparison/creation preference only.
- `trunk sync` temporarily delegates with identical old targeting to general fast-forward sync.
- `repo delete-branch` is removed with native `git branch -d/-D` as the documented replacement.
- Lifecycle commands never delete refs. `repo remove` unregisters only. `tree remove --forget-settings` is the explicit advisory-forget path.
- `reconcile` resumes observable structural steps or audits; abandon closes eligible records without compensation. Destructive directory replay requires the current role/selector expansion, workspace-relative/canonical paths, expected presence, and recorded device/inode to match; relocation or reoccupation refuses without touching the stale path.
- `doctor` is read-only. It reports an aged lock-reclamation `<lock>.steal` marker as an `orphaned-steal-marker` info diagnostic: the subject identifies the marker; the facts identify the associated lock, its `absent`, `reclaimable`, or `held` state, stable age classification, and `automatic` recovery. Associated-lock state enters diagnostic identity because it changes the remedy: `held` says to wait for or resolve the holder before retrying, while the other states say to retry the intended mutation; the next successful acquisition removes the aged marker. Direct lock creation performs the post-acquisition cleanup. Reclaim instead clears a pre-existing aged marker while contending for its intent file and removes its own fresh intent in `finally`. Marker mtime and observed age do not enter diagnostic identity. A marker at or within the stale window is treated as an in-progress steal and is not reported as orphaned. When it accompanies a same-host automatically reclaimable stale lock, that `stale-lock` diagnostic carries `stealMarker: "fresh"` as a remedy-changing fact and explains that another reclaim is in progress or was interrupted and that retry succeeds after the marker passes the 30-second stale window. The audit never removes either file. `fix --move` rescans and refuses stale/ambiguous diagnostics.
- Sync never resets divergence. For an integration strategy, any selected target with a native sequencer before the attempt or created during it forces top-level `needs-user`; higher failures affect exit precedence only, and Grove leaves the sequencer intact. Fetch-only performs no local integration and is not blocked solely by dirty or sequencer state.
- Native clone/worktree creation, restore, and reconciled worktree-add are complete only after the planned attached or unborn HEAD, canonical common-directory identity, index/worktree population, and clean status are verified; a checkout/filter failure after repository or ref creation is an honest partial/conflicted result and is never auto-deleted.
- `file ls` and `file read` (§8.7) never reach the workspace's `.grove` directory. A path whose resolution is that directory or lies inside it — by any spelling, traversal, case variant, or symlink — is refused `invalid-input` (exit 2) before anything is opened, and a workspace-root listing omits it. Grove's internal state is not workspace content; this keeps the retained remote of a resumable operation out of Grove's own read surface (feature `009-file-surface-state-exclusion`, `V3SEC-04`).
- `file ls` and `file read` (§8.7) validate operation records before using their steps. A malformed record is reported as an operation error without an internal failure; any repository anchor still recoverable from its raw record remains off the file surface while it is a Git directory. The same loader validation keeps `doctor` and `reconcile` from treating malformed records as usable operations (`V3FSF-01`).
- `file ls` and `file read` likewise never reach a repository Git directory Grove knows: each registered repository's store (a managed repository's expanded `layout.repositories` directory, a linked repository's recorded common directory) when it lies in scope, each unregistered repository observed through a Tree, and the anchor of every recorded `repo add` while that path still looks like a Git directory (a record that no longer loads fails closed on any anchor its text still names). The same identity test and refusal apply (the refusal names the repository's Git directory), and a listing of a parent omits the store. Code in trunks and Trees stays readable. This keeps a credential added by hand to a repository's remote out of Grove's read surface (feature `009-file-surface-state-exclusion`, `V3SEC-06`).

## Amendments — the corrective rulings (2026-08-23)

These supersede any statement above or in `specs/001-grove-cli/contracts/` that disagrees. Each is a ruling from the consolidated adversarial review; the reasoning is in `specs/003-git-native-grove/reviews/grove-v3-consolidated-review-20260823.md` Part 3.

### ① `grove new` creates an empty Grove by default

`grove new <name>` with no `--repo` MUST create the Grove and **zero Trees**, matching its own help, the worked example, and shipped `main` behaviour. Fan-out across every registered repository MUST require an explicit `--all`. Grove creation MUST NOT infer that "no repository named" means "all repositories". Witnesses: `V3NEW-01`, `V3NEW-02`.

### ② Restore binds to the archived commit; archive requires durability

- `restore` MUST reconstitute the **commit recorded at archive time**, not the branch tip. A branch that advanced natively since the archive is **not** an error and MUST NOT be refused as stale.
- When the archived object no longer exists, `restore` MUST refuse.
- `restore --latest` MUST opt into the current branch tip instead.
- `archive` MUST refuse a branch that is not pushed to a remote unless `--allow-unpushed` is passed. A retained ref is not a durability guarantee: v3 sanctions `git branch -D` as a native action and the managed bare repository is local-only, so a promise of restorability to an exact commit requires the commit to survive local ref deletion.
- **Known limitation, accepted:** the push check reads `refs/remotes/*` and is therefore accurate only as of the last fetch, so a branch pushed from another machine reads as unpushed. A false refusal is cheap and correctable with `--allow-unpushed`; a false acceptance silently breaks the restore promise. This narrows `002-work-safety-force-SC-007`'s offline guarantee for `archive` only.
- A repository whose remote is not recorded in Grove config MUST have its remote **observed from Git** rather than being exempted from the check. Only when Git itself has no remote does a distinct refusal apply, naming that as the reason.
- Archiving a Tree whose HEAD is **unborn** MUST be refused, with the remedy naming an initial commit or `grove delete`. Archive previously succeeded and restore could never complete, which is a trap; refusing destroys nothing, because an unborn Tree holds no committed work.

Witnesses: `V3ARC-01` … `V3ARC-06`.

### ③ Membership is layout position

A worktree is a member of a Grove because of **where it is**, not because its branch name matches. A name-matching worktree **outside the workspace** MUST be observed and reported, and MUST NOT be selected for any mutating operation or offered relocation. Witness: `V3ADO-01`.

**A Grove-position directory holding at least one Tree-position directory MUST be observed as a Grove**, even when no registered worktree and no advisory record points at it. Renaming `groves/<name>/` out of band therefore lists the Grove under its **new** directory name — the path is the name (§5.3) — and emits `unregistered-grove` (severity `policy`) for the content nothing accounts for.

- Existence alone is **not** sufficient: `git worktree remove` leaves `groves/<name>/trees/` behind as an empty husk, and observing that as a Grove would resurrect what the user just removed with native Git. The directory must actually hold Tree-position content.
- Grove MUST NOT infer that a renamed directory is the _same_ Grove as the stale registration. Both are reported — the old name with its prunable worktrees, the new name with its unaccounted content — because concluding they are one moved Grove is a guess, and Principle V forbids it. Identity is never rebound: the recorded Grove keeps its durable ID and the appeared directory is not handed one.

Witnesses: `V3ADO-01`, `V3ADO-02`.

### ④ Destructive intent is named, and separate from durability

- `--force` and the former `--allow-destructive` are **removed**. `--allow-destructive-all` permits loss of tracked edits, ordinary untracked files, Git-ignored files, and loose Grove content (`delete`). `--allow-destructive-git-ignored` permits only Git-ignored file loss in `archive`, `delete`, `tree remove`, and `trunk remove`; it never permits loose Grove content loss. They are alternative permission levels. Ignored directory inventories name individual files.
- Durability is a **separate axis**: `--allow-unpushed` covers work that exists in Git but only locally. A command MUST NOT conflate the two.
- Both the refusal **and** the forced run MUST itemize what is at stake or what was actually destroyed at the final point-of-use check. A file that vanished after preflight is not a discard. A forced run that stops partway, and its resume, do this for every step that completed, beside the failing target (`json-results-v1.md`; `V3DES-11`, `V3DES-12`). A Tree removal that Git fails partway is reported failed, with no discards claimed, even if Git deleted some files first. Telling a user only after the fact, or not at all, is the defect this ruling closes.
- An independent nested Git checkout, populated submodule, or bare repository is a structural owner outside either content-loss permission. Removal and structural movement refuse at the preflight and point-of-use checks, naming the nested owner, including during reconciliation. Git administrative entries are inspected through native filesystem lookup, so case and normalization aliases recognized by Git on the current volume cannot bypass the guard. The observed outer worktree's own marker is exempt by device/inode identity. Marked checkouts and bare-shaped metadata are reported as confirmed ownership only after native Git recognizes them; an unsafe or unverified candidate remains an itemized, fail-closed ambiguity. Inspection does not traverse outward symlinks.

Witnesses: `V3DES-01`, `V3DES-02`, `V3DES-03`.

### ⑤ There is no migration

Schema-1 and schema-2 ownership state MUST NOT be interpreted by any runtime code path. See constitution Principle VI and ruling ⑥.

### ⑥ No N-1 compatibility, and skew must self-identify

A foreign-schema workspace or Grove manifest MUST be refused, and the refusal MUST name the running Grove version, the resolved path of the executable that refused, and both schema versions. A machine carrying several installed builds otherwise gives the user no way to tell which one refused. Witness: `V3VER-01`.

### ⑦ JSON is a formatting option, not an information tier

Human and JSON modes MUST carry the **same meaningful facts** without requiring identical bytes, shape, labels, ordering, or layout. Any identity, path, repository name, or reason present in one MUST be present in the other. Every registered handler emits one structured result/error value; the shared emitter alone serializes it for human or JSON output, and handlers cannot provide an independent human projection. Registry-derived help uses the emitter's explicit help path so JSON remains structured while human help follows terminal conventions. `json-results-v1.md` and `help-presentation-v1.md` define these boundaries. Witnesses: `V3OUT-01`, `V3OUT-02`, `V3OUT-03`, `V3HLP-04`.

### ⑧ `specs/001-grove-cli` is closed to new behaviour

It remains the stable `§` citation authority and the home of the 180 regression scenario IDs, and is never renumbered or deleted. No new behaviour is written there; this directory supersedes it wherever the two disagree. See `specs/001-grove-cli/contracts/README.md` and `specs/README.md`.

### Archive and layout repair corrections (V3ALY)

- Before archive moves a Grove directory, an unobserved Git-marked Tree-position directory must not be treated as loose content merely because repository inspection failed. Archive refuses without a durable operation or filesystem mutation and itemizes the content at risk, explicitly marking any depth, count, or readability limit that prevents complete itemization. An unavailable repository unrelated to that Grove's Tree positions does not block archiving an otherwise fully observed or empty Grove (`V3ALY-01`).
- `fix --move` refuses a selected set containing two moves to one destination before creating a durable operation, including in dry-run mode; case-only aliases are the same destination on a case-insensitive volume but remain distinct on a case-sensitive volume (`V3ALY-03`).

## Delete observation efficiency

For a clean two-Tree Grove, a direct `grove delete` MUST complete with at most 120 Git invocations. The bound includes preflight, fresh point-of-use observations, work checks, and native removals. The command MUST retain the same Tree work checks at plan and point of use, including tracked, untracked, and ignored entries; the same loose-content inventory and consent comparison; and the same identity and protected-path checks. A lighter point-of-use workspace observation may omit worktree facts that no delete decision reads, while the target-specific work checks remain fresh. Witnesses: `V3DPF-01`, `V3DPF-02`.
