# Tasks: Git-native Grove

## Receipts for partial destruction (assessment-18 §8c)

Completion evidence is in `reviews/partial-receipt-ledger.md`; checkboxes are not evidence.

- [ ] T-PARTIAL-1 Add V3DES-11 direct and V3DES-12 resumed partial-receipt witnesses for `delete` and `archive` — FR-023A, TRACE-PARTIAL-RECEIPT; proof: missing-receipt reds on `bc1f480`.
- [ ] T-PARTIAL-2 Record per-file receipts in completed destructive steps and report them in partial results and resumes — depends on T-PARTIAL-1; FR-023A, TRACE-PARTIAL-RECEIPT; proof: V3DES-11 and V3DES-12 green.
- [ ] T-PARTIAL-3 Full local gate, isolated packed install and installed s8 control — depends on T-PARTIAL-2; TRACE-PARTIAL-RECEIPT; proof: gate totals and s8 output in the ledger.
- [ ] T-PARTIAL-4 Review round 3: V3DES-13 resumable metadata failure, `io-failed` classification, Tree-path re-population and vanished-file witnesses, named resumed Trees, contract gap text — depends on T-PARTIAL-3; FR-023A, TRACE-PARTIAL-RECEIPT; proof: round-3 reds, then full gate.
- [ ] T-PARTIAL-5 Review round 4: recoverable `io-failed` on resume-time metadata failures, pending archive refusal before the path check, state-based pending-operation remedy (V3DES-13, V3OPS-08) — depends on T-PARTIAL-4; FR-024, TRACE-PARTIAL-RECEIPT; proof: round-4 reds, then full gate.

## Per-path loose-content consent (release item 13)

Completion evidence is in `reviews/loose-consent-inventory-ledger.md`; checkboxes are not evidence.

- [ ] T-LOOSE-1 Add V3DES-09 direct and V3DES-10 resumed witnesses, the pre-fix record witness, and removal controls — FR-023, TRACE-LOOSE-CONSENT; proof: added-file-deleted reds on `f143968`.
- [ ] T-LOOSE-2 Record, compare, and itemize a bounded recursive per-path loose inventory on the direct and resumed delete paths — depends on T-LOOSE-1; FR-023, FR-023A, TRACE-LOOSE-CONSENT; proof: V3DES-09 and V3DES-10 green.
- [ ] T-LOOSE-3 Full local gate, isolated packed install and installed reproduction — depends on T-LOOSE-2; TRACE-LOOSE-CONSENT; proof: gate totals and reproduction output in the ledger.

## Piped output delivered in full (review-27 round 3 P2-2)

Completion evidence is in `reviews/json-output-flush-ledger.md`; checkboxes are not evidence.

- [ ] T-FLUSH-1 Add V3OUT-04 pipe-reading witnesses for large `--json` result, `--json` error, human stdout, human stderr, and an early-hangup control — FR-033A, TRACE-OUT-FLUSH; proof: truncation reds on unmodified `6b21d17`.
- [ ] T-FLUSH-2 Drain stdout and stderr before an explicit exit with the command's code — depends on T-FLUSH-1; FR-033A, TRACE-OUT-FLUSH; proof: V3OUT-04 green.
- [ ] T-FLUSH-3 Full local gate, isolated packed install and installed pipe check — depends on T-FLUSH-2; TRACE-OUT-FLUSH; proof: gate totals and pipe evidence in the ledger.

## Issue #27 recoverable acquisition abandonment

Completion evidence belongs in the branch's issue #27 report; task checkboxes are not evidence.

- [ ] T-27-1 Add a real interrupted fetch and removed-remote behavioral red witness for V3OPS-07 on frozen `885253f`, plus owned/replaced/modified anchors, successful artifacts, and ineligible controls — FR-024; proof: focused CLI test showing intended old refusal.
- [ ] T-27-2 Update FR-024 and active CLI/JSON/scenario contracts for scoped explicit abandonment and preservation — depends on T-27-1; proof: read-only cross-artifact analysis.
- [ ] T-27-3 Implement shared eligibility and point-of-use owned-anchor inspection without deleting successful artifacts; report resume/abandon remedies — depends on T-27-2; proof: focused V3OPS-07 CLI green and existing V3OPS-02 regressions.
- [ ] T-27-4 Verify full local gate and isolated packed global install — depends on T-27-3; proof: full prescribed npm command, pack, isolated install and installed version.
- [ ] T-27-5 Reproduce independent scaffold-deletion and omitted-nested-artifact findings with behavioral reds on frozen `4fa9bf2` — FR-024/V3OPS-07; depends on T-27-4; proof: six scaffold red cases and a nested-hook red case in the branch's ignored evidence logs.
- [ ] T-27-6 Require content-sensitive, default-template acquisition proof as well as recorded filesystem identity and native Git emptiness before deletion; fail closed for changed, unreadable, custom-template, or proof-free anchors and report nested retained content — FR-024/V3OPS-07; depends on T-27-5; proof: focused CLI green including custom layout.
- [ ] T-27-7 Repeat full local gate and isolated installed package proof, then freeze a new commit for independent review — depends on T-27-6; proof: exact command output and review disposition in the issue #27 report.
- [ ] T-27-8 Capture late-snapshot content-loss reds on frozen `68dc579` while remote add is paused — FR-024/V3OPS-07; depends on T-27-7; proof: two deleted user files in the ignored round-three red log.
- [ ] T-27-9 Establish genesis at Grove-created anchor initialization and validate only the exact remote-add transition in both direct and resumed execution; retain missing or changed proof, and cover post-init/post-remote-add crash windows — FR-024/V3OPS-07; depends on T-27-8; proof: focused CLI green with previous regressions.
- [ ] T-27-10 Run full local gate and isolated installed package proof, freeze a clean commit, then request fresh independent review — depends on T-27-9; proof: exact logs and review disposition in report-27-round3.md.

## Issue #18 repository-slot ownership correction

Completion evidence belongs in `reviews/tree-slot-owner-issue18-ledger.md`; checkboxes are not evidence.

