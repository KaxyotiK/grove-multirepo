# Implementation Plan: Git-native Grove

## Receipts for partial destruction (assessment-18 §8c)

**Authority:** constitution 6.0.0 Principle IV ruling ④; FR-023A; JSON results and CLI surface contracts; V3DES-11, V3DES-12. **Observed baseline:** at merge `bc1f480`, a forced `archive` or `delete` that fails after an earlier Tree removal returns only the failing target, and the completed step records `{registered: false, refsRetained: true}`. `reconcile` reports only steps it completed itself.

1. Add witnesses for direct and resumed `delete` and `archive` where a later step fails after an earlier step destroyed consented Tree content and, for `delete`, loose content. Proof: `node --test tests/cli/partial-receipt-v3.test.ts` red on the merge; the red run log was kept outside the repository.
2. Record each completed removal's point-of-use receipt in its `postState`, list completed targets beside the failing one in partial results, turn metadata-step failures after destruction into partial results, and report every completed destructive step on resume. Dependency: 1. Proof: the same file green.
3. Full local gate, isolated packed install, and the s8 control against the installed binary. Dependency: 2. Proof: `reviews/partial-receipt-ledger.md`.
4. Review round 3 (F1, F3, F4, F12, F2, F10): witnesses first (V3DES-13 recovery after a metadata-step failure, Tree-path re-population, vanished-file exclusion, named resumed Trees), red in `tests/cli/partial-receipt-v3.test.ts` (V3DES-13 cases; the red run log was kept outside the repository); then keep the metadata step resumable with a true remedy, classify filesystem failures as `io-failed`, and state the partial Git removal gap in the contracts. Dependency: 3. Proof: the same file green and the full gate.
5. Review round 4 (N1-N5), on release head `9958673`: witnesses first (early reconcile of a failed metadata step, pending-archive refusal text, state-based doctor remedy, delete remedy command), red in `tests/cli/partial-receipt-v3.test.ts` (V3DES-13 and V3OPS-08 cases; the red run log was kept outside the repository); then classify resume-time filesystem failures of metadata steps as recoverable `io-failed` with why and remedy, check this Grove's pending operation before the archive path, and share one state-based pending-operation remedy. Dependency: 4. Proof: the same witnesses green and the full gate.

## Per-path loose-content consent (release item 13)

**Authority:** constitution 6.0.0 Principle IV; FR-023, FR-023A; CLI surface contract; V3DES-09, V3DES-10. **Observed baseline:** at `f143968`, `delete --allow-destructive-all` records loose consent as top-level names from `unaccountedEntries`, and the direct and resumed removals compare names only before a recursive removal. A file added inside a consented loose directory is deleted.

1. Add built-artifact witnesses for the direct path (a Git gate pauses `worktree remove` after the durable plan) and the resumed path (the same pause, then SIGKILL), on a Grove with central metadata, plus a pre-fix record and removal controls. Proof: `node --test tests/cli/loose-consent-inventory.test.ts` red on the unmodified product because the added file is gone; the red run log was kept outside the repository.
2. Inventory loose content recursively per path with its type, without following symlinks or descending into nested Git metadata, bounded, and refusing when incomplete. Record it in the `directory-remove` step, compare it on both paths before removal, and itemize receipts per path. Read a name-only record as consent for those exact paths only. Dependency: 1. Proof: the same file and `tests/module/loose-inventory.test.ts` green.
3. Full local gate, isolated packed install, and the saved reproduction against the installed binary. Dependency: 2. Proof: `reviews/loose-consent-inventory-ledger.md`.

## Piped output delivered in full (review-27 round 3 P2-2)

**Authority:** constitution 6.0.0 Principle III; FR-033A; JSON results contract; V3OUT-04. **Observed baseline:** at `6b21d17`, `src/cli.ts` exits as soon as the command returns. Pipe writes are asynchronous on macOS, so any stdout or stderr output larger than the 64 KiB pipe buffer reaches a piped consumer truncated at 65,536 bytes, still with the command's exit code.

1. Add built-artifact V3OUT-04 witnesses that read stdout and stderr through pipes to EOF: a large `--json` result with progress, a large `--json` error envelope, large human stdout and stderr, and an early-hangup control. Proof: `node --test tests/cli/output-flush-v3.test.ts` red by truncation on the unmodified product; the red run log was kept outside the repository.
2. Wait until stdout and stderr have delivered everything already written, then exit explicitly with the command's code. Settle the wait if the reader hangs up, so exit codes and signals are unchanged. Dependency: 1. Proof: the same test file green, including the hangup control.
3. Run the full local gate, pack, and install into an isolated prefix, then pipe a large installed result into a JSON parser. Dependency: 2. Proof: `reviews/json-output-flush-ledger.md`.

