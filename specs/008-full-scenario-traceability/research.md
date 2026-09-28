# Research: Full scenario traceability

## R1 — Scenario discovery

**Decision:** Parse every table row in the authoritative §11 document for IDs matching `[A-Z0-9]+-[0-9]+`, then validate global uniqueness. Derive families from the prefix rather than maintaining a hardcoded family list or total.

**Rationale:** New families and scenarios enter the gate automatically.

**Alternatives considered:** One regex per family (repeats the current blind spot); a second JSON registry (creates competing authority).

## R2 — Citation discovery

**Decision:** Scan executable `*.test.ts` sources for exact scenario IDs, reject citations that do not exist in §11, and require the ID in the test title rather than a free-standing comment.

**Rationale:** Exact named tests remain greppable while unknown/stale IDs cannot inflate coverage.

**Alternatives considered:** Runtime test-name introspection (unnecessary runner coupling); any text match below `tests/` (credits comments and fixture data).

## R3 — Rollout

**Decision:** Audit and gate one family at a time. Temporary deferrals name an owning feature/task and are removed as their witnesses land; the final state permits none.

**Rationale:** The 118-gap baseline is too large for one undifferentiated test change, but partial progress must remain explicit and machine checked.

## R4 — Non-vacuity

**Decision:** Review setup/assertions for every credited test and mutation-check representative module, CLI, and E2E witnesses by temporarily reversing an expected result or moving the operation before its required boundary.

**Rationale:** Citation presence alone cannot prove behavior.

## R5 — Test placement

**Decision:** Extend the existing module, CLI, and E2E files closest to each contract family. Create new files only for a coherent missing capability such as crash-window control.

**Rationale:** Behavioral ownership stays visible and the suite avoids a monolithic traceability test.