- [ ] T-I18-1 Convert the issue #18 todo into the V3LAY-07 witness and add V3LAY-08 controls; capture V3LAY-07 red on unmodified `885253f` for the missing `misplaced` diagnostic — FR-006; proof: focused `tests/cli/layout-templates-v3.test.ts` run.
- [ ] T-I18-2 Classify a Tree whose `{repo}` segment differs from its Git-reported owner as misplaced toward the owner's slot, without touching destructive, recovery or reconcile code — FR-006/FR-027-FR-029; depends on T-I18-1; proof: the same focused run.
- [ ] T-I18-3 Record the owner-slot rule in `contracts/config-v3.md`, the V3LAY-07/08 scenario rows, and the evidence ledger — FR-051A; depends on T-I18-2; proof: `npm run traceability`.
- [ ] T-I18-4 Run the full local gate and installed package proof — FR-051B; depends on T-I18-3; proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, then isolated pack/install/version.
- [ ] T-I18-5 Review round 2 (F4): merge release head `6b21d17` without rewriting history, keeping both new top sections of plan and tasks — FR-051A; proof: merge tree equals the reviewed test merge.
- [ ] T-I18-6 Review round 2 (F1): add the V3LAY-09 case-variant witness and capture it red on `d442b6d`, then compare the `{repo}` segment under repository-name case-folding and align the config contract — FR-006; depends on T-I18-5; proof: focused layout run.
- [ ] T-I18-7 Review round 2 (F3, F5): amend spec US3 scenario 5 to agree with V3LAY-07 and drop the stale defect message from the witness — FR-051A; depends on T-I18-6; proof: `npm run traceability`.
- [ ] T-I18-8 Repeat the full local gate and installed package proof — FR-051B; depends on T-I18-7; proof: as T-I18-4.

## Round 8 native filesystem Git identity correction (issue #9)

Completion evidence belongs in `reviews/contained-path-round8-ledger.md`; checkboxes are not evidence. The round-seven ledger remains historical and its broad structural claims are superseded for the case-alias shapes identified by independent review.

- [ ] T-R8-1 Capture behavioral red direct and replay witnesses against frozen `b330ba0` for linked checkout `.GIT` admin files, bare `head` aliases, outer identity, ambiguous decoy and symlink marker — FR-012D/FR-023A; proof: focused round-eight CLI and module tests.
- [ ] T-R8-2 Use native filesystem lookup and device/inode identity in the shared structural guard; verify marked and bare-shaped ownership with native Git and fail closed on ambiguity — FR-021/ FR-023A; depends on T-R8-1; proof: round-seven plus round-eight focused tests.
- [ ] T-R8-3 Update active spec/contract/plan and append a round-eight evidence ledger without rewriting historical records — FR-023A/FR-051A; depends on T-R8-2; proof: traceability and document review.
- [ ] T-R8-4 Run the full local gate and installed package proof — FR-051B; depends on T-R8-3; proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, then isolated pack/install/version.

## Round 7 independent Git ownership correction (issue #9)

Completion evidence is in `reviews/contained-path-round7-ledger.md`; these checkboxes are not evidence. Round six remains historical and its broader structural claims are superseded for the nested Git shapes identified in independent review.

- [ ] T-R7-1 Capture tests-first behavioral red evidence on frozen `9341205` for ignored and ordinary nested repositories, populated submodules and bare repositories, direct and recovery paths — FR-023/FR-023A; proof: focused round-seven CLI test with frozen bundle.
- [ ] T-R7-2 Refuse independent nested Git ownership in common structural mutation preflight and point-of-use guards, preserving byte identity and avoiding outward symlinks — FR-021/FR-023A; depends on T-R7-1; proof: focused round-seven module and CLI tests.
- [ ] T-R7-3 Align active spec and contracts and record limitations in the round-seven ledger — FR-023A/FR-051A; depends on T-R7-2; proof: traceability and document review.
- [ ] T-R7-4 Run full local gates and installed package proof — FR-051B; depends on T-R7-3; proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, then isolated pack/install/version.

## Round 6 destructive containment amendment (issue #9)

Completion evidence is in `reviews/contained-path-round6-ledger.md`; these checkboxes are not evidence.

- [ ] T-R6-1 Capture tests-first red evidence for V3DES-01/03 ignored-file, ignored-directory, permission, replay and receipt witnesses — FR-023/FR-023A; proof: focused CLI run on previous product bundle with temporary legacy-flag substitution for behavioral assertions.
- [ ] T-R6-2 Expand byte and text working-state inventory and enforce exact consent for direct Tree/trunk/archive/delete and reconcile — FR-023/FR-023A; depends on T-R6-1; proof: `node --test tests/cli/destructive-round6.test.ts`.
- [ ] T-R6-3 Update public flag/help/documentation surfaces and preserve the old-flag rejection — FR-023A/FR-049B-C; depends on T-R6-2; proof: full module/CLI/traceability gates.
- [ ] T-R6-4 Verify full local gates and isolated installed artifact; record exact totals and remaining limits — FR-023A/FR-051A-B; depends on T-R6-3; proof: `npm run typecheck && npm test && npm run scan && npm run traceability`, followed by pack/install/version.

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: [spec.md](spec.md), [plan.md](plan.md), Decisions 001–003, and the contracts in `contracts/`

**Execution rule**: Complete phases in order. Within every phase, tests are authored and observed failing for the intended reason before source implementation. Every task names its requirement range and traceability ledger row.

## Phase 1: Baseline and governance

**Goal**: Freeze the actual v2 starting point and corrected design authority.

