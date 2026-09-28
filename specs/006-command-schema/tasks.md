# Tasks: Central command schemas

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/006-command-schema/`

**Tests**: Required by FR-007 and the constitution; parity and drift gates precede migration.

## Phase 1: Contract and red gates

- [x] T001 Confirm §8.1 in `specs/001-grove-cli/contracts/cli-surface.md` and CMD-16 in `specs/001-grove-cli/contracts/acceptance-scenarios.md` are authoritative
- [x] T002 [P] Add failing schema/usage/help drift cases for CMD-16 in `tests/module/dispatch-audit.test.ts` and `tests/module/arity.test.ts`
- [x] T003 [P] Expand trailing-global, option-value, repeated-option, and extras parity cases in `tests/module/globals.test.ts` and `tests/cli/regressions.test.ts`

## Phase 2: Shared foundation

- [x] T004 Add option/positional/extras schema fields and validation to `CommandSpec` in `src/commands/registry.ts`
- [x] T005 Make global scanning and `parseCommand` consume `ctx.spec` schema while retaining a temporary migration bridge in `src/commands/globals.ts` and `src/commands/args.ts`
- [x] T006 Add shared parsed-value narrowing helpers and tests in `src/commands/args.ts` and `tests/module/arity.test.ts`

**Checkpoint**: Old and new definitions have parity; the drift gate fails mismatches.

## Phase 3: User Story 1 — Consistent runtime behavior (Priority: P1)

**Independent Test**: §11 CMD-02…CMD-06 and CMD-16.

- [x] T007 [P] [US1] Migrate workspace/init/reconcile command schemas in `src/commands/workspace.ts`, `src/commands/init.ts`, and `src/commands/reconcile.ts`
- [x] T008 [P] [US1] Migrate review/file command schemas in `src/commands/review.ts` and `src/commands/files.ts`
- [x] T009 [US1] Migrate Grove/lifecycle/tree command schemas in `src/commands/grove.ts`, `src/commands/lifecycle.ts`, and `src/commands/tree.ts`
- [x] T010 [US1] Migrate repository/trunk command schemas in `src/commands/repo.ts` and `src/commands/trunk.ts`
- [x] T011 [US1] Migrate agent schemas including forwarded extras in `src/commands/agent.ts`
- [x] T012 [US1] Remove the temporary handler-schema bridge and fail any remaining duplicate schema at compile/scan time in `src/commands/args.ts` and `scripts/legacy-scan.sh`

**Checkpoint**: Every command parses exclusively from its registry definition with parity green.

## Phase 4: User Story 2 — Trust help and completion (Priority: P1)

**Independent Test**: §11 CMD-01, CMD-09, and CMD-16.

- [x] T013 [US2] Validate registry help entries and usage option/positionals against schemas in `tests/module/dispatch-audit.test.ts`
- [x] T014 [US2] Prove generated bash/zsh/fish completion preserves every schema option in `tests/cli/trunk-repo.test.ts`
- [x] T015 [US2] Update registry/parser documentation to state schema ownership in `src/commands/registry.ts`, `src/commands/args.ts`, and `docs/help-authoring-context.md`

## Phase 5: Closure

- [x] T016 Run `specs/006-command-schema/quickstart.md` including deliberate mismatch failures
- [x] T017 Run `npm run typecheck && npm test && npm run scan && npm run traceability`
- [x] T018 Adversarially reintroduce one handler-local schema and one usage mismatch and prove CMD-16/PROC-07 fail in `tests/module/dispatch-audit.test.ts` and `scripts/legacy-scan.sh`

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T001, T004–T012 |
| FR-002 | T005, T007–T012 |
| FR-003 | T004–T005, T007–T012 |
| FR-004 | T002, T013 |
| FR-005 | T003, T007–T015 |
| FR-006 | T012–T014, T017–T018 |
| FR-007 | T002–T003, T018 |

## Dependencies and strategy

T001–T006 block migration. T007/T008 can run in parallel; T009–T011 are sequenced to avoid shared type churn. T012 closes the bridge only after all families migrate. US2 validation follows the final shape. The MVP is the complete migration—partial dual authority must not ship.

## Format validation

All 18 tasks use the required checkbox, sequential ID, story label where applicable, and concrete path.
