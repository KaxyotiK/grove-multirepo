# Feature Specification: Git-native Grove

**Feature Branch**: `003-git-native-grove-v2-redesign`

**Created**: 2026-08-21

**Status**: Corrective convergence open; the bounded execution plan starts from verified v2 baseline `e6aabeb`

**Input**: Redesign Git-native Grove from the verified v2 baseline at `e6aabeb`. Decisions 001–003 and this package supersede the historical technical input in `docs/git-native-grove-proposal.md` (deleted; kept in the private development history, not in this repository). Standard Git remains the sole authority for repositories, refs, branches, HEAD, worktrees, upstreams, and working state. Grove owns workspace layout, repository acquisition policy, conventions, advisory metadata, diagnostics, and explicit multi-repository orchestration. This feature removes v2 ownership metadata without rejecting valid bare-repository/worktree topology registered under schema 3. No implementation commit from the superseded v3 branch is an implementation input.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Use standard Git without leaving Grove inconsistent (Priority: P1)

As a developer or coding agent working in a Grove Tree, I can use ordinary Git commands directly. Grove observes the resulting repository, branch, HEAD, upstream, worktree, and working state the next time it runs. Grove may report a convention mismatch, but it does not reject valid Git state, reverse the change, or require metadata repair.

**Why this priority**: Native Git interoperability is the defining product goal. Without it, Grove continues to compete with Git and agents cannot safely use their default Git workflows.

**Independent Test**: Start with a conforming Tree, perform branch switches and worktree additions, moves, and removals using only Git, then invoke Grove read commands. Every successful Git change is shown as current reality without any Grove-specific repair step.

**Acceptance Scenarios**:

1. **Given** a registered worktree displayed by Grove, **When** a user successfully switches its branch with Git, **Then** the next Grove invocation displays the new branch and does not report corruption.
2. **Given** a configured Grove layout, **When** a user adds a Git worktree directly at a matching Tree path, **Then** Grove discovers it as a Tree on the next invocation without a manifest edit.
3. **Given** a valid worktree outside its expected Grove path, **When** Grove observes it, **Then** Grove reports it as external or misplaced while continuing to accept the underlying Git state.
4. **Given** a detached, unborn, locked, or prunable worktree state accepted or reported by Git, **When** Grove lists or audits the workspace, **Then** Grove represents that state truthfully rather than forcing it into a stored branch model.
5. **Given** a native worktree path that is not valid UTF-8, **When** Grove lists or audits it, **Then** Grove preserves and displays the path losslessly, diagnoses `unsupported-native-path`, and refuses Grove mutation of that path with a native Git remedy.

---

### User Story 2 - Create and organize a multi-repository Grove (Priority: P1)

As a developer, I can add a repository that Grove stores as a managed bare common repository with real peer trunk worktrees, or link an externally managed repository without Grove occupying its long-running trunk branches. I can then create a Grove spanning all or selected repositories, with each resulting checkout remaining an ordinary Git worktree.

**Why this priority**: Multi-repository workspace organization is Grove's core value once Git retains ownership of live repository state.

**Independent Test**: Add one repository, link one existing standard checkout, and verify that add creates a bare common repository plus a trunk-layout worktree while link creates no trunk. Create one Grove and verify that both repositories receive only the intended Tree worktrees.

**Acceptance Scenarios**:

1. **Given** multiple configured repositories, **When** a user creates a Grove without narrowing repository scope, **Then** Grove targets every configured repository once in configuration order.
2. **Given** multiple configured repositories, **When** a user selects a subset, existing branches, remote-only branches, or explicit starting revisions, **Then** Grove creates only the unambiguous requested worktrees and reports each selected target.
3. **Given** an invalid name, ambiguous branch source, duplicate repository selection, occupied target, or moving starting revision, **When** creation is preflighted, **Then** Grove refuses before the first mutation and explains the corrective action.
4. **Given** one selected repository fails after another succeeds, **When** Grove returns, **Then** it reports honest partial success and retains every successfully created worktree and ref for resume or explicit cleanup.
5. **Given** the selected Git executable lacks a required capability, **When** a mutating command is preflighted, **Then** Grove reports the exact failed probe with exit 9 before persisting an operation record or mutating state.
6. **Given** a repository with a remote symbolic HEAD or explicit existing trunk override, **When** `repo add` succeeds, **Then** Grove creates a managed bare common repository and a real initial trunk worktree at the readable `trunks/<trunk-slug>@<repo-slug>` default path (for example `trunks/main@grove-cli`).
7. **Given** an added repository with `main` already materialized as a trunk, **When** another long-running branch is added, **Then** both branches appear as structurally equal trunk-layout worktrees backed by the same bare common repository.
8. **Given** an existing standard checkout, linked worktree, subdirectory, or bare common directory, **When** `repo link` succeeds, **Then** Grove records the canonical external common directory, creates no ref or trunk worktree, and treats the preferred trunk as an advisory creation/comparison base, resolving its configured remote-tracking ref when no local branch exists without creating that local branch.
9. **Given** a linked repository, **When** a trunk mutation is requested, **Then** Grove refuses before mutation so it cannot occupy a long-running branch needed by an external checkout.
10. **Given** either an added or linked repository, **When** a Tree is created on an available Grove branch, **Then** Grove creates the native linked worktree and honors Git's existing-worktree refusal without force.

---

### User Story 3 - Diagnose and explicitly correct convention drift (Priority: P1)

As a developer, I can audit the whole workspace or a selected Grove or repository and receive stable, actionable diagnostics for layout, naming, registration, metadata, and worktree health. If a misplaced worktree has one safe expected destination, I can preview and explicitly request the move.

**Why this priority**: Once native Git changes are accepted, Grove must make the gap between observed reality and workspace convention visible without confusing that gap with corruption.