- [x] T001 Record clean commit/worktree evidence and the complete v2 verification run in `specs/003-git-native-grove/reviews/v2-baseline-20260822.md` — FR-047, FR-051A; TRACE-BASE
- [x] T002 Inventory v2 `repo add`, `repo link`, trunk, claim, provenance, and rollback behavior in `specs/003-git-native-grove/reviews/v2-baseline-20260822.md` — FR-007, FR-011A-E, FR-018A-C; TRACE-ACQ
- [x] T003 Port and ratify corrected Decision 001 in `specs/003-git-native-grove/decisions/001-repository-acquisition-topology.md` — FR-011A-E, FR-018A-C; TRACE-DEC1
- [x] T004 Resolve the real v2 schema collision and record schema-3 foreign-state refusal in `specs/003-git-native-grove/decisions/002-schema-version-from-v2-baseline.md` — FR-046; TRACE-DEC2
- [x] T005 Align constitution, spec, contracts, data model, research, and quickstart in `.specify/memory/constitution.md`, `docs/git-native-grove-proposal.md`, and `specs/003-git-native-grove/` — FR-049A-C, FR-050; TRACE-GOV
- [x] T006 Create the verified-before and release-blocking-after scenario audit in `specs/003-git-native-grove/reviews/before-after-scenarios.md` — FR-051A, 003-git-native-grove-SC-016; TRACE-PARITY
- [x] T007 Validate the regenerated plan/task/ledger package and record read-only analysis in `specs/003-git-native-grove/reviews/speckit-analyze-v2-redesign.md` — FR-051A-B, 003-git-native-grove-SC-014; TRACE-ANALYZE

---

## Phase 2: Foundation — schema, layout, bytes, observation, and results

**Goal**: Establish ownership-free runtime primitives before command conversion.

**Independent test**: A raw-buffer fixture builds a bounded observed workspace with deterministic layout, diagnostics, and results while schema-1/2 inputs refuse normal loading.

### Tests first

- [x] T008 [P] [US1] Add failing schema-v3, central metadata, foreign-version refusal, and strict validation tests in `tests/module/workspace-v3.test.ts` and `tests/module/grove-v3.test.ts` — FR-007, FR-009-FR-017, FR-046; TRACE-FND-SCHEMA
- [x] T009 [P] [US1] Add failing layout/template/branch-key/collision/containment tests in `tests/module/layout-v3.test.ts` and `tests/module/paths.test.ts` — FR-006A-C, FR-009-FR-014C; TRACE-FND-LAYOUT
- [x] T010 [P] [US1] Add failing raw-buffer, `-z`, non-UTF-8 ref/path, unborn, linked-anchor, and capability tests in `tests/module/git-bytes.test.ts` — FR-001-FR-006C, FR-011B, FR-026A; TRACE-FND-GIT
- [x] T011 [P] [US1] Add failing bounded observation and role-classification tests in `tests/module/observed-workspace.test.ts` — FR-003-FR-006C, FR-011A-E, FR-015-FR-017; TRACE-FND-OBS
- [x] T012 [P] [US3] Add failing stable diagnostic identity/collision tests in `tests/module/diagnostic-id.test.ts` — FR-027-FR-029, 003-git-native-grove-SC-005; TRACE-FND-DIAG
- [x] T013 [P] [US4] Add failing target-complete result, byte JSON, redaction, outcome, and exit tests in `tests/module/output-results.test.ts` — FR-032A-FR-033B; TRACE-FND-RESULT

### Implementation

- [x] T014 [US1] Introduce schema-v3 declared/advisory/result types without legacy ownership shapes in `src/model/types.ts` and remove the completed transition's compatibility copies in Phase 8 — FR-007, FR-009-FR-017, FR-046; TRACE-FND-SCHEMA
- [x] T015 [US1] Implement strict schema-3 loading, foreign-schema refusal, and catalog CAS in `src/config/workspace.ts`, `src/config/grove.ts`, and `src/config/grove-catalog.ts` without legacy loaders — FR-009-FR-017, FR-046; TRACE-FND-SCHEMA
- [x] T016 [US1] Implement validated layout/naming compilation and byte-safe branch identity primitives in `src/config/layout.ts`, `src/config/conventions.ts`, `src/model/encoding.ts`, and `src/model/validate.ts` — FR-006A-C, FR-009-FR-014C; TRACE-FND-LAYOUT
- [x] T017 [US1] Adapt the Git runner and adapter to raw buffers, capability probes, canonical common directories, and `--porcelain -z` in `src/git/adapter.ts` — FR-001-FR-006C, FR-011B, FR-026A; TRACE-FND-GIT
- [x] T018 [US1] Implement bounded repository/worktree/Grove observation and stable anchor indexing in `src/model/observed.ts`, `src/config/discovery.ts`, and `src/paths/fs.ts` — FR-003-FR-006C, FR-011A-E, FR-015-FR-017; TRACE-FND-OBS
- [x] T019 [US3] Implement conformance diagnostics and stable canonical IDs in `src/model/conformance.ts` — FR-027-FR-029, 003-git-native-grove-SC-005; TRACE-FND-DIAG
- [x] T020 [US4] Implement `CommandResultV1`, path/ref JSON encoding, redaction, deterministic targets, and result-with-exit emission in `src/model/result.ts` and `src/output.ts` — FR-032A-FR-033B; TRACE-FND-RESULT
- [x] T021 [US1] Adapt init/config surfaces and shared baseline fixtures to schema v3 without losing safety witnesses in `src/commands/init.ts`, `src/commands/workspace.ts`, `tests/testkit/fixture.ts`, `tests/module/grove-v3.test.ts`, and `tests/module/init.test.ts` — FR-009-FR-014C, FR-047; TRACE-FND-SCHEMA
- [x] T022 Run Phase 2 focused suites and all verification scripts declared in `package.json` — FR-001, FR-046, FR-051B; TRACE-PHASE-GATE

---

## Phase 3: User Stories 1 and 3 — observed reads and doctor

**Goal**: Make successful raw Git state immediately visible and diagnosable.

**Independent test**: Switch branches and add/move/remove worktrees with Git; the next Grove read shows current state and doctor emits stable non-corruption diagnostics.

### Tests first

- [x] T023 [P] [US1] Add failing raw Git interoperability/read-command scenarios in `tests/cli/repository-diagnostic.test.ts`, `tests/cli/reconcile-scenarios.test.ts`, and `tests/e2e/git-native.test.ts` — FR-002-FR-008, 003-git-native-grove-SC-001-SC-002; TRACE-US1-READ
- [x] T024 [P] [US3] Add failing doctor filters, strict exit, stale metadata, and exact result fixtures in `tests/cli/audit-fixes.test.ts` and `tests/cli/repository-diagnostic.test.ts` — FR-027-FR-029, FR-032A-FR-033B; TRACE-US3-DOCTOR

