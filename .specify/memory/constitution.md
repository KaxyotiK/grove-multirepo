<!--
SYNC IMPACT REPORT
==================
Version change: 6.0.0 -> 6.0.1
Bump rationale: PATCH - correct the stale supported-platform sentence to match the macOS-only policy already adopted in 4.0.0 and retained in Development Workflow & Quality Gates. No principle, support commitment, or verification obligation changes.
Lineage: follows 6.0.0, present in public baseline commit 3e84630, and continues the historical VERSION LINEAGE and subsequent amendment reports below. This amendment is 6.0.1; historical version numbers and reports are unchanged.
Modified principles: none.
Modified section: Technology & Artifact Constraints, supported platforms.
Added sections: none.
Removed sections: none.
Migration impact: none; no runtime or workspace-schema change.
Affected documentation: README.md, CONTRIBUTING.md, AGENTS.md, and package.json already specify macOS only and require no platform-policy changes.
Templates / references requiring follow-up: none; dependent templates read the constitution at runtime.
Deferred items: none.

Superseded sync impact report follows.
SYNC IMPACT REPORT
==================
Version change: 5.0.1 -> 6.0.0
Bump rationale: MAJOR - Principle IV replaces the public destructive-consent flag with two
permission levels and removes the old spelling. This is a backward-incompatible rule change.
Rationale: ignored files have the same single-copy loss risk as other uncommitted work. A separate
ignored-only permission lets the user authorize precisely that class without authorizing tracked,
ordinary untracked, or loose Grove content.
Modified principle: IV, Forward, Ref-Safe Operations.
Migration impact: no public alias for --allow-destructive. Existing pending operation records
remain recoverable only against their exact recorded itemized sets; missing ignored entries do not
gain consent on replay. --allow-unpushed and structural/identity checks remain separate.
Affected specification: specs/003-git-native-grove/spec.md, plan.md, tasks.md, and contracts/.
Templates requiring follow-up: none. Historical review and remediation records are preserved.

Superseded sync impact report follows.
SYNC IMPACT REPORT
==================
Version change: 5.0.0 -> 5.0.1
Bump rationale: PATCH - the Development Workflow reference to the deleted proposal gains a
`git show` pointer, matching specs/003-git-native-grove/spec.md; no principle, rule, or obligation
changes.

Lineage: continues the VERSION LINEAGE table in the 5.0.0 report below
(its last row, 5.0.0, is 20ee90c); this amendment is 5.0.1.

Modified principles: none.
Added sections: none.
Removed sections: none.

Migration impact: none; a documentation pointer only.
Affected specifications: none changed by the amendment; the pointer matches
specs/003-git-native-grove/spec.md:9 and :343, and spec.md:345 is updated to stop
naming a specific governing version.

Templates / references requiring follow-up: none.

Superseded sync impact report follows.
Version change: 4.0.0 -> 5.0.0
Bump rationale: MAJOR - removes rules. Governance defines MAJOR as "backward-incompatible removal
or redefinition of a principle or rule", and this amendment deletes the Principle VI migration
clauses outright: the versioned schema-1/schema-2 loader exemption, the migration preview /
authorization / resumability / preservation requirements, and the migration-evidence and
migration-retention clauses in Principles III and IV. A MINOR bump would falsify the amendment
record, which is the same defect this review recorded as G-4.

What replaces them: there is no migration path. Schema-1 and schema-2 ownership state MUST NOT be
interpreted by any runtime code path, and a foreign-schema workspace or manifest MUST be refused
with an error naming the running version, the resolved executable path, and both schema versions.
Rationale: a migration subsystem has to understand the old ownership model in order to convert it,
so it keeps that model alive inside the runtime that Principle VI exists to keep clean.

Accepted consequence, recorded once: the three schema-1/2 test workspaces kept outside the repository (local test fixtures, one named `v1-backup`) become permanently unreadable. Confirmed disposable (remediation plan R6).

Also in this amendment: the dangling requirement to reconcile docs/future-state.md is dropped (the
file moved to .archive/); command dispositions become unchanged/changed/delegated/removed; and the
acceptance matrix requires a self-identifying schema refusal in place of the migration verification
matrix.

Modified principles:
  - III. One-Shot Command Execution -> drop migration evidence from workspace-local state
  - IV. Forward Recovery, Never Destructive Rollback -> drop the migration source-retention clause
  - VI. No Legacy Creep -> migration is removed, not isolated; refusal must self-identify

