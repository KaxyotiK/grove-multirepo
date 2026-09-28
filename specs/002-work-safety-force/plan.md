# Implementation Plan: Derive `--force` from what each command destroys

**Branch**: `002-work-safety-force` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-work-safety-force/spec.md`

## Summary

Constitution 2.0.0 replaced an asserted per-command blocker list with a derivation: an operation is destructive exactly when it removes data that exists nowhere else, and each command's blockers follow from what that command actually removes. The implementation still enforces the superseded rule.

The technical core is one predicate, correctly scoped. Replace the "does `refs/remotes/origin/<b>` exist" test with a reachability test — _has this branch a commit reachable from no ref that survives the operation?_ — and pass the **surviving-ref set** in per command, because it differs: `archive`, `delete`, and `repo delete-branch` remove named refs from a repository that survives, while `repo remove` on a managed repository deletes the object store and every local ref in it. Refs removed together are judged together, in one `rev-list`, or each vouches for the next and their shared commits are destroyed silently (research R3).

Around that predicate: the classifier stops throwing on unreadable worktrees and returns `unknown` instead, which lets `--force` classify before acting and report what it destroyed — the thing it cannot do today, because it skips classification entirely. Each command's blocker list is then derived from the §8.5.1 destruction table rather than asserted. `repo add`'s rollback stops removing a directory it did not create.

This is a behaviour change, so the contracts and 001's spec change with it: §8.5.1 is rewritten, `ARCH-*` scenarios are re-expressed and extended, and 001's FR-023/002-work-safety-force-SC-003 are rewritten to **cite** §8.5.1 instead of restating it — the restatement is what let the rule drift in the first place (finding C1).

## Technical Context

**Language/Version**: Strict TypeScript on ESM; Node ≥24. Unchanged.

**Primary Dependencies**: Node standard library only. Git is the external process dependency. No new dependency — the whole feature is `git rev-list` invocations and control flow.

**Storage**: None added. `TreeEntry.provenance` already exists (research R7), so `schemaVersion` does not move and there is no migration surface. Principle V refuses unknown manifest keys, so adding one would have been a breaking change.

**Testing**: `node:test` across the existing three §11 layers — module tests against `src/`, CLI subprocess tests against `dist/grove.mjs`, e2e under an isolated npm prefix. All fixtures are local `file://` remotes; the suite runs offline. Every new test cites its §11 scenario ID in the title.

**Target Platform**: macOS and Linux. Unchanged.

**Project Type**: Single-package CLI. Unchanged — no new commands, no new flags, no new surface.

**Performance Goals**: Not throughput-bound, but classification moves from one `show-ref` per Tree to one `rev-list` per Tree. `rev-list --count` on a doomed-ref set is bounded by history size; the `--not` set makes it terminate at the first surviving ref in practice. `repo remove` (managed) becomes cheaper: today it loops every branch in the store issuing two Git calls each, and can collapse to one whole-store judgment plus one call per named blocker.

**Constraints**: Network-free (FR-002, 002-work-safety-force-SC-007) — every judgment reads refs already on disk. Unchanged §6 locking and §6.1 journaling; classification happens inside the existing envelope. Exit codes unchanged: work-safety refusals stay `3`.

**Scale/Scope**: Four command families (`archive`/`delete`, `repo remove`, `repo delete-branch`, `repo add` rollback), one classifier module, one refusal/report module. Roughly 25 §11 scenario IDs, of which 15 are new.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._ Evaluated against constitution **2.0.0**.