**Independent Test**: Create conforming, misplaced, external, detached, stale-metadata, and unregistered-repository examples; run the audit; verify stable diagnostic codes and identifiers; preview one safe move and apply it explicitly.

**Acceptance Scenarios**:

1. **Given** unchanged workspace facts, **When** an audit is repeated, **Then** each diagnostic retains the same identifier and machine-readable code.
2. **Given** two distinct problems that look similar in presentation, **When** Grove emits diagnostics, **Then** their identifiers remain distinct and each remedy targets only its own subject.
3. **Given** a uniquely resolvable misplaced worktree, **When** a user previews a move, **Then** Grove shows the exact target and makes no changes.
4. **Given** a diagnostic that has changed or disappeared since it was displayed, **When** a user requests its fix, **Then** Grove refuses as stale rather than acting on the old observation.
5. **Given** ambiguous, occupied, locked, or unsafe move conditions, **When** a user requests a fix, **Then** Grove refuses without changing Git state or deleting files. **Amended 2026-09-24 (issue #18 review F3):** uncommitted work is not a refusal condition; a dirty Tree moves with its work intact (`V3LAY-07`).

---

### User Story 4 - Coordinate explicit sync and recover structural operations (Priority: P2)

As a developer or automation author, I can explicitly fetch or integrate selected clean branches across a Grove and receive one deterministic result for every selected target. I can also resume interrupted Grove structural operations after Grove re-observes their actual state.

**Why this priority**: Multi-repository coordination should remain convenient, but it must expose partial outcomes and native Git preconditions honestly rather than claiming atomicity.

**Independent Test**: Run fetch-only, fast-forward-only, and rebase syncs over mixed targets, then interrupt representative structural operations between steps and resume them. Verify target-complete results, ref safety, and no blind replay.

**Acceptance Scenarios**:

1. **Given** clean branches with fetchable upstreams, **When** a user requests fast-forward-only sync, **Then** each eligible target advances only when a fast-forward is possible and divergence is reported without reset.
2. **Given** a local-branch upstream, no upstream, a detached worktree, a dirty worktree, or an active native sequencer, **When** sync is requested, **Then** Grove applies the documented strategy-specific target reason; for an integration strategy, any selected target with an extant native sequencer forces top-level `needs-user`, while fetch-only does not integrate or block solely on dirty/sequencer state.
3. **Given** a rebase that needs user resolution, **When** Grove returns, **Then** the native sequencer remains available and the result directs the user to finish or abort it with Git.
4. **Given** an interrupted multi-repository structural operation, **When** recovery runs, **Then** Grove observes whether each step ran, did not run, reached a recognized intermediate state, or conflicted before deciding whether it can continue.
5. **Given** a conflicted or stale structural operation that cannot continue, **When** the user explicitly abandons its record, **Then** Grove closes the record without compensation or ref deletion and reports all surviving artifacts.

---

### User Story 5 - Perform lifecycle actions without hidden ref ownership (Priority: P2)

As a developer, I can remove Trees and trunks, rename, archive, restore, or delete a Grove, and unregister a repository with clear safety checks. These actions affect only their documented workspace and worktree targets; they never infer branch ownership or delete refs as rollback or cleanup.

**Why this priority**: Lifecycle commands are where the current ownership model creates the greatest risk of destroying work that Git still considers valid.

**Independent Test**: Exercise every lifecycle command with local-only branches, remote-only branches, detached commits, dirty worktrees, stale advisory metadata, and interrupted steps, then prove all refs are retained unless the user separately deletes them with Git.

**Acceptance Scenarios**:

1. **Given** a Tree on a normal branch, **When** the user removes the Tree, **Then** Grove removes only the selected worktree and leaves all refs untouched.
2. **Given** an unreachable detached commit, **When** a destructive lifecycle action is requested, **Then** Grove refuses until the user preserves or otherwise resolves the commit.
3. **Given** an archived Grove, **When** later native Git changes make a saved restoration hint unavailable or occupied, **Then** restore reports the mismatch and does not guess or rewrite refs.
4. **Given** a repository registration referenced by advisory settings, **When** the user unregisters it, **Then** Grove removes only the registration; the repository, worktrees, branches, and settings remain visible or stale as appropriate.
5. **Given** Tree settings the user wants discarded, **When** worktree removal is explicitly requested with settings removal, **Then** only those advisory settings and their ordering entry are forgotten.

---

### User Story 6 - Identify an incompatible ownership workspace safely (Priority: P2)

As an existing Grove user, I receive an unambiguous refusal when schema-3 Grove encounters schema-1 or schema-2 ownership state. The refusal identifies the running Grove version, the resolved executable, the encountered schema, and the accepted schema so I can choose the matching older binary or initialize a separate schema-3 workspace without the new runtime interpreting legacy ownership data.

**Why this priority**: The architecture and schema are intentionally breaking. A precise refusal protects existing Git repositories and worktrees without keeping the deleted ownership model alive inside v3.

**Independent Test**: Build disposable schema-1 and schema-2 workspace and Grove-manifest fixtures, invoke representative read and mutation commands with the built artifact, and prove that each invocation refuses before Git or filesystem mutation while identifying both versions and the resolved binary path.

**Acceptance Scenarios**:

1. **Given** a schema-1 or schema-2 workspace, **When** a schema-3 command loads it, **Then** Grove refuses without interpreting its repositories, worktrees, refs, claims, or provenance.
2. **Given** a Grove manifest written by another schema, **When** schema-3 Grove encounters it, **Then** Grove refuses rather than falling back, upgrading, or partially publishing schema-3 state.
3. **Given** several Grove builds are installed, **When** foreign-schema state is refused, **Then** human and JSON errors name the running version, resolved executable path, encountered schema, and accepted schema.
4. **Given** an existing bare common repository and attached worktrees with no foreign Grove ownership state loaded by v3, **When** they are registered under a schema-3 workspace through the supported acquisition boundary, **Then** Grove treats the Git topology as valid and does not reparent it into an ordinary clone.

### User Story 7 - Read help designed for a terminal (Priority: P1)

As a terminal user, I can scan top-level, noun-family, and per-command help in conventional CLI sections with aligned names and descriptions, readable notes, and copyable examples. As an automation author, I can request the same help facts as structured JSON.

**Why this priority**: Help is the first-use interface for the complete command surface. Exposing the internal object/array shape makes accurate help difficult to scan even when no fact is missing.

**Independent Test**: Request human and JSON help at the top level, for `repo`, and for `new`. Verify that human output uses conventional sections and aligned entries without structured-value dump markers, while JSON retains structured command, argument, option, note, example, and hint data.

**Acceptance Scenarios**:

1. **Given** the top-level command registry, **When** a user runs `grove --help`, **Then** the title, usage, global options, commands, and hint are separated into readable terminal sections with aligned option/command descriptions.
2. **Given** a noun family, **When** a user runs `grove repo --help`, **Then** each subcommand's path, summary, and exact usage remain visible without array/object traversal syntax.
3. **Given** a command with positionals, options, a note, and examples, **When** a user runs `grove new --help`, **Then** conventional Usage, Arguments, Options, Notes, and Examples sections preserve every meaningful fact with readable wrapping and copyable examples.
4. **Given** any of those help requests with `--json`, **When** Grove emits help, **Then** stdout is one structured JSON value containing the same meaningful help facts, without requiring the JSON shape to imitate the human layout.

### Edge Cases

- A valid Git worktree exists inside a Grove-shaped directory but belongs to an unconfigured repository.
- Two configured aliases resolve to the same repository identity, or an old alias is later reused for a different repository.
- A configured repository is reachable only through a linked worktree, a subdirectory, or a bare external anchor.
- A managed trunk or external worktree has an unborn branch, detached HEAD, unreachable detached commit, non-text ref name, missing upstream, local-branch upstream, or remote-only branch.
- A linked standard checkout is currently away from its preferred trunk and would be prevented from switching back if Grove occupied that branch.
- A path passed to `repo link` is a linked worktree or subdirectory whose common repository also has other worktrees.
- A path passed to `repo link` resolves to a bare repository; its topology does not imply consent for Grove trunk management.
- A native worktree path contains a valid UTF-8 newline and must round-trip normally, or contains invalid UTF-8 bytes and must be represented losslessly as `unsupported-native-path` without becoming a Grove mutation target.
- Raw Git changes a target after Grove observes it but before Grove attempts a mutation.
- Git reports a worktree as locked, missing, corrupt, prunable, already occupying a branch, or already occupying a destination.
- A layout or naming convention change makes existing worktrees nonconforming or would make loose Grove/archive content undiscoverable.
- Advisory Tree settings, order entries, or archive recipes refer to a repository or worktree that no longer exists or whose alias was reused.
- A structural operation crashes before mutation, after Git creates only a branch, after worktree creation, after a move/remove, or during metadata publication.
- Sync fetch succeeds but integration does not; a rebase succeeds or conflicts immediately before interruption; an upstream changes during the operation.
- A workspace marker or Grove manifest has schema 1, schema 2, an unknown schema, or a malformed schema field; refusal must occur before any legacy field is interpreted or any state is mutated.
- Machine-readable output must represent mixed complete, skipped, blocked, conflicted, and needs-user targets without omitting targets selected implicitly.
- Human help may be displayed in a narrow terminal; prose wraps beneath its description column without separating an option or command name from its description, while examples remain copyable.

## Requirements _(mandatory)_

### Functional Requirements

#### Git authority and interoperability

- **FR-001**: Git MUST be the sole authority for repository identity, refs, branches, HEAD, upstreams, worktree registration, locks, working state, and ahead/behind state.
- **FR-002**: Grove MUST NOT require a Git wrapper, command interception, hook, shim, or post-command metadata repair for standard Git use.
- **FR-003**: Grove MUST observe live Git state anew on each invocation and MUST NOT treat advisory or previously observed values as proof of current Git state.
- **FR-004**: A standard Git operation that succeeds MUST be accepted as current reality by Grove; any resulting convention mismatch MUST be reported as a diagnostic rather than corruption.
- **FR-005**: Grove MUST discover registered worktrees that match configured Grove and Tree paths even when they were created outside Grove.
- **FR-006**: Grove MUST distinguish conforming, misplaced, external, detached, unborn, locked, missing, corrupt, prunable, and unsupported-native-path observed states without inventing ownership.
- **FR-006A**: Grove MUST preserve native worktree path bytes from Git observation through identity and machine output.
- **FR-006B**: A non-UTF-8 native worktree path MUST be listed losslessly as `unsupported-native-path`.
- **FR-006C**: Grove MUST NOT canonicalize a native path from replacement text, match a non-UTF-8 path to UTF-8 layout, or target it through a Grove mutation API.
- **FR-007**: Grove MUST NOT maintain branch claims, branch provenance, authoritative Tree branch records, or other competing representations of live Git state.
- **FR-008**: Grove MUST NOT automatically rename, reset, delete, or recreate refs to enforce naming or layout conventions.

#### Workspace conventions and discovery

- **FR-009**: Workspace configuration MUST define validated locations for managed bare repository stores, trunks, Groves, Trees, and archived loose content.
- **FR-010**: Workspace configuration MUST define validated naming conventions for Grove-created branches and Trees. The default trunk location MUST use the normative readable `<branch-slug>@<repo-slug>` allocation, appending a collision-safe suffix only for truncation or an observed case-fold collision; it MUST NOT require a persisted live trunk array.
- **FR-011**: Workspace configuration MUST define stable repository identities, presentation aliases, preferred remotes, preferred trunks, and agent defaults without duplicating live Git state.
- **FR-011A**: A repository acquired by `repo add` MUST be registered as managed workspace storage; its common repository MUST be bare and derived from `layout.repositories`.
- **FR-011B**: A repository acquired by `repo link` MUST be registered as externally managed using its canonical common-directory anchor, whether the input is a standard checkout, linked worktree, subdirectory, or bare repository.
- **FR-011C**: Repository acquisition policy MUST NOT be interpreted as authority over refs, branches, or worktree existence.
- **FR-011D**: A linked repository's preferred trunk MUST be advisory and MUST NOT prove or create a trunk worktree or local trunk ref. Tree creation MUST resolve the configured local branch first and then the configured preferred remote's tracking ref when present, recording the exact OID used. If neither ref resolves, default Tree creation MUST refuse before mutation with stable `missing-revision` reason/exit 5 and require `--from` or repository-advisory repair.
- **FR-011E**: Trunk mutation commands MUST accept managed repositories and refuse linked repositories before mutation; Tree creation MUST remain available for both modes and MUST honor Git's native occupied-branch refusal without force.
- **FR-012A**: Grove MUST refuse a repository target whose Git identity is ambiguous or duplicates another configured canonical common directory.
- **FR-012B**: Grove MUST keep advisory selectors bound to stable repository IDs so alias removal or reuse cannot rebind stale data.
- **FR-012C**: Grove MUST refuse expanded layout collisions, including case-fold collisions.
- **FR-012D**: Grove MUST refuse lexical or symlink path escapes both during preflight and immediately before mutation. A layout target whose lexical expanded path differs from its canonical symlink-expanded path MUST also refuse before mutation so results and later observation share one path identity. Filesystem ownership MUST use native filesystem identity, including case and Unicode normalization. Unresolvable protected paths MUST diagnose and refuse rather than crash observation. Every destructive endpoint MUST be proved before `beginOperation` and re-proved from fresh observation at point of use; a point-of-use refusal MUST be recorded as terminal and MUST NOT be replayable.
- **FR-012E**: Grove MUST refuse invalid naming/template expansions after native ref/name validation.
- **FR-013**: Changing layout or naming configuration MUST report the resulting diagnostics without moving worktrees implicitly.
- **FR-014A**: Grove MUST refuse `layout.repositories` changes while workspace repositories are registered.
- **FR-014B**: Grove MUST refuse Grove/archive-root changes while existing loose content would become undiscoverable.
- **FR-014C**: Config changes MUST NOT move a worktree or loose content.
- **FR-015**: Grove membership MUST be determined from a registered Git worktree's canonical location under the configured Tree layout, not from directory existence or advisory metadata alone.
- **FR-016**: Grove MUST retain advisory agent preferences, Tree ordering, archive recipes, and presentation state separately from live Git state, and MUST diagnose stale references without blocking Git. One archived Grove snapshot MUST be a versioned aggregate with an archive timestamp, archived loose-content path/layout evidence, and one ordered repository-ID/Tree-keyed recipe per selected Tree.
- **FR-017**: Advisory references MUST remain bound to stable repository identity and Tree identity rather than silently attaching to a later alias reuse.

#### Creation, mutation, and recovery

- **FR-018**: Grove-created bare repositories, branches, trunks, and Tree worktrees MUST remain usable through standard Git without Grove at runtime.
- **FR-018A**: `repo add` MUST create and verify one real initial trunk worktree under `layout.trunks`; it MUST NOT classify the repository store or a privileged primary checkout as that trunk.
- **FR-018B**: Every managed trunk, including the preferred/default trunk, MUST follow the same observed-worktree creation, discovery, synchronization, movement, and removal contract.
- **FR-018C**: `repo link` MUST create no ref, branch, trunk, or worktree.
- **FR-019**: Grove MUST preflight every selected creation target, path, branch source, and revision mapping before the first multi-target mutation.
- **FR-020**: Grove MUST support unambiguous use of existing local branches, preferred-remote branches, convention-derived new branches, and explicitly based new branches, while refusing ambiguous combinations.
- **FR-021**: Immediately before each native Git/worktree/filesystem structural mutation, Grove MUST revalidate every applicable repository identity, registration, path, HEAD, working-state, pending-operation target ownership, and command-specific precondition. Worktree operations MUST share both `worktree:<canonical-absolute-path>` and, when attached/planned, `repository:<stable-id>:branch:<validated-short-branch>` ownership keys across create, remove, restore, and reconcile; Grove-scoped operations additionally share `grove:<name>`. Immediately before a Grove-only config or advisory compare-and-swap mutation, Grove MUST instead revalidate the record revision, key, stable identity evidence, and command-specific preconditions; unregistering a missing repository remains possible but MUST refuse an ambiguous or rebound registration.
- **FR-022**: Grove MUST expose multi-repository structural actions as forward, resumable operations with a durable identity and per-step outcomes rather than claiming atomicity. Operation directories/records that retain sensitive inputs MUST use restrictive modes and never expose those values through ordinary output.
- **FR-023**: Recovery MUST persist and compare the itemized destructive-consent sets (a bounded, recursive per-path inventory of loose Grove content with each entry's type, and per-Tree tracked, untracked, and Git-ignored file status entries); newly appearing entries, including files inside previously ignored directories and files added inside a consented loose directory, MUST cause terminal `stale-plan` with both sets itemized before any removal, on the direct and the resumed path (`V3DES-09`, `V3DES-10`). An incomplete loose inventory MUST refuse rather than consent. Old records missing ignored entries MUST NOT acquire consent for them, and an old record that names a loose directory without a per-path inventory MUST NOT acquire consent for its descendants. Recovery MUST observe each pending step before continuing and MUST NOT blindly replay a mutation or automatically compensate for partial success. A destructive directory step MUST persist its layout role/selector, workspace-relative path, canonical absolute path, expected presence, and `lstat` device/inode when present. Immediately before replay Grove MUST recompile the current layout, prove the role/selector expands to the same canonical path inside the current workspace, and prove presence plus device/inode still match; workspace relocation, reoccupation, or stale absolute paths MUST refuse before recursive mutation.
- **FR-023A**: Destructive Tree/trunk/archive/delete commands MUST refuse and itemize every at-risk ignored file by default. `--allow-destructive-git-ignored` authorizes only ignored-file loss; `--allow-destructive-all` also authorizes tracked, ordinary untracked, and loose Grove content loss. The old public `--allow-destructive` flag MUST be rejected. These flags MUST NOT override structural ownership, recorded consent and new-content recovery checks, or the separate `--allow-unpushed` gate. An independently owned nested Git checkout (including a populated submodule or linked worktree) or bare repository MUST block removal and structural movement under either flag, even when outer Git status collapses it to one directory or omits its inner work entirely. Git administrative markers MUST be found through native filesystem lookup, including case and normalization aliases on the current volume; the observed outer worktree exemption MUST use its filesystem identity. Marked checkouts and bare-shaped metadata MUST be verified by native Git before being reported as proved independent ownership; unreadable or unverified Git-like metadata MUST refuse with an honest ambiguous diagnosis. The scan MUST NOT follow outward symlinks. Direct and resumed success receipts MUST list the files actually present at the final point-of-use check, and a partial or resumed run MUST also report each completed step's receipt (`V3DES-11`, `V3DES-12`).
- **FR-024**: Users MUST be able to explicitly abandon conflicted or stale normal operation records without Grove deleting surviving worktrees, refs, or other artifacts. An interrupted `repo add` whose unfinished step is durably classified `recoverable-intermediate` with reason `git-failed` MAY also be explicitly abandoned; running records and other recoverable operations remain ineligible. Abandonment MUST release its logical target locks and scrub its retained remote. A failed acquisition's unregistered bare anchor MAY be removed only when its recorded filesystem identity still matches and point-of-use inspection proves it has no surviving refs, objects, worktrees, or additional content. Familiar Git scaffold names and types, or the anchor directory's identity alone, do not prove that its contents are Grove-owned. Grove MUST establish a content-sensitive default-template genesis proof when it creates the anchor, compare it with a pristine Git initialization, and allow only its verified remote-configuration transition before recording the final cleanup proof. A snapshot first taken after that transition cannot establish ownership. Interrupted recovery of an already existing anchor without genesis MUST NOT create that proof. Every proof and the native Git emptiness checks MUST be rechecked immediately before removal. Missing or incomplete proof, an explicit user Git template, or any change to scaffold bytes or entries MUST retain the anchor. Proof records MUST NOT store raw Git config, hook, template, or credential bytes. Abandonment MUST report retained anchors and their surviving content, including nested additions, for explicit user disposition; a bounded or unreadable inventory MUST say it is incomplete. Replaced anchors MUST be refused without touching the replacement. A recoverable Git failure MUST name both the operation-specific resume and eligible explicit-abandon commands.
- **FR-025**: Grove operation locks MUST coordinate Grove operations only; documentation and results MUST not imply that Grove prevents simultaneous raw Git mutation of the same target.
- **FR-026**: When native Git changes a target concurrently, Grove MUST report stale or conflicted state rather than infer a repair or rollback.
- **FR-026A**: Capability preflight MUST complete before operation-plan persistence; a missing required capability MUST report the exact failed probe with exit 9 and leave no operation record.

#### Diagnostics, synchronization, lifecycle, and results

- **FR-027**: Grove MUST provide a read-only audit over the workspace or selected repository or Grove using stable, machine-readable diagnostic codes and identities.
- **FR-028A**: Every diagnostic MUST identify exactly one canonical subject.
- **FR-028B**: A diagnostic identity MUST include every code-specific observed and expected fact that changes its remedy while excluding presentation aliases, timestamps, and observation generations.
- **FR-028C**: Unchanged diagnostic facts MUST reproduce the same identity and distinct remedy-changing facts MUST not collide in the conformance fixtures.
- **FR-029**: Grove MUST offer an explicit dry-run and apply flow for safe, unambiguous worktree moves; every apply MUST rescan and refuse stale diagnostics.
- **FR-030**: Grove MUST offer explicit fetch-only, fast-forward-only, and rebase synchronization strategies, defaulting to a strategy that never resets divergent work.
- **FR-031A**: An integration strategy MUST preserve native sequencer state when user resolution is required; any integration-selected target with a sequencer extant before or created during the operation forces top-level `needs-user`, while higher failures affect exit precedence only.
- **FR-031B**: Every sync strategy MUST skip unreadable, detached, unborn, and locked targets with stable reasons.
- **FR-031C**: Fast-forward-only sync MUST report divergence and MUST NOT reset or rebase it.
- **FR-031D**: Sync MUST resolve a local-branch upstream directly without fetching a preferred remote.
- **FR-031E**: Fetch-only sync without an upstream MUST fetch the preferred remote or report a stable no-remote block, while integration strategies report no-upstream.
- **FR-031F**: Integration strategies MUST skip dirty or upstream-less targets and treat a pre-existing sequencer according to FR-031A; fetch-only MUST NOT be blocked solely by dirty or sequencer state and MUST perform no local integration.
- **FR-032A**: All multi-target commands MUST return exactly one deterministic target entry for every explicit or implicit selected target, independent of equivalent selector input order.
- **FR-032B**: Target `reason`/`detail` MUST represent skipped, conflicted, or failed classifications while the top-level outcome is exactly complete, partial, blocked, or needs-user. `partial` means at least one selected target is incomplete after any observable repository, ref, fetch, worktree, filesystem, or advisory side effect, including a single-target branch-only or checkout failure; `blocked` means no selected target caused such a side effect.
- **FR-033A**: Machine-readable results and pre-result failures MUST use the stable versioned shapes, reasons, diagnostics, and exit classifications defined by the proposal contracts, with credential-bearing URL components redacted. Recovery MUST preserve a stable safety-refusal reason such as `unreachable-detached` rather than collapse it into a generic Git failure.
- **FR-033B**: Human and machine output MUST expose the same meaningful facts and remedies without requiring identical bytes, structure, labels, ordering, or layout. Machine stdout MUST remain stable and structured; human output MUST be idiomatic for a terminal.
- **FR-033C**: Every registered command result and error MUST be rendered from one structured value. Command handlers MUST NOT provide a second human-only result and MUST NOT write command output around the shared emitter. The generic human result renderer MUST traverse the same complete value serialized by `--json`, so adding a machine result field automatically makes it visible without a command-specific edit.
- **FR-033D**: Help MUST be derived from the command registry as one structured help model and presented through an explicit help path. JSON help MUST remain structured and machine-usable. Human help MUST use conventional top-level, noun-family, and per-command sections; align names with descriptions; preserve readable notes and copyable examples; wrap prose sensibly; and MUST NOT expose arrays or objects as generic `-`, `Name:`, `Desc:`, `Path:`, or `Summary:` traversal blocks.
- **FR-034A**: Grove MUST remove a worktree only through a command whose documented purpose includes worktree removal.
- **FR-034B**: A destructive Grove command MUST refuse a detached target whose HEAD cannot be proven reachable from a durable ref.
- **FR-035**: Grove MUST never delete or reset a pre-existing ref or an allowed planned ref addition as cleanup during Tree/trunk removal, Grove archive/delete, repository unregister, failed creation, recovery, or abandonment; planned branch-only intermediate refs remain visible and explicitly accounted for.
- **FR-036**: Archive data MUST be treated as advisory restoration guidance; restore MUST bind every recipe through the currently registered stable repository ID, verify canonical common-directory identity, current refs/objects, target, final HEAD/branch, and cleanliness, and MUST refuse occupied, missing, dirty, or ambiguous targets rather than guessing. **Amended 2026-08-23 (ruling ②):** restore binds to the **commit recorded at archive time**, so a branch that advanced natively since the archive is NOT stale and MUST be restored to the archived OID and reported, not refused; `--latest` opts into the current tip; restore refuses only when the archived object itself is gone. `archive` MUST refuse a branch that is not pushed unless `--allow-unpushed` is passed, and MUST refuse an unborn HEAD. The former blanket refusal of "stale" targets is withdrawn — it made a moved branch unrestorable, which is the ordinary case this feature exists to serve.
- **FR-037**: Repository removal MUST unregister only and MUST NOT delete the repository checkout, common repository data, worktrees, refs, or advisory records.
- **FR-038**: Branch deletion MUST be outside Grove's v3 command surface and remain an explicit standard Git action.

#### Foreign-schema compatibility and retired migration identifiers

The migration identifiers below are retained only as stable historical citation keys. They are not current requirements, do not require implementation tasks or executable witnesses, and MUST NOT be used to justify a schema-1/schema-2 runtime loader. FR-046 is the live compatibility rule.

- **FR-039A**: Migration from supported schema-1 or schema-2 ownership layouts MUST run only through the explicit migration command and MUST NOT be an automatic normal-v3 fallback. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-039B**: Migration MUST provide a non-mutating dry-run plan before conversion. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-039C**: Actual migration MUST require the proposal's separate HEAD-reflog archival acknowledgment. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-039D**: An accepted migration MUST be resumable under the proposal's abort/resume boundaries. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-040A**: Migration MUST inventory the supported common repository state: common refs and reflogs, recognized common pseudorefs with exact bytes and referenced OIDs using each pseudoref's contract-specific byte grammar (including empty `FETCH_HEAD` and optional final LF for single-OID forms), repository config bytes, hook names, object-layout features, repository HEAD, and every recorded worktree's registration, HEAD, branch, status, ignored-file, submodule, sparse, sequencer, and private-administration evidence. An unrecognized or malformed pseudoref MUST block before mutation. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-040B**: Migration MUST preserve and verify the existing managed bare common repository, its common configuration, and its valid registered worktrees without converting them to an ordinary primary checkout. Unsupported worktree-local config/private refs and checkout-sensitive filter/include/path policy MUST block before publication rather than trigger guessed reconstruction. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-040C**: Migration MUST fingerprint the complete supported inventory, verify the current expected generation before every migration-owned mutation or publication boundary, and advance the expected baseline only after each verified migration-owned source mutation. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-041A**: Migration MUST block dirty, missing, unregistered, locked, corrupt, prunable, detached, active-sequencer, ignored-file, submodule, sparse, worktree-local-config, worktree-private-ref, unsupported object-layout, checkout-sensitive-policy, or concurrently changed source state. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-041B**: Migration MUST block missing required objects, malformed/unsupported pseudorefs, non-round-trippable common symbolic refs, or any repository-local behavior outside the supported conversion profile. Unattached non-UTF-8 common direct refs are supported only when mirror import and raw-generation verification preserve exact name/OID identity. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-042A**: Migration MUST create preservation refs for existing common-reflog-only and recognized-pseudoref objects before final bundle creation, include them in preserved object closure, and verify by materializing the bundle into an empty repository and proving every inventoried live/preserved OID exists. Detached or worktree-private inputs are outside the supported conversion profile and MUST block. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-042B**: A missing object named by a common-ref reflog MUST block migration. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-042C**: A missing per-worktree HEAD-reflog object MUST remain only in acknowledged archival evidence and MUST NOT be claimed as live installation. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-042D**: Migration MUST disclose the per-worktree HEAD-reflog archival limitation before authorization. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-042E**: Migration plans and artifacts MUST protect credential-bearing values with redaction and restrictive file modes. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-043**: Migration MUST remain resumable across every migration-owned mutation and publication boundary and MUST block normal Grove mutations while an incomplete migration requires continuation. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-044**: Migration MUST publish v3 only after every retained repository and worktree passes common-directory identity, supported ref/pseudoref/object/configuration, HEAD, checkout-population, and cleanliness verification. Any explicitly required reconstruction MUST use migration-owned hooks disabled; common hooks may be copied only after checkout verification. Unsupported checkout-required policy MUST block during dry-run. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-045**: Migration MUST retain old stores, backups, bundles, manifests, reflog evidence, and preservation refs after completion; Grove MUST never automatically perform their cleanup. **VOID — ruling ⑤ deleted the migration subsystem and constitution 5.0.0 forbids any runtime path that interprets schema-1/2 ownership state. This requirement mandates behaviour that cannot exist; it is retained, not renumbered, because IDs are stable citation keys.**
- **FR-046**: Normal v3 behavior MUST NOT interpret or recreate the v1 ownership model; managed bare topology alone MUST NOT be classified as legacy ownership state.

#### Surface and governance completeness

- **FR-047**: All commands in the approved current-command inventory MUST be explicitly changed, intentionally unchanged, delegated compatibly, or removed with a documented native replacement.
- **FR-048**: The new audit, sync, and explicit move-fix capabilities MUST have documented human and machine behavior.
- **FR-049A**: Authoritative product specifications MUST state that Git owns live state and Grove owns convention/orchestration only.
- **FR-049B**: Command help and completions MUST express the same ownership and command-disposition contract.
- **FR-049C**: README, onboarding, and examples MUST demonstrate standard Git interoperability and the managed-bare versus external-link capability boundary, and MUST NOT teach v1 claims or provenance as current behavior.
- **FR-050**: The project constitution MUST receive a major amendment that establishes the Git-native ownership boundary before technical planning is approved.
- **FR-051A**: Each proposal and inherited acceptance criterion MUST map to at least one feature requirement, owning phase, exact executable witness, and planned verification. Scenario-ID presence or aggregate test counts alone MUST NOT be treated as semantic parity proof.
- **FR-051B**: Every planned implementation task MUST map to at least one feature requirement and one traceability-ledger row.
- **FR-052**: Recovery MUST share doctor's complete read-only diagnostic audit, resume metadata-free Grove deletion, give operation-specific reconcile remedies for lifecycle retries and metadata failures, and revalidate resumed repository acquisition against current config using exact alias, identity, store, and trunk conflicts rather than a global revision equality check (`cli-surface-v3.md` §Removal and recovery; V3RCV-01–04).
- **FR-053**: A clean two-Tree `grove delete` MUST use at most 120 Git invocations while preserving all plan-time and point-of-use identity, protected-path, Tree-work, loose-content, and consent checks (`cli-surface-v3.md` §Delete observation efficiency; V3DPF-01–02).

### Key Entities

- **Workspace Configuration**: The workspace-local declaration of layout, naming conventions, repository identities and aliases, preferred remotes and trunks, and agent defaults.
- **Repository Registration**: A stable configured identity, presentation alias, and acquisition policy. Managed registrations derive a bare common-directory store from workspace layout and permit trunk management; linked registrations point at an external canonical common directory and do not. Neither copies live Git state.
- **Observed Repository**: The current repository identity, anchors, remotes, refs, and worktree registrations reported by Git for one invocation.
- **Native Path**: Raw path bytes from Git plus optional valid-UTF-8/canonical forms and deterministic escaped display; replacement text is never used for identity or mutation.
- **Observed Worktree**: One current Git worktree with its byte-preserving Native Path, actual branch or detached/unborn state, HEAD, upstream, lock/health state, and working state.
- **Grove**: A workspace grouping expressed by configured filesystem layout and optional advisory preferences across one or more repositories.
- **Tree Selector**: A stable advisory reference to a repository identity and Tree identity used for settings and presentation without asserting that a worktree exists.
- **Diagnostic**: A stable, actionable comparison between observed reality and configured convention, tied to one canonical subject and remedy-relevant facts.
- **Operation Record**: A durable account of a Grove structural action, its selected targets, preconditions, per-step observations, outcomes, and recovery state.
- **Archive Recipe**: Advisory restoration guidance based on verified state at archive time; it does not claim ownership over later Git state.
- **Foreign Schema Refusal**: A pre-result error that identifies the running Grove version, resolved executable path, encountered schema, and accepted schema without interpreting legacy ownership fields or mutating Git/filesystem state.
- **Command Result**: The exact versioned proposal result containing command, outcome, one entry for every selected target, stable reasons/details, diagnostics, and exit classification.
- **Help Document**: A registry-derived structured description of top-level, noun-family, or per-command usage, entries, notes, examples, and hints. JSON serializes this model directly; human mode presents its facts using terminal-oriented help conventions.

### Scope Boundaries

- Grove does not implement Git or act as a security boundary around Git.
- Grove does not make several repositories one atomic transaction.
- Grove does not infer a Grove from an ambiguous branch name or require every configured repository worktree to live inside the workspace.
- Grove does not automatically rename user-created branches or make archived observations authoritative over later native Git changes.
- Grove does not guarantee exclusion of simultaneous raw Git mutation of the exact target; it revalidates, relies on Git's native arbitration, and reports conflicts honestly.
- A custom cmux sidebar may consume the resulting observed and machine-readable model, but sidebar rendering is not part of this feature.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **003-git-native-grove-SC-001**: In all raw-Git interoperability scenarios, 100% of successful branch switches and worktree additions, moves, and removals are reflected by the next Grove invocation without a Grove repair step.
- **003-git-native-grove-SC-002**: In the complete acceptance suite, 0 operations classify Git-accepted state as corrupt solely because it differs from previous Grove metadata.
- **003-git-native-grove-SC-003**: Across all creation, lifecycle, failure, and recovery tests, 0 refs are deleted automatically by Grove.
- **003-git-native-grove-SC-004**: Every selected repository/target appears exactly once in deterministic multi-target results, including config-default, cwd-inferred, and compatibility selections; unrelated configured repositories are not emitted for explicitly narrowed commands.
- **003-git-native-grove-SC-005**: Repeating an audit over unchanged facts reproduces 100% of diagnostic identifiers, while the collision suite produces 0 collisions among distinct tested subjects and remedies.
- **003-git-native-grove-SC-006**: Every structural-operation interruption point can be classified on the next recovery attempt without blind replay, and every non-recoverable record can be explicitly closed without inferred cleanup.
- **003-git-native-grove-SC-007**: Fast-forward-only sync never resets or rebases a divergent target, and every target needing native user resolution is reported without destroying its sequencer state.
- **003-git-native-grove-SC-008**: Every destructive lifecycle scenario retains all refs and refuses 100% of tested unreachable detached targets before worktree removal.
- **003-git-native-grove-SC-009**: Migration dry-run mutates 0 source facts and reports every planned target, precondition failure, preservation action, and acknowledged limitation in the verification matrix. **VOID — ruling ⑤ deleted the migration subsystem; there is no migration to measure.** Retained, not renumbered, because IDs are stable citation keys.
- **003-git-native-grove-SC-010**: After every tested migration interruption, the workspace either remains safely abortable before schema-3 metadata publication or has exactly one documented resumable Grove continuation after publication begins; the accepted Git topology remains in place in either state. **VOID — ruling ⑤ deleted the migration subsystem; there is no migration to measure.** Retained, not renumbered, because IDs are stable citation keys.
- **003-git-native-grove-SC-011**: Before v3 publication, 100% of migrated worktrees pass repository identity, HEAD, attachment, upstream, cleanliness, and required repository-local behavior checks. **VOID — ruling ⑤ deleted the migration subsystem; there is no migration to measure.** Retained, not renumbered, because IDs are stable citation keys.
- **003-git-native-grove-SC-012**: After successful migration, 100% of old stores, accepted backups, bundles, manifests, reflog evidence, and preservation refs remain available for manual review or cleanup. **VOID — ruling ⑤ deleted the migration subsystem; there is no migration to measure.** Retained, not renumbered, because IDs are stable citation keys.
- **003-git-native-grove-SC-013**: All 40 current commands have one documented disposition and verification path, and all new commands have stable human and machine contracts.
- **003-git-native-grove-SC-014**: Requirement-to-plan and plan-to-task analysis reports 0 unmapped requirements, 0 unmapped tasks, and 0 unresolved constitution conflicts before implementation starts.
- **003-git-native-grove-SC-015**: The final corrective audit contains 0 unresolved P0, P1, or P2 bug/proof-gap findings and every proposal acceptance criterion has an executable verification.
- **003-git-native-grove-SC-016**: In 100% of repository-acquisition scenarios, `repo add` produces a bare common repository plus a real readable trunk-layout worktree (including exact `trunks/main@<repo>` evidence), `repo link` produces no trunk/ref/worktree mutation, linked remote-only preferred trunks remain usable as Tree bases without local trunk creation, and every trunk command refuses linked repositories before mutation.
- **003-git-native-grove-SC-017**: The complete registered command surface has zero independent human-result callbacks or direct command-handler output writes; object, collection, scalar, and error emitter tests prove that command results expose the same complete facts in human and `--json` modes, and the acquisition E2E proves `repo link` exposes repository, operation, remote, trunk, and path facts in both modes.
- **003-git-native-grove-SC-018**: Top-level, noun-family, and per-command human help each pass executable usability assertions for conventional sections, spacing, aligned names/descriptions, notes/examples, and zero generic object-dump leakage; corresponding JSON assertions prove the same meaningful help facts remain structured and machine-usable.
- **003-git-native-grove-SC-019**: A clean two-Tree deletion uses no more than 120 Git invocations, and all tested dirty-work and loose-content refusals retain their existing exit and safety behavior.

## Assumptions

- This specification, its contracts, and Decisions 001–003 are authoritative. `docs/git-native-grove-proposal.md` is historical technical input only (deleted; kept in the private development history, not in this repository).
- This feature is a breaking schema and architecture revision that supersedes the live-state ownership model in `specs/001-grove-cli`.
- The constitution governs this plan. Since 5.0.0 it establishes Git ownership, the managed-add versus external-link capability boundary, local macOS release verification, and foreign-schema refusal with no migration runtime.
- Existing schema-1 and schema-2 ownership workspaces may continue using their matching older version; schema-3 commands refuse them and do not offer migration.
- Users and agents may use standard Git at any time, but they avoid intentionally racing a destructive Grove command against a raw Git mutation of the exact same worktree.
- Release verification for this corrective phase is local on macOS. CI and additional-platform verification are out of scope; this phase adds no Linux-specific work or compatibility claim beyond the constitution's inherited runtime constraints.
- Git capabilities required for deterministic, byte-safe observation and safe worktree operations are checked before relevant mutation; unsupported environments receive an actionable refusal.
- Historical proposal material is consulted only to explain prior decisions; it cannot override this specification, its contracts, or the constitution.