### Implementation

- [x] T025 [US1] Convert workspace/repository/Grove status, list, and show to one observation in `src/commands/workspace.ts`, `src/commands/repo.ts`, and `src/commands/grove.ts` — FR-003-FR-006C, FR-015; TRACE-US1-READ
- [x] T026 [US1] Convert Tree/trunk list, agent lookup, review, and file scope to observed worktrees in `src/commands/tree.ts`, `src/commands/trunk.ts`, `src/commands/agent.ts`, `src/commands/review.ts`, and `src/commands/files.ts` — FR-003-FR-006C, FR-015-FR-017; TRACE-US1-READ
- [x] T027 [US3] Implement/register read-only doctor and shared conformance audit in `src/commands/doctor.ts`, `src/commands/reconcile.ts`, and `src/commands/index.ts` — FR-027-FR-029, FR-048; TRACE-US3-DOCTOR
- [x] T028 [US1] Update observed read/help/fixture coverage without deleting baseline witnesses in `tests/testkit/fixture.ts`, `tests/cli/review.test.ts`, and `tests/cli/workspace.test.ts` — FR-047, FR-049B; TRACE-US1-READ
- [x] T029 Run Phase 3 focused/raw-Git E2E and all verification scripts declared in `package.json` — FR-002-FR-008, FR-051B; TRACE-PHASE-GATE

---

## Phase 4: User Story 2 — correct acquisition and native creation

**Goal**: Deliver Decision 001 from the start, with forward structural recovery.

**Independent test**: Add a managed repository and link four external input forms; prove managed peer trunks, zero link mutations, linked trunk refusal, and Tree creation for both modes.

### Tests first

- [x] T030 [P] [US2] Add failing prior-release/add/link acquisition matrix and installed-path assertions in `tests/cli/repository-acquisition.test.ts` — FR-011A-E, FR-018A-C, 003-git-native-grove-SC-016; TRACE-US2-ACQ
- [x] T031 [P] [US2] Add failing managed-peer-trunk, linked pre-mutation refusal, Tree availability, and ref/worktree snapshot tests in `tests/cli/trunk-scenarios.test.ts` and `tests/cli/repository-acquisition.test.ts` — FR-011D-E, FR-018A-C, FR-021, FR-035; TRACE-US2-TRUNK
- [x] T032 [P] [US4] Add failing forward operation, branch-only intermediate, resume/abandon, crash-window, and no-compensation tests in `tests/module/operation-v3.test.ts` and `tests/e2e/operation-recovery-v3.test.ts` — FR-019-FR-026A, FR-035; TRACE-US2-OPS

### Implementation

- [x] T033 [US4] Replace rollback journals with mode-safe forward plans, target locks, classification, resume, and abandon in `src/store/operation.ts`, `src/store/lock.ts`, and `src/commands/reconcile.ts` — FR-021-FR-026A, FR-035; TRACE-US2-OPS
- [x] T034 [US2] Implement exact remote/revision/unborn/worktree primitives and creation planners in `src/git/adapter.ts` and `src/model/plan.ts` — FR-018-FR-026A; TRACE-US2-CREATE
- [x] T035 [US2] Implement managed bare `repo add`, canonical external `repo link`, advisory `repo configure`, and registration mutation in `src/commands/repo.ts` — FR-011A-E, FR-018A-C, FR-021-FR-026A; TRACE-US2-ACQ
- [x] T036 [US2] Implement managed-only peer trunk add/remove and linked refusal in `src/commands/trunk.ts` — FR-011D-E, FR-018A-B, FR-021, FR-035; TRACE-US2-TRUNK
- [x] T037 [US2] Convert `new` and `tree add` to native observed plans without claims/provenance in `src/commands/grove.ts` and `src/commands/tree.ts` — FR-018-FR-026A, FR-035; TRACE-US2-CREATE
- [x] T038 [US2] Run acquisition/creation/recovery E2E, snapshot all refs/worktree registrations, and run all verification scripts declared in `package.json` — FR-011A-E, FR-018-FR-026A, FR-035, 003-git-native-grove-SC-016; TRACE-PHASE-GATE

---

## Phase 5: User Story 4 — explicit sync

**Goal**: Coordinate fetch-only, ff-only, and rebase over observed targets with honest outcomes.

**Independent test**: Mixed clean/dirty/diverged/unborn/detached/sequencer targets produce exact, target-complete results without reset or sequencer destruction.

### Tests first

- [x] T039 [P] [US4] Add failing strategy/upstream/divergence/sequencer/interruption tests in `tests/cli/sync-v3.test.ts` — FR-030-FR-031F; TRACE-US4-SYNC
- [x] T040 [P] [US4] Add failing mixed-target result/exit and linked-trunk refusal fixtures in `tests/module/output-results.test.ts`, `tests/cli/sync-v3.test.ts`, and `tests/cli/trunk-scenarios.test.ts` — FR-011E, FR-032A-FR-033B; TRACE-US4-RESULT

### Implementation

- [x] T041 [US4] Implement sync planning/state classification in `src/model/plan.ts`, `src/git/worktree.ts`, and `src/store/operation.ts` — FR-030-FR-033B; TRACE-US4-SYNC
- [x] T042 [US4] Implement/register `sync`, observed `repo fetch`, and managed-only `trunk sync` delegation in `src/commands/sync.ts`, `src/commands/repo.ts`, `src/commands/trunk.ts`, and `src/commands/index.ts` — FR-011E, FR-030-FR-033B, FR-048; TRACE-US4-SYNC
- [x] T043 [US4] Run sync focused/E2E and all verification scripts declared in `package.json` — FR-030-FR-033B, 003-git-native-grove-SC-004, 003-git-native-grove-SC-007; TRACE-PHASE-GATE

---

## Phase 6: User Story 5 and move half of User Story 3 — lifecycle/advisory state

**Goal**: Remove worktrees and manage Grove lifecycle without hidden ref ownership.

**Independent test**: Every lifecycle action retains ref OIDs, stale advisory selectors do not rebind, and explicit move fix rescans before mutation.

### Tests first

