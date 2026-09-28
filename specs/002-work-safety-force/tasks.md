> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

---

description: "Task list for 002-work-safety-force"
---

# Tasks: Derive `--force` from what each command destroys

**Input**: Design documents from `/specs/002-work-safety-force/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: **REQUIRED, not optional.** The constitution mandates tests-first ("author the applicable test scenarios before the implementing modules exist so they initially fail, then implement to green") and FR-013 requires every test to cite its §11 scenario ID in its title. Test tasks below are therefore first-class and gate their implementation tasks.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5 map to the user stories in spec.md
- Exact file paths are given in every task

## Path Conventions

Single package, flat `src/` tree at repository root; three test layers under `tests/` (`module/`, `cli/`, `e2e/`) with shared fixtures in `tests/testkit/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The fixture every work-safety test depends on. Research R4 showed both wrong `rev-list` spellings pass against a fixture of only-safe branches — so the fixture itself is the gate, and it comes first.

- [ ] T001 Extend `tests/testkit/fixture.ts` with a `makeSafetyRepo()` builder producing the five branch shapes from research.md: `merged` (commit merged into trunk, never pushed alone), `unique` (commit reachable from nothing else), `tagged` (commit reachable only via a tag), `pushed` (has an `origin/` counterpart), and a `pairA`/`pairB` sibling pair pointing at one otherwise-unreachable commit. All local `file://` remotes, offline.
- [ ] T002 [P] Add `tests/testkit/unreadable.ts` helper that makes a worktree's git state unreadable (permissions or a corrupted `.git` file) so `unknown`-state scenarios ARCH-23/ARCH-24 are testable and restorable in teardown.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The predicate and the type changes every user story sits on. Nothing in Phase 3+ can be built or tested until these are done.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Write failing module tests in `tests/module/work-safety.test.ts` for the reachability predicate under **scope A** (repository survives): `merged`→safe, `unique`→at-risk, `tagged`→safe, `pushed`→safe, using `makeSafetyRepo()` from T001.
- [ ] T004 [P] Write failing module tests in `tests/module/work-safety.test.ts` for **scope B** (object store deleted): `tagged` flips to at-risk while `merged`/`pushed` stay safe — the divergence that makes the surviving-ref set a parameter (research R2).
- [ ] T005 [P] Write a failing module test in `tests/module/work-safety.test.ts` for FR-001a: sibling refs `pairA`/`pairB` judged **together** report at-risk; assert explicitly that judging `pairA` alone returns "safe" so the regression is pinned as a known-wrong answer, not an accident.
- [ ] T006 [P] Write failing module tests in `tests/module/work-safety.test.ts` rejecting both fail-open spellings from research R4: `--exclude=refs/heads/<b>` and `--exclude=<b> --all` must each report a genuinely at-risk commit as safe, proving the suite would catch a regression to either.
- [ ] T006a [P] Write a failing module test in `tests/module/work-safety.test.ts` for FR-002a: when the reachability query cannot be completed — a ref that does not resolve, an absent or unreadable object store, a non-zero exit, or output that is not a count — the branch classifies **unknown**, never `safe`. `Number("")` is `0`, so the naive implementation returns the optimistic answer; this test is what stops the fail-open defect being reintroduced in the predicate that replaces it.
- [ ] T007 Add the `SurvivingRefs` type (`scope: "repository" | "remote-only"`, `removed: string[]`) to `src/model/safety.ts` per data-model.md.
- [ ] T008 Replace the `origin/<branch>` existence test in `src/git/worktree.ts` `classifyWork` with the verified predicate `git rev-list --count <ref> --not --exclude=<name>… --branches --remotes --tags` (scope A) / `--not --remotes` (scope B), taking `SurvivingRefs` as a parameter. Excludes use **bare** branch names and the invocation MUST NOT use `--all`. Makes T003–T006 green.
- [ ] T009 Redefine `WorkState` in `src/git/worktree.ts` per data-model.md: remove `unpushed`, add `at-risk-local` and `unknown`, rename `synced`→`safe`. Update every referencing site so `npm run typecheck` passes.
- [ ] T010 Make `classifyWork` return `{ state: "unknown", problem }` instead of throwing when the worktree state cannot be read (FR-003, research R5), and carry `provenance` and `problem` through `classifyGrove` in `src/model/safety.ts` per the extended `TreeSafety` shape.
- [ ] T010a Make the reachability judgment fail CLOSED per FR-002a in `src/git/worktree.ts`: return `{ state: "unknown", problem }` on a non-zero exit, an unresolvable ref, or stdout that does not parse as an integer. Do **not** funnel the error branch through the same numeric path as success — the success and error branches must be distinguishable, which is the whole lesson of the fail-open class. Makes T006a green.
- [ ] T010b Add the destruction table to `src/model/safety.ts` as a single exported constant keyed by command identity (`archive`, `delete`, `repo-remove-managed`, `repo-remove-linked`, `repo-delete-branch`, `tree-remove`, `trunk-remove`), with one boolean per column of the data-model.md table, and a `blockersFor(command, report)` function that derives the blocker list from it. **This is the chokepoint** (FR-004a): every destructive command calls it, no handler re-expresses the table. `blockersFor` throws on an unknown command rather than returning an empty list, so a destructive command added later cannot opt out by omission.
- [ ] T010c Add a dispatch-level test in `tests/module/dispatch-audit.test.ts` asserting that every command handler declaring a `force` option has an entry in the T010b table (002-work-safety-force-SC-008). This is the gate that would have caught `tree remove` and `trunk remove`; without it the table is a convention again, and conventions drift.

