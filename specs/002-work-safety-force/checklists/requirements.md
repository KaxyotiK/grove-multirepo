# Specification Quality Checklist: Derive `--force` from what each command destroys

**Purpose**: Validate specification completeness and quality before proceeding to planning **Created**: 2026-08-16 **Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation notes

**Iteration 1 findings, all resolved in the spec:**

1. _Implementation detail leak._ The feature request named the exact predicate (`git rev-list --count <b> --not --exclude=<b> --branches --remotes --tags`). The spec states the **rule** instead — "at least one commit reachable from no other ref in the repository, considering all local branches, all remote-tracking refs, and all tags" (FR-001) — and leaves the invocation to `plan.md`. The predicate was verified empirically before this spec was written — `git rev-list --count <b> --not --exclude=<b> --branches --remotes --tags`, which returned `1` for a branch with a genuinely unique commit and `0` for two merged branches. Two earlier formulations were wrong (`--all` re-includes per-worktree `HEAD`; `--exclude` matches _without_ the `refs/heads/` prefix against `--branches`). `/speckit-plan` must record the working form and both traps.

2. _Unresolved contradiction, not a clarification._ §8.5.1 item 3 ("a dirty Tree refuses even with `--force`") and 001's FR-023 ("a forced archive discards dirty work just as a forced delete does") have contradicted each other since they were written. This is finding C1's actual shape. Rather than raise a `[NEEDS CLARIFICATION]`, the spec resolves it against the constitution, which is non-negotiable in this scope and states the only override is each command's `--force` flag. Recorded as **AM-002** with the reasoning, and **AM-003** carries it into ARCH-04.

3. _Scope creep guard._ `repo remove`'s Grove-reference refusal looks like a work-safety blocker but is referential integrity — it blocks with `--force` and must keep doing so. Called out in Story 4 scenario 2 and in Assumptions so it is not "fixed" by mistake.

4. _Unverifiable success criterion._ An early 002-work-safety-force-SC-002 read "no false-positive refusals remain", which no test can prove. Rewritten as a procedure: for each provokable refusal, force the same command and confirm the named data is in fact gone.

**Facts verified against the working tree before writing** (so the spec's claims are not assumed):

- `src/git/worktree.ts` `classifyWork` — the `show-ref refs/remotes/origin/<b>` existence test is the false-positive source (FR-001).
- `src/commands/lifecycle.ts` — both `archive` and `delete` do `parsed.values.force ? [] : await classifyGrove(...)`, i.e. `--force` skips classification outright, so nothing can be reported (FR-011).
- `src/model/safety.ts` — `refuseUnsafe` already itemizes blockers well; the defect is _which_ blockers it is given, not the message shape. FR-010 largely codifies existing behaviour.
- `src/commands/repo.ts:118` — `rmSync(store, …)` in the catch, unconditional (FR-009).
- `src/commands/repo.ts:271-273` — the remote-less refusal fires for linked repositories, whose checkouts the command never touches (FR-007).
- `src/model/types.ts:60` — `provenance` is recorded per `TreeEntry`, so FR-006's created/adopted derivation reads data that already exists.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
- **AM-001 … AM-005 are prerequisites, not optional follow-ups.** `/speckit-plan` must schedule the contract and 001-spec edits alongside the code, or `/speckit-analyze` will report the same spec-vs-code contradiction this feature exists to remove.
