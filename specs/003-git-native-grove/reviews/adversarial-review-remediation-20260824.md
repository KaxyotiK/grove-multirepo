# Adversarial review — v3 remediation (loop mode)

**Run identity.** target = the branch diff on `003-git-native-grove-v2-redesign` since `a420acb` (`src/**`, `tests/**`, `scripts/**`, `specs/003-git-native-grove/**`, `.specify/memory/constitution.md`) · profiles = implementation, architecture, workflow · gate = **p1** · rounds = **5** · execution = **authorized** · report = this file.

**Resume reconciliation (2026-08-24).** The approved T096 terminal task requires the final fresh assignments to be architecture, workflow, and implementation. This replaces the stale `planning` label for the last round with the user's requested process/workflow lens; the target, five-round budget, execution authorization, and bug-fix-only scope are unchanged. The current target fingerprint at dispatch is `d662749a6d8bdaeb251ea589620ff93b365a16f1` (81 commits since `a420acb`). Later-round review focuses on the Phase 10 changes since `ba0c1ed` and may read the rest of the fixed target only to verify their integration and the carried findings.

**Binding scope constraint from the user:** fix bugs and issues, **do NOT increase scope**. No new features. A finding whose smallest correction falls outside the remediation plan's 80 items is recorded as an approval-required follow-up and not acted on.

**This run also serves release gate 3** — the independent second-reader review of P2b's ledger re-authoring (170 proof obligations across 63 superseded rows). The same work that produced this ledger also authored that re-authoring, so the sampling verdict must come from the independent reviewers, not from its author.

## Baseline fingerprint

- HEAD at round 1 start: `93f8eb92f103e0f8bb6dacee46a6995a80d06451`
- Gate at round 1 start: typecheck 0 errors · 429 tests passing · scan PASSED · traceability 180 prior-release + 41 v3 scenarios, 0 deferred, 0 findings.

## Round ledger

| Round | State | Reviewers | Findings at gate | Fixes | HEAD after |
|---|---|---|---|---|---|
| 1 | **complete** | implementation, architecture, planning (+2 earlier ad-hoc reviews) | 4 P0, ~9 P1 | all at-gate findings fixed and witnessed | `fc324d16599c402a80f1239b0cb400b20b0cdc28` |
| 2 | **complete** | planning (gate-3 RE-RUN), implementation (residual P1s) | 2 P1, several P2 | fixed and witnessed | (see round-2 section) |
| 3 | **complete** | implementation; planning DIED (API 529, no findings) | 1 P1, 4 P2 | F1/F2/F3/F5 fixed and witnessed; F4 + doctor gap → backlog | `3a3aa00` |
| 4 | **closed incomplete; consumed** | planning, implementation, architecture | no attributable review result returned | none | `3a3aa00` |
| 5 | **complete** | workflow, implementation, architecture | 3 P1 fixed; 2 P2 fixed | R5-F1–F3 and R5-A1–A2 independently verified | `c5f4d27` |

Round 4 was stale: the three review passes ultimately produced outputs from earlier bounded implementation/proof assignments, not the assigned round-4 review. Those outputs cannot honestly be treated as adversarial findings or a clean verdict. Round 4 therefore remains consumed but contributes no release evidence. It is not reset or replayed; round 5 is the only remaining round, which also respects the user's later request for up to three additional loops.

### Round 5 — pooled findings and pre-mutation state

**Target fingerprint before mutation:** `d662749a6d8bdaeb251ea589620ff93b365a16f1` **Post-mutation worktree fingerprint:** `c10974d3e2c099ec3f389a3bbd1f47c8e68979b15ef2281b68ba49f414c2a6e2` **State:** `complete` **Review coverage:** architecture traced acquisition policy, Git-owned topology, operation identity, and diagnostic aggregation; workflow traced installed add/link, trunk transitions/refusals, destructive removal, stale-lock recovery, and terminal handoffs; implementation traced the same inputs through command control flow and versioned results. Reviewers ran 68–78 focused tests, typecheck/traceability subsets, installed-package journeys, and exact fault reproductions. T095 supplies the complete 452-test, scan, build, traceability, and installed-artifact matrix.

| ID | Sev | State | Demonstrated defect | Intended bounded correction and witness |
|---|---|---|---|---|
| R5-F1 | P1 | fixed | `repo link` infers `{kind:"managed"}` when an external bare common directory merely occupies the alias-derived repository layout, then permits trunk mutation. Decision 001, constitution II, and FR-011B/E make acquisition command/consent—not topology—the capability boundary. | Red witness observed `kind:managed` and trunk statuses `0/2/5`; fixed `c5f4d27`. Post-fix review observed `kind:linked` and three exit-3 refusals. |
| R5-F2 | P1 | fixed | Forced Tree/trunk removal continues after working-state enumeration fails, deletes the worktree, and reports `discardedWork: []`, violating ruling ④'s mandatory itemization. | Both red witnesses observed exit 0 and deleted files; fixed `c5f4d27`. Post-fix fault review proved exit 5, zero operation delta, and retained worktree/files while readable force still itemizes. |
| R5-F3 | P1 | fixed | `doctor` computes `detail.counts` before appending stale-lock and pending-operation diagnostics, so one result reports a diagnostic and zero total/severity counts. | Both red witnesses observed a final diagnostic with zero counts; fixed `c5f4d27`. Post-fix review proved exact final totals/severity buckets without changing strict/reclaim policy. |