**Checkpoint**: The predicate is correct, fails closed, and the derivation has exactly one home. User stories can now proceed.

---

## Phase 3: User Story 1 — Archive finished work without being told it is at risk (Priority: P1) 🎯 MVP

**Goal**: `archive` stops blocking on branches and loose files it preserves, and stops reporting merged branches as at-risk.

**Independent Test**: Create a Grove, commit in a Tree, merge that branch into the trunk, archive without `--force`. It succeeds and the branch ref survives.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [ ] T011 [P] [US1] Write failing CLI test `ARCH-17` in `tests/cli/lifecycle.test.ts`: archive a Grove whose Trees are clean and whose commits are all reachable from the trunk, without `--force` → exits 0.
- [ ] T012 [P] [US1] Write failing CLI test `ARCH-18` in `tests/cli/lifecycle.test.ts`: archive a Grove with a clean at-risk-local Tree without `--force` → succeeds, and `--json` carries the branch in `localOnly`; assert the ref still exists in the object store afterwards.
- [ ] T013 [P] [US1] Write failing CLI test `ARCH-19` in `tests/cli/lifecycle.test.ts`: archive a Grove containing a loose non-git file without `--force` → succeeds and the file is present under `groves/.archive/<name>/`.
- [ ] T014 [P] [US1] Rewrite CLI test `ARCH-03` in `tests/cli/lifecycle.test.ts`: archive with one dirty and one at-risk-local Tree refuses naming **only** the dirty Tree; assert the at-risk branch is absent from the refusal.
- [ ] T015 [P] [US1] Rewrite CLI test `ARCH-14` in `tests/cli/lifecycle.test.ts`: a lone untracked file still makes the Tree dirty and still refuses archive.

### Implementation for User Story 1

- [ ] T016 [US1] Call `blockersFor("archive", …)` from T010b in `src/commands/lifecycle.ts`, passing no `removed` refs since archive removes none. Do not restate the blocker list here — the table already says dirty and unknown Trees only; this task wires the handler to it.
- [ ] T017 [US1] Emit the `localOnly` field on archive success in `src/commands/lifecycle.ts` per `contracts/json-output.md`, listing branches now reachable from no other ref. It is informational and MUST NOT set `discarded.nothing` to false.
- [ ] T018 [US1] Update the stale docblock at the top of `src/commands/lifecycle.ts`, which still states "Archive never discards uncommitted work (dirty refuses even with --force)" — superseded by AM-002.

**Checkpoint**: US1 fully functional. 002-work-safety-force-SC-001 met — the everyday false positive is gone.

