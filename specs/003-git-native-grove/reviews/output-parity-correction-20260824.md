# Structural output-parity correction — 2026-08-24

**Implementation commit:** `66bccd4` **Scope:** Close the demonstrated human/JSON information gap across the existing command surface. No command, storage domain, migration behavior, CI requirement, or platform scope was added.

## Red evidence

The pre-fix architecture had 68 `ok`/`result` emission sites across 15 production command modules. Every emitter call could accept a separate human callback, while top-level help/version paths wrote directly to stdout. The tests-first witnesses reproduced three independent failures:

- `tests/module/output.test.ts` could not import the required shared `renderHuman` function.
- `tests/module/output-architecture.test.ts` found callback projections in all 15 emitting command modules, a callback-capable emitter, direct command output in `agent.ts`, and direct help/version output in `cli.ts`.
- `tests/cli/output-parity.test.ts` proved human `repo link` omitted its repository ID and therefore also failed to carry the complete operation/remote/trunk acquisition result.

## Correction

- `src/output.ts` now accepts one value per success/result and renders that same JSON-normalized value as compact JSON or a complete deterministic human traversal. Nested terminal controls are escaped centrally; a top-level string remains raw for shell-completion scripts.
- Every registered handler uses the callback-free emitter. Grove-owned handler output cannot bypass it, and help/version use the same structured emission path.
- `agent run` launch failures now enter the standard error envelope instead of writing an unrelated handler-local error line. The documented foreground child-process I/O exception remains intact.
- The source-architecture test derives its coverage from the command registry/module aggregator, parses every command module, rejects extra emitter arguments and direct process/console output, and therefore automatically covers newly registered command modules.
- Human-output regression assertions were changed only where they encoded an intentionally lossy second projection. Their replacement assertions check the same repository identities, diagnostics, remedies, detached restore facts, and terminal-safety guarantees in the complete shared rendering.

## Verification at `66bccd4`

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` module | PASS — 177/177 |
| `npm test` CLI | PASS — 261/261 |
| `npm test` E2E | PASS — 20/20 |
| Total executable tests | PASS — 458/458 |
| `npm run scan` | PASS — PROC-07, all exclusion checks green |
| `npm run traceability` inherited | PASS — 180 scenarios, 184 witnesses, 0 deferred |
| `npm run traceability` v3 | PASS — 42 scenarios across 17 families, including V3OUT 3/3 |
| `npm run build` | PASS — one `dist/grove.mjs` bundle (433.1 KiB reported by esbuild) |

Focused verification also passed the emitter/architecture suite (5/5), output-parity suite (5/5), and the 26-test terminal-safety, diagnostic, reconciliation, and restore slice. Full E2E includes the isolated global package install, managed `repo add`, external `repo link`, linked Tree creation, linked trunk-mutation refusal, and complete installed-artifact lifecycle.

## Audit disposition

`V3OUT-03` and `003-git-native-grove-SC-017` are green. There are zero registered handler-local human projections, zero registered handler direct-output writes, and no command-specific formatter that can omit a newly added structured field. The only direct production writes outside the emitter are the NDJSON progress stream and the pre-dispatch unsupported-Node notice; neither is a command result. No migration implementation was introduced. This milestone remains local and unpushed.