## Issue #27 recoverable acquisition abandonment

**Authority:** constitution 6.0.0 Principles IV–V; FR-024; CLI and JSON result contracts; V3OPS-07. **Observed baseline:** at `885253f`, a real interrupted `repo add` with a removed remote resumes as recoverable `git-failed`. The published remedy offers only resume, while `--abandon` refuses recoverable state and keeps the alias locked.

1. Add real interruption and removed-remote V3OPS-07 witnesses on the frozen base, including owned empty anchor, replacement, added content, refs/worktree, and ineligible records. Proof: `node --test tests/cli/repo-add-abandon-27.test.ts` red for the eligible cases.
2. Amend the active spec and contracts to admit only recoverable `repo add` with durable `git-failed` evidence, retaining current identity and preservation rules. Dependency: 1. Proof: cross-artifact analysis against FR-024 and V3OPS-07.
3. Share the eligibility check between the operation store and reconcile; inspect the owned anchor at point of use, remove only an empty acquisition shell, and retain other successful artifacts. Give exact resume/abandon remedies. Dependency: 2. Proof: focused green witness.
4. Run the full local gate and isolated packed global install. Dependency: 3. Proof: `/opt/homebrew/bin/npm run typecheck && /opt/homebrew/bin/npm test && /opt/homebrew/bin/npm run scan && /opt/homebrew/bin/npm run traceability`, followed by `npm pack`, isolated `npm install -g --prefix`, and installed `grove --version`.

Independent review of frozen `4fa9bf2` found that the empty-shell name/type check could delete user edits to Git's initial `description`, `info/exclude`, `HEAD`, `config`, or sample hooks. It also found that retained nested files were omitted from `survivingArtifacts`. The approved rework keeps the same FR-024/V3OPS-07 boundary:

5. Capture behavioral red witnesses on frozen `4fa9bf2` for changed scaffold bytes and an added nested hook; include a custom repository layout, custom Git template, and missing proof as preservation controls. Dependency: 4. Proof: focused CLI reds and controls in `tests/cli/repo-add-abandon-27.test.ts` (V3OPS-07 cases); the red run logs were kept outside the repository.
6. Record a bounded content/metadata digest only for the default-template acquisition shell; require a complete match plus existing filesystem identity and native Git emptiness checks at cleanup. Retain any uncertain anchor and itemize nested content without recording raw Git config, template, hook, or credential bytes. Dependency: 5. Proof: V3OPS-07 and V3OPS-02 focused CLI green, including the custom-layout witnesses.
7. Repeat the full prescribed local gate and isolated package install, then obtain independent review of the frozen new head. Dependency: 6. Proof: exact gate/pack commands and reviewer disposition in `reviews/repo-add-abandon-27-ledger.md`.

Independent review of frozen `68dc579` found a further P0: the proof was first captured after `git remote add`, so user bytes placed in an initial Git file while that command was paused were adopted as Grove-owned and deleted on abandon. Owner authorized continuation after an automated review halt; neither prior DO NOT MERGE verdict is an approval.

8. Capture behavioral reds on exact `68dc579` for unique description and nested exclude bytes written while `git remote add` is paused, then explicit abandon. Dependency: 7. Proof: `tests/cli/repo-add-abandon-27.test.ts` (V3OPS-07 description/exclude cases) shows two real-Git content-loss failures; the red run log was kept outside the repository.
9. Establish genesis from Grove-created anchor identity and a pristine default-template Git initialization; persist bounded metadata/content hashes only. Require exact comparison before and after the known remote config mutation in direct execution and recovery. Never create missing genesis from an already existing anchor. Dependency: 8. Proof: V3OPS-07 and V3OPS-02 focused green, including post-init and post-remote-add crash controls.
10. Repeat the full prescribed local gate and isolated package install, then freeze a new head for fresh independent review. Dependency: 9. Proof: complete command logs, pack/version, clean commit, and reviewer disposition in round-three report.

## Issue #18 repository-slot ownership correction

**Authority:** constitution 6.0.0 Principles I and V; FR-006, FR-027-FR-029; contract `config-v3.md` (Layout templates); V3LAY-07 and V3LAY-08. **Observed baseline:** on `885253f`, under `groves/{grove}/trees/{repo}/{tree}`, a Tree of repository alpha moved with native Git into beta's `{repo}` slot was classified as conforming: `doctor` reported nothing and `fix --move` had nothing to plan (exit 5). **Outcome:** direct Tree classification compares the `{repo}` segment with the registration Git reports as the owner. A mismatch is `misplaced`, with the owner's slot as its expected path, so the existing audit and `fix --move` path report and repair it. Destructive commands, recovery and reconcile are unchanged.