---

## Phase 4: User Story 2 — Delete refuses only for what delete removes (Priority: P1)

**Goal**: `delete` stops blocking on `adopted` refs it retains, and correctly blocks on sibling `created` refs that would otherwise vouch for each other.

**Independent Test**: Build a Grove with one created and one adopted Tree, both clean with local-only commits; `delete` without `--force` names only the created one.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [ ] T019 [P] [US2] Write failing CLI test `ARCH-20` in `tests/cli/lifecycle.test.ts`: a clean, at-risk-local **adopted** Tree does not block `delete` without `--force`.
- [ ] T020 [P] [US2] Write failing CLI test `ARCH-21` in `tests/cli/lifecycle.test.ts`: a Grove with two `created` Trees whose branches point at the same otherwise-unreachable commit blocks `delete` and names **both**. This is the FR-001a data-loss case at the CLI layer.
- [ ] T021 [P] [US2] Rewrite CLI tests `ARCH-08` and `ARCH-15` in `tests/cli/lifecycle.test.ts` for at-risk-local `created` Trees and dirty Trees respectively, asserting the itemized blocker list.
- [ ] T022 [P] [US2] Rewrite CLI test `ARCH-10` in `tests/cli/lifecycle.test.ts`: deleting an archived Grove whose torn-down `created` Tree is at-risk-local blocks without `--force`.

### Implementation for User Story 2

- [ ] T023 [US2] Collect every `created` Tree branch in the Grove into one `SurvivingRefs.removed` set in `src/commands/lifecycle.ts` **before** classifying, so siblings are judged together (FR-001a). Judging per-Tree here is the data-loss path — do not loop.
- [ ] T024 [US2] Call `blockersFor("delete", …)` from T010b in `src/commands/lifecycle.ts` with the `created` ref set from T023. The table supplies the columns — dirty, unknown, at-risk-local `created`, loose — so this handler must not re-express them.
- [ ] T025 [US2] Rewrite `refuseUnsafe` in `src/model/safety.ts` to build the itemized `blockers` array of `contracts/json-output.md` (one entry per blocker, with `kind` discriminator) rather than the current state-bucketed string list, keeping exit code `5` and the what/why/remedy shape.

**Checkpoint**: US1 and US2 both work independently. FR-006 and FR-001a met.

---

## Phase 5: User Story 3 — `--force` reports what it destroyed (Priority: P1)

**Goal**: `--force` classifies before acting and enumerates every discard.

**Independent Test**: Force-delete a Grove with a dirty Tree and a loose file; both are itemized in text and in `--json`.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [ ] T026 [P] [US3] Rewrite CLI test `ARCH-04` in `tests/cli/lifecycle.test.ts`: `archive --force` with a dirty Tree now **succeeds**, discarding the uncommitted work and itemizing it. This reverses the previous expectation — cite AM-002 in a comment so the reversal is not read as a bug.
- [ ] T027 [P] [US3] Rewrite CLI tests `ARCH-09` and `ARCH-16` in `tests/cli/lifecycle.test.ts` to assert the `discarded` payload contents, not merely a zero exit.
- [ ] T028 [P] [US3] Write failing CLI test `ARCH-22` in `tests/cli/lifecycle.test.ts`: force-delete a Grove with nothing at risk → `discarded.nothing === true` and the human output states nothing was discarded, with no warning implying loss.
- [ ] T029 [P] [US3] Write failing CLI tests `ARCH-23` and `ARCH-24` in `tests/cli/lifecycle.test.ts` using the T002 helper: an unreadable Tree blocks without `--force` (fails CLOSED) and, with `--force`, appears in `discarded.unknown` rather than being omitted.
- [ ] T030 [P] [US3] Write a failing module test in `tests/module/work-safety.test.ts` asserting `discarded.branches` excludes refs whose commits survive elsewhere — a `created` ref deleted while its commits live on in the trunk is not a discard.

### Implementation for User Story 3

