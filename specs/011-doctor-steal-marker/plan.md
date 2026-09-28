# Implementation Plan: Diagnose orphaned steal markers

**Branch**: `fix/doctor-steal-marker` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-doctor-steal-marker/spec.md`

## Summary

Extend the existing read-only lock scan with a distinct aged-marker finding and a remedy-changing fresh-marker fact on automatically reclaimable locks. `doctor` maps those states to stable, truthful diagnostics. Acquisition ensures a pre-existing aged marker is gone before successful return through path-specific handling with the same strict `>` predicate: direct creation cleans after obtaining the lock, while reclaim clears it during intent contention and removes its own marker in `finally`. Orphan findings also classify the associated lock so a healthy holder gets a wait-first remedy and distinct identity.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 24+

**Primary Dependencies**: Node.js standard library; existing Grove result/diagnostic model

**Storage**: Workspace-local lock and marker files under `.grove/locks/`; no schema change

**Testing**: Node test runner; module and built-CLI integration tests

**Target Platform**: macOS

**Project Type**: Single-package command-line application

**Performance Goals**: One directory read and at most one `stat` per lock-directory entry; no wait or mutation in the audit

**Constraints**: Read-only audit; stable diagnostic identity; exact agreement with the existing marker-reclaim threshold; direct-create cleanup after lock ownership; no issue-17 race changes; no v2 contract edits; no changes outside the assigned lock/doctor/test/v3 contract/spec scope

**Scale/Scope**: One lock-directory scan, one finding variant with associated-lock state plus an optional stale-lock fact, one new diagnostic code, one direct-create cleanup, and one acceptance scenario

## Constitution Check

_GATE: Passed before research and re-checked after design._

| Principle / gate | Design evidence | Result |
|---|---|---|
| I. Git owns live state | Reads only Grove-owned lock files; no Git fact is stored or changed. | PASS |
| II. Grove owns convention | Lock arbitration remains Grove-local coordination. | PASS |
| III. One command, workspace-local state | Uses only the resolved workspace's `.grove/locks/`. | PASS |
| IV. Forward, ref-safe operations | Audit does not mutate; direct creation cleans only an aged marker after acquiring the lock, while reclaim retains its existing arbitration. | PASS |
| V. Observe, diagnose, never guess | Fresh markers fail closed; aged-marker remedies distinguish held, reclaimable, and absent locks through stable facts. | PASS |
| VI. No legacy creep | No compatibility path, dependency, or legacy vocabulary is introduced. | PASS |
| Tests first | `V3DIAG-04` is observed failing before production code changes. | PASS |
| Local verification | Full verification plus package and isolated-install checks are required. | PASS |

## Phase 0: Research

[research.md](./research.md) settles the orphan boundary, scan result shape, diagnostic identity, contract location, and witness construction.

## Phase 1: Design

- [data-model.md](./data-model.md) defines the new in-memory finding variant and diagnostic mapping.
- [contracts/doctor-steal-marker.md](./contracts/doctor-steal-marker.md) indexes the governing contracts and exact amendment/scenario text.
- [quickstart.md](./quickstart.md) validates aged and fresh markers plus automatic recovery.

The post-design constitution check remains PASS: the audit adds read-only evidence only, includes no migration or stored schema, and direct acquisition removes only a strictly aged marker after it has obtained the lock.

## Project Structure

```text
specs/011-doctor-steal-marker/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/doctor-steal-marker.md
├── checklists/requirements.md
└── tasks.md

src/store/lock.ts
src/commands/doctor.ts
specs/README.md
specs/003-git-native-grove/contracts/cli-surface-v3.md
specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md
tests/module/store.test.ts
tests/cli/repository-diagnostic.test.ts
```

**Structure Decision**: Keep filesystem/associated-lock classification and direct-create cleanup in `src/store/lock.ts`, where marker reclamation owns the shared stale predicate. Keep presentation in `src/commands/doctor.ts`, the existing mapper from lock findings to diagnostics. No unrelated observation or lifecycle module changes.

## Complexity Tracking

No violations or exceptions.