1. Convert the issue #18 `test.todo` into V3LAY-07 and add V3LAY-08 controls; observe V3LAY-07 failing on the unmodified source for the missing `misplaced` diagnostic. Proof: focused `tests/cli/layout-templates-v3.test.ts` run.
2. Compute the owner-slot expected path in direct Tree classification. Dependency: 1. Proof: the same focused run is green.
3. Record the rule in the config contract, the scenario rows, and the evidence ledger. Dependency: 2. Proof: `npm run traceability`.
4. Run the full local gate and installed package proof. Dependency: 3. Proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, then pack, isolated global install, and installed `grove --version`.
5. Review round 2 (review of `d442b6d`). Merge release head `6b21d17` (F4). Add the V3LAY-09 witness, observe it red on `d442b6d`, and then compare the `{repo}` segment under the repository-name case-folding (F1). Amend spec US3 scenario 5 to agree with V3LAY-07 (F3), and drop the stale defect message (F5). The review's F2 (two moves to one destination) and F6 (the issue's `new`-resume paragraph) are separate issues. Dependency: 4. Proof: as step 4.

## Round 8 native filesystem Git identity correction (issue #9)

**Authority:** constitution 6.0.0 Principles IV–V; FR-012D/FR-021/FR-023A; V3DES-01. **Observed baseline:** independent review of `b330ba0` reproduced direct and resumed removal of linked worktree content when its Git administrative file was named `.GIT` on case-insensitive APFS, and direct removal of a bare repository whose `HEAD` was named `head`. A non-Git bare-shaped directory was incorrectly asserted as proved ownership. **Outcome:** inspect marker names using the filesystem's own lookup semantics, exempt the observed outer worktree by device/inode, and ask native Git to verify marked and bare-shaped directories. Unverified or unsafe Git-like metadata refuses as ambiguous without falsely claiming a confirmed owner.

1. Capture behavioral red direct and replay witnesses on frozen `b330ba0`, including both permission levels, bare HEAD case alias, outer identity, symlink marker and bare decoy. Proof: focused round-eight CLI and module tests against that baseline.
2. Correct the shared structural ownership guard with native filesystem lookup and identity, no outward symlink traversal, and fail-closed inspection. Dependency: 1. Proof: round-seven and round-eight focused tests.
3. Align the active spec and contracts and record the independent review dispositions in the round-eight ledger without rewriting historical records. Dependency: 2. Proof: traceability and document review.
4. Verify the frozen source and isolated installed artifact. Dependency: 3. Proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, then pack, isolated global install, and installed `grove --version`.

## Round 7 independent Git ownership correction (issue #9)

**Authority:** constitution 6.0.0 Principle IV; FR-021/FR-023/FR-023A; V3DES-01. **Observed baseline:** independent review of `9341205` reproduced loss of ignored and ordinary nested repositories during direct removal and replay, and silent loss of ignored submodule work under ignored-only consent. The outer Git inventory collapses a nested repository to one directory or omits a tracked submodule's inner work. **Outcome:** identify independently owned nested Git checkouts and bare repositories through native-byte filesystem observation at every structural preflight and point of use. An observed outer worktree's own `.git` is exempt only at its root. Both destructive permission levels and recovery refuse a nested owner with an actionable path. Ordinary ignored directories retain the round-six exact-file consent behavior.

1. Capture red direct and replay witnesses on the frozen `9341205` bundle for ignored and ordinary nested repositories, populated submodules, and bare Git repositories; preserve the review's original reproducible probes. Proof: `node --test tests/cli/destructive-round7.test.ts` with the frozen bundle, observing behavioral loss rather than flag parsing failure.
2. Add a byte-safe, symlink-avoiding structural ownership inspection to the common mutation guard. It refuses unreadable inventory and names nested owners. Dependency: 1. Proof: focused round-seven CLI and module witnesses, plus existing round-six consent tests.
3. Update FR-023A, V3DES-01, the CLI contract, tasks and evidence ledger without rewriting historical reports. Dependency: 2. Proof: `npm run traceability` and document review.
4. Verify the exact head and isolated installed artifact before another independent review. Dependency: 3. Proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, followed by pack, isolated global install and `grove --version`.