- [ ] T031 [US3] Add `buildDiscardReport()` to `src/model/safety.ts` producing the `DiscardReport` of data-model.md (`uncommitted`, `branches`, `loose`, `unknown`, `nothing`). One implementation shared by all four forcing commands — do not duplicate per command.
- [ ] T032 [US3] Delete the `parsed.values.force ? [] : await classifyGrove(...)` guard from **both** `archiveHandler` and `deleteHandler` in `src/commands/lifecycle.ts`. Classification now always runs; T010 removed the throw that made the guard necessary.
- [ ] T033 [US3] Emit `discarded` on success from `archive` and `delete` in `src/commands/lifecycle.ts`, in human-readable text and as `--json` fields (FR-011, FR-012).

**Checkpoint**: All three P1 stories complete. The MVP is shippable here.

---

## Phase 6: User Story 4 — Unregistering a repository grove does not own (Priority: P2)

**Goal**: `repo remove` stops refusing on branches it never touches, and uses the correct (remote-only) surviving set for managed stores.

**Independent Test**: Link a remote-less local checkout, `repo remove` without `--force`, confirm it succeeds and the checkout is unchanged.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [ ] T034 [P] [US4] Write failing CLI test `REPO-11` in `tests/cli/trunk-repo.test.ts`: removing a linked repository with no remote and no trunks succeeds without `--force`; assert the checkout's file hashes are unchanged.
- [ ] T035 [P] [US4] Write failing CLI test `REPO-12` in `tests/cli/trunk-repo.test.ts`: a linked repository still referenced by a Grove refuses **even with `--force`** — the referential-integrity refusal must survive this feature untouched.
- [ ] T036 [P] [US4] Write failing CLI test `REPO-13` in `tests/cli/trunk-repo.test.ts`: removing a managed repository whose branches are all reachable from remote-tracking refs succeeds without `--force`.
- [ ] T037 [P] [US4] Write failing CLI test `ARCH-25` in `tests/cli/trunk-repo.test.ts`: a tag-held-only branch does not block `delete` but does block `repo remove` on the managed repository — the scope divergence, asserted end to end.

### Implementation for User Story 4

- [ ] T038 [US4] Skip work-safety entirely for linked repositories in `repoRemoveHandler` (`src/commands/repo.ts`), removing the `repo.remote === null` refusal at `repo.ts:271-273`. Leave the Grove-reference refusal at `repo.ts:243-250` untouched.
- [ ] T039 [US4] Replace the per-branch `origin/<b>` loop in `repoRemoveHandler` (`src/commands/repo.ts`) with a single `scope: "remote-only"` judgment over the managed store, then one named-blocker call per at-risk branch for itemization. Blockers come from `blockersFor("repo-remove-managed", …)` / `blockersFor("repo-remove-linked", …)`, not from a list written in this handler.
- [ ] T040 [US4] Emit `discarded` from `repo remove --force` in `src/commands/repo.ts` using `buildDiscardReport()` from T031.
- [ ] T041 [US4] Apply the FR-008 predicate to `repo delete-branch` in `src/commands/repo.ts`, replacing its own `origin/<b>` check with scope A over the single named ref, with blockers from `blockersFor("repo-delete-branch", …)`.

**Checkpoint**: US1–US4 complete.

---

## Phase 7: User Story 5 — A failed `repo add` does not delete a directory it found (Priority: P2)

**Goal**: `repo add`'s rollback removes only what it created.

**Independent Test**: Place a directory at the target object-store path, run `repo add` against an unreachable remote, confirm the directory survives.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [ ] T042 [P] [US5] Write failing CLI test `REPO-14` in `tests/cli/trunk-repo.test.ts`: with a directory already at `.bare/<name>`, `repo add` refuses **before** cloning, names the occupied path, and leaves the directory's contents byte-identical.
- [ ] T043 [P] [US5] Write failing CLI test `REPO-15` in `tests/cli/trunk-repo.test.ts`: with no pre-existing directory, a `repo add` that fails after cloning still rolls back the store it created.

### Implementation for User Story 5

