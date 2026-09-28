# Feature Specification: Crash recovery witnesses

**Feature Branch**: `002-work-safety-force`

**Feature Directory**: `007-crash-recovery-tests`

**Created**: 2026-08-20

**Status**: Implemented

**Input**: User description: "Add real deterministic kill-mid-archive and kill-mid-restore witnesses so deferred recovery scenarios can gate the build."

**Authority**: §6.1, §8.3, §8.5, and §11 ARCH-07, ARCH-11.

**Finding record**: `docs/BACKLOG.md` traceability debt and `docs/reviews/adversarial-002-work-safety.md`.

**Review record**: `docs/reviews/adversarial-007-crash-recovery.md`.

## Why this feature exists

Archive and restore recovery are claimed by normative scenarios but lack live interruption tests. Unit tests exercise journal functions; they do not prove the built CLI leaves a recoverable journal when its process dies inside a real Git mutation.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Recover interrupted archive (Priority: P1)

An engineer can trust that a process death during archive leaves state a single reconcile can make consistent without losing retained files or refs.

**Why this priority**: Archive teardown is a destructive crash window over multiple worktrees.

**Independent Test**: Kill the built CLI at the deterministic ARCH-07 Git boundary, run reconcile, and verify one consistent lifecycle state with no live lock or unfinished journal.

**Normative acceptance**: §11 ARCH-07.

---

### User Story 2 - Recover interrupted restore (Priority: P1)

An engineer can trust that a process death during restore does not leave split active/archive state or partially materialized worktrees after reconcile.

**Why this priority**: Restore crosses both directory and Git worktree state.

**Independent Test**: Kill the built CLI at the deterministic ARCH-11 Git boundary, run reconcile, and verify one consistent lifecycle state.

**Normative acceptance**: §11 ARCH-11.

---

### User Story 3 - Trust the interruption harness (Priority: P2)

A maintainer can prove the witness reaches the intended post-mutation/pre-acknowledgement window and leaves no orphaned proxy or CLI process.

**Why this priority**: A kill test that misses its window is theatre.

**Independent Test**: Make the proxy signal before and after the real Git mutation; assert the parent kills the process group only after the post-mutation signal and times out precisely otherwise.

**Normative acceptance**: §6.1 ordering as exercised by ARCH-07 and ARCH-11.

### Edge Cases

The owning contracts define recovery outcomes. The harness must cover multiple Trees, preserve loose Grove files, use only local fixture repositories, and clean up on success, assertion failure, and timeout.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Add a deterministic test-only Git boundary without changing the production artifact.
- **FR-002**: Exercise ARCH-07 against the built CLI and real filesystem/Git state.
- **FR-003**: Exercise ARCH-11 against the built CLI and real filesystem/Git state.
- **FR-004**: Prove the process is killed after the targeted Git mutation completes but before the CLI acknowledges it.
- **FR-005**: Prove reconcile clears or finishes the journal and leaves exactly one consistent state.
- **FR-006**: Guarantee subprocess/proxy cleanup under every test outcome.
- **FR-007**: Remove ARCH-07/ARCH-11 from traceability deferral only after their witnesses pass.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **007-crash-recovery-tests-SC-001**: ARCH-07 and ARCH-11 each have a built-artifact witness that fails if the kill window is not reached.
- **007-crash-recovery-tests-SC-002**: Each witness proves zero unfinished journals, live locks, or orphaned test processes after reconcile.
- **007-crash-recovery-tests-SC-003**: Repeating each witness at least ten times produces no timing-dependent failure.
- **007-crash-recovery-tests-SC-004**: The production bundle contains no fault-injection flag, environment read, or test hook.
- **007-crash-recovery-tests-SC-005**: Full tests, scan, and traceability pass with two fewer deferred scenarios.

## Assumptions

- CI platforms support POSIX process groups and signals; Windows remains unsupported.
- Fixture-controlled `PATH` is test input, not Grove workspace-selection state.
- Recovery may roll back or finish only as specified by the journal mode; tests assert consistency, not an invented direction.
