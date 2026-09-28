# Research: Self-contained v3 contracts

## R1 — Source of truth for each imported rule

| Imported rule | Proposal | Written from |
|---|---|---|
| Config top-level shape and key sets | §5 | `src/config/workspace.ts` key sets; `DEFAULT_CONVENTIONS` |
| Layout tokens and template rules | §5.1 | proposal §5.1, already partly restated in `config-v3.md`; `src/config/layout.ts` |
| Naming tokens and bounds | §5.2 | `src/config/conventions.ts` (tokens, 1–512 bytes, unique allowed tokens) |
| Repository entries | §5.3 | already restated in `config-v3.md`; key set from `workspace.ts` |
| Grove metadata and archive snapshot | §5.4 | `src/config/grove.ts` `KEYS`; `src/model/types.ts`; ruling ② |
| Metadata-free Groves | §5.5 | proposal §5.5 (unchanged by any ruling) |
| Command grammar | §8.2 | shipped `--help` usage for each command |
| Creation matrix, remote-only, revision semantics | §8.2 | proposal §8.2 (unchanged by rulings), cross-checked with `new`/`tree add`/`trunk add` help |
| Reason vocabulary | §8.4 | proposal §8.4 list plus the versioned additions already in `json-results-v1.md` |

## R2 — Where the proposal is superseded

| Proposal text | Superseded by | Contract states |
|---|---|---|
| `new` with no `--repo` selects every repository | ruling ① | empty Grove; `--all` fans out |
| `tree remove --force` | ruling ④ | `--allow-destructive` |
| `migrate` family | ruling ⑤ | no migration command |
| `--abandon` for conflicted or stale | commit `c11bcbe` | conflicted only |
| `doctor --strict` maps policy diagnostics to 3 | `V3DIAG-02` | policy or blocking → 3 |
| `doctor --strict` exit row in the `json-results-v1.md` table reads "strict policy diagnostics" | `V3DIAG-02` | "strict policy or blocking diagnostics" |
| Exit 8/9 migration wording | ruling ⑤; `json-results-v1.md` table | the existing table (already current) |
| `new` flags | shipped registry | adds `--all`, `--prefix` |

## R3 — Gate shape

**Decision:** In `citations.test.ts`, fail any line in `specs/003-git-native-grove/contracts/*.md` that matches `\bproposal\b` unless it also matches `historical|not normative|void|no longer`.

**Rationale:** P2.7 keyed on file paths; the surviving dependencies name a _section_, not a path. Keying on the word catches both, and the existing demotion vocabulary is already how P2.7 lets a line through.

## R4 — What is not edited

Closed specs, plans, and tasks keep their historical mentions (covered by the removed-documents list). The constitution's statement that the proposal is historical input remains true, so it is not amended.
