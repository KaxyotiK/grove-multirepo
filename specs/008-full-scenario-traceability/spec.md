# Feature Specification: Full scenario traceability

**Feature Branch**: `002-work-safety-force`

**Feature Directory**: `008-full-scenario-traceability`

**Created**: 2026-08-20

**Status**: Complete

**Input**: User description: "Turn all authoritative acceptance scenarios into non-vacuous, gated tests family by family."

**Authority**: Constitution Development Workflow, §11 in `specs/001-grove-cli/contracts/acceptance-scenarios.md`, and 001-grove-cli-SC-006.

**Baseline**: 180 scenarios; 69 cited in executable test titles and 111 uncited immediately before implementation on 2026-08-20.

## Why this feature exists

The current traceability script gates only ARCH and REPO. Most authoritative scenarios can change without a named witness, and merely adding an ID to a nearby test can make a metric green without proving the result. The project needs family-by-family coverage where every citation corresponds to an assertion that exercises the contracted setup and result.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Trust every contract scenario (Priority: P1)

A maintainer can find at least one executable, non-vacuous witness for every §11 scenario.

**Why this priority**: A normative rule without a witness can drift silently.

**Independent Test**: For one family, map every ID to an existing complete test or add the missing witness, then deliberately break one expected result and observe the family gate fail.

**Normative acceptance**: All §11 scenario families and 001-grove-cli-SC-006.

---

### User Story 2 - Prevent new traceability gaps (Priority: P1)

A maintainer adding or changing a scenario receives a failing gate until a named witness exists.

**Why this priority**: Coverage must remain complete after the cleanup campaign.

**Independent Test**: Add a temporary scenario ID and verify the generic traceability gate reports that exact uncited ID; add a duplicate ID and verify it also fails.

**Normative acceptance**: Constitution scenario-traceability governance.

---

### User Story 3 - Reject test theatre (Priority: P2)

A reviewer can distinguish a true witness from an ID pasted into an unrelated or assertion-free test.

**Why this priority**: Citation coverage alone measures spelling, not behavior.

**Independent Test**: Mutation-check representative witnesses in each layer and require the test to fail.

**Normative acceptance**: Constitution tests-first and review requirements.

### Edge Cases

The campaign first validates scenario reachability and constitutional consistency. An impossible or contradictory scenario is corrected in the owning contract before any test is credited. Planned scenarios from features 004–007 become gateable only when those features land.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Audit every §11 scenario for unique ID, reachability, and consistency before crediting coverage.
- **FR-002**: Map every scenario to at least one test whose name cites the exact ID and whose assertions prove its expected result.
- **FR-003**: Expand the traceability gate generically to every scenario family without a hardcoded family count.
- **FR-004**: Fail on uncited IDs, duplicate scenario IDs, unknown test citations, and expired deferrals.
- **FR-005**: Add or strengthen tests family by family; do not satisfy gaps with comment-only citations.
- **FR-006**: Integrate feature 004/005/007 witnesses before gating their new or formerly deferred IDs.
- **FR-007**: Add representative mutation checks proving the witness set is non-vacuous.
- **FR-008**: Keep all new tests isolated, local-only, deterministic, and within existing test layers.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **008-full-scenario-traceability-SC-001**: 100% of unique §11 scenario IDs have at least one named executable witness.
- **008-full-scenario-traceability-SC-002**: Zero duplicate IDs, unknown citations, or permanent deferrals remain.
- **008-full-scenario-traceability-SC-003**: Every family is enforced by one generic gating script on every test run/CI run.
- **008-full-scenario-traceability-SC-004**: Representative mutation checks fail in every §11 test layer.
- **008-full-scenario-traceability-SC-005**: Full tests, scan, and traceability pass on macOS and Linux.

## Assumptions

- Existing tests may receive an ID only after their setup and assertions are shown to cover the scenario fully.
- One test may witness multiple IDs when it independently asserts each expected result.
- New product features are out of scope; defects exposed by authoritative witnesses are fixed against the constitution and accepted decisions.
- Features 004, 005, and 007 land before their dependent traceability phases close.
