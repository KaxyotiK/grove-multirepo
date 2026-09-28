# Feature Specification: Shared repository diagnostics

**Feature Branch**: `002-work-safety-force`

**Feature Directory**: `004-repository-diagnostics`

**Created**: 2026-08-20

**Status**: Implemented

**Input**: User description: "Make repository health concrete and consistent across repo status, trunk ls, and reconcile; keep grove status as inventory."

**Authority**: §8.3, §8.4, §8.4.1, and §11 REPO-30, TRUNK-12, RECON-06.

**Decision record**: `docs/decisions-and-tasks-20260820.md` D6.

## Why this feature exists

The three diagnostic surfaces currently answer overlapping questions with separate checks. That allows a recorded trunk to be missing or on the wrong branch while one command reports healthy and another reports clean. Users need one actionable answer, not a broad health ontology.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Diagnose a repository once (Priority: P1)

An engineer can inspect a repository and receive a complete, typed list of concrete problems.

**Why this priority**: The shared result is the authority consumed by every other story.

**Independent Test**: Exercise §11 REPO-30 and verify each concrete state produces exactly its contracted problem kind while a healthy repository produces none.

**Normative acceptance**: §11 REPO-30.

---

### User Story 2 - Inspect trunks consistently (Priority: P2)

An engineer listing trunks sees the trunk-related portion of the same repository diagnosis.

**Why this priority**: Trunk operators should not have to reconcile conflicting status commands.

**Independent Test**: Exercise §11 TRUNK-12 and compare its typed problems with REPO-30 output.

**Normative acceptance**: §11 TRUNK-12.

---

### User Story 3 - Reconcile all repository drift (Priority: P2)

An engineer running reconcile sees every repository/trunk inconsistency and never receives a clean result while one exists.

**Why this priority**: Reconcile is the workspace-wide drift authority and must consume, not clone, the repository diagnostic.

**Independent Test**: Exercise §11 RECON-06 for every problem kind and after repairing each state.

**Normative acceptance**: §11 RECON-06 and RECON-04.

### Edge Cases

The owning edge behavior is defined once in §8.4 and §11 REPO-30/TRUNK-12/RECON-06. Diagnostics are read-only and network-free; an unreadable object store or trunk is reported, never guessed healthy.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Implement the single repository diagnostic defined by §8.4.
- **FR-002**: Make `repo status` expose the complete result under §8.4 and REPO-30.
- **FR-003**: Make `trunk ls` expose the trunk subset under §8.4.1 and TRUNK-12.
- **FR-004**: Make `reconcile` consume the result under §8.3 and RECON-06.
- **FR-005**: Preserve `grove status` as inventory with no health judgment.
- **FR-006**: Add failing scenario-ID witnesses before changing implementation.

### Key Entities

The derived diagnostic entities and fields are normative in §8.4. No new persistent state exists.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **004-repository-diagnostics-SC-001**: All five contracted problem kinds are reproduced by tests and agree across every consumer to which they apply.
- **004-repository-diagnostics-SC-002**: Zero tested inconsistent repositories produce `healthy:true` or `clean:true`.
- **004-repository-diagnostics-SC-003**: A repaired repository removes the problem from all consumers on the next invocation.
- **004-repository-diagnostics-SC-004**: All diagnostics complete without network access or workspace mutation.
- **004-repository-diagnostics-SC-005**: Typecheck, all test layers, scan, and scenario traceability pass.

## Assumptions

- Diagnostic commands continue to exit `0` when they successfully report unhealthy state.
- Human strings are renderings of typed problems, never an independent diagnostic source.
- No `ok | degraded | unusable` aggregate is introduced.