- [ ] T044 [US5] Add a pre-flight check in `repoAddHandler` (`src/commands/repo.ts`) refusing when the target object-store path already exists, with what/why/remedy naming the path.
- [ ] T045 [US5] Scope the rollback in `repoAddHandler` (`src/commands/repo.ts:113-124`) to remove the store only when this invocation created it, replacing the unconditional `rmSync(store, { recursive: true, force: true })`.

**Checkpoint**: All five user stories complete and independently testable.

---

## Phase 8: Contract & 001-spec amendments

**Purpose**: Make the specification match the now-correct code. **Must not run before Phases 3–7 are green** — amending the contract first leaves the repository in exactly the state this feature exists to end.

- [ ] T046 Apply AM-001 and AM-002: replace §8.5.1 in `specs/001-grove-cli/contracts/cli-surface.md` with the staged text from `specs/002-work-safety-force/contracts/work-safety.md`. Do not renumber the section.
- [ ] T047 [P] Apply AM-001 (JSON portion): fold the refusal-detail and discard-report shapes from `specs/002-work-safety-force/contracts/json-output.md` into §8.5.1 of `specs/001-grove-cli/contracts/cli-surface.md`.
- [ ] T048 [P] Apply AM-003: replace the `ARCH-*` rows and append the new `ARCH-17`–`ARCH-25` and `REPO-11`–`REPO-15` rows in `specs/001-grove-cli/contracts/acceptance-scenarios.md` from `specs/002-work-safety-force/contracts/acceptance-scenarios.md`. `ARCH-13` stays absent.
- [ ] T049 Apply AM-004: rewrite FR-023 and 002-work-safety-force-SC-003 in `specs/001-grove-cli/spec.md` to **cite** §8.5.1 instead of restating it. Restating the rule in a third place is what let it drift (finding C1) — the replacement must not reproduce any blocker list.
- [ ] T050 [P] Apply AM-005: re-run the Constitution Check table in `specs/001-grove-cli/plan.md` against constitution 2.0.0, replacing the Principle IV row that describes the superseded rule.
- [ ] T051 [P] Update the §11 scenario count in `specs/001-grove-cli/contracts/README.md` (currently "139 scenario IDs" and "8 of 139 (5.8%) are cited") to the post-feature counts.
- [ ] T052 [P] Close the corresponding findings in `docs/reviews/consolidated-review-20260816.md` — C1, P0-1, P0-2, P0-6, P2-4 — marking each resolved with the tasks that resolved it.
- [ ] T053 Remove the three now-satisfied deferred TODOs from the SYNC IMPACT REPORT in `.specify/memory/constitution.md`. This is a comment-block edit only; the principle text and version 2.0.0 do not change.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T053a Cite the seven `ARCH-*` scenarios this feature does **not** change — ARCH-01, ARCH-02, ARCH-05, ARCH-06, ARCH-07, ARCH-11, ARCH-12 — in whichever existing test already covers each, and write a test where none does. **Zero `ARCH-*` IDs are cited anywhere in `tests/` today**, so T054's gate cannot pass without this. Most are already covered by untitled assertions in `tests/cli/lifecycle.test.ts` (archive-preserves-loose-files → ARCH-01, restore → ARCH-02), so this is largely retitling, not new coverage.
- [ ] T054 Add the traceability gate from quickstart.md Part 7 to `scripts/` and wire it into `.github/workflows/ci.yml`: every `ARCH-*` and `REPO-*` ID in `specs/001-grove-cli/contracts/acceptance-scenarios.md` must be cited by at least one test, failing CI otherwise (002-work-safety-force-SC-006). Depends on T053a. Scope the gate to `ARCH-*` and `REPO-*` for now — the other §11 families are at 6/139 citation and are out of this feature's scope; widening the gate without the coverage to back it would only produce a permanently red build.
- [ ] T055 [P] Audit `grove archive --help`, `grove delete --help`, `grove repo remove --help`, `grove repo delete-branch --help`, `grove tree remove --help`, and `grove trunk remove --help` in `src/commands/lifecycle.ts`, `src/commands/repo.ts`, `src/commands/tree.ts`, and `src/commands/trunk.ts` so each `--force` description states what that command actually destroys, worded from its row in the T010b table. `repo.ts:395` currently says "Discard uncommitted/unpushed work", which uses the removed `unpushed` vocabulary.
- [ ] T056 [P] Grep `src/` and `tests/` for the removed `unpushed` and `synced` vocabulary and replace it with `at-risk-local` / `safe`, including comments and JSON field names.
- [ ] T057 Run `npm run typecheck && npm test && npm run scan`, then walk quickstart.md Parts 1–7 end to end against the built binary.
- [ ] T058 Run `/speckit-analyze` and confirm no contradiction remains between `specs/001-grove-cli/`, `specs/002-work-safety-force/`, the constitution, and the code.
- [ ] T059 [P] Emit `discarded` from `tree remove --force` in `src/commands/tree.ts:151` using `buildDiscardReport()` from T031, and add a citing CLI test in `tests/cli/lifecycle.test.ts`. `tree remove`'s blockers are already correct — it destroys uncommitted work and no ref, which is exactly what it refuses on — but its success payload is `{ grove, removed, branch }` and names nothing it discarded. Required by FR-011, which applies to every command whose `--force` destroys data.
- [ ] T059a [P] Do the same for `trunk remove --force` in `src/commands/trunk.ts` (`removeHandler`, the `forceRemoveWorktree` at ~line 121), with a citing CLI test in `tests/cli/trunk-repo.test.ts`. Identical shape to T059: its refusal already fails closed on `d.problem` and blocks on `d.dirty`, but on success it reports only `Removed trunk <branch>@<repo> (branch ref retained)` while having discarded uncommitted work. It was absent from the destruction table until the retro review; T010c is the gate that stops the next one being missed the same way.
- [ ] T060 [P] Add an offline verification step to `.github/workflows/ci.yml` running the full suite with networking disabled, proving 002-work-safety-force-SC-007 mechanically rather than by inspection. Every fixture is already a local `file://` remote, so this should pass unchanged — the point is that a future change reintroducing a network call fails CI instead of passing review.
- [ ] T061 Verify 002-work-safety-force-SC-002 explicitly: for each refusal the suite can provoke, force the same command and assert the data the refusal named is in fact gone afterwards. A refusal naming data that survives forcing is a false positive by definition, and this is the only check that catches one the derivation table missed.

