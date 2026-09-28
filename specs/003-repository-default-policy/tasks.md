# Tasks: Repository default policy

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/003-repository-default-policy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/repository-default-policy.md](./contracts/repository-default-policy.md)

**Tests**: Required by FR-007 and the constitution. Each story's CLI witnesses must fail before its implementation tasks begin.

**Organization**: Tasks are grouped by independently testable user story. Foundational schema and resolver work blocks every story.

## Phase 1: Contract and governance setup

**Purpose**: Make §4/§8.4/§8.4.1/§11 authoritative before implementation.

- [x] T001 Update repository/default/trunk data ownership in `specs/001-grove-cli/contracts/architecture.md`, `specs/001-grove-cli/contracts/cli-surface.md`, and `specs/001-grove-cli/data-model.md`
- [x] T002 Add REPO-20…REPO-25 and TRUNK-10…TRUNK-11 to `specs/001-grove-cli/contracts/acceptance-scenarios.md` and update the constitution sync-impact record in `.specify/memory/constitution.md`

---

## Phase 2: Foundational schema and resolver

**Purpose**: Establish schema-v2 policy and one local default resolver before command stories.

**Critical**: No user-story implementation begins until this phase is green.

- [x] T003 [P] Add failing schema-v2 validation tests for `defaultBranch`, selected remote names, rejected `trunk`, and version 1 skew in `tests/module/validate.test.ts`
- [x] T004 [P] Add failing unit tests for override → cached remote HEAD → refusal, local-ref verification, and checkout-HEAD exclusion in `tests/module/repo-default.test.ts`
- [x] T005 Replace `RepositoryEntry.trunk` with nullable `defaultBranch`, bump the schema directly, and validate full repository/trunk shapes in `src/model/types.ts` and `src/config/workspace.ts`
- [x] T006 Add selected-remote/cached-HEAD helpers in `src/git/adapter.ts` and the shared typed effective-default resolver in `src/model/repo.ts`

**Checkpoint**: Schema 2 loads only the new shape and the resolver passes its isolated tests without network access.

---

## Phase 3: User Story 1 — Use the repository's real default branch (Priority: P1)

**Goal**: Managed and linked repositories resolve defaults identically and no consumer reads linked checkout HEAD.

**Independent Test**: REPO-20/REPO-21/REPO-24 fixtures prove parity, checkout-HEAD exclusion, and refusal without a local effective default.

### Tests

- [x] T007 [US1] Add failing REPO-20/REPO-21/REPO-24 CLI witnesses in `tests/cli/repository-default.test.ts`

### Implementation

- [x] T008 [US1] Change `repo add`/`repo link` to `--default-branch`, selected remote names, managed cached-HEAD seeding, and non-snapshot outputs in `src/commands/repo.ts`
- [x] T009 [US1] Route new-Grove and tree-add starting refs plus selected-remote branch adoption through repository policy in `src/commands/grove.ts` and `src/commands/tree.ts`
- [x] T010 [US1] Make Tree-context comparison bases resolve asynchronously from `defaultBase` or effective repository default in `src/model/treectx.ts`, `src/model/safety.ts`, and `src/commands/review.ts`
- [x] T011 [US1] Replace hardcoded `origin` fetch/tracking/sync behavior with the selected remote in `src/commands/repo.ts`, `src/commands/grove.ts`, `src/commands/tree.ts`, `src/commands/trunk.ts`, and `src/git/adapter.ts`
- [x] T012 [US1] Replace stored-trunk status/delete guards and inventory output with effective-default behavior in `src/commands/repo.ts`, `src/commands/trunk.ts`, and `src/commands/workspace.ts`

**Checkpoint**: Equivalent managed/linked fixtures resolve the same branch, all default consumers share one resolver, and no `repo.trunk` or hardcoded operational `origin` remains.

---

## Phase 4: User Story 2 — Override repository policy without re-registering (Priority: P1)

**Goal**: Users atomically set/clear the override and selected remote using local state only.

**Independent Test**: REPO-22/REPO-23 show successful offline policy changes, atomic invalid refusals, and use-time refusal after clearing the last default source.

### Tests

- [x] T013 [US2] Add failing REPO-22/REPO-23 CLI witnesses for configure set/clear, mutual exclusion, no-option refusal, invalid atomicity, and zero Git mutation in `tests/cli/repository-default.test.ts`

### Implementation

- [x] T014 [US2] Implement locked `repo configure --default-branch`/`--no-default-branch` and `--remote`/`--no-remote` with local-only validation in `src/commands/repo.ts`
- [x] T015 [US2] Register configure help/examples and update repo add/link/ls/status structured policy fields in `src/commands/repo.ts`

**Checkpoint**: Policy can be corrected without re-registration, invalid changes persist nothing, and configure never fetches or rewrites Git.