## Round 6 destructive containment amendment (issue #9)

**Authority:** constitution 6.0.0; FR-023/FR-023A; CLI surface ruling ④; V3DES-01/03. **Observed baseline:** review-9-round5 reproduced unflagged ignored-file deletion, blind replay of a newly ignored file, and a direct receipt reporting a vanished preflight file. **Outcome:** exact ignored-file inventory and two explicit permission levels, with point-of-use receipts and recorded-set recovery. Existing structural and unpushed checks still apply.

1. Record failing CLI witnesses for direct Tree/trunk/archive/delete, ignored directory children, replay, permissions and receipt races. Proof: `node --test tests/cli/destructive-round6.test.ts` against the previous product bundle (using a temporary legacy-flag substitution for behavioral witnesses); all expected behavioral assertions fail for their intended reason.
2. Extend the shared byte and text inventory, command preflight, durable input, and recovery. Dependency: 1. Proof: focused module and CLI tests, including V3DES-01/03.
3. Align help, README, governance, contracts and historical traceability without rewriting old reports. Dependency: 2. Proof: `npm run typecheck && npm test && npm run scan && npm run traceability`.
4. Verify the exact head and an isolated global package install before independent review. Dependency: 3. Proof: full gate, `npm pack`, `npm install -g --prefix <isolated>`, installed `grove --version`.

**Branch**: `003-git-native-grove-v2-redesign` | **Date**: 2026-08-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification in this directory, the corrected technical proposal at the historical `docs/git-native-grove-proposal.md` (deleted; kept in the private development history, not in this repository), Decisions 001–003, and the verified v2 baseline evidence at `reviews/v2-baseline-20260822.md`.

## Summary

Evolve the verified green v2 implementation directly into Git-native Grove. Preserve its sound managed bare repository topology, real initial and additional peer trunks, safety suite, and linked Tree support. Replace its duplicated live-state ownership—repository trunk arrays, manifest Tree arrays, branch provenance, claims, and ref-deleting compensation—with byte-safe Git observation, validated convention, central advisory metadata, stable diagnostics, target-complete results, and forward resumable operations.

The corrective phase preserves the v2 public trunk naming invariant (`trunks/main@repo`), closes the demonstrated recovery/diagnostic/result gaps, and repairs the existing parity evidence with exact behavior witnesses. It does not add commands, storage domains, or product capabilities.

The redesign has one acquisition boundary from the first implementation phase onward: `repo add` manages a bare common repository and peer trunks; `repo link` registers an external canonical common directory, creates nothing, and refuses all trunk mutations. There is no ordinary-clone or primary-checkout intermediate architecture.

## Technical Context

**Language/Version**: strict TypeScript ESM on Node 24 or newer

**Primary Dependencies**: Node standard library only at runtime; existing esbuild and TypeScript development dependencies

**Storage**: workspace-local versioned JSON config, central advisory Grove metadata, locks, and forward operation records; Git owns repositories and all live ref/worktree facts

**Testing**: Node built-in test/assert across module, CLI, and E2E suites; the current implementation has 172 module, 256 CLI, and 20 E2E tests plus scan, build, isolated installed-artifact scenarios, and the inherited-scenario traceability gate

**Target Platform**: local macOS release verification. CI and additional-platform verification are out of scope for this corrective phase; no Linux-specific implementation work is planned.

**Project Type**: one foreground CLI package and one bundled executable

**Performance Goals**: one bounded Git observation reused per read command; mutation commands revalidate point-of-use facts; no added background or network work outside commands that already declare remote access

**Constraints**: no daemon/global state, Git wrapper, ref ownership, lossy ref/path decoding, automatic ref deletion, raw recursive worktree fallback, or fictional cross-repository atomicity

**Scale/Scope**: all 40 baseline commands retain an explicit disposition; three v3 command families (`doctor`, `sync`, and `fix`) and foreign-schema refusal remain gated with the complete baseline regression surface. No migration command or runtime loader exists.

## Constitution Check

_GATE: passed before research and passed after design._