Also in 5.0.0 (Phase 3, rulings become normative): Principle IV gains the work-safety rules ruling
④ found missing entirely -- `grep -c force` on this document returned 0, so the flag that lets a
user destroy their work had no constitutional basis at all. `--allow-destructive` and
`--allow-unpushed` are now named as separate axes, and itemization is required on both the refusal
and the forced run.

VERSION LINEAGE (ledger G-4, recorded 2026-08-23)
------------------------------------------------
The amendment record was previously unreadable against `git log`, because this branch's version
numbers COLLIDE with `main`'s. Both branches forked from `da0b157` (2026-08-15, constitution 1.0.0)
and both independently issued a "2.0.0". Verified from history, not asserted:

  branch 003-git-native-grove-v2-redesign        main
  --------------------------------------        ----
  62b1949  1.0.0  (shared ancestor)              62b1949  1.0.0  (shared ancestor)
  926ea6a  2.0.0  derive --force from what       9da99e1  2.0.0  establish Git-native architecture
                  a command destroys             1954887  2.0.1  compatibility-boundary wording
  07a7709  3.0.0  corrected git-native authority          2.0.2  migration ref-safety wording
  5a094cf  3.0.1  release blockers
  e2978e3  4.0.0  local macOS verification; CI out of scope
  20ee90c  5.0.0  migration removed

`926ea6a` is NOT an ancestor of `main`, and `main`'s constitution commits are not ancestors of this
branch. The two 2.0.0 amendments are different amendments carrying the same number. The resulting
principle SET is identical on both sides -- the same six principles, I..VI, with the same titles --
so the divergence is numbering and rationale, not architecture.

`main`'s 2.0.1 and 2.0.2 were never incorporated here and are now moot: 2.0.2 amended Principle IV
to permit an obsolete worktree administration namespace to be retired during migration, and version
5.0.0 removes migration entirely.

Consequence to accept knowingly: merging this branch to `main` moves the constitution 2.0.2 -> 5.0.0
in one step, and `main`'s 2.0.1/2.0.2 rationale is superseded rather than merged. Do not attempt to
reconcile the numbers retroactively -- amendment records are historical and MUST NOT be rewritten.