This work independently reproduced R5-F1 and R5-F3 and confirmed their exact contract contradictions. For R5-F2, two independent reviewers executed Tree and trunk Git-fault reproductions; direct control-flow inspection confirms that both handlers deliberately translate `dirtyStatus.problem` to an empty list and still invoke `worktree remove --force`. No guard or downstream correction rescues the deleted files. The findings therefore survive pooling as P1. The counts item was proposed as P2 by implementation but independently demonstrated as realistic wrong machine behavior by architecture and workflow; it is pooled as P1. No separate P2 or SUSPECTED-CRITICAL finding survived round 5.

#### Round 5 post-fix review advisories

Architecture and workflow accepted R5-F1–F3 with zero residual P0/P1/P2. Implementation also accepted every runtime fix, then identified two bounded proof/documentation P2 advisories. The user explicitly required no P2s and authorized bug/proof-gap corrections without scope increase, so both were fixed within round 5 rather than being left as advisory debt.

**Pre-advisory-fix worktree fingerprint:** `9f639d3a425ab65676782f615de76432f20727ad3153f77d0365d32d617f4d05` **Post-advisory-fix worktree fingerprint:** `7b573eca7cb1f6eac28ae0ec8653b958af831543d5f01425a6ba386e007c142d`

| ID | Sev | State | Advisory | Intended bounded correction |
|---|---|---|---|---|
| R5-A1 | P2 | fixed | `src/commands/repo.ts` still contains the obsolete comment claiming layout position should infer managed policy, contradicting Decision 001 and the corrected runtime directly below it. | Removed only the stale contradictory comment; implementation post-review confirmed the correct acquisition-boundary comment remains. |
| R5-A2 | P2 | fixed | The two status-failure witnesses prove refusal and content retention but do not pin that refusal occurs before an operation record is created. | Both witnesses now assert zero `.grove/operations` entry delta; implementation post-review passed both plus the complete 31-test destructive/lifecycle pair. |

#### Round 5 terminal verification and stop reason

- Architecture post-fix verdict: ACCEPT, zero residual P0/P1/P2.
- Workflow post-fix verdict: ACCEPT, zero residual P0/P1/P2.
- Implementation final post-advisory verdict: ACCEPT, zero residual P0/P1/P2.
- Exact implementation commit `c5f4d2714027e36779a6dd5caa829445da4e97a3`: typecheck PASS; 172 module + 260 CLI + 20 E2E = 452 tests PASS; scan PASS; inherited traceability 180/180 with 184 witnesses; v3 traceability 41/41; build PASS.
- A fresh isolated temporary-prefix install of `c5f4d27` passed managed add, ordinary external link, linked Tree creation, all three linked trunk refusals, and the managed-layout-position collision control (`kind:linked`, trunk mutation refused).

**Stop reason:** the fifth and final allowed round is complete and its stricter user-requested gate is satisfied with zero unresolved in-scope P0/P1/P2 bug or proof gap. The round count was never reset or exceeded. Historical round-3 F4 remains explicitly outside the approved bug-fix boundary because its proposed remedy changes the documented `file read` surface; it is neither silently fixed nor misrepresented as user-accepted risk.

## Findings

### Round 1 — fixed and witnessed

| Sev | Finding | Origin | Commit |
|---|---|---|---|
| P0 | `reconcile --abandon` deleted a **live** bare repository (every ref and object) after the documented unregister-only `repo remove`, then exited 5 claiming it did nothing. `doctor` exited 0. | mine (B4) | `6ae4141`→fixed |
| P0 | Ruling ④ itemization absent on 3 of 5 destructive paths, and its witness could not fail: `/my-notes\.txt|subdir|uncommitted/` matched the bare word the non-itemizing message always contained. | mine | fixed |
| P0 | A **symlink at the archive layout path** was followed by delete/restore/rename. `restore` takes no destructive flag and relocated an unrelated directory at exit 0. Survived three of my hardening passes because each fixed the recorded VALUE, never which resolver consumed it. | pre-existing | fixed |
| P0 | P2b's **synonym-marker bypass**: the consolidation rule keyed on marker NAME, so unique names over one assertion evaded it on all 63 rows. Honest form failed the gate; evasive form passed. | mine | fixed |
| P1 | E-9, U-9, G-6 marked `implemented:verified-local` and false. U-9 was closed under **another row's** evidence. | mine | E-9/U-9 fixed, G-6 deferred |
| P1 | `isSubpath(p, p) === true` — three containment guards admitted the workspace root. | 2 pre-existing, 1 mine | fixed |

**Method note.** Every P0/P1 acted on was reproduced before being fixed, and each fix carries a witness verified to fail against the old behaviour.

