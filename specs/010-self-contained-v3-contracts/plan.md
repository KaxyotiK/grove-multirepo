# Implementation Plan: Self-contained v3 contracts

**Branch**: `release/grove-multirepo` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

## Summary

State in the three v3 contracts the rules they import from the proposal's §5, §8.2, and §8.4, written from the shipped registry, the config validators, and rulings ①–⑤ rather than copied. Add a citations gate so a contract cannot depend on the proposal again, then delete the proposal. No code under `src/` changes.

## Technical Context

**Language/Version**: Markdown contracts; strict TypeScript ESM test (Node ≥24)

**Primary Dependencies**: `specs/003-git-native-grove/contracts/`, `tests/module/citations.test.ts`

**Storage**: None

**Testing**: `node:test` module gate; full verify command

**Target Platform**: macOS (constitution 4.0.0)

**Project Type**: Bundled CLI (specification-only change)

**Performance Goals**: Not applicable

**Constraints**: No behaviour, help, or test-expectation change; closed specs and the constitution are not edited; `§` numbering untouched

**Scale/Scope**: Three contracts, one test, one deletion, one index entry

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Principle / gate | Design response | Result |
|---|---|---|
| I–VI | No runtime change. | PASS |
| Single source (III) | Grammar is transcribed from the registry's shipped help, which stays the runtime authority. | PASS |
| Spec workflow | Contracts are the authority; this removes a hidden external authority. | PASS |
| Tests-first | The new gate is observed failing on the current contracts before they are edited. | PASS |

## Phase 0: Research

[research.md](./research.md) records, per imported rule, its current source of truth and each place the proposal is superseded.

## Phase 1: Design

- [data-model.md](./data-model.md): no data change.
- [contracts/self-contained-v3-contracts.md](./contracts/self-contained-v3-contracts.md): section map from proposal to owning contract.
- [quickstart.md](./quickstart.md): validation steps.

## Project Structure

```text
specs/010-self-contained-v3-contracts/{spec,plan,research,data-model,quickstart,tasks}.md
specs/003-git-native-grove/contracts/{config-v3,cli-surface-v3,json-results-v1}.md
tests/module/citations.test.ts
docs/git-native-grove-proposal.md   (deleted)
specs/README.md
```

**Structure Decision**: Each imported rule goes to the contract that already cites it; no new contract file.

## Complexity Tracking

No violations or exceptions.
