# Feature Specification: Repository default policy

**Feature Branch**: `002-work-safety-force`

**Feature Directory**: `003-repository-default-policy`

**Created**: 2026-08-20

**Status**: Complete

**Input**: User description: "Replace the stored repository trunk snapshot with one shared default-branch policy for managed and linked repositories; keep only an optional repository override, add offline-safe repository configuration, and explain linked worktree conflicts."

**Authority**: `.specify/memory/constitution.md` Principles III and V · `specs/001-grove-cli/contracts/cli-surface.md` §8.4 and §8.4.1 · `specs/001-grove-cli/contracts/acceptance-scenarios.md` §11 (`REPO-*`, `TRUNK-*`)

**Decision record**: `docs/decisions-and-tasks-20260820.md` D1–D5 and D8

**Finding addressed**: `docs/reviews/consolidated-review-20260816.md` P0-8

---

## Why this feature exists

Before this feature, repository registration snapshotted `trunk` from two different sources: a managed clone's Git HEAD and a linked checkout's currently checked-out branch. The linked value is not a repository default at all, becomes stale as external Git state changes, and is then reused as the starting and comparison branch throughout Grove. This duplicates mutable Git state in workspace configuration and violates the single-source-of-truth rule.

The repository default, an actual trunk worktree, and a Grove comparison base are separate facts. This feature gives each one an unambiguous owner and makes managed and linked repositories resolve their defaults identically.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Use the repository's real default branch (Priority: P1)

A developer registers either a managed clone or an existing linked checkout. Grove uses the same repository-default policy in both modes and never mistakes the linked checkout's current feature branch for the repository default.

**Why this priority**: Every newly created branch depends on the resolved repository default. A wrong answer silently creates work from the wrong history.

**Independent Test**: Register managed and linked fixtures whose checked-out branch differs from the selected remote's default, create Trees, and prove both use the effective default specified by the §8.4 contract amendment.

**Normative acceptance**: §11 REPO-20, REPO-21, REPO-24, REPO-26, REPO-27, REPO-28, and TREE-24.

---

### User Story 2 - Override repository policy without re-registering (Priority: P1)

A developer with a local-only repository, multiple remotes, or an intentionally nonstandard default can set or clear repository policy without removing Groves that already reference the repository.

**Why this priority**: A remote-less linked repository has no stable Git-owned default metadata, and remove-and-re-link is blocked while Groves reference it. An optional override is the only workspace-local, correctable source for that case.

**Independent Test**: Configure, clear, and replace the default-branch override and selected remote using only local Git state, proving invalid changes leave the previous configuration byte-for-byte usable.

**Normative acceptance**: §11 REPO-22, REPO-23, REPO-24, and REPO-27.

---

### User Story 3 - Understand linked worktree coupling (Priority: P2)

A developer choosing between `repo add` and `repo link` can see that linked mode shares Git worktree administration with the original checkout and can choose managed mode when isolation matters.

**Why this priority**: Linked mode is useful, but its shared branch-checkout constraint is externally visible and can surprise users or their IDEs.

**Independent Test**: Inspect help and add an explicit trunk to a linked repository, proving the documented warning appears in human and structured output while no default trunk is auto-created.

**Normative acceptance**: §11 REPO-25, TRUNK-10, and TRUNK-11.

### Edge Cases

The authoritative edge behavior is §8.4–§8.4.1 and §11 REPO-20…REPO-28, TREE-24, and TRUNK-10…TRUNK-11. This feature introduces no second statement of those rules.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Implement the repository data ownership defined by §4 and §8.4.
- **FR-002**: Implement effective-default resolution exactly as defined by §8.4.
- **FR-003**: Route registration and all default consumers through §8.4 and §8.7.
- **FR-004**: Implement repository policy configuration under §8.4 and §6 mutation rules.
- **FR-005**: Implement linked registration/help and explicit trunks under §8.4–§8.4.1.
- **FR-006**: Apply the direct version transition governed by §4 and §9; add no legacy path.
- **FR-007**: Test the feature through the cited §11 scenarios before changing implementation.

### Key Entities

Entity ownership is normative in §4, §8.4, and `specs/001-grove-cli/data-model.md`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **003-repository-default-policy-SC-001**: In 100% of managed/linked parity scenarios, equivalent local Git metadata resolves the same default branch regardless of the linked checkout's current branch.
- **003-repository-default-policy-SC-002**: Every tested command that needs a default follows exactly one observable resolution order and refuses when neither source resolves; zero cases guess `main` or checkout HEAD.
- **003-repository-default-policy-SC-003**: All four repository-policy configuration operations complete without network access and leave invalid attempted changes with zero persisted configuration mutation.
- **003-repository-default-policy-SC-004**: Help and runtime output communicate the linked one-location constraint in both human and JSON modes, with JSON stdout parseable as exactly one value.
- **003-repository-default-policy-SC-005**: The full typecheck, test, provenance scan, and scenario-traceability gates pass with no compatibility path for the superseded workspace schema.

## Assumptions

- The selected remote's locally cached symbolic HEAD is the Git-owned default metadata available to offline commands; Grove does not query a hosting service.
- Clearing policy is allowed even when it leaves no effective default; commands that need the value refuse at use time.
- Existing Groves and fixtures are development data. There is no adopted production schema to migrate or preserve.
- P1-5 shared health diagnostics and P2-11 removal of `grove diff` are separate later features.
