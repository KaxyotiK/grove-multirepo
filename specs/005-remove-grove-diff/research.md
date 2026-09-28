# Research: Remove Grove diff

## R1 — Removal rather than expansion

**Decision:** Remove the command without replacement.

**Rationale:** Standard Git owns patch semantics; Grove's value is cross-repository aggregation.

**Alternatives considered:** Add head/base/arbitrary-ref modes (duplicates Git); keep the narrow working-tree command (continues misleading composition).

## R2 — Compatibility

**Decision:** The old spelling becomes a normal unknown-command exit `2` with no alias or warning period.

**Rationale:** The project has no adoption and Principle VI forbids legacy creep.

## R3 — Dead code boundary

**Decision:** Remove the handler and imports/helpers that have no remaining caller; retain shared Git worktree functions used by aggregate commands.

**Rationale:** The built artifact must not ship an unreachable implementation, while unrelated review mechanics must remain untouched.

## R4 — Documentation

**Decision:** Public docs may show representative standard Git commands, but Grove help lists only Grove commands and does not add a Git-wrapper command.

**Rationale:** This guides users without creating another surface or duplicating Git help.
