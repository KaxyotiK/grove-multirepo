# Contracts — staged deltas, not a parallel specification

**Read this before editing anything here.**

The authoritative behavioural specification is `specs/001-grove-cli/contracts/`. A rule is stated exactly once, there. Feature specs cite it; they do not restate it (constitution, "Development Workflow & Quality Gates"; `specs/001-grove-cli/contracts/README.md`, "Rule of one statement").

This directory therefore holds **replacement text staged for application to the 001 contracts**, not a second contract that competes with them. Each file below is the exact prose that replaces a named section, so the edit during `/speckit-implement` is a substitution rather than a re-derivation.

When this feature merges, these files have done their job and the 001 contracts are authoritative again. Do not cite `specs/002-work-safety-force/contracts/*` from code, tests, or later features — cite `§8.5.1` and the `ARCH-*` IDs, which resolve in 001.

| File | Applies to | Amendment |
|---|---|---|
| [work-safety.md](work-safety.md) | `001/contracts/cli-surface.md` §8.5.1 | AM-001, AM-002 |
| [acceptance-scenarios.md](acceptance-scenarios.md) | `001/contracts/acceptance-scenarios.md` `ARCH-*` | AM-003 |
| [json-output.md](json-output.md) | `001/contracts/cli-surface.md` §8.5.1 (JSON shape) | AM-001 |

`AM-004` (rewrite 001 `spec.md` FR-023 and 002-work-safety-force-SC-003 to cite rather than restate) and `AM-005` (re-run 001 `plan.md`'s Constitution Check against 2.0.0) have no staged text — they are edits to 001's own spec and plan, scheduled in `tasks.md`.

**Section numbers are stable citation keys.** This feature rewrites the _body_ of §8.5.1 and does not renumber it. There are 396 `§` references across `src/`, `tests/`, `specs/`, and the constitution that must keep resolving.