- [x] T044 [P] [US5] Add failing lifecycle ref-retention, detached reachability, archive recipe, Git-refusal, and crash tests in `tests/cli/lifecycle.test.ts` and `tests/cli/lifecycle-v3.test.ts` — FR-034A-FR-038, 003-git-native-grove-SC-003, 003-git-native-grove-SC-008; TRACE-US5-LIFE
- [x] T045 [P] [US5] Add failing central catalog lazy-CAS, alias reuse, selector staleness, and forget-settings tests in `tests/cli/metadata-catalog.test.ts` — FR-012B, FR-015-FR-017; TRACE-US5-META
- [x] T046 [P] [US3] Add failing fix dry-run/apply/stale/unsafe move tests in `tests/cli/audit-fixes.test.ts` — FR-021, FR-026-FR-029; TRACE-US3-FIX

### Implementation

- [x] T047 [US5] Complete advisory catalog lifecycle and selector CAS in `src/config/grove-catalog.ts`, `src/config/grove.ts`, and `src/model/types.ts` — FR-012B, FR-015-FR-017; TRACE-US5-META
- [x] T048 [US5] Implement observed lifecycle/move safety planning and detached reachability in `src/model/plan.ts`, `src/commands/lifecycle.ts`, and `src/git/adapter.ts` without restoring the removed ownership safety table — FR-021-FR-029, FR-034A-FR-037; TRACE-US5-LIFE
- [x] T049 [US5] Convert Tree configure/reorder/remove and trunk remove to advisory/observed behavior in `src/commands/tree.ts` and `src/commands/trunk.ts` — FR-012B, FR-016-FR-017, FR-034A-FR-035; TRACE-US5-LIFE
- [x] T050 [US5] Convert archive/restore/delete/rename/configure to central recipes and ref-safe native worktree operations in `src/commands/lifecycle.ts` — FR-016-FR-017, FR-021-FR-026, FR-034A-FR-036; TRACE-US5-LIFE
- [x] T051 [US5] Make `repo remove` unregister-only and remove the branch-deletion command in `src/commands/repo.ts` and `src/commands/index.ts` — FR-037-FR-038, FR-047; TRACE-US5-REPO
- [x] T052 [US3] Implement/register rescan-safe `fix --move` in `src/commands/fix.ts` and `src/commands/index.ts` — FR-021, FR-026-FR-029, FR-048; TRACE-US3-FIX
- [x] T053 [US5] Delete runtime claim/provenance/ref-deleting callers and raw worktree deletion fallback in `src/git/claim.ts`, `src/store/journal.ts`, and `src/git/adapter.ts` after equivalent tests are green — FR-007-FR-008, FR-035, FR-038; TRACE-US5-REMOVE
- [x] T054 [US5] Run lifecycle/fix focused/E2E, ref-OID comparison, and all verification scripts declared in `package.json` — FR-012B, FR-015-FR-017, FR-021-FR-029, FR-034A-FR-038; TRACE-PHASE-GATE

---

## Phase 7: User Story 6 — foreign-schema refusal

**Goal**: Refuse schema-1/schema-2 ownership state without interpreting it while leaving native Git repositories and worktrees untouched.

**Independent test**: Human and JSON invocations against disposable foreign-schema workspace and manifest fixtures identify the running version, resolved binary, encountered schema, and accepted schema before mutation; the exclusion scan proves no migration runtime exists.

The former T055–T062 migration tasks are retired historical IDs under constitution 5.0.0. They are not active tasks, requirements, or evidence, and their deleted files MUST NOT be recreated.

---

## Phase 8: Polish, ownership cutover, and release audit

**Goal**: Remove transitional ownership code, update user guidance, and prove the whole redesign.

- [x] T063 Remove `src/compat/v2/`, `src/migration/`, ownership loaders, and every normal-runtime legacy path after conversion, and enforce their absence in `scripts/legacy-scan.sh` — FR-007-FR-008, FR-046; TRACE-CUTOVER
- [x] T064 [P] Update registry/help/completions and all 40 command dispositions in `src/commands/registry.ts`, `src/commands/completion.ts`, and `tests/module/dispatch-audit.test.ts` — FR-047-FR-049B; TRACE-COMMANDS
- [x] T065 [P] Update current guidance in `README.md`, `docs/help-authoring-context.md`, `docs/PROVENANCE.md`, and `docs/LEGACY-CHECKLIST.md` — FR-049A-C; TRACE-DOCS
- [x] T066 Add installed-artifact acquisition/link/raw-Git/lifecycle validation in `tests/e2e/artifact.test.ts` and `tests/e2e/git-native.test.ts` — FR-011A-E, FR-018A-C, FR-049C, 003-git-native-grove-SC-016; TRACE-ARTIFACT
- [x] T067 Update `scripts/scenario-traceability.sh` and scenario contracts for v3 families without losing the 180-scenario baseline accounting — FR-051A-B; TRACE-SCENARIOS
- [x] T068 Mark release-blocking after scenarios only after executable witnesses pass in `specs/003-git-native-grove/reviews/before-after-scenarios.md` — FR-051A-B, 003-git-native-grove-SC-016; TRACE-PARITY
- [x] T069 Run final Spec Kit consistency analysis and adversarial review; record results in `specs/003-git-native-grove/reviews/` — FR-051A-B, 003-git-native-grove-SC-014-SC-015; TRACE-FINAL-REVIEW
- [x] T070 Run `npm run typecheck && npm test && npm run scan && npm run traceability`, prior-release comparison, and isolated package install; record exact counts in `specs/003-git-native-grove/reviews/release-audit-v3.md` — FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-016; TRACE-FINAL-GATE
- [x] T071 Mark every completed task in `specs/003-git-native-grove/tasks.md` and commit the final coherent implementation/audit milestone locally without push, merge, install outside isolated prefixes, or publish — FR-051B; TRACE-FINAL-GATE

---

## Phase 9: Corrective adversarial convergence

**Goal**: Correct only the demonstrated redesign regressions/proof gaps and converge through fresh architecture, workflow, and implementation review with no unresolved P0/P1/P2 finding.

### Tests and governance first

