# Quickstart: Full scenario traceability

## Prerequisites

- Node >=24 and local Git
- Features 004, 005, and 007 complete before their dependent family checkpoints close

## Validate structure

```bash
bash scripts/scenario-traceability.sh
```

Expected final result: all scenario families are discovered generically, every unique ID is cited by a named executable test, and there are zero deferrals, duplicates, or unknown citations.

## Validate behavior

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```

Expected: all commands pass on macOS and Linux without network access.

## Negative controls

In a disposable working copy:

1. Add an uncited scenario row and verify the gate names it.
2. Duplicate an existing ID and verify the gate rejects both rows.
3. Put an unknown ID in a test title and verify the gate rejects it.
4. Temporarily reverse one representative module, CLI, and E2E expected result; each owning test must fail before the mutation is reverted.

## Mutation evidence (2026-08-20)

Each mutation below was applied alone, its named witness was run, and the production source was restored before continuing. None of the mutations is committed.

| Layer | Temporary defect | Witness command | Observed non-zero result |
|---|---|---|---|
| Module | Encoded `~` as uppercase `~7E` instead of the required `~7e` | `node --test --test-name-pattern='TREE-20' tests/module/encoding.test.ts` | Exit `1`; `TREE-20` failed with `actual: '~7E'`, `expected: '~7e'` |
| CLI | Wrote typed `--json` errors to stderr instead of stdout | `npm run build && node --test --test-name-pattern='CMD-05' tests/cli/command-scenarios.test.ts` | Exit `1`; `CMD-05` failed because the structured error leaked to stderr |
| E2E | Disabled bundling so the copied artifact depended on the source tree | `npm run build && node --test --test-name-pattern='ART-02' tests/e2e/artifact.test.ts` | Exit `1`; `ART-02` failed with `ERR_MODULE_NOT_FOUND` for `output.ts` in the isolated directory |

## Closure evidence (2026-08-20)

All negative controls were repeated in a disposable clone. The validator exited `1` with these exact diagnostics:

- `FAIL: uncited scenario CONTROL-01`
- `FAIL: duplicate contract scenario DUP-01 at lines 1, 2`
- `FAIL: unknown test-title scenario UNKNOWN-99 in unknown.test.ts`

The three mutations above were then repeated in that clone; `TREE-20`, `CMD-05`, and `ART-02` each failed with the recorded diagnostic, and the mutated sources were restored.

The reviewed full gate passed on macOS and in a clean Linux/Node 24 container as a non-root user: 164 module, 230 CLI, and 26 E2E tests (420 total), plus the scan and all 180 scenarios in 14 families with zero deferrals. The Linux run also proved the test fixture does not depend on a global Git identity.