| Principle | How this plan complies | Gate |
|---|---|---|
| I. One Command, No Background | No process, listener, or persisted state added. Classification happens inside the existing invocation and is discarded on exit. The `DiscardReport` is printed, never written. | PASS |
| II. Workspace-Local State Only | Reads only refs inside repositories the workspace already manages, plus the existing manifests. Writes nothing new. No `GROVE_*` reads. | PASS |
| III. Single Source of Truth | `provenance` stays owned by the manifest and is *read* here, not duplicated — this feature exists partly because the teardown consulted it while the check did not. No new fact is stored anywhere. The §8.5.1 destruction table is stated once, in the contract, and cited from code. | PASS |
| IV. Safety by Construction | This feature *is* the Principle IV amendment. Blockers derived from the destruction table; refusals itemize; `--force` reports what it discarded; `unknown` fails CLOSED; network-free. Locking and §6.1 journaling unchanged. | PASS |
| V. Refuse, Never Guess | `unknown` is never collapsed into `dirty` or `safe`. `repo add` refuses an occupied object-store path instead of clearing it. Every refusal keeps what/why/remedy and exit `3`. | PASS |
| VI. No Legacy Creep | No code copied from the pinned source; no excluded provenance touched; no legacy vocabulary. PROC-07 scan unaffected. | PASS |
| Tech & Artifact Constraints | No dependency added, no new command or flag, kebab-case unchanged, `--json` remains exactly one JSON value. | PASS |
| Dev Workflow & Quality Gates | Tests-first per §12; contracts and constitution already amended together (commit `926ea6a`); every scenario cited by ID (FR-013); three §11 layers gate completion. | PASS |

**Re-check after Phase 1**: PASS, with one finding. Phase 0 research invalidated `FR-001` as first written — a single ref universe is provably wrong for one of the two command scopes, and would have silently destroyed tag-held commits under `repo remove`. The spec was corrected (`FR-001` parameterized, `FR-001a` added) _before_ this gate, so no violation is carried forward. This is recorded rather than hidden because it is exactly the class of drift the traceability rule exists to catch.

No violations. **Complexity Tracking is empty by design.**

## Project Structure

### Documentation (this feature)

```text
specs/002-work-safety-force/
├── spec.md                      # Feature specification
├── plan.md                      # This file
├── research.md                  # Phase 0 — R1–R7, all empirically verified
├── data-model.md                # Phase 1 — SurvivingRefs, TreeSafety, DiscardReport, derivation table
├── quickstart.md                # Phase 1 — offline validation, 7 parts
├── contracts/                   # Phase 1 — staged deltas to the 001 contracts, NOT a parallel spec
│   ├── README.md                #   why these are deltas and must not be cited
│   ├── work-safety.md           #   AM-001, AM-002 — replacement §8.5.1
│   ├── acceptance-scenarios.md  #   AM-003 — rewritten + new ARCH-*/REPO-* rows
│   └── json-output.md           #   AM-001 (JSON) — refusal detail + discard report
├── checklists/requirements.md   # Spec quality checklist
└── tasks.md                     # Created by /speckit-tasks — NOT this command
```

### Source Code (repository root)

```text
src/
├── git/
│   └── worktree.ts        # classifyWork: reachability predicate; return `unknown`, stop throwing
├── model/
│   └── safety.ts          # SurvivingRefs; classifyGrove takes it; refuseUnsafe renders blockers;
│                          # NEW: the destruction table as data + blockersFor() — the chokepoint;
│                          # NEW: buildDiscardReport() shared by every forcing command
├── commands/
│   ├── lifecycle.ts       # archive/delete: drop the `force ? [] : classify` guard; derive blockers
│   │                      # from the §8.5.1 table; emit `discarded` / `localOnly`
│   └── repo.ts            # repo remove: scope-B predicate, skip work-safety for linked;
│                          # repo add: refuse an occupied store path, rollback only what it created
├── commands/tree.ts       # tree remove --force: emit `discarded`
├── commands/trunk.ts      # trunk remove --force: emit `discarded` (absent from the first pass)
└── errors.ts              # unchanged — `detail` already carries structured fields

tests/
├── module/safety.test.ts     # predicate under both scopes, sibling refs, both fail-open spellings
├── cli/lifecycle.test.ts     # ARCH-03/04/08/09/10/14/15/16 rewritten; ARCH-17–25 new
├── cli/repo.test.ts          # REPO-11–15 new
└── testkit/                  # NEW fixture builder: merged / at-risk / tag-held / sibling branches
```

