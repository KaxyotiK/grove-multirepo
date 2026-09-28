# Feature Specification: Self-contained v3 contracts

**Feature Branch**: `release/grove-multirepo`

**Feature Directory**: `010-self-contained-v3-contracts`

**Created**: 2026-09-23

**Status**: Implemented

**Input**: User description: "Move the parts of `docs/git-native-grove-proposal.md` that the v3 contracts still rely on into those contracts, reconciled with the corrective rulings and the shipped CLI, then delete the proposal."

**Authority**: `specs/README.md` ("Nothing outside `specs/` is normative"); `specs/003-git-native-grove/contracts/` `config-v3.md`, `cli-surface-v3.md`, `json-results-v1.md` and their corrective rulings ①–⑧; ledger G-13.

## Why this feature exists

The project rule is that nothing outside `specs/` is normative, and G-13 removed one contract's "Normative source" pointer to the proposal. Three contracts still depend on it for rules they do not state:

- `config-v3.md` — "Normative source: proposal section 5"; "exactly the proposal's branch and Tree naming templates".
- `cli-surface-v3.md` — "Creation and recovery grammar is exactly proposal section 8.2"; branches "follow the proposal creation matrix".
- `json-results-v1.md` — "Normative source: proposal section 8.4"; "exactly the proposal interface"; "the exact proposal vocabulary".

The proposal predates the corrective rulings, so its text is partly wrong today: its §8.2 grammar still has `migrate` (ruling ⑤), `tree remove --force` (ruling ④), `new` selecting every repository by default (ruling ①), and `--abandon` for `stale` operations (since removed). A reader who follows a contract's pointer lands on superseded rules. The gate that should catch this (P2.7 in `tests/module/citations.test.ts`) only flags lines naming a file path, and these name a section.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A contract states its own rules (Priority: P1)

A maintainer or contributor reading a v3 contract finds every rule it depends on in that contract, matching the shipped CLI, without consulting a historical document.

**Why this priority**: It is the defect: contract authority depends on a document nobody maintains against it.

**Independent Test**: No line in `specs/003-git-native-grove/contracts/` depends on the proposal; each rule previously imported by reference is stated in the owning contract.

**Acceptance Scenarios**:

1. **Given** `config-v3.md`, **When** a reader looks for the workspace config shape, layout token rules, naming token rules and bounds, Grove metadata shape, or metadata-free Grove behaviour, **Then** each is stated there.
2. **Given** `cli-surface-v3.md`, **When** a reader looks for the creation/recovery grammar, the branch creation matrix, remote-only lookup, revision semantics, `tree remove --forget-settings`, `reconcile` mode rules, and `sync`/`fix` target selection, **Then** each is stated there and agrees with the shipped help and rulings.
3. **Given** `json-results-v1.md`, **When** a reader looks for the stable reason vocabulary, **Then** it is listed there.

---

### User Story 2 - The gap cannot reopen (Priority: P1)

A contract line that depends on the proposal fails the test suite.

**Why this priority**: Without a gate this regresses silently, as it did after G-13.

**Independent Test**: Reintroducing "Normative source: proposal section 5" into a v3 contract fails `tests/module/citations.test.ts`.

**Acceptance Scenarios**:

1. **Given** a v3 contract line mentioning the proposal, **When** it does not mark the reference historical, void, or not normative, **Then** the citations test fails naming the line.

---

### User Story 3 - The proposal leaves the tree (Priority: P2)

With nothing normative depending on it, the proposal is deleted like the other historical documents and remains readable from history.

**Independent Test**: `docs/` is gone; `specs/README.md` lists the proposal under removed historical documents with a `git show` pointer that resolves.

### Edge Cases

- Where the proposal and a ruling disagree, the ruling wins and the contract states the ruling's rule, not the proposal's.
- Where the proposal and the shipped CLI disagree and no ruling covers it, the contract states the shipped behaviour only if an existing witness already proves it; otherwise the difference is recorded as an open question rather than silently resolved.
- Historical mentions of the proposal in closed specs, plans, and tasks stay as written.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `config-v3.md` MUST state the workspace config shape, layout template rules and tokens, naming template tokens and bounds, Grove metadata and archive-snapshot shape, and metadata-free Grove behaviour, and MUST NOT name the proposal as a source.
- **FR-002**: `cli-surface-v3.md` MUST state the creation/recovery grammar and selection rules, the branch creation matrix, remote-only lookup, revision semantics, `--forget-settings`, `reconcile` modes, and `sync`/`fix` target selection, matching the shipped help and rulings ①–⑤.
- **FR-003**: `json-results-v1.md` MUST list the stable reason vocabulary and MUST NOT name the proposal as a source.
- **FR-004**: A module test MUST fail when any line in `specs/003-git-native-grove/contracts/` mentions the proposal without marking it historical, void, or not normative.
- **FR-005**: No runtime behaviour, help text, or test expectation changes.
- **FR-006**: Delete `docs/git-native-grove-proposal.md` and list it in `specs/README.md` under removed historical documents.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **010-self-contained-v3-contracts-SC-001**: Zero lines in the v3 contracts depend on the proposal.
- **010-self-contained-v3-contracts-SC-002**: Every rule listed in FR-001–FR-003 is findable in its owning contract, and every grammar line matches the shipped `--help` usage.
- **010-self-contained-v3-contracts-SC-003**: Reintroducing a proposal-dependent line fails the test suite.
- **010-self-contained-v3-contracts-SC-004**: Typecheck, all test layers, scan, and traceability pass with no changes under `src/`.

## Resolved differences

Two places where the proposal and the shipped CLI disagree with no ruling were settled by existing witnesses, so the contracts state the shipped behaviour and no open question remains:

- **Derived branch that already exists.** The proposal's matrix adopts it; the CLI refuses. Stable scenario `TREE-15` and `FR-018` require the refusal and are witnessed (`tests/cli/tree-scenarios.test.ts`, `tests/module/operation-v3.test.ts`).
- **`fix --move` with no diagnostic or filter.** The proposal uses the containing Grove and refuses at workspace level; the CLI considers every unambiguous move in the workspace, as exercised by `tests/cli/adoption-v3.test.ts` and `tests/cli/process-scenarios.test.ts`.

## Assumptions

- The corrective rulings in `cli-surface-v3.md`, Decisions 001–003, and later features (including `009`) are authoritative over the proposal.
- The shipped CLI registry is the single source of command grammar (constitution: one schema per command), so the contract grammar is written to match it.
- The constitution's statement that the proposal is historical input stays true after deletion and needs no amendment.
