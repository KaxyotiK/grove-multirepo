# Feature Specification: Central command schemas

**Feature Branch**: `002-work-safety-force`

**Feature Directory**: `006-command-schema`

**Created**: 2026-08-20

**Status**: Implemented

**Input**: User description: "Centralize option schemas in CommandSpec and make usageArity a drift test rather than runtime enforcement."

**Authority**: §8.1 and §11 CMD-01…CMD-06, CMD-09, CMD-16.

**Decision record**: `docs/decisions-and-tasks-20260820.md` “Command schemas”.

## Why this feature exists

Today option types live beside handler calls while usage/help live in the registry, and positional enforcement parses the display string. A command can therefore document one surface and parse another. Users need one declared surface whose runtime behavior, globals, help, and completion cannot drift.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Receive consistent argument behavior (Priority: P1)

An engineer can place supported globals/options in their documented positions and receives the same result and errors throughout the schema refactor.

**Why this priority**: Behavior preservation is the acceptance boundary for the refactor.

**Independent Test**: Run §11 CMD-16 plus the existing CMD-02…CMD-06 matrix before and after migration.

**Normative acceptance**: §11 CMD-02…CMD-06 and CMD-16.

---

### User Story 2 - Trust help and completion (Priority: P1)

An engineer sees usage, option help, and generated completion that agree with the enforced schema.

**Why this priority**: The refactor is valuable only if future drift becomes a failing gate.

**Independent Test**: Deliberately mismatch one command at a time and prove CMD-01/CMD-09/CMD-16 fail.

**Normative acceptance**: §11 CMD-01, CMD-09, and CMD-16.

### Edge Cases

§8.1 and CMD-16 own ambiguous global positions, repeatable string options, defaults, zero-option commands, optional/variadic positionals, and forwarded tokens after literal `--`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Make `CommandSpec` the sole runtime argument-schema authority under §8.1.
- **FR-002**: Route global disambiguation and command parsing through the registered schema.
- **FR-003**: Enforce positional bounds from schema fields rather than the usage display string.
- **FR-004**: Convert usage parsing into a gating schema/help drift audit.
- **FR-005**: Migrate every command without changing observable argv behavior or error ordering.
- **FR-006**: Keep the direct-parse scan and all existing command/help/completion gates.
- **FR-007**: Add failing CMD-16 drift and parity witnesses before migration.

### Key Entities

The command-schema fields are normative in §8.1 and derived into no persistent state.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **006-command-schema-SC-001**: 100% of registered commands declare option and positional schemas in `CommandSpec`.
- **006-command-schema-SC-002**: Zero handlers pass a separate option schema to the parser.
- **006-command-schema-SC-003**: Every usage/help mismatch tested causes a deterministic gate failure.
- **006-command-schema-SC-004**: The complete existing argv regression suite has zero behavior or exit-code changes.
- **006-command-schema-SC-005**: Typecheck, all tests, scan, and traceability pass.

## Assumptions

- This is behavior-preserving; no command or flag is added, removed, or renamed.
- Usage remains human-readable display text rather than a runtime grammar.
- Loose internal value typing may be narrowed with shared helpers; duplicating schemas for inference is not allowed.