| Principle | Design evidence | Status |
|---|---|---|
| I. Git Owns Live State | Observed repository/worktree/ref state is invocation-scoped; config and central manifests contain no live arrays, claims, or provenance. | PASS |
| II. Grove Owns Convention and Orchestration | Validated layouts/naming, stable registrations, advisory selectors, and the managed-add/external-link capability boundary are explicit. | PASS |
| III. One Command, Workspace-Local State | Every new record remains under the workspace and every action is foreground. | PASS |
| IV. Forward, Ref-Safe Operations | Forward step records, point-of-use revalidation, target-complete partial results, and no compensating ref deletion. | PASS |
| V. Observe, Diagnose, Never Guess | Byte-safe observation, capability probes, strict selectors, stable diagnostics, and stale-fix refusal. | PASS |
| VI. No Legacy Creep | Schema-1/schema-2 ownership state is never interpreted; foreign schemas self-identify on refusal, while valid bare Git topology remains usable when registered under schema 3. | PASS |
| Technology and artifact constraints | Existing Node/npm/esbuild single-artifact shape remains; no runtime dependency is added. | PASS |
| Workflow and quality gates | Tests precede each implementation slice; baseline tests, scan, traceability, bundle install, and acquisition E2E are phase/final gates. | PASS |

No constitution exception or complexity waiver is required.

## Project Structure

### Documentation

```text
specs/003-git-native-grove/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── traceability.md
├── decisions/
├── contracts/
├── checklists/
├── reviews/
└── tasks.md
```

### Source and tests

```text
src/
├── cli.ts
├── commands/                 # handlers; doctor, fix, and sync are the v3 additions
├── config/                   # v3 config, layout/convention compiler, advisory catalog
├── git/                      # raw-buffer adapter and narrow native mutations
├── model/                    # observed, conformance, plan, result, advisory types
├── paths/                    # containment and internal paths
└── store/                    # CAS metadata, locks, forward operations

tests/
├── module/                   # byte/layout/model/operation/result contracts
├── cli/                      # command, acquisition, lifecycle, sync, and schema-refusal scenarios
├── e2e/                      # raw Git, installed artifact, recovery, prior-release parity
└── testkit/                  # raw Git and interruption fixtures
```

**Structure Decision**: retain the existing single-package boundaries and add only domain-specific modules. V2 source remains the implementation base; sound v3 modules may be selectively adapted, but no superseded implementation commit or Phase 9 patch is applied wholesale.

## Design and Traceability Rules

1. Decision 001 supersedes every primary-checkout or linked-trunk statement in the proposal; Decision 002 supersedes its schema-version and migration-source assumptions; Decision 003 supersedes its opaque `branchKey` trunk-layout detail and defines corrective safety boundaries.
2. `spec.md` owns user outcomes and `FR-*`/`SC-*`; contracts own exact interfaces and results.
3. `traceability.md` maps every requirement, task, baseline scenario family, changed command, and final gate. A task without requirement and ledger IDs is invalid.
4. Tests for a phase are committed and observed failing for the intended reason before that phase's source implementation.
5. No phase removes a baseline witness until its Git-native equivalent and prior-release comparison are green.
6. Every phase exits with focused tests, `npm run typecheck`, `npm run build`, `npm run scan`, and `npm run traceability`; full `npm test` runs at each coherent commit.
7. Corrective Phase 9 starts from the accepted adversarial findings, adds a red witness for every bug before its implementation change, and closes only after a fresh adversarial pass reports no unresolved P0/P1/P2 bug or proof-gap finding.

## Dependency-Ordered Phases

### Phase 1 — Baseline, governance, and executable contracts

**Requirements**: FR-047–FR-051B; 003-git-native-grove-SC-013–003-git-native-grove-SC-016

- Preserve the verified `e6aabeb` run, inventory v2 add/link/trunk/ownership behavior, and freeze the before/after acquisition checklist.
- Ratify the governing constitution lineage through 5.0.0 and corrected Decision 001; import only corrected spec/design material.
- Build a new literal traceability ledger and failing prior-release topology/acquisition tests.

**Exit**: spec checklist passes; analysis has zero critical/high findings; acquisition tests fail only on intended v3 differences; baseline remains green.

### Phase 2 — Schema, layout, byte-safe Git, observation, and result foundation

**Requirements**: FR-001–FR-018C, FR-026A–FR-028C, FR-032A–FR-033B **Stories**: US1 foundation; US2 acquisition model

- Add failing layout/naming, config/advisory, raw-byte, capability, observation, diagnostic-ID, and result-shape contracts.
- Freeze baseline command types/loaders/path derivations under `src/compat/v2/`, then introduce schema-v3 runtime types (the existing incompatible schema number is not silently reused), validated layout/convention compilers, readable collision-safe trunk allocations, and stable repository locations.
- Adapt the Git runner to buffers and `-z` parsing; build one bounded observed workspace including linked-worktree/subdirectory/bare anchors and non-UTF-8 read-only paths.
- Add central advisory catalog reads, conformance diagnostics, command results, and explicit self-identifying foreign-schema refusal before normal schema loading.