**Structure Decision**: No new modules and no new directories. The destruction table lives in `model/safety.ts` **as data**, and `blockersFor()` is the single function every destructive path is forced through. The retro's Mode 3 — "one correct pattern, re-implemented wrong elsewhere" — is precisely what a per-handler derivation reproduces: work-safety would again be a convention rather than a chokepoint, and conventions drift. `trunk remove` is the proof that they already have.

The predicate belongs in `git/worktree.ts` beside the classification it corrects; the surviving-ref parameter and the derivation belong in `model/safety.ts`, which already owns `TreeSafety` and `refuseUnsafe`. The one genuinely new function is `buildDiscardReport()`, placed there rather than duplicated across `lifecycle.ts` and `repo.ts` — four commands must report identically, and a second copy is how the two halves of a rule drift apart.

The testkit fixture builder is the load-bearing test change. Research R4 showed both wrong `rev-list` spellings pass against a fixture containing only safe branches; a fixture with a **genuinely unreachable commit** is what distinguishes them. Every work-safety test must build on it.

## Implementation Phasing

Tests first in every phase — author the scenarios so they fail, then implement to green.

1. **Fixture + predicate (module layer).** Testkit builder producing merged / at-risk / tag-held / pushed / sibling branches. Module tests asserting both scopes, `FR-001a` siblings, and that both fail-open spellings are rejected. Then the predicate in `git/worktree.ts`. Exit: module tests green; the two wrong spellings demonstrably fail the suite.
2. **`unknown` state.** `classifyWork` returns `unknown` with `problem` instead of throwing; `classifyGrove` carries `provenance` through. Exit: `ARCH-23` blocks, and classification under `--force` no longer needs the guard.
3. **Derived blockers + discard report.** `SurvivingRefs` threaded through `classifyGrove`; `refuseUnsafe` derives from the destruction table; `buildDiscardReport()` added; `lifecycle.ts` drops the `force ? []` guard. Exit: `ARCH-03/04/17–22/24` green at layers 1–2, `--json` shape per `contracts/json-output.md`.
4. **`repo` commands.** `repo remove` scope-B predicate and the linked-repository skip, preserving the Grove-reference refusal; `repo add` pre-flight on an occupied store path with a created-only rollback. Exit: `REPO-11–15` green.
5. **Contract and 001-spec amendments.** Apply AM-001/002/003 from `contracts/`; rewrite 001 `spec.md` FR-023 and 002-work-safety-force-SC-003 to cite §8.5.1 (AM-004); re-run 001 `plan.md`'s Constitution Check against 2.0.0 (AM-005). Exit: `/speckit-analyze` reports no contradiction between spec, contracts, and code. 6a. **Chokepoint gate.** A dispatch-level test enumerating every handler with a `force` option and asserting each has a table entry (002-work-safety-force-SC-008). Exit: a destructive command cannot be added without an entry.
6. **Traceability gate.** Every `ARCH-*` and new `REPO-*` ID cited by a test; add the grep gate from quickstart Part 7 to CI. Exit: 002-work-safety-force-SC-006 — zero uncited IDs; full suite plus PROC-07 scan green on macOS and Linux.

7. **Adversarial rounds to convergence.** Fan-out by command family, live repro before acceptance, class-sweep before instance-fix, loop until a round returns nothing (002-work-safety-force-SC-009). Budgeted as a build phase per `docs/retro-failure-analysis.md`, which records that this — not the green suite — is what found every P0 and P1 in the previous build.

**Ordering constraint**: phase 5 must not run before phases 1–4 are green. Amending the contract first would leave the repository in the state this feature exists to end — a spec that says one thing while the code does another.

## Complexity Tracking

> No Constitution Check violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