- [x] T072 Ratify Decision 003 and align spec, plan, contracts, research, data model, quickstart, before/after audit, and traceability before source mutation — FR-010-FR-012D, FR-051A-B, 003-git-native-grove-SC-015-SC-016; TRACE-CORR-GOV
- [x] T073 [P] [US2] Add failing exact readable-trunk, collision, contained-symlink refusal, linked remote-only advisory-base, and selector-order witnesses in module/CLI/E2E suites — FR-010-FR-012D, FR-018A-C, FR-032A, 003-git-native-grove-SC-016; TRACE-CORR-ACQ
- [x] T074 [P] [US5] Add failing stale-recipe restore, hook-dirtied restore/reconcile, pending-operation removal ownership, relocated destructive replay, and detached trunk-removal race witnesses — FR-021-FR-026, FR-033A, FR-034A-FR-036, 003-git-native-grove-SC-006, 003-git-native-grove-SC-008; TRACE-CORR-LIFE
- T075 is a retired historical migration task ID under constitution 5.0.0; it is not an active task or release requirement.
- [x] T076 Add an exact inherited-scenario disposition/witness ledger and strengthen traceability validation so `TRUNK-01` requires its named exact-path assertion marker — FR-051A-B, 003-git-native-grove-SC-015-SC-016; TRACE-CORR-PARITY
- [x] T077 Run corrective Spec Kit analysis and record zero critical inconsistency/coverage findings before implementation — FR-051A-B, 003-git-native-grove-SC-014-SC-015; TRACE-CORR-ANALYZE

### Corrective implementation

- [x] T078 [US2] Restore readable collision-safe trunk allocation/observation and refuse lexical/canonical layout target mismatch without adding live trunk arrays — FR-010-FR-012D, FR-018A-B; TRACE-CORR-ACQ
- [x] T079 [US2] Resolve linked advisory bases through local then configured remote-tracking refs and sort equivalent multi-repository creation results deterministically — FR-011D-E, FR-020, FR-032A; TRACE-CORR-ACQ
- [x] T080 [US4] Enforce compatible operation target ownership, current-workspace destructive replay containment, final checkout cleanliness/identity, and stable safety-reason propagation in recovery — FR-021-FR-026, FR-033A; TRACE-CORR-OPS
- [x] T081 [US5] Rebind restore through current stable registration and add final clean checkout verification; revalidate detached reachability immediately before trunk removal — FR-021, FR-034A-FR-036, 003-git-native-grove-SC-008; TRACE-CORR-LIFE
- T082 is a retired historical migration task ID under constitution 5.0.0; its deleted runtime MUST NOT be restored.

### Verification and review loop

- [x] T083 Run all focused corrective suites plus typecheck, build, scan, and exact traceability gates — FR-051A-B, 003-git-native-grove-SC-013-SC-016; TRACE-CORR-GATE
- [x] T084 Run complete module/CLI/E2E and isolated installed-artifact acquisition/link scenarios, recording exact results in a corrective release audit — FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-016; TRACE-CORR-GATE
- [x] T085 Run up to five fresh adversarial architecture/workflow/implementation rounds, fixing only verified in-scope findings and stopping with no unresolved P0/P1/P2 bug or proof gap — 003-git-native-grove-SC-015; TRACE-CORR-REVIEW
- [x] T086 Close the before/after checklist, corrective report, and tasks only after all evidence is green; commit coherent local milestones without push, merge, global install, or publish — FR-051B, 003-git-native-grove-SC-015-SC-016; TRACE-CORR-GATE

## Dependencies and execution order

1. Phase 1 freezes authority and analysis before implementation.
2. Phase 2 blocks all command work.
3. Phase 3 establishes observation/read semantics used by creation, sync, lifecycle, and foreign-schema-safe diagnostics.
4. Phase 4 supplies forward structural operations and corrected acquisition.
5. Phase 5 depends on observed state/results but remains non-resumable sync.
6. Phase 6 depends on observation and forward lifecycle operations.
7. Phase 7 publishes only after the complete v3 destination model exists.
8. Phase 8 deletes compatibility only after all equivalent witnesses are green.
9. Phase 9 corrects the adversarially demonstrated gaps from the implemented v3 baseline; its governance/tests precede source changes and its review loop follows full verification.
10. Phase 10 begins with documentation reconciliation, bounded traceability repair, and read-only analysis. Only then does each bug receive a failing witness before its source task; release verification and review run last in that order.

## Parallel opportunities

- T008–T013 touch separate focused suites and may run in parallel after Phase 1.
- T023–T024, T030–T032, and T044–T046 are independent test-first groups.
- Source tasks that share `src/git/adapter.ts`, `src/model/plan.ts`, or command files run sequentially even when adjacent work could otherwise be parallel.
- Phase 10 is deliberately sequential: readiness gates run first, each red witness is followed by only its bounded source fix, then terminal gates run in order.

## Implementation strategy

The first demonstrable increment is Phases 1–3: raw Git becomes observable without repair. Phase 4 is the corrected acquisition/creation milestone and cannot be replaced by the superseded ordinary-primary-checkout implementation. Each later phase is independently testable, and no phase advances with a failed focused or baseline gate.

---

## Phase 10: Convergence

Earlier `[X]` markers in T001–T086 record execution at their original milestone; they are not current release evidence and do not override reopened production-checklist items. T087–T096 are the active completion set, and T096 supersedes the earlier terminal claims in T083–T086.

### Planning prerequisites

