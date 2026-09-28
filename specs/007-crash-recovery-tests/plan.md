# Implementation Plan: Crash recovery witnesses

**Branch**: `002-work-safety-force` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

Build a fixture-only Git proxy that delegates the targeted worktree mutation, signals completion, then blocks. E2E tests kill the CLI process group in that exact window and run reconcile.

## Technical Context

**Language/Version**: Strict TypeScript ESM, Node ≥24; POSIX process signals

**Primary Dependencies**: Node child processes/filesystem; real local Git; existing CLI fixture kit

**Storage**: Disposable test workspaces, sentinel files, existing journals/locks

**Testing**: Built-artifact CLI tests under `node:test`

**Target Platform**: macOS and Linux

**Project Type**: Test infrastructure for bundled CLI

**Performance Goals**: Deterministic boundary with bounded waits; ten-run soak under CI-appropriate timeout

**Constraints**: No production hook; no network; kill/cleanup whole process group; non-vacuous state assertions

**Scale/Scope**: Archive and restore, with multiple Trees and retained loose files

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Gate | Design response | Result |
|---|---|---|
| I. No Background | Test kills and reaps every child/process group. Production behavior unchanged. | PASS |
| II. Workspace-Local | Grove state stays in disposable workspaces; sentinels live in fixture temp roots. | PASS |
| III. Single Source | Tests inspect manifests/filesystem/Git rather than infer from directory names. | PASS |
| IV. Safety | Directly proves durable journal ordering and recovery. | PASS |
| V. Refuse, Never Guess | Timeouts fail explicitly; a missed boundary cannot pass. | PASS |
| Artifact constraint | Bundle has no fault hook or environment-controlled branch. | PASS |

## Phase 0: Research

[research.md](./research.md) selects the Git proxy/process-group design and non-vacuity assertions.

## Phase 1: Design

- [data-model.md](./data-model.md) defines the test protocol states.
- [contracts/crash-recovery-tests.md](./contracts/crash-recovery-tests.md) indexes authority.
- [quickstart.md](./quickstart.md) describes repeatable validation.

## Project Structure

```text
specs/007-crash-recovery-tests/{spec.md,plan.md,research.md,data-model.md,quickstart.md,tasks.md}
specs/007-crash-recovery-tests/contracts/crash-recovery-tests.md
tests/testkit/git-fault.ts
tests/e2e/crash-recovery.test.ts
scripts/scenario-traceability.sh
```

**Structure Decision**: Keep the boundary controller entirely in testkit and run against the normal built bundle. Do not add source hooks.

## Complexity Tracking

No constitution exception. Process-group control is required to prevent an orphaned blocking Git proxy.