---

## Phase 10: Adversarial pass (required, not polish)

**Purpose**: `docs/retro-failure-analysis.md` is unambiguous on this — 113 green tests found none of the 2 P0s or ~26 P1s, and two adversarial rounds with live repro found all of them. A suite written alongside the code measures "did I build what I intended", not "is it safe". This phase supplies the second question. It is a build phase, not optional polish.

**Stop condition**: a fresh round that finds nothing new (002-work-safety-force-SC-009). "We are out of ideas" is not a stop condition.

- [ ] T062 Run an adversarial round against the work-safety surface with **one reviewer per command family** — `archive`/`delete`, `repo remove`/`repo delete-branch`/`repo add`, `tree remove`/`trunk remove`, and the predicate itself. Fan-out is what surfaced the same one-line defect duplicated across three files in round 1; a single linear pass normalizes it away. Brief each to **break** the command, not verify it, and to default to the pessimistic reading.
- [ ] T063 Reproduce every candidate finding live before accepting it, and record refuted candidates alongside confirmed ones. No finding is accepted on inspection alone — this is what kept false positives out of rounds 1–2 and what makes the report trustworthy.
- [ ] T064 For each confirmed finding, ask whether it is an **instance or a class**, and sweep the whole command surface for the class before fixing the instance. "Fix delete" would have missed D1, D2, C4, and C5; "sweep all 40 commands for this shape" caught them. `trunk remove` is this feature's own worked example of a class caught one instance too late.
- [ ] T065 Write a regression test citing a §11 scenario ID for every confirmed finding, then repeat T062–T064 until a round returns nothing new (002-work-safety-force-SC-009). Record the rounds and their outcomes in `docs/reviews/`.

**Adversarial fixtures to build, at minimum** — each is a case the happy-path fixture cannot reach:

