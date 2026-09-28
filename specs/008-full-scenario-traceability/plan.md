# Implementation Plan: Full scenario traceability

**Branch**: `002-work-safety-force` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the ARCH/REPO-only citation counter with one generic validator, then audit and witness all 180 authoritative scenarios family by family. A scenario receives credit only from a named test whose setup and assertions prove the contracted outcome; representative mutations prove the suite is not vacuous.

## Technical Context

**Language/Version**: Strict TypeScript ESM, Node >=24; portable Bash 3.2 for repository gates

**Primary Dependencies**: Node `node:test`/`node:assert`; existing CLI fixture kit; real local Git

**Storage**: Markdown scenario table, TypeScript test sources, temporary test workspaces

**Testing**: Module, CLI, and E2E suites plus a repository-level traceability validator

**Target Platform**: macOS and Linux

**Project Type**: Quality-gate and test-coverage campaign for a bundled CLI

**Performance Goals**: Deterministic local validation; keep the ordinary full suite CI-appropriate

**Constraints**: No network; no comment-only credit; no permanent deferrals; exact scenario IDs

**Scale/Scope**: 180 scenarios in 14 families, measured implementation baseline 69 cited and 111 uncited

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Gate | Design response | Result |
|---|---|---|
| Spec authority | Scenario text remains in §11; feature artifacts only cite and index it. | PASS |
| Scenario traceability | Every authoritative ID receives a named executable witness. | PASS |
| Tests first | Each family audit adds or strengthens failing witnesses before product fixes. | PASS |
| Refuse, Never Guess | Duplicate, unknown, uncited, and expired-deferral states fail with exact IDs. | PASS |
| Workspace local | Tests use disposable workspaces and local Git only. | PASS |
| Artifact constraint | ART-06 adds only the contract-required Node-version refusal; no runtime dependency or second artifact is introduced. | PASS |

## Phase 0: Research

[research.md](./research.md) selects a generic table parser, phased enforcement, and mutation-based non-vacuity checks.

## Phase 1: Design

- [data-model.md](./data-model.md) defines scenarios, citations, deferrals, and family gates.
- [contracts/full-scenario-traceability.md](./contracts/full-scenario-traceability.md) indexes authority.
- [quickstart.md](./quickstart.md) defines validation and negative controls.

## Project Structure

```text
specs/008-full-scenario-traceability/{spec.md,plan.md,research.md,data-model.md,quickstart.md,tasks.md}
specs/008-full-scenario-traceability/contracts/full-scenario-traceability.md
scripts/scenario-traceability.sh
tests/module/*.test.ts
tests/cli/*.test.ts
tests/e2e/*.test.ts
```

**Structure Decision**: Keep the generic repository gate in the existing script and put behavioral witnesses in their natural test layer. Do not create a parallel scenario registry.

## Delivery Phases

1. Make the validator structurally complete before expanding enforcement.
2. Audit each scenario family for reachability and assertion completeness.
3. Add missing witnesses and enable that family only when it is green.
4. Land dependent feature witnesses from 004, 005, and 007 before closing their IDs.
5. Remove all deferrals, run mutations at each test layer, and enforce the all-family gate in CI.

## Complexity Tracking

No constitution exception. Family checkpoints constrain the size of the campaign while the final validator remains generic rather than encoding a fixed list or count.
