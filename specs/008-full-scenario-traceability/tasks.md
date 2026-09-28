# Tasks: Full scenario traceability

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/008-full-scenario-traceability/`

**Tests**: This feature is a test-coverage and quality-gate campaign. A citation is not complete until the named test proves the scenario's setup and result.

## Phase 1: Generic validator foundation

- [x] T001 Record the measured 180-scenario/69-exact-title-citation baseline and per-family counts in `docs/BACKLOG.md`
- [x] T002 [US2] Add fixture contract/test-source inputs for uncited, duplicate, unknown-citation, comment-only, stale-deferral, and new-family cases in `tests/module/scenario-traceability.test.ts`
- [x] T003 [US2] Rewrite `scripts/scenario-traceability.sh` to discover every §11 family and exact test-title citation generically, with no hardcoded family list or scenario count
- [x] T004 [US2] Make `scripts/scenario-traceability.sh` reject duplicate contract IDs, unknown test IDs, comment-only credit, and invalid or ownerless deferrals with exact diagnostics
- [x] T005 [US2] Prove T002's negative controls fail for the intended reason and its valid all-family fixture passes in `tests/module/scenario-traceability.test.ts`

**Checkpoint**: The validator detects structural gaps for arbitrary families; existing temporary deferrals remain reported while the behavioral campaign proceeds.

## Phase 2: Discovery, initialization, and isolation (User Story 1, P1)

- [x] T006 [US1] Audit DISC-01–DISC-14 against assertions in `tests/module/discovery.test.ts`, `tests/cli/workspace.test.ts`, and `tests/cli/regressions.test.ts`; add missing failing witnesses before assigning IDs
- [x] T007 [US1] Audit INIT-01–INIT-09 against `tests/module/init.test.ts` and `tests/cli/regressions.test.ts`; add interruption/unwritable/idempotence witnesses and fix exposed defects only after they fail
- [x] T008 [US1] Audit ISO-01–ISO-05 against `tests/cli/workspace.test.ts` and `tests/testkit/fixture.ts`; prove cross-workspace locks/config and HOME isolation
- [x] T009 [US1] Enable DISC, INIT, and ISO in the family rollout state in `scripts/scenario-traceability.sh` only after all three families pass

## Phase 3: Tree identity and paths (User Story 1, P1)

- [x] T010 [US1] Audit TREE-01–TREE-24 for exact branch/path identity, collisions, adoption, defaults, remove safety, and empty Groves across `tests/module/encoding.test.ts`, `tests/module/ids.test.ts`, `tests/cli/lifecycle.test.ts`, `tests/cli/repository-default.test.ts`, and `tests/cli/trunk-repo.test.ts`
- [x] T011 [US1] Add missing TREE witnesses first, then fix any exposed product defect in `src/commands/tree.ts`, `src/commands/grove.ts`, `src/model/encoding.ts`, or the owning module without weakening assertions
- [x] T012 [US1] Enable TREE in `scripts/scenario-traceability.sh` when all 23 authoritative TREE IDs have complete witnesses

## Phase 4: Command surface (User Story 1, P1)

- [x] T013 [US1] Complete feature 005 tasks before crediting CMD-15 and feature 006 tasks before crediting CMD-16, as defined in `specs/005-remove-grove-diff/tasks.md` and `specs/006-command-schema/tasks.md`
- [x] T014 [US1] Audit CMD-01–CMD-16 across `tests/module/arity.test.ts`, `tests/module/globals.test.ts`, `tests/module/exit-codes.test.ts`, `tests/module/dispatch-audit.test.ts`, and `tests/cli/review.test.ts`; add missing help/completion/JSON/progress/config witnesses
- [x] T015 [US1] Add the all-command runtime-schema/usage/help drift matrix and pre-refactor argv parity assertions required by CMD-16 in the feature-006-owned test files
- [x] T016 [US1] Enable CMD in `scripts/scenario-traceability.sh` only after removed-command and centralized-schema witnesses pass

## Phase 5: Repository, trunk, and reconcile diagnostics (User Story 1, P1)

- [x] T017 [US1] Complete feature 004 tasks before crediting REPO-30, TRUNK-12, and RECON-06 as defined in `specs/004-repository-diagnostics/tasks.md`
- [x] T018 [US1] Audit REPO-01–REPO-30 across `tests/cli/trunk-repo.test.ts`, `tests/cli/repository-default.test.ts`, `tests/cli/repo-add-staging.test.ts`, `tests/cli/audit-fixes.test.ts`, and `tests/cli/regressions.test.ts`, including real local fetch/no-remote witnesses for REPO-02 and REPO-09
- [x] T019 [US1] Audit TRUNK-01–TRUNK-12 across `tests/cli/trunk-repo.test.ts` and `tests/cli/repository-default.test.ts`, adding real local fast-forward/divergence/collision witnesses before fixing any exposed defect
- [x] T020 [US1] Audit RECON-01–RECON-06 across `tests/cli/workspace.test.ts`, `tests/cli/regressions.test.ts`, and feature 004's diagnostic tests; prove no mutation or identity rebinding
- [x] T021 [US1] Enable REPO, TRUNK, and RECON in `scripts/scenario-traceability.sh` and remove their temporary deferrals only after every named witness passes

## Phase 6: Lifecycle and process recovery (User Story 1, P1)

- [x] T022 [US1] Complete feature 007 tasks before removing ARCH-07 and ARCH-11 deferrals, as defined in `specs/007-crash-recovery-tests/tasks.md`
- [x] T023 [US1] Audit ARCH-01–ARCH-29 across `tests/cli/lifecycle.test.ts`, `tests/module/work-safety.test.ts`, and `tests/e2e/crash-recovery.test.ts`; ensure every credited combined-title test independently asserts each scenario result
- [x] T024 [US1] Audit PROC-01–PROC-14 across `tests/module/journal.test.ts`, `tests/module/operation-lock.test.ts`, `tests/cli/golden-path.test.ts`, `tests/e2e/crash-recovery.test.ts`, and `tests/e2e/artifact.test.ts`; add live/stale lock, reader consistency, signal, and cleanup witnesses
- [x] T025 [US1] Enable ARCH and PROC in `scripts/scenario-traceability.sh` only after crash-window tests and all process-cleanup assertions pass

## Phase 7: File/review and agent surfaces (User Story 1, P1)

- [x] T026 [US1] Complete feature 005's FILE-03 witness, then audit FILE-01–FILE-06 across `tests/cli/review.test.ts` and `tests/cli/workspace.test.ts`, including binary/oversize and partial multi-repository errors
- [x] T027 [US1] Audit AGENT-01–AGENT-10 across `tests/cli/review.test.ts`, `tests/testkit/fake-agent.ts`, and `tests/e2e/golden-path.test.ts`; add precedence, argv pass-through, exit propagation, and working-directory containment witnesses
- [x] T028 [US1] Enable FILE and AGENT in `scripts/scenario-traceability.sh` only after both families pass

## Phase 8: Artifact and golden paths (User Story 1, P1)

- [x] T029 [US1] Audit ART-01–ART-06 in `tests/e2e/artifact.test.ts`, including isolated global install, clean-environment execution, package contents, and unsupported-Node behavior
- [x] T030 [US1] Audit E2E-01–E2E-04 in `tests/e2e/golden-path.test.ts`; make the human, globally installed, JSON-driven, and archive-safety journeys independently executable and assertion-complete
- [x] T031 [US1] Enable ART and E2E in `scripts/scenario-traceability.sh` after the built-artifact journeys pass

## Phase 9: Reject test theatre (User Story 3, P2)

- [x] T032 [US3] Mutation-check representative module witnesses by reversing expected encoding/safety results and recording that the named tests fail before reverting in `specs/008-full-scenario-traceability/quickstart.md`
- [x] T033 [US3] Mutation-check representative CLI witnesses by reintroducing one removed-command or diagnostic-parity defect and recording the expected failures before reverting in `specs/008-full-scenario-traceability/quickstart.md`
- [x] T034 [US3] Mutation-check representative E2E witnesses by moving a crash kill before its boundary or violating artifact isolation and recording the expected failures before reverting in `specs/008-full-scenario-traceability/quickstart.md`

## Phase 10: Closure

- [x] T035 Remove every remaining deferral and rollout-family exception from `scripts/scenario-traceability.sh`; require all discovered families by default
- [x] T036 Update traceability counts and close superseded debt in `specs/001-grove-cli/contracts/README.md`, `docs/BACKLOG.md`, and `docs/decisions-and-tasks-20260820.md`
- [x] T037 Run `npm run typecheck && npm test && npm run scan && npm run traceability` on macOS and Linux and confirm all 180 current IDs plus future IDs are generically enforced
- [x] T038 Run every negative control in `specs/008-full-scenario-traceability/quickstart.md` in a disposable copy and verify exact failure diagnostics

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T006–T008, T010, T014, T018–T020, T023–T024, T026–T027, T029–T030 |
| FR-002 | T006–T008, T010, T014, T018–T020, T023–T024, T026–T027, T029–T030 |
| FR-003 | T002–T005, T009, T012, T016, T021, T025, T028, T031, T035 |
| FR-004 | T002–T005, T021, T022, T035, T038 |
| FR-005 | T006–T008, T010–T011, T014–T015, T018–T020, T023–T024, T026–T027, T029–T030 |
| FR-006 | T013, T017, T022, T026 |
| FR-007 | T032–T034, T038 |
| FR-008 | T006–T008, T010–T011, T014–T015, T018–T020, T023–T024, T026–T027, T029–T030, T037 |

## Dependencies and execution order

T002–T005 create the generic validator and block family enablement. The behavioral audits may then proceed family by family, but CMD depends on features 005/006, repository diagnostics depend on 004, crash recovery depends on 007, and FILE-03 depends on 005. Family enablement follows witnesses, never precedes them. Mutation checks and zero-deferral closure run only after every family is green.

## Format validation

All 38 tasks use the required checkbox and sequential ID; user-story tasks carry their story label and every task names a concrete repository path.
