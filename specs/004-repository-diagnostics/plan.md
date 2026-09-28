# Implementation Plan: Shared repository diagnostics

**Branch**: `002-work-safety-force` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-repository-diagnostics/spec.md`

## Summary

Introduce one derived, typed, network-free repository diagnostic and route `repo status`, `trunk ls`, and `reconcile` through it. Preserve existing inventory and exit behavior while making structured problems and human rendering consistent.

## Technical Context

**Language/Version**: Strict TypeScript ESM, Node ≥24

**Primary Dependencies**: Existing Git adapter, repository/default resolver, path layout, command registry

**Storage**: None; diagnostics derive from workspace config, filesystem, and local Git state

**Testing**: `node:test`; module tests plus CLI scenario witnesses

**Target Platform**: macOS and Linux

**Project Type**: Bundled CLI

**Performance Goals**: One bounded local inspection per repository/trunk; no network calls

**Constraints**: Read-only; fail closed; stable typed JSON; human output rendered from the same result

**Scale/Scope**: All registered repositories and recorded trunks in one workspace

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Principle / gate | Design response | Result |
|---|---|---|
| I. One Command | Foreground local reads only. | PASS |
| II. Workspace-Local | Reads only workspace config, paths, and selected Git stores. | PASS |
| III. Single Source | One derived diagnostic is shared by all consumers; nothing is persisted. | PASS |
| IV. Safety | Unknown/unreadable state is a typed problem, never healthy. | PASS |
| V. Refuse, Never Guess | Missing or unreadable facts remain explicit. | PASS |
| VI. No Legacy | No dependencies, compatibility path, or legacy vocabulary. | PASS |
| Spec workflow | Contract and §11 scenarios precede test and implementation tasks. | PASS |

## Phase 0: Research

[research.md](./research.md) fixes the problem taxonomy, aggregation rule, consumer projections, and error behavior. No clarification remains.

## Phase 1: Design

- [data-model.md](./data-model.md) defines the derived diagnostic types and invariants.
- [contracts/repository-diagnostics.md](./contracts/repository-diagnostics.md) indexes the owning contracts.
- [quickstart.md](./quickstart.md) defines end-to-end validation.

## Project Structure

```text
specs/004-repository-diagnostics/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/repository-diagnostics.md
├── checklists/requirements.md
└── tasks.md

src/model/repository-diagnostic.ts
src/commands/repo.ts
src/commands/trunk.ts
src/commands/reconcile.ts
tests/module/repository-diagnostic.test.ts
tests/cli/repository-diagnostic.test.ts
```

**Structure Decision**: Put derivation and rendering in a new model module. Commands select and present its output; they do not reimplement checks.

## Complexity Tracking

No constitution violations or justified complexity exceptions.