- an object store deleted out from under a live classification (FR-002a);
- a branch name that is also a valid tag name, and a tag and branch of the same name at different commits;
- a Grove whose Trees span two repositories where one store is readable and the other is not;
- three or more `created` siblings on one commit, not just the two of T005;
- a `--force` run killed between classification and the mutation it authorized;
- a ref name containing a leading `-`, a newline, or a glob character, exercised through `--exclude`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001 blocks all test tasks.
- **Foundational (Phase 2)**: Depends on Phase 1. **Blocks every user story.**
- **User Stories (Phases 3–7)**: All depend on Phase 2. US1, US2, US3 touch overlapping regions of `lifecycle.ts`; US4 and US5 are confined to `repo.ts` and are genuinely parallel to them.
- **Amendments (Phase 8)**: Depends on Phases 3–7 being green. Hard ordering constraint.
- **Polish (Phase 9)**: Depends on Phase 8 (T054's gate reads the amended scenario file).
- **Adversarial (Phase 10)**: Depends on Phase 9. Runs against the finished feature, and loops back into Phases 3–7 whenever it confirms a finding. The feature is not done until a round comes back empty.

### User Story Dependencies

- **US1 (P1)**: After Phase 2. Independent.
- **US2 (P1)**: After Phase 2. Independent of US1, but T025 rewrites `refuseUnsafe`, which US1's refusal tests assert against — sequence US1 → US2 if worked by one person.
- **US3 (P1)**: After Phase 2. Depends on T010 (no-throw) and reads best after US1/US2 exist, since T031's report consumes the same classification.
- **US4 (P2)**: After Phase 2. Fully independent — different file. T040 reuses T031.
- **US5 (P2)**: After Phase 2. Fully independent — no classification involvement at all.

### Parallel Opportunities

- T003–T006 are four independent test tasks against the same new predicate.
- All test-writing tasks within a story are `[P]` — different test names, and in `lifecycle.test.ts` different test bodies.
- **US4 and US5 can be built alongside US1–US3 by a second person**: `repo.ts` and `lifecycle.ts` do not overlap. T040's dependency on T031 is the only cross-story link.
- Phase 8's T047, T048, T050, T051, T052 are independent files.

---

## Parallel Example: Phase 2 Foundational

```bash
# Four independent predicate tests, all failing until T008:
Task: "T003 scope-A predicate tests in tests/module/work-safety.test.ts"
Task: "T004 scope-B predicate tests in tests/module/work-safety.test.ts"
Task: "T005 FR-001a sibling-ref test in tests/module/work-safety.test.ts"
Task: "T006 fail-open spelling rejection tests in tests/module/work-safety.test.ts"
```

---

## Implementation Strategy

### MVP (Phases 1–5)

1. Phase 1: the fixture — without it the predicate tests cannot distinguish right from wrong.
2. Phase 2: the predicate. **Critical path.**
3. Phases 3–5: US1, US2, US3 — all three P1 stories.
4. **STOP and VALIDATE**: quickstart Parts 1–4.

At this point the everyday false positive is gone, `delete` refuses on exactly what it destroys, and `--force` reports its damage. That is the feature's user-visible value.

### Incremental Delivery

1. Phase 1 + 2 → predicate correct and proven.
2. - US1 → archiving finished work stops demanding a flag (002-work-safety-force-SC-001).
3. - US2 → delete's refusals become exact (FR-006, FR-001a).
4. - US3 → forcing becomes accountable (002-work-safety-force-SC-004).
5. - US4, US5 → the `repo` surface follows (002-work-safety-force-SC-005).
6. - Phase 8, 9 → spec matches code; the gate prevents recurrence.
7. - Phase 10 → adversarial rounds to convergence. Not optional; see the retro.

### Notes

- `[P]` = different files or independent test bodies, no dependencies.
- Verify each test fails before implementing — especially T005 and T006, whose whole purpose is to fail against the plausible-but-wrong implementations.
- T023, T032, and T010a are the three tasks where a mistake silently destroys user data. Review all three closely: T023 is the sibling-ref judgment, T032 removes the guard that skipped classification, and T010a is the error branch of the predicate everything else trusts.
- Commit after each task or logical group.
