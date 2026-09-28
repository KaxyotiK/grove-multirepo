# Research: Git-native Grove

Architectural questions are settled by `docs/git-native-grove-proposal.md` (deleted; kept in the private development history, not in this repository), Decisions 001–003, and the corrective adversarial review. This file records those decisions; it does not reopen them.

## R1 - Authority boundary

**Decision**: Git exclusively owns live repository, ref, HEAD, upstream, worktree, lock, sequencer, and working-state truth. Grove observes it on every invocation.

**Rationale**: Standard Git and agent defaults remain valid; no duplicated state can drift.

**Alternatives considered**: Git wrappers, hooks, command interception, branch claims, authoritative manifest branches. Rejected because each conflicts with native Git.

## R2 - Grove membership and advisory state

**Decision**: Registered worktree location under compiled layout expresses active membership. Stable central metadata stores preferences and versioned aggregate archive snapshots, whose ordered recipes are keyed by repository identity and Tree identity only.

**Rationale**: Layout is observable while advisory state can survive moves/removal without asserting existence.

**Alternatives considered**: Tree arrays in Grove manifests; path-derived advisory identity; alias-only keys. Rejected because they can become a second source of truth or rebind after alias reuse.

## R3 - Git/ref byte boundary

**Decision**: Preserve raw ref and worktree-path bytes from Git observation through identity/hashing; derive separately escaped display values. Normalize branch identity to full `refs/heads/` bytes before branch-key creation. Native non-UTF-8 paths remain listable as `unsupported-native-path` but cannot enter UTF-8 layout matching or Grove mutation APIs.

**Rationale**: Git permits ref bytes that a lossy text conversion cannot represent reliably.

**Alternatives considered**: UTF-8 strings everywhere; lossy replacement; raw branch text in paths; canonicalizing paths after replacement decoding. Rejected for collision and wrong-target risk.

## R4 - Layout and naming

**Decision**: One validated compiler expands whole-segment layout tokens and validated naming tokens. Managed trunks use the inherited readable `<branch-slug>@<repo-slug>` allocation, with a deterministic byte-derived suffix only when truncation or an observed case-fold collision requires it. Git's worktree registration remains the live path authority; v3 stores no trunk array.

**Rationale**: One authority prevents divergent path logic, traversal, option confusion, and case-fold collisions.

**Alternatives considered**: Per-command joins, raw unescaped branch tokens, opaque full-hash paths for every trunk, and persisted allocation arrays. Rejected as ambiguous, a user-facing regression, or a competing live-state model.

## R5 - Structural failure and concurrency

**Decision**: Multi-repository structural operations use durable forward plans, point-of-use revalidation, and observation-based resume. Grove locks coordinate Grove only; Git arbitrates native mutation. No automatic compensation.

**Rationale**: Cross-repository atomicity is impossible, and blocking standard Git would violate the goal.

**Alternatives considered**: Rollback transactions, branch deletion on failure, assuming Grove locks exclude Git. Rejected as unsafe or false.

Repository registration follows native trunk and remote evidence. `repo add` fixes and records clone remote `origin`, then uses an explicit existing remote branch or the remote symbolic HEAD, except that an empty remote requires an explicit unborn trunk. `repo link` creates nothing, records `origin`, otherwise the sole remote, otherwise no preferred remote, and selects explicit trunk preference, attached/unborn input HEAD, common HEAD, then only the preferred remote HEAD; ambiguous detached inputs refuse rather than choosing among remotes.

## R6 - Sync

**Decision**: Sync is explicit with fetch-only, fast-forward-only, and rebase strategies. Sync crash records are closed as interrupted observations; a new run fetches and observes afresh. Native sequencers remain user-owned; for integration strategies, a selected target with a pre-existing or newly created sequencer forces top-level `needs-user` while higher failures affect exit precedence only. Fetch-only performs no local integration and is not blocked solely by dirty or sequencer state.

**Rationale**: Remote refs and rebases cannot be attributed or replayed safely after a crash.

**Alternatives considered**: Treat sync as resumable structural WAL; reset divergence; auto-abort rebase. Rejected because postconditions are unknowable or destructive.

## R7 - Diagnostics and results

**Decision**: Stable diagnostic IDs hash a versioned canonical subject plus all remedy-relevant observed/expected facts. Multi-target commands emit a versioned result containing every selected target and classified exit behavior.

**Rationale**: Safe fix-by-ID needs stable, non-colliding identity and rescan; automation needs complete partial outcomes.

**Alternatives considered**: Presentation-text IDs, fixed nullable tuples, fail-fast errors that omit later targets. Rejected as unstable or incomplete.

## R8 - Lifecycle safety

**Decision**: Grove removes only explicitly selected worktrees and advisory/loose workspace content. It never deletes refs or recursively removes after Git refusal; unreachable detached work blocks destructive actions.

**Rationale**: Grove cannot infer branch ownership, and detached commits may be the only copy of work.

**Alternatives considered**: Provenance-based cleanup, forced raw deletion, branch rollback. Rejected for data-loss risk.

## R9 - Foreign-schema refusal