**Exit**: module contracts are green; no v3 runtime live arrays/claims/provenance exist; baseline commands still compile through explicitly temporary adapters only.

### Phase 3 — Observed reads, doctor, and raw Git interoperability

**Requirements**: FR-002–FR-008, FR-015–FR-017, FR-027–FR-029, FR-032A–FR-033B **Stories**: US1, US3

- Write raw `git switch` and worktree add/move/remove scenarios first.
- Convert status, repo/Grove/Tree/trunk list/show, review/file scope, agent lookup, and reconcile audit to the shared observation.
- Add read-only `doctor` and stable conformance identities.

**Exit**: successful raw Git changes are visible on the next invocation without repair; changed HEAD is reality, not corruption; all read commands reuse one observation.

### Phase 4 — Correct acquisition and native creation with forward recovery

**Requirements**: FR-011A–FR-026A, FR-032A–FR-035 **Stories**: US2 and structural recovery from US4

- Write the complete Decision 001 matrix, linked-refusal side-effect snapshots, creation matrix, and every structural crash window before implementation.
- Implement managed bare add plus real initial peer trunk, external common-directory link with no mutations, and pre-mutation refusal of linked trunk add/remove/sync.
- Implement Tree/new/trunk creation with exact OID planning and native occupied-branch arbitration.
- Replace rollback with forward operation records, observable intermediates, resume, and abandon.

**Exit**: every acquisition row passes; partial creation retains artifacts and refs; main and other managed trunks have one lifecycle; linked Trees work without duplicate checkout.

### Phase 5 — Sync state machine and target-complete results

**Requirements**: FR-030–FR-033B, FR-047–FR-048 **Stories**: US4

- Add failing fetch-only, ff-only, rebase, local/nonpreferred upstream, dirty/diverged/unborn, sequencer, interruption, and mixed-target fixtures.
- Implement explicit sync attempts over observed Trees and managed trunks only.
- Keep `trunk sync` as managed-only compatibility targeting; linked repositories refuse before fetch or local mutation.

**Exit**: no reset/implicit upstream; sequencers stay native; results contain every selected target once with correct outcome and exit.

### Phase 6 — Advisory catalog, lifecycle, and explicit move fix

**Requirements**: FR-012B, FR-015–FR-017, FR-021–FR-029, FR-034A–FR-038 **Stories**: US3, US5

- Write lifecycle ref snapshots, metadata staleness/rebinding, detached reachability, move-fix, and crash tests first.
- Complete central metadata CAS/lazy creation; convert configure/reorder and archive recipes.
- Convert Tree/trunk remove, archive/restore/delete/rename, and repo remove to observed, ref-retaining behavior; repo remove unregisters only.
- Add stale-safe `fix --move`; remove branch-deletion command and raw deletion fallback.

**Exit**: lifecycle changes no pre-state ref OID; Git refusal remains a refusal; alias reuse never rebinds advisory data.

### Phase 7 — Foreign-schema refusal and legacy-runtime exclusion

**Requirements**: FR-046, FR-049A–FR-049C **Stories**: US6

- Write schema-1, schema-2, unknown-schema, and malformed-schema refusal fixtures first.
- Refuse before interpreting legacy ownership fields or mutating Git/filesystem state; human and machine errors name the running version, resolved executable path, encountered schema, and accepted schema.
- Prove `src/migration/`, migration commands, ownership loaders, claims, provenance, and mutable live-state arrays are absent. Valid bare repositories/worktrees remain ordinary Git topology and may be registered only through the supported schema-3 acquisition boundary.

**Exit**: every foreign-schema fixture self-identifies without mutation; exclusion scans pass; no migration runtime or command exists.

### Phase 8 — Ownership removal, docs, and release proof

**Requirements**: FR-007–FR-008, FR-038, FR-046–FR-051B **Stories**: completion of US1–US6

- Delete temporary runtime compatibility, claims, provenance, live arrays, ref-deleting rollback, branch-deletion surface, and every migration parser/command.
- Update current contracts, help, completions, README, onboarding, and installed examples.
- Run full consistency/adversarial review, requirement/task audit, prior-release regression comparison, acquisition/link E2E, full test/typecheck/build/scan/traceability, and isolated package install.

**Exit**: every live task has a green executable witness; zero unmapped requirements/tasks, P0/P1 findings, v3 runtime ownership hits, ref-deleting paths, or failed baseline/final gates.

### Phase 9 — Corrective adversarial convergence

