# Research: Shared repository diagnostics

## R1 — One concrete problem list

**Decision:** Use the five problem kinds defined in §8.4. `healthy` is exactly `problems.length === 0`.

**Rationale:** These are observable failures users can repair. A multidimensional or severity ontology adds policy without solving disagreement.

**Alternatives considered:** Separate command-specific booleans (current defect); integrity / operability / syncability dimensions (rejected by D6).

## R2 — Consumer projections

**Decision:** `repo status` returns the full result; `trunk ls` projects recorded trunks and their trunk-related problems; `reconcile` returns `repositoryProblems` and renders them into `drift`.

**Rationale:** This preserves each command's purpose while keeping diagnosis single-sourced.

**Alternatives considered:** Replace reconcile's string drift shape (unnecessary wider break); make reconcile the sole authority and reduce repo status (contradicts the repository status contract).

## R3 — Exit and mutation behavior

**Decision:** Successfully reporting problems exits `0`; diagnostics never fetch or mutate.

**Rationale:** These commands report state. A nonzero exit is reserved for inability to execute the command under §9, not the state being reported.

## R4 — Cascading failures

**Decision:** Emit every independently observable problem. An unreadable store does not suppress a missing trunk path; an existing trunk whose branch cannot be read emits `trunk-branch-unreadable`.

**Rationale:** Users receive the fullest repair list available without guessing derivative facts.
