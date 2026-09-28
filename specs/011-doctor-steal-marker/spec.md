# Feature Specification: Diagnose orphaned steal markers

**Feature Branch**: `fix/doctor-steal-marker`

**Feature Directory**: `011-doctor-steal-marker`

**Created**: 2026-09-23

**Status**: Implemented

**Input**: User description: "Make `grove doctor` report an orphaned lock-reclamation `.steal` marker without reporting a steal that is still in progress."

**Authority**: §6 and §8.4; `specs/003-git-native-grove/contracts/` `cli-surface-v3.md`, `json-results-v1.md`, and `acceptance-scenarios-v3.md`.

## Why this feature exists

Lock reclamation creates an exclusive `<lock>.steal` intent marker and normally removes it when the reclaim attempt finishes. An uncatchable process termination can leave that marker behind. Lock acquisition bounds contention on the marker while reclaiming a stale lock, but previously left an aged marker untouched when it acquired a missing lock directly. The read-only command intended to explain workspace health also filtered every marker out. A user could therefore see a permanent diagnostic after a successful mutation, or a misleading retry remedy while a fresh marker still blocked stale-lock reclaim.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Doctor explains an orphaned steal marker (Priority: P1)

A user auditing a workspace sees the orphaned marker as its own stable diagnostic and learns that the next successful acquisition of that lock removes it automatically.

**Why this priority**: This is the missing observation that makes an otherwise bounded lock refusal mysterious.

**Independent Test**: Put an aged `.steal` marker beside a stale lock, run `grove doctor` twice, and observe one `orphaned-steal-marker` diagnostic with the same ID, automatic-recovery facts, and a retry remedy both times; the audit leaves both files unchanged.

**Acceptance Scenarios**:

1. **Given** a `.steal` marker older than the lock stale window, **When** `grove doctor` audits the workspace, **Then** it reports one `info` diagnostic whose subject names the marker, whose facts name the associated lock and automatic recovery, and whose remedy tells the user to retry the intended mutation.
2. **Given** unchanged marker and lock facts, **When** `grove doctor` repeats the audit, **Then** the diagnostic ID is unchanged and neither file has been removed or rewritten.
3. **Given** the orphaned marker beside a missing, healthy, or stale lock, **When** a mutation next acquires that lock by any successful path, **Then** lock acquisition removes the aged marker before returning; manual deletion is not prescribed.

---

### User Story 2 - A live steal is not diagnosed as orphaned (Priority: P1)

A user running `doctor` while another process is actively reclaiming a lock does not receive a false orphan warning.

**Why this priority**: The marker is mutual-exclusion state. Calling an active marker orphaned would make a safe concurrent operation look broken and invite unsafe manual interference.

**Independent Test**: Put a fresh `.steal` marker beside a reclaimable lock and confirm `doctor` does not return `orphaned-steal-marker`.

**Acceptance Scenarios**:

1. **Given** a `.steal` marker whose age is within the stale window, **When** `grove doctor` audits the workspace, **Then** it does not report the marker as orphaned, even when the associated lock holder is dead, frozen, unreadable, or absent.
2. **Given** a fresh marker beside a same-host automatically reclaimable lock, **When** `grove doctor` audits the workspace, **Then** the `stale-lock` diagnostic identifies the fresh marker as a remedy-changing fact and says another reclaim is in progress or was interrupted and to retry after the 30-second stale window.

### Edge Cases

