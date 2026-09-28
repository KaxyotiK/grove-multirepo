# Tasks: Diagnose orphaned steal markers

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** Evidence is the green `V3DIAG-04` witness plus the full verify and isolated-install commands.

**Input**: Design documents from `specs/011-doctor-steal-marker/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Tests-first is required by the constitution and FR-008. Observe the new witnesses failing before editing production code; do not commit that red intermediate state.

## Phase 1: Setup and contract

**Purpose**: Establish the normative behaviour and traceability ID before implementation.

- [x] T001 Add the 12th-feature row for `011-doctor-steal-marker` in `specs/README.md`
- [x] T002 Add `V3DIAG-04` immediately after `V3DIAG-03` in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md`
- [x] T003 Add the aged/fresh marker diagnostic rule from `contracts/doctor-steal-marker.md` to `specs/003-git-native-grove/contracts/cli-surface-v3.md`

**Checkpoint**: The v3 contract names the exact diagnostic and executable witness obligation.

## Phase 2: User Story 1 — Doctor explains an orphaned marker (Priority: P1) 🎯 MVP

**Goal**: An aged marker appears as one stable, read-only, automatically recoverable diagnostic.

**Independent Test**: Two `doctor` audits return the same specified diagnostic ID without changing the marker or lock; the next successful acquisition recovers automatically.

### Tests for User Story 1

- [x] T004 [US1] Add the aged-marker half of a `V3DIAG-04:` built-CLI witness in `tests/cli/repository-diagnostic.test.ts`, covering exact code/severity/subject/facts, retry remedy, stable ID, read-only mtimes/content, and subsequent automatic acquisition recovery
- [x] T005 [US1] Add an aged-marker scanner witness for the discriminated finding shape in `tests/module/store.test.ts`
- [x] T006 [US1] Run `npm run build && node --test tests/module/store.test.ts tests/cli/repository-diagnostic.test.ts` before production edits and record that T004/T005 fail because `.steal` is filtered in `src/store/lock.ts`

### Implementation for User Story 1

- [x] T007 [US1] Add discriminated `stale-lock` and `orphaned-steal-marker` finding types and classify aged marker mtimes with the existing strict stale threshold in `src/store/lock.ts`
- [x] T008 [US1] Map the marker finding to the specified stable `info` diagnostic and automatic retry remedy while retaining the existing `stale-lock` projection in `src/commands/doctor.ts`

**Checkpoint**: T004/T005 pass; repeat audits are stable and read-only, and acquisition recovery is automatic.

## Phase 3: User Story 2 — A live steal is not diagnosed (Priority: P1)

**Goal**: A marker within the stale window remains invisible even beside a reclaimable lock.

**Independent Test**: A fresh marker produces zero `orphaned-steal-marker` findings and diagnostics while changing a reclaimable stale lock's remedy and identity.

### Tests and validation for User Story 2

- [x] T009 [US2] Complete `V3DIAG-04:` in `tests/cli/repository-diagnostic.test.ts` with a fresh-marker non-diagnostic assertion beside a dead same-host lock
- [x] T010 [US2] Complete the scanner witness in `tests/module/store.test.ts` with fresh-marker and `.tmp` exclusions, then run both isolated test files

**Checkpoint**: The aged boundary reports exactly one orphan while the fresh boundary reports none.

## Phase 4: Closure

**Purpose**: Prove the feature through its contract, package, and installed artifact.

- [x] T011 Run the scenarios in `specs/011-doctor-steal-marker/quickstart.md` against `dist/grove.mjs`
- [x] T012 Run `npm run typecheck && npm test && npm run scan && npm run traceability`; if a `PROC-*` test fails under shared load, rerun `tests/cli/process-scenarios.test.ts` alone and record both results
- [x] T013 Run `npm pack`, install the tarball with `npm install -g --prefix <isolated-temp-dir> <tarball>`, and run the installed `grove --version`
- [x] T014 Update `specs/011-doctor-steal-marker/spec.md` status to Implemented and create commits whose messages end with `Co-Authored-By: Codex <noreply@openai.com>`