**Requirements**: FR-010–FR-012D, FR-018–FR-036, FR-046, FR-051A–FR-051B; 003-git-native-grove-SC-003, 003-git-native-grove-SC-006, 003-git-native-grove-SC-008, 003-git-native-grove-SC-015–003-git-native-grove-SC-016 **Stories**: corrective witnesses across US2, US3, US4, and US5

- Ratify Decision 003 and restore exact readable trunk allocation without adding live trunk state.
- Add red regression witnesses for foreign-schema refusal, stale restore, detached trunk-removal race, symlink-expanded layout mismatch, relocated destructive replay, pending target ownership; hook-dirtied checkout completion; linked remote-only advisory bases; stable refusal propagation; and deterministic result ordering.
- Correct each implementation slice independently, preserving successful partial artifacts and all refs, and run its focused suite before advancing.
- Replace ID-only prior-release parity evidence with an exact disposition/witness ledger whose validator requires the named assertion markers, including the `TRUNK-01` installed-path check.
- Run the full gate and up to five architecture/workflow/implementation adversarial rounds, stopping early only when no P0/P1/P2 bug or proof-gap finding remains.

**Exit**: every corrective task and exact witness is green; full verification passes; the durable review report contains no unresolved P0/P1/P2 finding; no scope beyond the accepted redesign was introduced.

### Phase 10 — Bounded production convergence

**Requirements**: FR-027–FR-029, FR-033A–FR-035, FR-046, FR-049A–FR-051B; 003-git-native-grove-SC-008, 003-git-native-grove-SC-013–003-git-native-grove-SC-016 **Stories**: corrective witnesses for US3 and US5; release evidence across all live stories

1. Reconcile the live spec, plan, contracts, data model, research, validation guide, traceability map, tasks, and checklists with constitution 5.0.0 before source work. Retain void FR/SC IDs only as historical citation keys; add no migration or CI/additional-platform scope.
2. Write a failing human/JSON parity witness for forced Tree/trunk removal, then change only the result facts needed to itemize discarded filenames.
3. Write a failing same-host stale-lock diagnosis/reclaim witness, then change only diagnostic classification and wording; do not alter lock acquisition or reclaim policy.
4. Before either source fix, repair stale markers/citations, add missing obligations to existing live ledger rows, and consolidate or strengthen already-cited assertions until the current traceability validator is green, then run read-only Spec Kit analysis. Add no product behavior and do not redesign the ledger schema, counting rules, validator architecture, or claim model.
5. After both source slices, run the full local macOS release matrix, installed-artifact managed-add/external-link scenarios, and at most five bounded review rounds.

**Ordering**: documentation prerequisites -> T089 traceability repair -> T090 analysis -> T091 red result witness -> T092 result fix -> T093 red lock witness -> T094 diagnostic fix -> T095 release matrix -> T096 final review/checklist closure. Each source task is blocked by its immediately preceding red witness. No source work begins while readiness gates are red, and terminal gates do not run early.

**Exit**: both reproduced bugs have red-before/green-after evidence; traceability reports zero findings without an evidence-architecture change; analysis has zero unresolved HIGH/CRITICAL findings; the local release matrix and installed acquisition/link scenarios pass; the durable review continues its existing ledger without exceeding five total rounds, and it and the production checklist report zero unresolved P0/P1/P2 findings.

### Phase 11 — Structural output parity correction

**Requirements**: FR-033A–FR-033C, FR-046, FR-049C, FR-051A–FR-051B; 003-git-native-grove-SC-013–003-git-native-grove-SC-017 **Stories**: output conformance across every registered command; documentation correction for the settled no-migration boundary

1. Remove stale migration promises from README, current help/provenance guidance, and Decisions 001–003. Preserve retired FR/SC IDs and historical review records as citation history; add no migration runtime or replacement capability.
2. Add red emitter round-trip, source-architecture, registry-surface, and `repo link` parity witnesses. The source audit covers every registered handler rather than a selected command list.
3. Replace handler-provided human callbacks with one shared renderer that receives the same structured success/error value serialized by `--json`. Strings remain raw in human mode so completion scripts stay executable; structured values are traversed completely.
4. Remove direct command-result output paths, route help/version views through registry-derived values where applicable, and verify the compiler rejects the old callback signature.
5. Run focused parity/acquisition/help tests, the full local release gate, traceability, build, and isolated installed acquisition scenarios. Record the new evidence without reopening migration, CI, platform, or command scope.

**Ordering**: documentation/spec correction -> read-only Spec Kit analysis -> red architecture and CLI witnesses -> shared renderer -> command-surface conversion -> focused/full verification. No production source changes begin until the red witnesses demonstrate the current lossy projection.

