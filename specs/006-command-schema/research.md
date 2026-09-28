# Research: Central command schemas

## R1 — Runtime schema shape

**Decision:** Add `options`, `positionals: {min,max}`, and `forwardsExtras` to `CommandSpec`.

**Rationale:** These are the facts runtime parsing needs. Help prose remains separately authored.

**Alternatives considered:** Parse `usage` in production (current drift risk); retain handler-local schemas (two authorities); introduce another command-definition framework (unnecessary).

## R2 — Type strategy

**Decision:** Runtime correctness takes priority over duplicating generic shapes for inference. Expose shared narrowing helpers for string, boolean, and repeated-string values where TypeScript cannot retain a stored registry entry's literal type.

**Rationale:** A compile-time duplicate would recreate the same source-of-truth defect.

## R3 — Usage/help drift

**Decision:** Keep `usageArity` and usage option extraction only in tests. Compare documented bounds and option spellings with the schema; verify help entries name declared fields.

**Rationale:** Documentation remains independently readable while mismatches fail before release.

## R4 — Migration

**Decision:** Add a temporary parser bridge, migrate one command family at a time with parity tests, then delete the bridge and scan for handler-supplied schemas.

**Rationale:** The refactor touches every handler; family checkpoints make regressions attributable.