**Decision**: Schema-3 Grove never interprets schema-1 or schema-2 ownership state. It refuses a foreign workspace or Grove manifest before mutation and identifies the running Grove version, resolved executable path, encountered schema, and accepted schema. A bare common repository and attached worktrees remain valid Git topology; when no foreign ownership state is loaded, they may be registered through the schema-3 acquisition boundary without being recreated under an ordinary clone.

**Rationale**: A migration loader necessarily keeps the deleted ownership model alive in the v3 runtime. Refusal is the only unambiguous no-legacy boundary, while recognizing native Git topology independently avoids confusing a bare repository with legacy ownership state.

**Alternatives considered**: Explicit or automatic migration, shape inference, ordinary-clone reparenting, and N-1 ownership compatibility. Rejected as contrary to constitution 5.0.0 or as destructive guesses.

## R9A - Output parity by construction

**Decision**: Registered command handlers emit one structured success/error value. Compact JSON and readable human output are serializations of that same complete value; handlers cannot provide a second human callback or write command output directly. Strings are emitted raw in human mode so a generated completion script remains executable.

**Rationale**: A separately maintained human projection can always omit a field added to the machine result. Traversing the one canonical value makes omission impossible at the command call site and lets a registry-wide source audit protect the entire surface, including future commands.

**Alternatives considered**: Expand the existing seven-command assertion list; require reviewers to remember parity for every new field; retain command-specific renderers with runtime spot checks. Rejected because each preserves the duplication mechanism that produced the `repo link` defect.

## R9B - Registry-derived help with format-specific presentation

**Decision**: Keep one typed help document derived from the command registry. JSON serializes that document directly. Human mode routes the same document through one dedicated terminal help renderer with conventional sections, aligned names/descriptions, prose wrapping, and verbatim examples. Command results and errors continue through the complete generic renderer from R9A.

**Rationale**: Help is presentation content rather than a command-result envelope. A generic object walk preserves fields but exposes implementation structure (`-`, `Name:`, `Desc:`) and makes the primary discovery interface difficult to scan. A single centralized help renderer preserves semantic parity without reintroducing handler-local projections or field duplication.

**Alternatives considered**: Keep generic traversal for every structured value; restore arbitrary per-command callbacks; store separate human help strings beside JSON metadata. Rejected because the first is unusable and the latter two recreate drift. The chosen boundary specializes only the presentation of the shared registry-derived help document.

## R10 - Delivery strategy

**Decision**: Land independently green implementation phases, using transition-only compatibility boundaries until schema-3 behavior is proven, then remove all ownership and migration machinery. Corrective phases close only independently reproduced in-scope gaps without reopening feature scope.

**Rationale**: The change is too broad for one cutover and must remain bisectable and testable.

**Alternatives considered**: Big-bang rewrite; permanent dual-mode runtime. Rejected for review risk or long-term source-of-truth conflict.

## R11 - Repository acquisition topology and trunk capability

**Decision**: `repo add` creates a managed bare common repository and a real initial trunk worktree under `layout.trunks`; all managed trunks are peer linked worktrees. `repo link` records an external canonical common directory, creates no trunk, and treats its preferred trunk as an advisory base only. Trunk mutations are allowed for add-managed repositories and refused for linked repositories; Tree creation remains available to both. The complete decision and scenario matrix are recorded in `decisions/001-repository-acquisition-topology.md`.

**Rationale**: A bare anchor keeps repository storage independent from every removable checkout and makes all managed trunks structurally uniform. Creating a trunk for a linked standard repository would occupy that branch and prevent the user's external checkout from switching to it.

**Alternatives considered**: Ordinary clone as a privileged primary trunk, detached administrative checkout, primary checkout inside the trunk layout, and implicit trunk management for linked repositories. Rejected because each couples storage to a checkout, creates asymmetric lifecycle rules, or interferes with externally managed branch switching.

## R12 - Schema allocation from the verified v2 baseline

**Decision**: Publish the ownership-free runtime as schema version 3. Runtime accepts exactly schema 3 and self-identifies when refusing schemas 1, 2, or another foreign value.

**Rationale**: The baseline already assigns version 2 to an incompatible shape containing live trunk and Tree arrays. Reusing 2 would require ambiguous shape detection or silently misparse a real workspace.

**Alternatives considered**: Reuse schema 2 because the superseded v3 branch called the old model v1; infer the model from keys. Rejected because both contradict the actual baseline and the refusal-to-guess principle.

## R13 - Corrective evidence and replay boundary

**Decision**: A ninth corrective phase addresses only independently reproduced regressions in the implemented redesign. It uses red witnesses before each fix, exact prior-release behavior mappings, point-of-use target ownership/containment/cleanliness checks, self-identifying schema refusal, and an adversarial loop that closes only with no unresolved P0/P1/P2 bug or proof gap.

**Rationale**: The prior ID-count traceability gate allowed `TRUNK-01` to pass after its expected behavior was changed. Release evidence must bind the inherited outcome to a named assertion rather than infer semantic parity from an ID or aggregate count.

**Alternatives considered**: accept the green aggregate suite, reuse the superseded Phase 9 plan, or broaden the redesign while correcting it. Rejected because each either preserves the proof gap or exceeds the authorized scope.

## Clarifications

No unresolved research questions remain. Product decisions come from the approved proposal; implementation details not fixed there must preserve the constitution and contract artifacts.