**Exit**: zero handler-local human projections or direct handler output writes; every structured result field is necessarily rendered in both modes; `repo link` parity is green; no live document promises migration support; full verification passes.

### Phase 13 — Human help presentation correction

**Requirements**: FR-033B–FR-033D, FR-049B, 003-git-native-grove-SC-013, 003-git-native-grove-SC-017–003-git-native-grove-SC-018 **Story**: User Story 7 terminal-readable help with structured JSON help

1. Reproduce and preserve evidence for top-level, noun-family, and per-command human/JSON help.
2. Revise the output contract so semantic fact parity does not require identical shape or generic traversal, while retaining the one-payload result/error architecture and completion behavior.
3. Add red CLI witnesses for conventional sections, spacing, aligned entries, readable notes and examples, absence of `-`/`Name:`/`Desc:` object-dump leakage, and structured JSON facts at all three help levels. Revise the architecture audit to require the explicit shared help path.
4. Introduce a typed registry-derived help document and one centralized terminal help renderer. Route only help through the emitter's explicit help method; keep command results/errors and raw completion strings on their existing paths.
5. Run focused help/output/architecture/completion tests, all mandated local gates, diff review, and record the committed evidence without push, publish, or merge.
6. Adversarially verify the PR, then close any demonstrated help-dispatch, terminal-width, or architecture-enforcement gaps with focused regression witnesses before merge.

**Ordering**: authoritative spec/contracts/design -> read-only Spec Kit analysis -> red help and architecture witnesses -> help model/renderer -> focused and full gates -> evidence review/commit.

**Exit**: all three human help levels are conventional and readable with zero generic traversal leakage; all three JSON levels remain structured and contain the shared meaningful facts; the result/error parity suite and completion script remain green; full local verification passes.

## Cross-Phase Verification

| Gate | Required evidence |
|---|---|
| Baseline preservation | Every inherited scenario has an exact preserved/superseded disposition and executable witness; aggregate IDs or test counts are supporting evidence only. |
| Correct topology | Managed bare anchor plus readable real peer trunks (`trunks/main@repo` by default); linked registration has zero acquisition/trunk mutation side effects and may seed Trees from its configured remote-tracking trunk without creating a local trunk. |
| Git authority | Lists/reads derive live facts from Git; runtime config/advisory files contain no live arrays or provenance. |
| Byte safety | Non-UTF-8 refs/paths round-trip losslessly and are never targeted through lossy strings. |
| Ref safety | Pre-state refs retain OIDs across creation failure, lifecycle, recovery, and abandon. |
| Recovery | Every structural step has pre/post/intermediate classification and no blind replay. |
| Foreign schema | Schema-1/schema-2/unknown ownership state is refused before interpretation or mutation and the error identifies both schemas and the executing binary. |
| Packaging | Bundled CLI installs and runs without source, node_modules, or runtime dependencies. |

## Complexity Tracking

No constitution violations or complexity waivers. Schema-1/schema-2 ownership parsing and all migration machinery are absent. Temporary adapters were allowed only until their owning command phase was green and have been deleted in Phase 8.

## Implemented structure

The final cutover accepts schema 3 only and refuses every foreign schema before interpreting its shape. `src/migration/`, migration commands, ownership loaders, production claims, provenance, rollback journals, ref-deleting cleanup, and mutable live-state arrays are absent and guarded by the legacy scan.

## Archive and layout repair lane (V3ALY)

**Authority:** Constitution I, IV, V; FR-029A and FR-036A; `cli-surface-v3.md` and `config-v3.md` V3ALY amendments. **Baseline:** the V3ALY-01/02/03 focused built-artifact witnesses failed before implementation; V3ALY-04 is volume-dependent, skips on the default case-insensitive test volume, and passes on mounted case-sensitive APFS.

1. Add V3ALY-01 through V3ALY-04 acceptance rows and executable witnesses; capture the failing baseline before source changes.
2. Refuse archive when Git inspection leaves Tree membership unknown, itemizing Tree-position content before any move. Reject colliding repair destinations before dry-run or operation creation. Compare case-variant owner paths by filesystem identity. Dependency: 1.
3. Define structural Tree slot paths once in layout code and use them in loose-content inventory at delete plan and point of use, preserving ordinary loose-file protection. Coordinate recovery reuse with its owning lane. Dependency: 1.
4. Run focused witnesses, then the full local gate once at default concurrency. Record passing witnesses in the traceability ledger; commit and open a PR for independent review. Dependency: 2 and 3.