- Marker contents are an internal contention token, not a holder record: they carry no host, process-start identity, or heartbeat. A PID-like token MUST NOT be used to infer that its creator is dead; a fresh marker fails closed as an in-progress steal.
- A readable or unreadable marker becomes orphaned only after its own modification time exceeds the stale window. This mirrors the aged-unreadable lock rule and the acquisition rule that makes the marker automatically reclaimable.
- The associated lock may be missing, readable, or unreadable. Marker classification depends on marker age, and every successful acquisition removes an aged marker before returning, so the audit and acquisition agree about automatic recovery.
- A marker aged exactly `staleMs` remains fresh; it becomes orphaned only at `staleMs + 1` or later.
- A fresh marker beside an aged unreadable lock is not orphaned, but it is carried on the automatic stale-lock finding because it can delay the advertised recovery.
- Temporary lock files remain excluded from this diagnostic.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The lock audit MUST return aged `.steal` markers separately from ordinary stale lock files, including marker filename, associated lock filename, a stable reason, and recovery class.
- **FR-002**: A `.steal` marker MUST count as orphaned only when its modification time is older than the configured stale window. A fresh marker MUST NOT be reported as orphaned, regardless of marker contents or the associated lock state.
- **FR-003**: `doctor` MUST emit code `orphaned-steal-marker`, severity `info`, subject `{ kind: "lock-steal-marker", path: <marker filename> }`, and facts `{ lock: <associated lock filename>, lockState: "absent" | "reclaimable" | "held", reason: <stable classification>, recovery: "automatic" }`.
- **FR-004**: The diagnostic summary and remedy MUST state that cleanup occurs on the next successful acquisition. For `held`, the remedy MUST first tell the user to wait for or resolve the associated lock holder; otherwise it MUST tell the user to retry the intended mutation. It MUST NOT instruct manual marker removal.
- **FR-005**: The diagnostic identity MUST be stable for unchanged remedy-relevant facts. Marker age, observation time, and other volatile presentation facts MUST NOT enter its subject or facts.
- **FR-006**: The audit MUST remain read-only. It MUST NOT remove or rewrite a marker or lock.
- **FR-007**: Direct lock creation MUST remove a pre-existing `.steal` marker only when its age is strictly greater than `staleMs`. Stale-lock reclaim MUST apply that same predicate while contending for a pre-existing marker, and MUST remove its own newly created marker in `finally`.
- **FR-008**: Add `V3DIAG-04` after `V3DIAG-03` in the v3 acceptance scenarios and add an executable witness whose title starts `V3DIAG-04:`. The witness MUST fail before the production change and cover both an aged orphan and a fresh in-progress marker.
- **FR-009**: Amend only the v3 CLI contract where the new diagnostic is stated; do not change the stable v2 citation authority.
- **FR-010**: An automatically reclaimable same-host `stale-lock` finding with a fresh adjacent marker MUST carry `stealMarker: "fresh"`; `doctor` MUST include that fact in diagnostic identity and state that another reclaim is in progress or was interrupted and retry succeeds after the 30-second stale window.
- **FR-011**: An orphan finding MUST classify the associated lock as `absent`, `reclaimable`, or `held`. That stable remedy-changing fact MUST enter diagnostic identity; a transition between held and absent MUST change the ID without changing marker age facts.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **011-doctor-steal-marker-SC-001**: An aged marker produces exactly one `orphaned-steal-marker` diagnostic with severity `info`, automatic recovery, and the specified subject and facts in 100% of repeated unchanged audits.
- **011-doctor-steal-marker-SC-002**: Two unchanged audits produce the same diagnostic ID and zero marker or lock mutations.
- **011-doctor-steal-marker-SC-003**: A marker at or within the stale window produces zero `orphaned-steal-marker` diagnostics, including beside a dead or unreadable lock.
- **011-doctor-steal-marker-SC-004**: The `V3DIAG-04` witness, typecheck, all test layers, scan, traceability, package creation, isolated install, and installed `grove --version` all pass.
- **011-doctor-steal-marker-SC-005**: An aged marker with no associated lock is absent after one successful mutation, and the next `doctor` audit reports no orphan for it.
- **011-doctor-steal-marker-SC-006**: A fresh marker beside a reclaimable same-host lock changes the `stale-lock` diagnostic identity and yields the 30-second wait remedy in every audit.
- **011-doctor-steal-marker-SC-007**: Direct acquisition preserves markers aged exactly `staleMs` and `staleMs - 1`, while still removing one aged `staleMs + 1`.
- **011-doctor-steal-marker-SC-008**: An aged marker beside a healthy holder produces a held-state wait remedy and a different diagnostic ID from the same marker after that lock becomes absent.

## Assumptions

- A marker older than the existing 30-second default stale window cannot be a healthy steal: the protected reclaim section contains only bounded local filesystem operations and does not carry a heartbeat. This is the same threshold acquisition already uses to remove a contended marker.
- Automatic recovery means the next successful acquisition of the associated lock removes the aged marker before returning, including direct creation when the lock file was missing.
- The marker token is deliberately not promoted to a public record shape. Its current PID-like spelling is insufficient to adjudicate process identity safely, especially across hosts or PID reuse.