---

## Phase 5: User Story 3 — Understand linked worktree coupling (Priority: P2)

**Goal**: Help and successful linked trunk creation explain the one-branch/one-worktree constraint.

**Independent Test**: REPO-25/TRUNK-10/TRUNK-11 cover help, human/JSON warning parity, and removable default-branch worktrees.

### Tests

- [x] T016 [US3] Add failing REPO-25/TRUNK-10/TRUNK-11 CLI witnesses in `tests/cli/repository-default.test.ts`

### Implementation

- [x] T017 [US3] Rewrite `repo link` help to explain no auto-created trunk, shared Git administration, branch conflicts, and the `repo add` independence recommendation in `src/commands/repo.ts`
- [x] T018 [US3] Add the structured/human linked-trunk warning and remove configured-default worktree removal coupling in `src/commands/trunk.ts`

**Checkpoint**: The choice is clear before linking and at explicit trunk creation; managed output is unchanged except for the new policy vocabulary.

---

## Phase 6: Integration and closure

**Purpose**: Remove superseded vocabulary, update all fixtures/docs, and run every gate.

- [x] T019 Update remaining tests, fixtures, help expectations, README examples, and completion assertions from stored `trunk`/remote URL to `defaultBranch`/selected remote in `tests/`, `README.md`, and `src/`
- [x] T020 Update `docs/BACKLOG.md`, `docs/design-decisions-20260819.md`, and `docs/decisions-and-tasks-20260820.md` only after P0-8 scenarios are green
- [x] T021 Run the runnable validations in `specs/003-repository-default-policy/quickstart.md` and correct any contract drift
- [x] T022 Run `npm run typecheck && npm test && npm run scan` and `bash scripts/scenario-traceability.sh`

---

## Phase 7: Adversarial review and remediation

**Purpose**: Challenge the implementation and its declared coverage after the pre-review checkpoint.

- [x] T023 Add non-vacuous witnesses for structured registration policy output, invalid-override parity, explicit branch adoption without a default, selected non-`origin` remotes, unresolved policy during unrelated deletion, managed warning absence, and forced branch discard reporting in `tests/cli/repository-default.test.ts` and `tests/cli/audit-fixes.test.ts`
- [x] T024 Harden schema-v2 loading for repository/remote/branch grammar, canonical linked paths, and non-escaping trunk directories in `src/config/workspace.ts` and `tests/module/validate.test.ts`
- [x] T025 Correct registration, branch adoption/deletion, linked-warning, and discard-report output behavior in `src/commands/repo.ts`, `src/commands/grove.ts`, `src/commands/tree.ts`, and `src/commands/trunk.ts`
- [x] T026 Remove duplicated/superseded contract statements, add REPO-26…REPO-29 and TREE-24 traceability, and rerun every project gate

---

## Dependencies & execution order

### Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T001, T003, T005, T019, T024 |
| FR-002 | T004, T006, T007, T012, T023, T025 |
| FR-003 | T008–T012, T023, T025 |
| FR-004 | T013–T015 |
| FR-005 | T016–T018, T023, T025 |
| FR-006 | T003, T005, T019 |
| FR-007 | T002–T004, T007, T013, T016, T021–T023, T026 |

### Phase dependencies

- Phase 1 establishes authority and must complete first.
- Phase 2 depends on Phase 1 and blocks all user stories.
- US1 depends on Phase 2 because registration and consumers require the new shape/resolver.
- US2 depends on Phase 2 and may be implemented after US1 stabilizes shared repo output.
- US3 depends on Phase 2; its `trunk.ts` changes run after US1 to avoid same-file overlap.
- Integration depends on all three stories.

### Tests-first order

1. T003/T004 fail, then T005/T006 make them pass.
2. T007 fails, then T008–T012 make US1 pass.
3. T013 fails, then T014/T015 make US2 pass.
4. T016 fails, then T017/T018 make US3 pass.
5. T019–T022 close drift and run the full gates.
6. T023–T026 adversarially challenge the checkpoint, remediate findings, and rerun the gates.

### Parallel opportunities

- T003 and T004 touch separate new/existing test files and can run in parallel.
- T001 and T002 touch separate contract/governance files but are kept sequential for authority review.
- User stories are conceptually independent after Phase 2, but US1/US2/US3 all touch `repo.ts` or `trunk.ts`; execute them sequentially in this single workspace.

## Implementation strategy

The MVP is US1: eliminate checkout-HEAD derivation and the stored snapshot. US2 makes the new model usable for remote-less/multi-remote repositories. US3 makes linked coupling visible. Do not ship a partial schema in which any consumer still reads `repo.trunk` or hardcodes `origin`.

## Format validation

All 26 tasks use the required checkbox, sequential ID, optional `[P]`, story label where applicable, concrete action, and file path format.