- [x] T087 Reconcile foreign-schema/no-migration authority across `specs/003-git-native-grove/spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `traceability.md`, `tasks.md`, `contracts/cli-surface-v3.md`, `contracts/config-v3.md`, `contracts/json-results-v1.md`, `checklists/requirements.md`, and `reviews/speckit-analyze-corrective-phase9.md` without adding runtime behavior — FR-046, FR-049A-C; TRACE-CONV-DOCS
- [x] T088 Bound release evidence to local macOS and remove CI/additional-platform work from `specs/003-git-native-grove/spec.md`, `plan.md`, `quickstart.md`, `checklists/corrective-requirements.md`, `reviews/before-after-scenarios.md`, and `reviews/release-audit-corrective-v3.md` without changing inherited runtime constraints — FR-049A-C, 003-git-native-grove-SC-014; TRACE-CONV-DOCS

### Blocking readiness gates

- [x] T089 Repair stale/orphan assertion markers and incorrect live-row citations, add missing proof obligations to existing live ledger rows, and consolidate or strengthen already-cited witness assertions in `specs/003-git-native-grove/reviews/prior-release-scenario-ledger.json` and its already cited `tests/**/*.test.ts` witnesses until `npm run traceability` reports zero findings; do not add product behavior or change the ledger schema, counting rules, validator architecture, or assertion-local claim model — FR-051A-B, 003-git-native-grove-SC-014-SC-016; TRACE-CONV-TRACE
- [x] T090 Run a fresh read-only Spec Kit analysis over `specs/003-git-native-grove/spec.md`, `plan.md`, and `tasks.md`; record zero constitution conflicts, unmapped live requirements/tasks, or unresolved HIGH/CRITICAL findings in `specs/003-git-native-grove/reviews/speckit-analyze-convergence.md` before source implementation begins — FR-051A-B, 003-git-native-grove-SC-014; TRACE-CONV-ANALYZE

### Slice A — destructive-result parity

- [x] T091 [US5] Add failing human/JSON parity assertions proving forced `tree remove` and `trunk remove` results contain every discarded filename in `tests/cli/destructive-v3.test.ts` and `tests/cli/corrective-lifecycle-v3.test.ts` — FR-033A-B, FR-035, 003-git-native-grove-SC-008; TRACE-CONV-DESTRUCTIVE
- [x] T092 [US5] Add discarded filename facts to forced machine results while preserving identical human output in `src/commands/tree.ts` and `src/commands/trunk.ts`; change no removal eligibility or capability — FR-033A-B, FR-035, 003-git-native-grove-SC-008; TRACE-CONV-DESTRUCTIVE

### Slice B — truthful stale-lock diagnosis

- [x] T093 [US3] Add a failing same-host dead-lock scenario coupling `doctor --strict` output to successful automatic reclaim by the next mutation in `tests/cli/repository-diagnostic.test.ts`, with classification coverage in `tests/module/store.test.ts` — FR-027-FR-029; TRACE-CONV-LOCK
- [x] T094 [US3] Distinguish automatically reclaimable same-host stale locks from cross-host/manual-action locks in `src/store/lock.ts` and `src/commands/doctor.ts`; keep lock acquisition policy unchanged — FR-027-FR-029; TRACE-CONV-LOCK

### Terminal gates

- [x] T095 Run `npm run typecheck && npm test && npm run scan && npm run traceability`, `npm run build`, and the isolated installed-artifact `repo add`/`repo link` E2E scenarios on local macOS; replace stale terminal evidence in `specs/003-git-native-grove/reviews/release-audit-corrective-v3.md` with current commit, counts, and results — FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-016; TRACE-CONV-GATE
- [x] T096 Continue the existing five-round ledger in `specs/003-git-native-grove/reviews/adversarial-review-remediation-20260824.md`: first disposition its stale dispatched round-4 entry, never reset the count or exceed five total rounds, fix only reproduced in-scope bugs or proof gaps, and close that review, `reviews/before-after-scenarios.md`, and `checklists/corrective-requirements.md` only with zero unresolved P0/P1/P2 findings — 003-git-native-grove-SC-015; TRACE-CONV-REVIEW

---

## Phase 11: Structural output parity correction

This phase closes the PR review's demonstrated output-conformance bug without adding commands or capabilities. The no-migration boundary is settled scope and receives documentation correction only.

- [x] T097 Reconcile no-migration scope in `README.md`, `docs/PROVENANCE.md`, `docs/help-authoring-context.md`, `docs/LEGACY-CHECKLIST.md`, and `specs/003-git-native-grove/decisions/001-repository-acquisition-topology.md` through `003-readable-trunk-layout-and-corrective-boundaries.md`; retain historical review evidence unchanged — FR-046, FR-049C; TRACE-OUT-ARCH
- [x] T098 Run a fresh read-only Spec Kit analysis over `specs/003-git-native-grove/spec.md`, `plan.md`, and `tasks.md`; require zero constitution conflicts, unmapped live requirements/tasks, or unresolved HIGH/CRITICAL findings before production source changes — FR-051A-B, 003-git-native-grove-SC-014; TRACE-OUT-ARCH
- [x] T099 Add failing one-payload emitter round-trip, direct-output/source-architecture, complete registered-handler inventory, and `repo link` acquisition parity witnesses in `tests/module/output.test.ts`, `tests/module/output-architecture.test.ts`, and `tests/cli/output-parity.test.ts` — FR-033A-C, 003-git-native-grove-SC-013, 003-git-native-grove-SC-017; TRACE-OUT-ARCH
- [x] T100 Implement the lossless shared human renderer and remove human callback parameters from `src/output.ts`; structured values and error envelopes must traverse completely, while a string value remains raw in human mode — FR-033A-C; TRACE-OUT-ARCH
- [x] T101 Convert every registered command handler and registry-derived help/version success path in `src/commands/*.ts` and `src/cli.ts` to emit one structured value with no independent human projection or command-output bypass; preserve completion-script executability — FR-033A-C, FR-049B, 003-git-native-grove-SC-013, 003-git-native-grove-SC-017; TRACE-OUT-ARCH
- [x] T102 Audit and correct focused human-output expectations across `tests/cli/**/*.test.ts` and `tests/e2e/**/*.test.ts` only where the old expectation depended on a lossy second projection; run focused emitter, output-parity, acquisition, help, completion, error, and installed-artifact verification without weakening behavior assertions — FR-033A-C, 003-git-native-grove-SC-017; TRACE-OUT-ARCH
- [x] T103 Run `npm run typecheck && npm test && npm run scan && npm run traceability && npm run build`, record exact results in `specs/003-git-native-grove/reviews/output-parity-correction-20260824.md`, confirm the worktree is clean after a coherent local commit, and leave PR merge/publish actions unperformed unless separately authorized — FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-017; TRACE-OUT-ARCH

---

## Phase 12: Installed-CLI live E2E convergence

**Goal**: Correct only the five defects reproduced by the installed Grove 0.3.0 live acceptance run, close their proof gaps tests-first, and replace the failing live verdict with fresh evidence.

- [x] T104 Add a whole-record failing V3OPS-05 witness, then prevent terminal `repo add` operation records from retaining the exact raw remote anywhere in `tests/cli/operations-v3.test.ts`, `src/commands/repo.ts`, and `src/store/operation.ts` without weakening resumable recovery — FR-033A, Contract V3OPS-05 (partial); TRACE-LIVE-F01
- [x] T105 Add a combined dirty-Tree/loose-Grove human/JSON refusal witness, then emit one complete pre-mutation risk inventory from `tests/cli/destructive-v3.test.ts` and `src/commands/lifecycle.ts` while preserving the existing forced-run inventory — FR-033A-C, Constitution IV (contradicts); TRACE-LIVE-F02
- [x] T106 Add a write-then-fresh-read ordering witness, then apply advisory `treeOrder` consistently to observed Grove presentation in `tests/cli/help-behaviour-v3.test.ts`, `tests/cli/config-integrity-v3.test.ts`, and `src/model/observed.ts` without making metadata authoritative for Tree existence — FR-016, Constitution I-II (partial); TRACE-LIVE-F03
- [x] T107 Add managed/linked unregister result-shape witnesses, then report managed bare storage as retained common Git data rather than a checkout in `tests/cli/trunk-repo.test.ts` and `src/commands/repo.ts` while keeping removal unregister-only — FR-037, Decision 001 (contradicts); TRACE-LIVE-F04
- [x] T108 Add workspace/Grove/Tree stale-agent preference witnesses, then emit stable non-blocking diagnostics from `tests/cli/repository-diagnostic.test.ts` and `src/model/observed.ts` when advisory defaults reference missing agent definitions — FR-016, Constitution II/V (partial); TRACE-LIVE-F05
- [x] T109 Run focused corrective suites and `npm run typecheck && npm test && npm run scan && npm run traceability && npm run build`; rebuild the local CLI, rerun all five live reproductions in a fresh disposable workspace, and record exact outcomes in `specs/003-git-native-grove/reviews/live-e2e-correction-20260824.md` without push, publish, merge, migration, or unrelated scope — FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-017 (partial); TRACE-LIVE-GATE

---

## Phase 13: Human help presentation correction

**Goal**: Preserve structured JSON help while restoring conventional, readable terminal help at the top-level, noun-family, and per-command surfaces.

**Independent test**: `grove --help`, `grove repo --help`, and `grove new --help` use conventional sections and aligned entries with no object-dump leakage; the three `--json` forms expose the same meaningful help facts as structured values; completion and command-result parity remain green.

- [x] T110 [US7] Reconcile help semantic parity and presentation policy in `specs/003-git-native-grove/spec.md`, `contracts/help-presentation-v1.md`, `contracts/json-results-v1.md`, `contracts/cli-surface-v3.md`, `contracts/acceptance-scenarios-v3.md`, `research.md`, `plan.md`, `quickstart.md`, `traceability.md`, and `reviews/help-human-formatting-20260824.md` — FR-033B-D, FR-049B, 003-git-native-grove-SC-018; TRACE-HELP-PRESENT
- [x] T111 [US7] Run read-only Spec Kit analysis over the revised `spec.md`, `plan.md`, and `tasks.md`; require no constitution conflict or unmapped live requirement/task before production edits — FR-051A-B, 003-git-native-grove-SC-014; TRACE-HELP-PRESENT
- [x] T112 [US7] Add failing top-level, noun-family, and per-command human usability and JSON fact witnesses plus an explicit-help-path architecture witness in `tests/module/help.test.ts`, `tests/cli/help-formatting.test.ts`, and `tests/module/output-architecture.test.ts` — FR-033B-D, FR-049B, 003-git-native-grove-SC-017-SC-018; TRACE-HELP-PRESENT
- [x] T113 [US7] Implement the typed help document, aligned/wrapped human renderer, and explicit emitter help path in `src/help.ts`, `src/output.ts`, and `src/cli.ts` without changing command-result rendering or completion output — FR-033B-D, FR-049B, 003-git-native-grove-SC-017-SC-018; TRACE-HELP-PRESENT
- [x] T114 [US7] Run focused help, output architecture, output parity, and completion verification followed by `npm run typecheck && npm test && npm run scan && npm run traceability` — FR-033B-D, FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-018; TRACE-HELP-PRESENT
- [x] T115 [US7] Review scope and quality, record exact green witnesses and the commit in `specs/003-git-native-grove/reviews/help-human-formatting-20260824.md`, and commit the complete change on `fix/help-human-formatting` without merge or push — FR-049A-C, FR-051A-B, 003-git-native-grove-SC-018; TRACE-HELP-PRESENT
- [x] T116 [US7] Add adversarial regression witnesses for globals-anywhere JSON help, boolean-option help dispatch, real 80-column registry title/usage wrapping, and handler exclusion from the help-only emitter path — FR-033B-D, 003-git-native-grove-SC-017-SC-018; TRACE-HELP-PRESENT
- [x] T117 [US7] Implement canonical two-precision help dispatch, controlled title/usage wrapping, handler-facing emitter isolation, and verify the ART-05 ledger's whitespace-canonical evidence; then rerun focused and full gates and update the PR — FR-033B-D, FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-018; TRACE-HELP-PRESENT

## Archive and layout repair lane (V3ALY)

- [x] T-ALY-1 Record FR-029A/FR-036A and V3ALY-01..04 contracts, then add built-artifact behavior tests and capture their red baseline — TRACE-ARCHIVE-LAYOUT.
- [x] T-ALY-2 Fix archive refusal/itemization, duplicate fix destinations, case-sensitive slot ownership, and structural empty-slot inventory while preserving wrapper projection files — TRACE-ARCHIVE-LAYOUT; depends on T-ALY-1.
- [ ] T-ALY-3 Verify focused suites and the exact full local gate, rebase after recovery, and record passing test evidence — TRACE-ARCHIVE-LAYOUT; depends on T-ALY-2.