Superseded sync impact report follows.
Version change: 3.0.1 -> 4.0.0
Bump rationale: MAJOR - removes a rule. The CI mandate ("CI MUST run the full suite and
source/dependency exclusion checks on macOS and Linux") is replaced by local verification on macOS.
Continuous integration and non-macOS platforms are out of scope until stated otherwise. The
verification content is unchanged - full suite, exclusion scan, both traceability legs, bundled
build, and isolated global install - only its execution venue moves from CI to the developer's
machine. Accepted consequence: the case-fold guards are not exercised on a case-sensitive
filesystem, and the offline (no-network) work-safety check has no automated enforcement.

Superseded sync impact report follows.
Version change: 3.0.0 -> 3.0.1
Bump rationale: PATCH - remove the obsolete migration exception for retiring a source worktree
administration directory. Decision 001 now requires supported managed bare repositories and valid
attached worktrees to remain the destination topology in place. The preceding MAJOR amendment
reversed the incompatible rule that classified managed bare repository
storage as legacy ownership state. Git-native Grove forbids branch claims and duplicated live
state, not bare common repositories. `repo add` now owns a managed bare storage convention and
creates real peer trunk worktrees; `repo link` remains externally managed and receives no trunk
mutation capability. This changes the approved repository topology and migration destination.
Decision 002 additionally allocates schema version 3 because the verified baseline already ships
an incompatible schema version 2; explicit migration recognizes supported ownership schemas 1
and 2 without changing the ownership principles.

Modified principles:
  - II. Grove Owns Convention and Orchestration -> distinguish managed-add and external-link
    repository policy
  - VI. No Legacy Creep -> separate valid managed bare topology from obsolete v1 ownership state

Added sections: none.
Removed sections: none.

Templates / references requiring follow-up:
  - docs/future-state.md and the 003 proposal require the repository-topology correction recorded
    in specs/003-git-native-grove/decisions/001-repository-acquisition-topology.md.
  - specs/001-grove-cli remains historical v1 specification; specs/003-git-native-grove
    supersedes its live-state ownership model.
  - Downstream Spec Kit templates read this constitution at runtime; no template edits required.

Deferred TODOs: none.
-->

# Grove CLI Constitution

Grove is a single-command, workspace-local CLI for organizing multi-repository units of work ("Groves") around native Git repositories and worktrees. Git owns repository truth. Grove owns workspace convention, advisory organization, diagnostics, and explicit orchestration. This constitution states the non-negotiable principles every feature, change, and review MUST uphold.

## Core Principles

### I. Git Owns Live State (NON-NEGOTIABLE)

Git is the exclusive authority for repositories, common directories, refs, branches, HEAD, upstreams, worktree registrations, locks, working state, sequencers, and ahead/behind state.

- Grove MUST observe those facts from Git and MUST NOT store a competing authoritative copy.
- Standard Git commands MUST work without a Grove wrapper, shim, interception layer, hook, or metadata repair step.
- When a standard Git command succeeds, Grove MUST accept its result as current reality on the next invocation. A convention mismatch is a diagnostic, not corruption.
- Grove MUST NOT maintain branch claims, provenance-based ownership, authoritative Tree branch records, or other state that can disagree with Git.
- Grove MUST NOT reject, reverse, or rewrite valid Git state merely because it was created or changed outside Grove.

Rationale: Agents and users already rely on standard Git. A second representation of Git state creates conflict, makes successful native commands appear unsafe, and turns Grove into a competing version-control layer.

### II. Grove Owns Convention and Orchestration

Grove owns the declarative workspace surrounding Git, not Git itself.

- Workspace config MUST be the authority for validated repository, trunk, Grove, Tree, and archive layout; naming conventions; stable repository registrations; preferred remotes and trunks; and agent defaults.
- Registered Git worktrees matched to configured filesystem layout express active Grove and Tree membership. A directory alone MUST NOT prove that a Tree exists.
- Advisory metadata MAY own Grove and Tree preferences, ordering, archive recipes, and UI state. It MUST NOT prove that a worktree, ref, branch, or repository still exists.
- Stale advisory references MUST produce diagnostics and MUST NOT block Git or silently attach to a different repository after alias reuse.
- Grove MAY create managed bare common repositories, refs, and worktrees with native Git operations; observe and compare them with convention; and coordinate explicit multi-repository actions. Managed bare storage MUST NOT be treated as ownership of refs or worktree existence.
- Repository acquisition policy is Grove-owned convention: repositories created by `repo add` MAY receive managed trunk worktrees, while repositories registered by `repo link` remain externally managed and MUST NOT receive trunk mutations without a separately approved explicit opt-in.
- Grove MUST NOT automatically rename user-created branches, infer ambiguous intent, or require every worktree of a configured repository to live inside the workspace.

Rationale: This boundary preserves Grove's value as a multi-repository workspace organizer while keeping each underlying repository understandable and usable as normal Git.

### III. One Command, Workspace-Local State

Grove is exactly one foreground program exposed as one command, `grove`, and all Grove-owned state belongs to the workspace in which it is used.

- There is no IDE, daemon, server, socket, RPC layer, background service, event bus, supervisor, detached process, or global workspace registry.
- Every invocation MUST resolve one workspace, read current config and Git state, perform the requested action, durably write only required workspace records, and exit. No process, listener, or lock survives a successful command.
- Agent runs MUST remain foreground child processes that inherit the terminal. Grove MUST NOT detach, supervise, resume, remotely control, or record agent sessions.
- Grove-owned config, advisory metadata, locks, and operation records MUST live beneath the resolved workspace. Grove MUST NOT use hidden global Grove state or remembered workspace selection.
- Workspace selection MUST be explicit or discovered from the nearest valid workspace marker. An invalid nearest marker MUST be reported rather than skipped in favor of an ancestor.
- Independent workspaces MUST NOT read or mutate one another's Grove-owned state.

Rationale: A foreground, workspace-local tool is inspectable and composable. Hidden global state or background machinery would make both Git interoperability and failure recovery harder to trust.

### IV. Forward, Ref-Safe Operations

Grove safety is based on point-of-use validation, Git's native arbitration, durable forward plans, and explicit user control. Grove MUST NOT pretend that several repositories form one atomic Git transaction.

- Immediately before each native Git or worktree/filesystem structural mutation, Grove MUST revalidate every applicable target identity, registration, path, HEAD, working-state, and operation-specific precondition. Grove-only config/advisory CAS mutations instead revalidate their exact record revision, key, and command-specific preconditions; they MUST NOT invent a Git availability requirement. Unregister-only operations MUST remain possible when the registered repository is missing, while refusing an ambiguous or newly rebound registration.
- Grove locks MUST serialize Grove operations only. They MUST NOT claim to prevent simultaneous standard Git changes. A native change at the same target produces a stale or conflicted result, never inferred repair.
- Multi-step structural actions MUST record a durable, uniquely identified forward plan before the first mutation and MUST record observable preconditions and outcomes for each step.
- Recovery MUST observe whether a step did not run, ran, reached a recognized intermediate state, or conflicted. It MUST NOT replay blindly and MUST NOT perform automatic compensation.
- Abandoning a conflicted normal operation MUST leave successful worktrees, refs, and other artifacts visible for explicit lifecycle action.
- Grove MUST NEVER request deletion of a ref during rollback, recovery, Tree or trunk removal, Grove archive or deletion, repository unregister, failed creation, or inferred cleanup. Branch deletion remains an explicit native Git action.
- Destructive worktree actions MUST be explicitly requested, MUST honor dirty and detached-work safety, and MUST NOT fall back to raw recursive deletion after Git refuses removal.
- **Losing work MUST require a flag that says so, and the two ways to lose it are separate axes** (ruling ④). `--allow-destructive-all` authorizes destroying content that exists in only one place: tracked edits, ordinary untracked files, Git-ignored files, and loose Grove content that was never in Git. `--allow-destructive-git-ignored` authorizes only Git-ignored file loss. Ignored directories MUST be inventoried as individual files so later additions do not inherit consent. The former public `--allow-destructive` flag MUST be rejected without an alias. `--allow-unpushed` authorizes proceeding with work that is committed but exists only locally. A command MUST NOT conflate them, and MUST NOT accept a single `--force` that means both.
- **A destructive operation MUST itemize what is at stake — on the refusal AND on the forced run.** Naming the count is not enough; the user has to be able to see what they are about to lose, and afterwards what they did lose. A silent forced run is the failure this rule exists to prevent.
- Machine results MUST report every selected target, honest partial success, and states requiring native user resolution.

Rationale: Native Git and multi-repository operations can race, fail, or be interrupted. Forward, observable recovery preserves work without inventing rollback ownership or deleting refs.

### V. Observe, Diagnose, Never Guess

Grove distinguishes observed Git reality, configured convention, and advisory metadata. When a safe target or intent is ambiguous, malformed, stale, or unsupported, Grove MUST stop and explain.

- Config, paths, naming templates, selectors, revision inputs, and repository identities MUST be validated before use. Invalid or unsupported schema MUST NOT silently fall back to defaults.
- Read commands MUST represent detached, unborn, external, misplaced, locked, missing, corrupt, prunable, and stale-metadata states explicitly.
- Convention and health findings MUST use stable machine-readable codes and identities tied to canonical subjects and remedy-relevant facts.
- An explicit fix MUST rescan current facts immediately before mutation. A stale or ambiguous diagnostic MUST refuse without side effects.
- Errors and non-complete results MUST state what happened, why, which targets were affected, and the next action in both human and machine-readable modes.
- Grove MUST probe required Git capabilities before relevant mutation and MUST refuse unsupported behavior with an actionable result.

Rationale: Native interoperability deliberately permits state outside Grove convention. Truthful observation and precise diagnostics keep that freedom understandable without guessing user intent.

### VI. No Legacy Creep

The prior `grove-ide` architecture and pre-v3 live-state ownership models are historical reference only. They MUST NOT remain in the normal Git-native runtime, and no code path may read them.

- Code from excluded desktop, RPC, daemon, session, event, projection, or server architecture MUST NOT enter the CLI runtime.
- Dependencies MUST NOT add Electron, React, Vite, xterm, WebSocket/RPC, server, or IPC packages. Grove remains one package with one command and one shipped artifact.
- Legacy vocabulary such as `trail` and `canopy` MUST NOT enter code, tests, help, or machine output except in explicitly pinned historical references.
- Pre-v3 authoritative trunk/Tree entries, branch claims, provenance, raw-removal fallback, and ref-deleting rollback MUST be isolated from normal v3 behavior and removed at the final acceptance gate once v3 behavior is proven. A managed bare common repository is valid native Git topology and MUST NOT be rejected merely because an ownership schema also used one.
- During the unreleased phased transition only, not-yet-converted baseline v2 commands MAY depend on an explicitly whitelisted `src/compat/v2/` boundary. Normal v3 modules MUST NOT import it, it MUST receive no new behavior, and it MUST be deleted as part of the final v3 acceptance/release gate.
- There is no migration path. Schema-1 and schema-2 ownership state MUST NOT be interpreted by any runtime code path. A workspace or Grove manifest written by another schema MUST be refused, and the refusal MUST name the running Grove version, the resolved path of the executable that refused, and both schema versions, so a machine carrying several builds can identify which one refused.
- Automated source and dependency exclusion checks MUST gate every change and permit legacy terms only in documented historical-reference boundaries.

Rationale: A breaking rewrite succeeds only if old ownership machinery cannot quietly return under new names. A migration subsystem is exactly that machinery: it must understand the old model in order to convert it, so it keeps the old model alive inside the new runtime. Refusing foreign schemas outright is the only version of this rule that stays true over time, and it is honest -- the user is told what happened and by which binary, rather than being handed a resume command for a partial conversion.

## Technology & Artifact Constraints

The existing lightweight command-line toolchain remains fixed unless this constitution is amended:

- Language: strict TypeScript using ESM. Runtime: Node 24 or newer. Supported platform: macOS only.
- Package manager: npm with a committed lockfile. CLI parsing uses the Node standard library with direct subcommand dispatch; process and hashing behavior use Node standard-library facilities. Tests use Node's built-in test and assertion facilities. Bundling is development/build only.
- The single shipped artifact is `dist/grove.mjs` with a Node shebang. It MUST run without Bun, TypeScript, `node_modules`, Electron, a display server, a source checkout, or experimental flags. The package MUST contain only the built CLI, package metadata, README, and license.
- The command surface has two layers: bare verbs act on Groves or the workspace; noun families manage supporting resources. Flags are kebab-case. Machine-readable mode writes only its versioned value to stdout, except a foreground agent run owns the inherited terminal.
- Git capability requirements MUST be declared and checked. Unsupported capabilities MUST fail before mutation rather than relying on lossy or ambiguous fallbacks.

## Development Workflow & Quality Gates

- `specs/003-git-native-grove/spec.md` defines user-visible outcomes for the Git-native revision, and `docs/git-native-grove-proposal.md` (deleted; kept in the private development history, not in this repository) is historical technical input, not a normative source: nothing outside `specs/` is normative (ledger G-13). The contracts under `specs/003-git-native-grove/contracts/`, README, help, and examples MUST be brought into agreement before v3 completion. (`docs/future-state.md` moved to `.archive/` and is no longer a reconciliation target.)
- Changes MUST be tests-first: contract and acceptance scenarios are written and observed failing before implementation, then implemented to green. Every phase MUST leave the repository buildable and its relevant tests passing.
- Every feature requirement MUST trace to a plan phase and verification; every implementation task MUST trace back to a requirement. All current commands MUST have an explicit unchanged, changed, delegated, or removed disposition.
- Acceptance MUST include raw Git interoperability, ref retention, byte-safe observation, layout validation, diagnostic stability, interrupted-operation recovery, mixed-target machine results, and a refusal of every unsupported ownership schema that identifies the binary that refused.
- Verification is local on macOS: every change MUST pass the full suite, the source/dependency exclusion scan, both scenario-traceability legs, a bundled-CLI build, and a clean global install under an isolated package prefix, on the developer's machine before the change is accepted. Continuous integration and additional platforms are out of scope until stated otherwise.
- Implementation MUST NOT begin while constitution conflicts, unmapped requirements, unmapped tasks, or P0/P1 specification-analysis findings remain.
- Reviews MUST verify all Core Principles. Complexity that weakens native Git interoperability, introduces hidden state, or guesses intent is rejected or requires a prior constitution amendment.

## Governance

This constitution supersedes other practices and conventions for this repository. A conflicting proposal, specification, plan, task, implementation, or review finding MUST be changed unless this constitution is amended first.

- Amendments MUST be documented with rationale, migration impact, affected specifications, and an updated governance version. Authoritative product documentation MUST be updated in the same body of work.
- Governance versioning follows semantic versioning: MAJOR for backward-incompatible removal or redefinition of a principle or rule; MINOR for a new principle or materially expanded guidance; PATCH for non-semantic clarification or correction.
- Every pull request and review MUST record constitution compliance. A change that cannot satisfy the Core Principles and quality gates is rejected or deferred, never merged with an exception.
- Runtime command and behavior details belong in authoritative specifications and contracts; this constitution governs the invariants those documents MUST honor.

**Version**: 6.0.1 | **Ratified**: 2026-08-15 | **Last Amended**: 2026-09-28