### Round 1 — at-gate findings NOT yet verified by me (carried into round 2)

- `{ skip: true }` on a witness title satisfies the validator's regex; 123 witnesses skipped while both gates reported PASSED.
- The v3 leg runs with no ledger — 41 scenarios pass with **empty test bodies** (G-6, now deferred, but the hole is real today).
- `restore` reports `complete`/exit 0 when the archived loose content is gone, then clears `archiveSnapshot` — destroying the only record it existed.
- `abandonOperation` does not scrub `record.secret`; a conflicted acquisition is unresumable, so E-9's scrub-on-completion never runs for it.
- Restore gates 4 and 8 are unwitnessed (replacing each with `true` leaves the suite green).
- P1-A: a Grove's advisory record is read by directory scan but written by name-derived path.

## Prior self-review (context, NOT a substitute for this run)

Before this run, five ad-hoc self-review passes fixed seven defects, three of them P0 (all three sharing one root cause: `isSubpath(p, p) === true`, so "inside the workspace" guards also admitted the workspace root — one hand-edited advisory-metadata key deleted an entire workspace at exit 0). Two ad-hoc review attempts on that work **never delivered findings**, so none of it was independently reviewed. That is precisely why gate 3 was unsatisfied and why this run exists.

### Round 3 — implementation profile (independent second reader), verified and fixed

Reviewer pinned `62a9f1f`, rebuilt from a clean `git archive`, and ran every gate plus 8 disposable workspace reproductions and a second build of `e1de810^` to separate regression from pre-existing. Six of the seven fix targets it was asked to attack survived every probe.

| Sev | Finding | Verdict | Disposition |
|---|---|---|---|
| P1 | **F1** — `looseEntries` hardcodes the literal segment `trees` and one descent level (the DEFAULT `layout.trees` written into code) at two sites. Under `groves/{grove}/{tree}` every Tree is reported loose and `delete` refuses at exit 5; under `groves/{grove}/trees/{repo}/{tree}` the intermediate directory is. The remedy the refusal itself prints pushes the user to `--allow-destructive`, which also disables the uncommitted-work guards, and the forced run then itemizes live Tree worktrees as discarded loose content — inverting ruling ④. Variant B is a **regression** from the round-1 fix; variant A is pre-existing. | CONFIRMED (reproduced independently) | fixed `3a3aa00` — both sites share `unaccountedEntries`, which derives structure from the accounted paths. 4 witnesses; 3 fail against the pre-fix accounting. |
| P2 | **F2** — `acquire`'s reclaim branch `continue`s before the deadline check, so a contended reclaim (orphaned `.steal` marker, reachable via SIGKILL between marker creation and its `finally`) spins until `staleMs` instead of refusing at `timeoutMs`. Contradicts safety.md's "waits up to 5 seconds … then exits 4". | CONFIRMED | fixed `3a3aa00`; witness measures 60s vs a 200ms budget pre-fix. |
| P2 | **F3** — `agent add` rejects control/bidi characters but `config set` writes the same `agents`/`defaults` keys and bypassed it; the value then reached the terminal unescaped from `agent run`. | CONFIRMED | fixed `3a3aa00` in the **change** validator, not at load — a workspace already holding such a value must stay openable, and `agent ls`/`file ls` escape stored values for that case. Reject on write; escape on display. |
| P2 | **F4** — `grove file read .grove/operations/<id>.json` exposes `secret.remote` for a pending `repo-add` through the agent-facing read surface. | CONFIRMED, advisory | **backlog** — excluding `.grove` from a documented command is new behaviour. |
| P2 | **F5** — dead `exactOid`/`counts` in sync.ts (the latter duplicating `git.aheadBehind` with different failure semantics) and unused `scopeArgs`. | CONFIRMED | fixed `3a3aa00`. |

**Structural risk the reviewer named, and I agree with:** the entire test corpus treats `layout.trees` as a constant. F1 is one instance; `collectDirectoryMergeRoots` and the conformance `misplaced` / `fix --move` planners are unattacked siblings. Logged to backlog.md.

### Round 3 — found independently while repairing the ledger

| Sev | Finding | Disposition |
|---|---|---|
| P1 | `repo status` and `repo ls` mapped a repository problem to `invalid-config` and exited **8**. §8.4 requires diagnostic commands to report unhealthy state at exit `0`, and `trunk ls` already does — so the two disagreed about the same typed problem, which TRUNK-12 forbids. The REPO-30 witness had encoded the buggy exit code. | fixed `3a3aa00` |
| P1 | REPO-30's two ledger clauses cited `init` / `repo add` **setup lines** as their evidence. CMD-16 rested 3 obligations on 1 observation; TREE-02's marker was lost in a consolidation. | fixed `3a3aa00`; prior-release leg now 0 findings (from 45). |
| — | `observedFields` undercounts a field whose expression contains an unbalanced paren inside a regex literal. Fails **closed** (undercount → FAIL), so it is a usability wart, not a hole. | left as-is, noted here |
