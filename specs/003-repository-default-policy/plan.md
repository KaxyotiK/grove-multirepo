# Implementation Plan: Repository default policy

**Branch**: `002-work-safety-force` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-repository-default-policy/spec.md`

## Summary

Replace the schema-v1 repository `trunk` snapshot and remote URL with schema-v2 policy: `defaultBranch: string | null` (explicit override only) and `remote: string | null` (selected Git remote name). Add one asynchronous resolver that uses override → cached selected-remote HEAD → typed refusal, route every branch-creation/comparison/guard/status consumer through it, add atomic offline-only `repo configure`, and make linked-mode coupling explicit in help and trunk-add output.

## Technical Context

**Language/Version**: Strict TypeScript, ESM, Node ≥24

**Primary Dependencies**: Node standard library; existing `Git` adapter and command registry; no new runtime dependencies

**Storage**: Workspace-local JSON manifests plus local Git refs/config; workspace schema version 2, with no migration or compatibility reader

**Testing**: `node:test`/`node:assert`; module and CLI regression layers; §11 scenario traceability

**Target Platform**: macOS and Linux

**Project Type**: Single bundled CLI

**Performance Goals**: Default resolution uses bounded local Git subprocesses only; configuration holds the workspace lock only for local validation and one atomic manifest write

**Constraints**: No network during default resolution or `repo configure`; never use linked checkout HEAD; no global state; JSON stdout remains exactly one value; no legacy schema support

**Scale/Scope**: One workspace manifest schema, six command consumers, repository/trunk help and outputs, authoritative §4/§8.4/§8.4.1/§11 contract amendments

## Constitution Check

_GATE before research: PASS. Re-check after design: PASS._

| Principle / gate | Design response | Result |
|---|---|---|
| I. One Command, No Background | Uses foreground local Git subprocesses only; no service or retained process. | PASS |
| II. Workspace-Local State Only | The optional override and selected remote live only in workspace config. Linked Git is read as the user-selected object store; configuration never writes it. | PASS |
| III. Single Source of Truth | Remote-derived default stays in Git; Grove stores only explicit user policy. Trunks and Grove bases remain separately owned. | PASS |
| IV. Safety by Construction | `repo configure` uses the one workspace mutation lock and atomic CAS write; invalid changes persist nothing. | PASS |
| V. Refuse, Never Guess | Resolver has one order and refuses if neither source works; checkout HEAD and guessed `main` are forbidden. | PASS |
| VI. No Legacy Creep | No legacy code/dependencies/vocabulary introduced; schema v1 is refused, not migrated. | PASS |
| Artifact constraints | Existing TypeScript/Node CLI and bundle shape are unchanged. | PASS |
| Spec workflow / traceability | Feature artifacts cite §§; new REPO/TRUNK scenarios receive CLI witnesses before implementation. | PASS |

## Phase 0: Research decisions

See [research.md](./research.md). All technical unknowns are resolved:

1. repository default ownership and schema shape;
2. cached remote-HEAD resolution in bare and linked stores;
3. selected remote naming and fetch/tracking behavior;
4. atomic/offline configuration semantics;
5. linked-trunk warning output;
6. direct schema transition and consumer fan-out.

## Phase 1: Design

- [data-model.md](./data-model.md) defines schema-v2 repository policy, the derived effective default, trunk entries, and comparison-base relationship.
- [contracts/repository-default-policy.md](./contracts/repository-default-policy.md) indexes the authoritative contract amendments and §11 scenarios applied during implementation.
- [quickstart.md](./quickstart.md) provides runnable parity, configuration, refusal, and warning validations.

The post-design constitution check remains PASS. The design removes duplicated state, adds no new service or dependency, remains offline, and turns every ambiguity into a refusal.

## Project Structure

### Documentation (this feature)

```text
specs/003-repository-default-policy/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── repository-default-policy.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source and tests

```text
src/
├── model/
│   ├── types.ts
│   ├── repo.ts
│   └── treectx.ts
├── config/workspace.ts
├── git/adapter.ts
└── commands/
    ├── repo.ts
    ├── grove.ts
    ├── tree.ts
    ├── trunk.ts
    └── review.ts

tests/
├── module/
└── cli/

specs/001-grove-cli/
├── data-model.md
└── contracts/
    ├── architecture.md
    ├── cli-surface.md
    └── acceptance-scenarios.md
```

**Structure Decision**: Extend the existing single CLI. Put policy derivation beside repository lookup in `src/model/repo.ts`, so commands cannot reimplement resolution. Keep Git mechanics in the adapter and orchestration in command handlers.

## Complexity Tracking

No constitution violations require justification.
