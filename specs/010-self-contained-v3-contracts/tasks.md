# Tasks: Self-contained v3 contracts

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** Evidence is the green citations gate plus the full verify command.

**Input**: Design documents from `specs/010-self-contained-v3-contracts/`

**Tests**: Required by FR-004; the gate is observed failing on the current contracts first.

## Phase 1: Failing gate

- [x] T001 [US2] Add a test to `tests/module/citations.test.ts` failing any line in `specs/003-git-native-grove/contracts/*.md` that matches `\bproposal\b` without `historical|not normative|void|no longer`, and observe it fail on the current `config-v3.md`, `cli-surface-v3.md`, and `json-results-v1.md`

## Phase 2: User Story 1 — Contracts state their own rules (Priority: P1)

- [x] T002 [P] [US1] In `specs/003-git-native-grove/contracts/config-v3.md`, replace the "Normative source" line, state the config shape and key sets, layout tokens and template rules, naming tokens and bounds, Grove metadata and archive-snapshot shape, and metadata-free Groves, per research R1–R2
- [x] T003 [P] [US1] In `specs/003-git-native-grove/contracts/cli-surface-v3.md`, replace the two proposal-dependent lines with the shipped creation/recovery grammar and selection rules, the creation matrix, remote-only lookup, revision semantics, `--forget-settings`, `reconcile` modes, and `sync`/`fix` selection, per research R2; record any proposal-vs-shipped difference no ruling or witness settles in `specs/010-self-contained-v3-contracts/spec.md` under Open Questions instead of resolving it
- [x] T004 [P] [US1] In `specs/003-git-native-grove/contracts/json-results-v1.md`, replace the "Normative source" line and the proposal references with the stated interface origin and the full stable reason vocabulary, and correct the exit-3 row to "strict policy or blocking diagnostics" (`V3DIAG-02`)

**Checkpoint**: T001's gate passes; every grammar line matches shipped `--help`.

## Phase 3: User Story 3 — Delete the proposal (Priority: P2)

- [x] T005 [US3] Delete `docs/git-native-grove-proposal.md` (and the empty `docs/`), add it to the removed-documents list in `specs/README.md`, and change `specs/README.md`'s "historical input" sentence to a pointer into the private development history

## Phase 4: Closure

- [x] T006 Run `specs/010-self-contained-v3-contracts/quickstart.md`, including the negative control in step 3
- [x] T007 Run `npm run typecheck && npm test && npm run scan && npm run traceability`, `npm pack` plus an isolated `--prefix` install and `grove --version`, and confirm `git diff --stat -- src` is empty

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T002 |
| FR-002 | T003 |
| FR-003 | T004 |
| FR-004 | T001, T006 |
| FR-005 | T007 |
| FR-006 | T005 |

## Dependencies and strategy

T001 is observed failing locally, then T002–T004 (separate files) make it pass; T001–T004 land as one commit so no commit carries a failing gate. T005 follows. The feature ships atomically.

## Format validation

All 7 tasks use the required checkbox, sequential ID, story label where applicable, and concrete path.
