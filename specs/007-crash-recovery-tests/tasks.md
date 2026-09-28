# Tasks: Crash recovery witnesses

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/007-crash-recovery-tests/`

**Tests**: This feature is test infrastructure; every task exists to produce non-vacuous witnesses.

## Phase 1: Foundation

- [x] T001 Confirm §6.1/§8.3/§8.5 and ARCH-07/ARCH-11 remain authoritative in `specs/001-grove-cli/contracts/safety.md`, `specs/001-grove-cli/contracts/cli-surface.md`, and `specs/001-grove-cli/contracts/acceptance-scenarios.md`
- [x] T002 Implement exact-argv Git delegation, post-mutation sentinel, bounded wait, and cleanup in `tests/testkit/git-fault.ts`
- [x] T003 Add unit tests for match/non-match delegation, timeout, and process-group cleanup in `tests/module/git-fault.test.ts`

**Checkpoint**: The harness cannot report a boundary it did not reach and leaves no child behind.

## Phase 2: User Story 1 — Interrupted archive (Priority: P1)

**Independent Test**: §11 ARCH-07.

- [x] T004 [US1] Add the failing multi-Tree archive kill-window witness in `tests/e2e/crash-recovery.test.ts`
- [x] T005 [US1] Assert journal intent, completed Git effect, retained loose files/refs, reconcile outcome, and cleanup in `tests/e2e/crash-recovery.test.ts`
- [x] T006 [US1] Fix the shared recovery lock defect exposed by ARCH-07 in `src/commands/reconcile.ts` without weakening the witness

## Phase 3: User Story 2 — Interrupted restore (Priority: P1)

**Independent Test**: §11 ARCH-11.

- [x] T007 [US2] Add the failing multi-Tree restore kill-window witness in `tests/e2e/crash-recovery.test.ts`
- [x] T008 [US2] Assert journal intent, completed Git effect, one lifecycle location, exact Tree branches/paths, reconcile outcome, and cleanup in `tests/e2e/crash-recovery.test.ts`
- [x] T009 [US2] Verify the shared `reconcile` lock fix also closes the ARCH-11 recovery defect without weakening the witness

## Phase 4: User Story 3 — Harness trust (Priority: P2)

**Independent Test**: Ten-run soak and artifact hook absence.

- [x] T010 [US3] Add ten-run soak and missed-boundary negative controls in `tests/e2e/crash-recovery.test.ts`
- [x] T011 [US3] Add a production-hook exclusion assertion to `scripts/legacy-scan.sh`

## Phase 5: Closure

- [x] T012 Remove ARCH-07 and ARCH-11 from `DEFERRED` in `scripts/scenario-traceability.sh`
- [x] T013 Update deferred-count documentation in `specs/001-grove-cli/contracts/README.md`, `docs/BACKLOG.md`, and `docs/decisions-and-tasks-20260820.md`
- [x] T014 Run `specs/007-crash-recovery-tests/quickstart.md` and the ten-run soak
- [x] T015 Run `npm run typecheck && npm test && npm run scan && npm run traceability`
- [x] T016 Temporarily move the kill before the real Git mutation and prove ARCH-07/ARCH-11 fail their non-vacuity assertions in `tests/e2e/crash-recovery.test.ts`

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T002–T003, T011 |
| FR-002 | T004–T006 |
| FR-003 | T007–T009 |
| FR-004 | T002, T004–T005, T007–T008, T016 |
| FR-005 | T005–T006, T008–T009 |
| FR-006 | T002–T003, T010 |
| FR-007 | T012–T015 |

## Dependencies and strategy

T001–T003 block both recovery stories. ARCH-07 and ARCH-11 may then be implemented independently in the same E2E file sequentially. Product fixes T006/T009 are conditional but explicit: a failing live witness is fixed, never reclassified. Deferral removal is last.

## Format validation

All 16 tasks use the required checkbox, sequential ID, story label where applicable, and concrete path.