## Phase 5: Independent-review follow-ups

**Purpose**: Make automatic recovery truthful for every acquisition path and explain the fresh marker that temporarily blocks reclaim.

- [x] T015 Amend the feature artifacts and v3 doctor contract so any successful acquisition cleans an aged marker and a fresh marker changes the blocked-reclaim remedy and identity
- [x] T016 Add red module and built-CLI witnesses for aged-marker cleanup after direct acquisition and for fresh-marker stale-lock facts, identity, and 30-second remedy
- [x] T017 Use one strict marker-age predicate for contended reclaim and direct-create post-acquisition cleanup in `src/store/lock.ts`, outside the protected re-check window
- [x] T018 Carry `stealMarker: "fresh"` on automatically reclaimable lock findings and include it in `doctor` facts and remedy selection
- [x] T019 Add injected-clock witnesses for an unreadable aged lock with a fresh marker and the exact `staleMs` / `staleMs + 1` boundary
- [x] T020 Run full verification, package creation, isolated install, and installed `grove --version`; record the independent review follow-up commit without amending `36ee9c7`

## Phase 6: Second independent-review follow-ups

**Purpose**: Protect the strict cleanup boundary, describe path-specific cleanup honestly, and make orphan remedies truthful while the associated lock is healthy.

- [x] T021 Add the direct-acquisition exact-boundary witness, prove it fails under unconditional cleanup in an isolated scratch mutation, and add the red healthy-holder CLI witness
- [x] T022 Classify orphan findings with remedy-changing `absent`, `reclaimable`, or `held` associated-lock state and project that fact into diagnostic identity and remedy selection
- [x] T023 Remove the redundant post-reclaim cleanup call and update research, plan, data model, quickstart, and v3 CLI contracts to describe direct-create and reclaim cleanup separately
- [x] T024 Reword User Story 2 scenario 1 so a fresh marker is not reported as an orphan while remaining available as a stale-lock fact
- [x] T025 Run full verification, package creation, isolated install, and installed `grove --version`; create a new follow-up commit without amending `0da81f6`

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T005, T007 |
| FR-002 | T005–T007, T009–T010, T019, T024 |
| FR-003 | T004, T008, T022 |
| FR-004 | T004, T008, T021–T022 |
| FR-005 | T004, T008, T016, T018, T021–T022 |
| FR-006 | T004, T008, T011 |
| FR-007 | T016–T017, T020–T021, T023, T025 |
| FR-008 | T002, T004–T006, T009–T010, T016, T019, T021 |
| FR-009 | T003 |
| FR-010 | T015–T019 |
| FR-011 | T021–T025 |

## Dependencies and execution order

T001–T003 establish the contract. T004–T005 add red witnesses and T006 records the required failing state. T007 → T008 makes User Story 1 green. T009–T010 complete the independently testable live marker boundary. T011–T014 close the feature.

T015 updates the reviewed contract before the follow-up implementation. T016 and T019 establish the red witnesses; T017–T018 make them green; T020 closes the follow-up only after all gates pass.

T021 establishes both round-3 proofs before production edits. T022 implements the new diagnostic fact and remedy; T023–T024 align every governing artifact; T025 closes only after all gates pass.

There are no useful implementation parallel opportunities: both stories share one scanner and one acceptance witness, and the change is intentionally smaller than coordination overhead. Contract and test edits touch separate files but remain ordered by the tests-first gate.

## Implementation strategy

The MVP is User Story 1 after the contract and red witnesses. User Story 2 is the safety boundary and must land in the same commit. The contract, tests, and production change ship atomically so every commit remains buildable and green; the red state is observed locally and never committed.

## Format validation

All 25 tasks use the required checkbox and sequential ID, user-story tasks carry their story label, and every edit task names an exact repository path.
