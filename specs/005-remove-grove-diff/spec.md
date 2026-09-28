# Feature Specification: Remove Grove diff

**Feature Branch**: `002-work-safety-force`

**Feature Directory**: `005-remove-grove-diff`

**Created**: 2026-08-20

**Status**: Implemented

**Input**: User description: "Remove grove diff; use standard Git commands for per-file patches and keep Grove's aggregate review commands."

**Authority**: §8.1, §8.7, and §11 CMD-15, FILE-03, FILE-04, E2E-01.

**Decision record**: `docs/decisions-and-tasks-20260820.md` D7.

## Why this feature exists

The current single-file command duplicates only one narrow Git diff mode and suggests Grove owns a general patch surface when it does not. Git already handles working-tree, staged, committed, and arbitrary-ref patches. Grove earns its review surface where it aggregates across repositories.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Use the honest command surface (Priority: P1)

An engineer sees only the review commands Grove actually owns and receives a precise unknown-command error for the removed surface.

**Why this priority**: Help, completion, and dispatch must agree before code is considered removed.

**Independent Test**: Exercise §11 CMD-15 and FILE-03 in human and structured modes.

**Normative acceptance**: §11 CMD-15 and FILE-03.

---

### User Story 2 - Keep multi-repository review (Priority: P1)

An engineer continues using aggregate changes, commits, and against-trunk results across Trees.

**Why this priority**: Removing the redundant command must not shrink Grove's differentiated value.

**Independent Test**: Exercise §11 FILE-04, FILE-06, and E2E-01 before and after removal.

**Normative acceptance**: §11 FILE-04, FILE-06, and E2E-01.

### Edge Cases

§8.7 and §11 FILE-03 own removed-command behavior. No alias, hidden compatibility route, replacement flag, or legacy handler remains.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Remove `grove diff` from dispatch, help, completion, and implementation under §8.1/§8.7.
- **FR-002**: Preserve `changes`, `commits`, and `against-trunk` behavior under §8.7.
- **FR-003**: Remove tests and documentation that advertise the old behavior; replace them with CMD-15/FILE-03 removal witnesses.
- **FR-004**: Remove now-unused code only after proving no remaining consumer exists.
- **FR-005**: Update E2E-01 and all generated/public command inventories.
- **FR-006**: Add failing removal witnesses before implementation changes.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **005-remove-grove-diff-SC-001**: Zero public help, completion, README, contract, or registered-command entries advertise `grove diff`.
- **005-remove-grove-diff-SC-002**: Human and JSON invocations of the removed command exit `2` through the standard unknown-command envelope.
- **005-remove-grove-diff-SC-003**: All FILE-04/FILE-06 aggregate review behavior remains unchanged.
- **005-remove-grove-diff-SC-004**: The built artifact and package contain no unreachable diff handler.
- **005-remove-grove-diff-SC-005**: Typecheck, all test layers, scan, and traceability pass.

## Assumptions

- Git is invoked by users from the Tree worktree for patch display.
- This removal is pre-adoption and needs no compatibility alias or deprecation period.
- `file read` remains the Grove surface for contained file content.
