# Human help formatting correction — 2026-08-24

**Branch:** `fix/help-human-formatting` **Regression source:** `66bccd4` **Scope:** Human presentation of registry-derived top-level, noun-family, and per-command help; structured JSON help, command-result completeness, and completion behavior are preserved.

## Baseline reproduction

| Surface | Baseline observation |
|---|---|
| Top-level human | Global options and commands leak as standalone `-` collection items followed by `Option:`/`Description:` or `Path:`/`Summary:` fields. |
| Noun-family human | Each command leaks as `-` plus `Path:`, `Summary:`, and `Usage:` fields. |
| Per-command human | Arguments/options leak as `-` plus `Name:` and `Desc:` fields; examples are array bullets. |
| JSON help | Top-level, family, and command help are structured one-object values and retain meaningful facts. |
| Completion | `grove completion zsh` is emitted as a raw executable string. |

## Evidence ledger

| Task | Status | Green witness |
|---|---|---|
| T110 — authority/design reconciliation | 🟢 implemented:verified-local | US7, FR-033B-D, 003-git-native-grove-SC-018, `V3HLP-04`, the help-presentation contract, R9B, Phase 13, and `TRACE-HELP-PRESENT` agree on one help model with idiomatic human/JSON presentations. |
| T111 — read-only Spec Kit analysis | 🟢 implemented:verified-local | 94 requirement entries, 18 success criteria, and 105 tasks analyzed with zero ambiguity, duplication, constitution conflict, unmapped live requirement/task, or HIGH/CRITICAL finding. |
| T112 — red help/architecture witnesses | 🟢 implemented:verified-local | Before source changes: three human CLI assertions failed on generic traversal, the module import failed because `src/help.ts` did not exist, the architecture assertion failed because no explicit help path existed, and structured JSON help passed. |
| T113 — explicit help presentation path | 🟢 implemented:verified-local | `src/help.ts` owns the typed registry-derived documents and aligned/wrapped renderer; `Emitter.help` routes JSON directly or human help centrally; result/error and completion paths are unchanged. |
| T114 — focused and full verification | 🟢 implemented:verified-local | Focused help/output/architecture/parity/process slice: 21/21. Final exact chain `npm run typecheck && npm test && npm run scan && npm run traceability`: 180 module, 266 CLI, 20 E2E; PROC-07 passed; inherited 180/180 and current 43/43 scenarios passed. |
| T115 — diff review and local commit | 🟢 implemented:verified-local | `git diff --check`, live top/family/command human+JSON review, completion output review, and branch/scope inspection passed; this review ships in the coherent local correction commit on `fix/help-human-formatting`. |
| T116 — adversarial regression witnesses | 🟢 implemented:verified-local | Red witnesses reproduced human output/internal errors for accepted trailing JSON-help placements, 80-column title/usage overflow, and handler access to `Emitter.help`; the registry-wide usage witness now compares exact syntax after controlled line normalization. |
| T117 — adversarial fixes and renewed gates | 🟢 implemented:verified-local | CLI help uses the canonical two-precision global scanner before workspace discovery, title/usage rendering uses hanging indentation, handlers receive `CommandEmitter`, all 49 help documents pass the 80-column non-example audit, and the final exact gate chain passes: 181 module, 267 CLI, 20 E2E; PROC-07; inherited 180/180 and current 43/43 scenarios. |

## Final evidence

- Human top-level help now separates title, Usage, Global options, Commands, and Hint with blank lines and aligned description columns.
- Human noun-family help aligns every subcommand summary across the family and retains an exact copyable Usage line for each command.
- Human per-command help uses Usage, Arguments, Options, Notes, and Examples sections; descriptions wrap below one aligned column and examples remain verbatim.
- No tested human help surface contains a standalone collection `-` line or traversal fields named `Name:`, `Desc:`, `Path:`, or `Summary:`.
- JSON top-level, family, and command help retain the prior structured objects and all asserted meaningful facts.
- The V3OUT result architecture, acquisition parity suite, raw completion string, isolated package install, source scan, and scenario traceability all remain green.

The initial review found no remaining correctness or scope concern. A subsequent adversarial PR review demonstrated two follow-up gaps: accepted trailing/global-after-boolean placements could miss JSON help or fall through as an internal error, and real registry titles/usages exceeded an 80-column terminal without controlled continuation indentation. It also identified that handlers could access the help-only emitter method. The apparent ART-05 ledger mismatch was refuted: the traceability validator canonicalizes witness whitespace, so its one-space evidence string correctly matches the two-space source indentation after normalization. T116-T117 own the corrective witnesses, implementation, and renewed gate evidence.

The follow-up closes both P1 findings and the handler-capability P2. Accepted leading/trailing and post-boolean `--json` help placements now return one structured object before workspace discovery; real 80-column titles/usages wrap with controlled indentation; command handlers cannot call the help-only method through their declared context; and the exact final gate chain is green.

The older unchecked reviewer-owned `checklists/live-e2e-corrections.md` artifact was not modified; its completed Phase 12 tasks and separate green live-E2E evidence predate and are outside this correction.
