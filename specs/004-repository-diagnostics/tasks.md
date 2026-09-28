# Tasks: Shared repository diagnostics

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/004-repository-diagnostics/`

**Tests**: Required by FR-006 and the constitution; witnesses must fail before implementation.

## Phase 1: Contract and shared foundation

- [x] T001 Confirm §8.3/§8.4/§8.4.1 in `specs/001-grove-cli/contracts/cli-surface.md` and REPO-30/TRUNK-12/RECON-06 in `specs/001-grove-cli/contracts/acceptance-scenarios.md` remain the single normative statements
- [x] T002 Add failing problem derivation and ordering tests in `tests/module/repository-diagnostic.test.ts`
- [x] T003 Implement the typed diagnostic, empty-list health derivation, and human renderer in `src/model/repository-diagnostic.ts`

**Checkpoint**: One read-only function derives every problem kind with deterministic ordering.

## Phase 2: User Story 1 — Diagnose a repository (Priority: P1)

**Independent Test**: §11 REPO-30.

- [x] T004 [US1] Add failing `repo status` JSON/human witnesses for all five kinds and a healthy repository in `tests/cli/repository-diagnostic.test.ts`
- [x] T005 [US1] Replace command-local health/default checks with the shared diagnostic in `src/commands/repo.ts`

**Checkpoint**: `repo status` is the complete diagnostic consumer and REPO-30 passes.

## Phase 3: User Story 2 — Inspect trunks consistently (Priority: P2)

**Independent Test**: §11 TRUNK-12.

- [x] T006 [US2] Add failing cross-command identity assertions for trunk problems in `tests/cli/repository-diagnostic.test.ts`
- [x] T007 [US2] Project `trunk ls` rows and health from the shared diagnostic in `src/commands/trunk.ts`

**Checkpoint**: `trunk ls` contains no separate worktree health computation.

## Phase 4: User Story 3 — Reconcile repository drift (Priority: P2)

**Independent Test**: §11 RECON-06 and RECON-04.

- [x] T008 [US3] Add failing reconcile problem/drift/clean and repaired-state witnesses in `tests/cli/repository-diagnostic.test.ts`
- [x] T009 [US3] Integrate shared repository diagnostics into reconcile output and clean aggregation in `src/commands/reconcile.ts`

**Checkpoint**: Every shared problem makes reconcile non-clean and appears in both structured and rendered output.

## Phase 5: Closure

- [x] T010 [P] Add a regression proving `grove status` remains inventory-only in `tests/cli/repository-diagnostic.test.ts`
- [x] T011 Update help/output examples and typed-output documentation in `README.md` and `specs/001-grove-cli/spec.md`
- [x] T012 Run the runnable matrix in `specs/004-repository-diagnostics/quickstart.md`
- [x] T013 Run `npm run typecheck && npm test && npm run scan && npm run traceability`
- [x] T014 Adversarially remove each consumer integration and prove its cited scenario fails in `tests/cli/repository-diagnostic.test.ts`

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T001–T003 |
| FR-002 | T004–T005 |
| FR-003 | T006–T007 |
| FR-004 | T008–T009 |
| FR-005 | T010 |
| FR-006 | T002, T004, T006, T008, T010, T014 |

## Dependencies and strategy

T001–T003 block all stories. US1, US2, and US3 then touch separate command files and can be built independently, though US2/US3 require the shared model rather than US1's command integration. The MVP is T001–T005. Closure follows all desired stories.

## Format validation

All 14 tasks use the required checkbox, sequential ID, story label where applicable, and concrete path.
