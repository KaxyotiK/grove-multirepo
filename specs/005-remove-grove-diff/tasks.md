# Tasks: Remove Grove diff

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/005-remove-grove-diff/`

**Tests**: Required by FR-006 and the constitution; removal witnesses fail before code removal.

## Phase 1: Contract and failing witnesses

- [x] T001 Confirm §8.1/§8.7 in `specs/001-grove-cli/contracts/cli-surface.md` and CMD-15/FILE-03/E2E-01 in `specs/001-grove-cli/contracts/acceptance-scenarios.md` are authoritative
- [x] T002 [P] Add failing CMD-15 help/completion/dispatch assertions in `tests/module/dispatch-audit.test.ts` and `tests/cli/review.test.ts`
- [x] T003 [P] Replace the old diff behavior test with failing FILE-03 human/JSON unknown-command witnesses in `tests/cli/review.test.ts`

## Phase 2: User Story 1 — Honest command surface (Priority: P1)

**Independent Test**: §11 CMD-15 and FILE-03.

- [x] T004 [US1] Remove the diff handler, registration, and now-unused imports from `src/commands/review.ts`
- [x] T005 [US1] Remove diff arity/registration expectations while retaining command drift checks in `tests/module/arity.test.ts` and `tests/module/dispatch-audit.test.ts`
- [x] T006 [US1] Remove the obsolete corrupt-diff regression or convert its underlying missing-worktree assertion to a retained review command in `tests/cli/audit-fixes.test.ts`

**Checkpoint**: Registry-generated help/completion and dispatch all agree the command is absent.

## Phase 3: User Story 2 — Preserve aggregate review (Priority: P1)

**Independent Test**: §11 FILE-04, FILE-06, and E2E-01.

- [x] T007 [US2] Strengthen retained multi-repository attribution/base regressions in `tests/cli/review.test.ts`
- [x] T008 [US2] Update the built-artifact golden path to the contracted review sequence in `tests/e2e/golden-path.test.ts`
- [x] T009 [US2] Remove any newly unused diff-only helper after a repository-wide caller check in `src/git/worktree.ts`

**Checkpoint**: Aggregate review remains green and the built artifact contains no dormant handler.

## Phase 4: Documentation and closure

- [x] T010 Update public examples and command inventories in `README.md` and `specs/001-grove-cli/spec.md`
- [x] T011 Run `specs/005-remove-grove-diff/quickstart.md` and scan `src/`, `tests/`, `README.md`, and current specs for stale public references
- [x] T012 Run `npm run typecheck && npm test && npm run scan && npm run traceability`
- [x] T013 Reintroduce the registration temporarily and prove CMD-15/FILE-03 fail before finalizing the removal tests in `tests/cli/review.test.ts`

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T001–T006 |
| FR-002 | T007–T009 |
| FR-003 | T002–T003, T006, T010–T011 |
| FR-004 | T004, T009, T011 |
| FR-005 | T002, T005, T008, T010 |
| FR-006 | T002–T003, T007–T008, T013 |

## Dependencies and strategy

T001–T003 establish red witnesses. US1 removal and US2 preservation can then proceed in the same module with T004 before T009; test/doc tasks on separate files can run in parallel. The complete feature is small enough to ship atomically—there is no useful partial removal.

## Format validation

All 13 tasks use the required checkbox, sequential ID, story label where applicable, and concrete path.
