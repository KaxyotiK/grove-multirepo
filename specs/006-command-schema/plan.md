# Implementation Plan: Central command schemas

**Branch**: `002-work-safety-force` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

Move option definitions, positional bounds, and extras forwarding into `CommandSpec`. Make `parseCommand` consume that schema, then retain usage parsing only as a test-time drift oracle.

## Technical Context

**Language/Version**: Strict TypeScript ESM, Node ≥24

**Primary Dependencies**: `node:util.parseArgs`, existing registry/global scanner/parser

**Storage**: None

**Testing**: Module schema/drift tests plus existing CLI regression suite

**Target Platform**: macOS and Linux

**Project Type**: Bundled CLI

**Performance Goals**: No material change; one schema lookup per invocation

**Constraints**: Exact argv/error/output parity; no duplicate runtime schema; direct `parseArgs` remains banned

**Scale/Scope**: Every registered command and 40 parser call sites

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Gate | Design response | Result |
|---|---|---|
| I / artifact constraints | Keeps one direct-dispatch CLI and required parser. | PASS |
| III. Single Source | One registered schema owns runtime parsing. | PASS |
| V. Refuse, Never Guess | Unknown/surplus input remains explicitly refused. | PASS |
| VI. No Legacy | No alternate parser or compatibility behavior. | PASS |
| Spec workflow | §8.1/CMD-16 precede migration. | PASS |

## Phase 0: Research

[research.md](./research.md) resolves schema shape, type strategy, drift validation, and migration order.

## Phase 1: Design

- [data-model.md](./data-model.md) defines `CommandArgumentSchema`.
- [contracts/command-schema.md](./contracts/command-schema.md) indexes authority.
- [quickstart.md](./quickstart.md) validates parity and drift failures.

## Project Structure

```text
specs/006-command-schema/{spec.md,plan.md,research.md,data-model.md,quickstart.md,tasks.md}
specs/006-command-schema/contracts/command-schema.md
src/commands/registry.ts
src/commands/args.ts
src/commands/globals.ts
src/commands/*.ts
tests/module/arity.test.ts
tests/module/dispatch-audit.test.ts
tests/module/globals.test.ts
tests/cli/regressions.test.ts
scripts/legacy-scan.sh
```

**Structure Decision**: Extend the existing registry; do not add a parser layer. Migrate command families incrementally while the parser temporarily accepts old call syntax, then remove the bridge.

## Complexity Tracking

No violations or exceptions.
