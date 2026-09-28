# Implementation Plan: Remove Grove diff

**Branch**: `002-work-safety-force` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

Remove the redundant per-file `diff` verb from registry, handler code, help, completion, tests, and documentation. Preserve aggregate review commands and make removed-command behavior explicit.

## Technical Context

**Language/Version**: Strict TypeScript ESM, Node ≥24

**Primary Dependencies**: Existing command registry, review commands, generated completion

**Storage**: None

**Testing**: `node:test`; command-surface module tests, CLI tests, built-artifact e2e

**Target Platform**: macOS and Linux

**Project Type**: Bundled CLI

**Performance Goals**: Not applicable; surface/code removal

**Constraints**: No alias or deprecation shim; JSON error contract remains standard; aggregate review unchanged

**Scale/Scope**: One command registration/handler and every public inventory/reference

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Principle / gate | Design response | Result |
|---|---|---|
| I. One Command | Removes surface; adds no runtime component. | PASS |
| II. Workspace-Local | No state behavior changes. | PASS |
| III. Single Source | Registry remains help/completion authority. | PASS |
| IV. Safety | Read-only removal does not affect destructive paths. | PASS |
| V. Refuse, Never Guess | Removed command is a precise unknown-command refusal. | PASS |
| VI. No Legacy | No compatibility alias or dormant handler remains. | PASS |
| Spec workflow | §8.1/§8.7 and §11 are updated before code tasks. | PASS |

## Phase 0: Research

[research.md](./research.md) confirms the removal boundary, error behavior, and dead-code scope.

## Phase 1: Design

- [data-model.md](./data-model.md) records that no data transition exists.
- [contracts/remove-grove-diff.md](./contracts/remove-grove-diff.md) indexes authority.
- [quickstart.md](./quickstart.md) validates the removed and retained surfaces.

## Project Structure

```text
specs/005-remove-grove-diff/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/remove-grove-diff.md
├── checklists/requirements.md
└── tasks.md

src/commands/review.ts
tests/module/arity.test.ts
tests/module/dispatch-audit.test.ts
tests/cli/review.test.ts
tests/cli/audit-fixes.test.ts
tests/e2e/golden-path.test.ts
README.md
```

**Structure Decision**: Remove the handler from the existing review module; keep the other review verbs together. Generated help/completion change automatically when the registry entry disappears.

## Complexity Tracking

No violations or exceptions.
