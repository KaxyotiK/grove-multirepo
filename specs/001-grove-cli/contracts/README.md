# Contracts — the normative specification

> **Closed to new behaviour (ruling ⑧, 2026-08-23).** This directory remains the stable `§` citation authority and the home of the 180 regression scenario IDs — never renumbered, never deleted, and still the resolution target for every `§N` in `src/` and `tests/`. But no new behaviour is written here. The Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which **supersedes this directory wherever the two disagree**. Sections describing subsystems v3 deleted carry a **Superseded** note, and `tests/module/citations.test.ts` fails any citation into one. See [`specs/README.md`](../../README.md) for the authority order.

These files were the authoritative behavioural specification for `grove`. They were extracted from `docs/future-state.md` on 2026-08-16, when that document was retired in favour of spec-driven development under Spec Kit. The original was removed from the tree before public release; it remains in the private development history.

Authority order: `.specify/memory/constitution.md` (principles and governance) → these contracts (behaviour) → `specs/<NNN>-*/spec.md` (per-feature deltas).

## Rule of one statement

A rule is stated **once**, here. Feature specs cite it; they never restate it. Restating is how FR-023 came to contradict the constitution while both looked internally consistent — kept in the private development history (C1).

## Section index

`§N` numbers are stable citation keys. There are 396 `§`-references across `src/`, `tests/`, `specs/`, and the constitution; they resolve here. **Do not renumber sections.**

| § | Topic | File |
|---|---|---|
| §1 | The product | [architecture.md](architecture.md) |
| §2 | Workspace discovery | [architecture.md](architecture.md) |
| §3 | Folder structure (§3.1 one workspace, §3.2 multiple) | [architecture.md](architecture.md) |
| §4 | Configuration files (§4.1 workspace, §4.2 Grove) | [architecture.md](architecture.md) |
| §5 | Naming (§5.1 slugs, §5.2 collisions, §5.3 Grove names) | [naming.md](naming.md) |
| §6 | Single-process safety (§6.1 rollback journal) | [safety.md](safety.md) |
| §7 | `grove init` | [cli-surface.md](cli-surface.md) |
| §8 | Command surface (§8.1–§8.9) | [cli-surface.md](cli-surface.md) |
| §9 | Exit codes | [exit-codes.md](exit-codes.md) |
| §10 | Source & build shape, grove-ide provenance | *retired* — kept in the private development history |
| §11 | Acceptance scenarios (§11.1–§11.14) | [acceptance-scenarios.md](acceptance-scenarios.md) |
| §12 | Implementation sequence | *retired* — the build is complete; kept in the private development history |
| §13 | Legacy-creep checklist | *retired* → enforced by `scripts/legacy-scan.sh` (`npm run scan`); the old checklist is in the private development history |

## Acceptance scenarios are the join key

`acceptance-scenarios.md` (§11) defines **180 scenario IDs** — `ARCH-*`, `REPO-*`, `RECON-*`, `DISC-*`, `ISO-*`, `CMD-*`, `E2E-*`, `PROC-*` and others. A scenario is only real if a test cites its ID.

As of feature 008, **180 of 180 (100%)** are cited by executable test titles and all 14 discovered families are enforced by `scripts/scenario-traceability.sh`. There are no deferrals or family allowlists. A new contract row fails until a named witness exists; duplicate contract IDs and unknown test-title citations also fail with their exact IDs.

The original gap was not cosmetic: it is how an implementation that directly violated **ARCH-04** shipped under a task claiming `ARCH-*` coverage. Feature 008 also mutation-checked a module, CLI, and E2E witness so citation completeness cannot be mistaken for behavioral coverage.

Every test that covers a scenario MUST name its ID in the test title, so coverage is greppable and a free-standing comment cannot receive credit:

```
test("ARCH-04: dirty Tree refuses archive even with --force", …)
```

## Changing a contract

Behaviour changes MUST update the contract and the constitution together, per `.specify/memory/constitution.md` §"Development Workflow & Quality Gates". The sequence is:

1. `/speckit-constitution` — only if a principle itself changes.
2. Edit the contract file here.
3. `/speckit-specify` a new `specs/<NNN>-*/` feature describing the delta, citing `§` and scenario IDs.
4. `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
5. `/speckit-analyze` before implementing, to catch cross-artifact drift.
