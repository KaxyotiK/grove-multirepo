# Grove v3 — consolidated review and conclusions

**Date:** 2026-08-23 **Branch:** `003-git-native-grove-v2-redesign` **Version reviewed:** grovekit 0.3.0 **Status:** Review complete. Decisions ruled. No code changed at time of writing.

This document consolidates every review of Grove v3 and the conclusions drawn from them. It supersedes the separate review documents as the single place to read; those remain as evidence.

**Sources consolidated**

| Source | Method |
|---|---|
| `adversarial-review-grove-v3-20260823.md` | 5 adversarial profiles — implementation, planning, workflow, ux-ui, architecture — with every P0/P1 independently re-verified |
| `reviews/adversarial-review-grove-cli-practical-use-20260823.md` | Practical-use adversarial review against a real workspace |
| `reviews/grove-full-usability-test-matrix-20260823.md` | 5 rounds of structured real use, ~60 scenarios |
| `fix-ledger-20260823.md` | The executable work list (reproduced in Part 5) |

---

## Part 1 — Verdict

**The fundamental design is sound. Do not restructure.**

The core primitive — _Git owns live state; Grove owns layout convention, acquisition policy, diagnostics, and explicit orchestration_ — is coherent and correct for this problem. The v1→v3 trade was right: losing the CAS manifest and ref-deleting rollback journal means v3 **cannot destroy a ref**, and Git-as-source-of-truth eliminates an entire family of reconciliation bugs that dominated v1's retro.

This is not an assertion. The usability matrix put the thesis through ten rounds of direct native-Git manipulation and it held every time:

| Test | Action | Result |
|---|---|---|
| G-01 | Standard worktree created beside Grove | Classified `external`; managed state untouched |
| G-03/04 | `git worktree move` a Tree, then move it back | Detected `misplaced`, exact reverse plan, health returned |
| G-05/06 | Native branch rename, then rename back | Observed drift, no silent reassignment, health returned |
| G-07/08 | Detached HEAD, then reattach | Reported safely, synced the *other* Tree, health returned |
| G-09/10 | `git worktree remove`, then native re-add at the compiled path | Dropped with no invented claim; rediscovered on re-add |

**But it is not shippable as 0.3.0.** One live arbitrary-code-execution path, several terminal operational states with no CLI exit, and a verification apparatus that was tightened only where behaviour did not change.

**Headline counts after decisions are applied:** 1 P0 (security), 5 architectural P1, ~14 remaining P1, ~26 P2 → **72 actionable items**, of which 55 are mechanical and 17 need design. Seven items are obsoleted outright by the rulings.

---

## Part 2 — The central process finding

v1's process was built around proving **preservation**. No equivalent machinery was ever built for proving **replacement**. Everything below follows from that.

**The parity ledger switches off clause-checking for exactly the rows that changed.** `scripts/scenario-traceability.mjs:189`:

```js
const requiredClauses = row.disposition === "preserved" ? materialClauses(row.contractExpected) : [row.contractExpected];
```

"Preserved" rows are decomposed into material clauses, each requiring proof. "Superseded" rows collapse to one opaque blob. **63 of 70 superseded rows carry fewer obligations than their text has clauses.** `ARCH-07` still asserts a **v1** guarantee — _"The §6.1 journal completes or rolls back via `grove reconcile`"_ — is "established" by v3 evidence, though §6.1 is deleted, rollback is constitutionally forbidden, and durable partial state is now the design.

**The v3 gate runs with no ledger at all** — `--contract` without `--ledger`, so all ten V3 scenarios are gated by ID-in-test-title alone: precisely the method the project declared insufficient after TRUNK-01 slipped through.

**The cleanest demonstration.** `grove new <name>` with no `--repo` creates a Tree and branch in _every_ registered repository, while its help says "Omit entirely to create an empty Grove." The witness for the governing scenario, `tests/cli/tree-scenarios.test.ts:159` (TREE-23), creates the empty Grove _before any `repo add`_ — so with zero repositories the fan-out is structurally impossible to observe. **The test passes, the gate counts the scenario as covered, and the documented behaviour is broken.** A green traceability run is not behavioural evidence.

Supporting: `specs/002-work-safety-force/tasks.md` is **0/71 checked** and is the declared verified baseline; `speckit-analyze-final-v3.md` concedes _"Task checkboxes are execution state, not traceability state"_; no review record exists for features 003-repository-default-policy, 004, 005, or 006; **CI never ran on v3** (the release audit concedes "locally on macOS"; `backlog.md` says Actions is disabled).

**Topology note.** `main` is _not_ a frozen v1 baseline. The branches diverged at `da0b157` (constitution 1.0.1); `main` independently advanced to 2.0.2. The `§N` contract apparatus was built _on this branch_. So this is two phases of one branch that has drifted from a live sibling — which is why the constitution's `2.0.2 → 3.0.0` amendment header asserts a supersession that never happened here.

---

## Part 3 — Decisions (authoritative)

| # | Decision | Ruling |
|---|---|---|
| ① | `grove new` with no `--repo` | Creates an **empty Grove**, per help, worked example, and `main`. Fan-out requires explicit `--all`. |
| ② | Restore semantics | Restore reconstitutes the **archived commit**, not the branch tip. A moved branch is **not** an error. If the object is gone, refuse; `--latest` opts into the current tip. **Archive requires a pushed branch** or `--allow-unpushed`. |
| ③ | Native-worktree adoption | Adoption by **layout position** is correct and must keep working. A worktree **outside the workspace** that merely name-matches a Grove must be observed and reported, but **not** selected for mutating operations and **not** offered relocation. |
| ④ | Destructive-operation flag | `--force` → **`--allow-destructive`**, meaning *you will lose work*: uncommitted files (archive, delete, tree/trunk remove) and loose Grove content (delete). Durability is a separate axis: **`--allow-unpushed`**. Refusals **and** forced runs must itemize. |
| ⑤ | Schema 1/2 migration | **Delete the subsystem entirely.** |
| ⑥ | Version skew | No N-1 compatibility. Refusal is correct, but the error MUST name running version, executable path, and workspace schema. |
| ⑦ | Human vs JSON | **JSON is a formatting option, not an information tier.** Both modes carry identical facts. |
| ⑧ | `specs/001-grove-cli` | **Retired on this branch.** |

### Rationale worth preserving

**② corrected an earlier refutation of mine.** I first refuted "v3 dropped the unpushed-work guard" because refs are always retained, so nothing is lost. Too narrow: v3 explicitly sanctions `git branch -D` as a native action, and the bare repository is local-only — so **a retained ref is not a durability guarantee**. If archive promises restorability to an exact commit, the snapshot must survive local ref deletion. The guard returns for a better reason than v1 had.

_Known tension, accepted:_ checking "is this pushed" against `refs/remotes/*` is offline but only accurate as of the last fetch, so a branch pushed from another machine reads as unpushed. A false refusal is cheap and correctable via `--allow-unpushed`; a false _acceptance_ silently breaks the restore promise. This narrows v1's 002-work-safety-force-SC-007 offline guarantee for `archive` only.

**④ took four candidates, and the rejections are the useful part.**

- **Split by mechanism** (`--discard-uncommitted` + `--discard-loose`) — rejected. It carves along a git-tracked/not seam invisible to the user. An uncommitted edit and a loose file are the same thing to them: something that exists in only one place.
- **`--discard-work`** — rejected. In Grove's own vocabulary a Grove _is_ a "unit of work," so the flag reads as "discard the Grove."
- **`--discard-changes`** — rejected. `grove changes` is an existing command meaning uncommitted changes only, implying the flag excludes loose files.
- **`--discard-unsaved`** — rejected as **factually false**. Those files _are_ saved; the editor wrote them to disk. "Unsaved" conventionally means "in a buffer," so on a destructive flag it invites exactly the wrong inference: _"I saved everything, so nothing will be lost."_

`--allow-destructive` wins by asserting nothing about the files' state and naming only the consequence — the sole claim true across both commands and both kinds of content. Precision about _what_ is at stake moves to the output, not the flag name.

**⑤ is the largest simplification available.** Verified: package unpublished, no external users; the only schema-1/2 workspaces are local test fixtures kept outside the repository, one named `v1-backup`. Deleting migration removes 1,125 lines and closes a P0 and a P1 without fixing either. _Accepted cost:_ those workspaces become permanently unreadable.

---

## Part 4 — Findings

### P0 — Security

**S-1 · Argv injection → arbitrary command execution.** `src/commands/repo.ts:297` builds `["fetch","--prune",remote]` with no `--` and no validation, bypassing the guard at `src/git/adapter.ts:245-247` — the only place that guard exists.

Reproduced end to end:

```bash
git clone ./upstream evil && cd evil && git remote remove origin
git config "remote.--upload-pack=touch $MARK.url" ../upstream    # the remote NAME is the payload
```

```
$ grove repo link ./evil --name evil     → Linked repository "evil"
$ grove repo fetch                       → evil: git-failed        ← all the user sees
$ ls -la $MARK                           → …/PWNED                 ← executed
```

`repo link` is the documented way to onboard an existing checkout, and `.git/config` is attacker-controlled content in any clone-and-work scenario. The compromise is silent.

**Architectural root cause (A-1).** This is not an isolated slip. **66 raw `tryRun` call sites vs 9 through the port; 15 adapter methods have zero callers; `Git.fetch` — sole holder of the guard — has one.** Fixing the line closes the instance; routing the duplicated invocations through the existing typed methods closes the class.

### Architecture (A1–A5)

**A1 · `archiveSnapshot` overrules Git on restore.** Under ruling ② this is now scoped differently than first reported: pinning the archived OID is _correct_; **refusing** when the branch moved is the bug. Restore must succeed at the recorded commit.

**A2 · Archived Groves have no observation.** Nothing scans the `archive` layout role (`observed.ts:88-95,200-215`; `matchLayoutPath` supports the role but has no caller). Reproduced — deleting only `.grove/groves/feat.json` while `archives/feat/` remains on disk:

```
$ grove ls --archived     → No Groves.
$ grove doctor            → No conformance diagnostics.
$ grove doctor --strict   → exit 0
$ grove restore feat      → 0 observed/advisory Groves match
```

After archive the worktrees are gone, so Git holds no trace of membership and a single unbacked-up JSON is the sole authority — the same single-source-of-truth fragility v3 claims to have deleted, relocated to the half of the lifecycle Git does not cover.

**A3 · The Git port is not a boundary.** See S-1 root cause above.

**A4 · No shared operation executor.** `store/operation.ts:132-152` hardcodes lifecycle command kinds — persistence knowing command policy. `reconcile.ts` dispatches on the `step.kind × record.kind` cross product (~20 branches) with `kind: string` and `input: unknown`. Every new multi-step command must be written twice with no compiler link; a missed resume branch wedges an operation as `conflicted/unsupported-step`, discovered only after a crash.

**A5 · One observation granularity, eager and serial.** `observeWorkspace` has 40 call sites; scoped `observeRepository` has zero. Serial `for … await`, ~5 subprocesses per worktree — measured **3.1s for `grove ls` at 20 trees**, linear. Observation is fused with policy: you cannot observe without evaluating conformance.

### Operational dead-ends

**A failed `repo add` can never be completed or abandoned.** `repo.ts:104` hardcodes `recoverable-intermediate`; `operation.ts:262` permits abandon only from `conflicted`/`stale`; and **`"stale"` is never assigned anywhere in the codebase.** The remedy names a transition that cannot occur. Escape is `rm` on the operation JSON.

**`doctor --strict` ignores `blocking` severity.** `doctor.ts:51` gates on `policy` only, while `blocking` is emitted at `observed.ts:20,217,241`. Reproduced: `{blocking: 1}` in JSON, exit 0 from `--strict`, on a workspace where `grove new` fails with exit 5. A CI gate on the flagship health command reports healthy.

**`repo remove` on a managed repo with live Trees is a one-way door.** Re-add refuses (path exists), `repo link` refuses (already registered); the link that eventually works demotes the repo to `linked` irreversibly, orphaning a live worktree in Grove's own trunk layout.

**`stale-metadata` is detected, unfixable, and its remedy refuses.** `tree remove --forget-settings` resolves Trees from _observed_ worktrees, so it exits 2 once the worktree is gone. `doctor --strict` then exits 3 forever.

### Ownership and adoption

**Membership is decided by branch name, not layout position.** Reproduced — a worktree created by native Git _entirely outside the workspace_:

```
$ git -C repos/app worktree add /…/OUTSIDE-the-workspace work
$ grove tree ls work        → refs/heads/work   /…/OUTSIDE-the-workspace     ← claimed
$ grove doctor              → misplaced: … Run `git worktree move …` into the workspace
$ grove sync work …         → app: fetched-no-integration                    ← selected for mutation
```

Position plays no role in membership — only in whether you get a `misplaced` diagnostic. Concrete harm: `repo link` someone's existing checkout whose branch happens to match a Grove name, and Grove claims it and proposes relocating it. Ruling ③ scopes the fix.

### Destructive-operation semantics

Verified asymmetry, invisible in the current flag:

| Destroyed | `archive --force` | `delete --force` | Recoverable? |
|---|---|---|---|
| Uncommitted changes in a worktree | discarded | discarded | No |
| Untracked files inside a worktree | discarded | discarded | No |
| **Loose files in the Grove dir, outside any repo** | **preserved** (dir moved) | **`rm -rf`** | **No — nothing retains them** |
| Commits / branches | retained | retained | Always |

`delete --force` destroys arbitrary user files with no git relationship — notes, scratch data, a local database. It is the most destructive operation in the CLI and shares a flag name with one that preserves the very same files. The _refusal_ itemizes correctly (`loose Grove content would be removed: my-notes.txt, subdir`); the _forced run_ reports only `Deleted del-test; all refs were retained`.

### Output parity (ruling ⑦ collapses eight findings into one)

`changes`/`commits`/`against-trunk` emit identical `refs/heads/x: N change(s)` lines for different repositories — the default branch convention _guarantees_ the collision, and this is the product's core multi-repo journey. `doctor` drops subject, facts, and the diagnostic id that `fix --diagnostic` requires, making quickstart step 8 unperformable without `--json`. `sync` drops which target on a mutating command. `repo status` renders `worktrees=3` instead of the promised roles and paths. `ls --archived` reports `0 tree(s)` for an archive restore will rebuild into N Trees. A `Uint8Array`/`Buffer` serialization leak splits one `facts` object into two shapes (`conformance.ts:60`).

### Onboarding

**The README golden path fails at step 5.** `agent add codex codex` then `agent run` → exit 5, _"No agent to run."_ `agent add` sets no default; the working form is `grove configure <grove> --default-agent codex`.

**The `--from` remedy is wrong and blames the wrong flag.** Following `→ Pass --from <revision>` literally yields `Invalid --branch "main"` — a flag the user never typed. Correct form is `--from ledger=main`. Bare `--from` _is_ right for `tree add`/`trunk add`, so the shared parser string is wrong only for `new` — the headline v3 behaviour change a migrating user meets first.

**Version skew, hit in real use.** `grove sync` failed with _"config.json uses schema version 3; normal runtime supports schema version 2"_ because PATH resolved to an older build. The error names neither the running version nor the executable path.

---

## Part 5 — The work

Full item-level detail is in `fix-ledger-20260823.md`. Summary by workstream:

| # | Workstream | Items | Notes |
|---|---|---:|---|
| 1 | **Security** | 3 | Do first. S-1 is a live ACE path and is independent of everything else. |
| 2 | **Delete migration** | 4 | Largest win. −1,125 lines; closes a P0 and a P1 without fixing either. |
| 3 | **Command semantics** | 7 | From rulings ①–④. |
| 4 | **Output parity** | 10 | One principle (⑦), one pass. |
| 5 | **Operational dead-ends** | 9 | 4 need design. |
| 6 | **Onboarding & ergonomics** | 12 | Mostly mechanical. |
| 7 | **Governance & traceability** | 15 | Includes retiring 001 and getting CI running. |
| 8 | **Architecture** | 8 | Schedule, not blockers. A-2 before the next multi-step command. |
| 9 | **Config & validation integrity** | 4 | Found late, in the matrix's later rounds. Three are data-integrity defects. |
| | **Total** | **72** | 55 mechanical, 17 needing design. |

### Late additions — config and validation integrity

These surfaced only in the usability matrix's later rounds and were **missing from the first consolidation pass**. Three are data-integrity defects rather than polish:

- **`config set` deletes sibling keys instead of merging.** Patching one key in `defaults` and one in `agents` silently removed `defaults.syncStrategy`, `defaults.branchPrefix`, and agent `beta` — exit 0. The documented contract (commit `5c36b18`, `docs/BACKLOG.md`) is explicit that keyed objects merge by key and `null` removes. The implementation does the opposite. **Silent config data loss.**
- **Top-level JSON grammar is unvalidated.** `null` → internal **exit 1**; `[]` → **success with the revision bumped**; `42` → exit 2 with raw implementation error text; a bare string → exit 3 treated as key `"0"`. Four inputs, four different failure modes, one of them a successful write.
- **Invalid default review base accepted at write time, fails at read time.** A Git-invalid `bad..ref` configures with exit 0 and `doctor` reports clean; later `commits` and `against-trunk` fail on **all** Trees with exit 6.
- **`tree reorder` persists a duplicate selector** (exit 0) instead of refusing.

**Obsoleted by rulings — do not work these:** the migration wedge P0 (fingerprint over reflog/index bytes; abort refused post-publication; workspace bricked by `git status`); the `GROVE_TEST_MIGRATION_CRASH_AFTER` production-bundle hook (the _gate_ weakness survives — broaden the `legacy-scan` regex to `GROVE_TEST_*`); `migrate --dry-run` output disparity; the migration consent gate; the whole migration workflow surface; N-1 runtime compatibility; and amending `json-results-v1.md` to permit lossy human output.

---

## Part 6 — Validated; do not disturb

Recorded as strengths, not merely absent defects. Several survived direct adversarial attack.

- **Native-Git interoperability** — the G-series above, ten rounds, all held.
- **Migration isolation** — only `commands/migrate.ts` imports `src/migration/**`; `src/compat/` is gone. Principle VI holds. _(Moot after ⑤, but it was done right.)_
- **Byte-preserving `NativePath` / `RefName` encoding** — a first-rate primitive at the right altitude; most Git tooling gets this wrong. No parsing defect found under attack with spaces, unicode, detached HEAD, or prunable worktrees.
- **Crash recovery and concurrency** — SIGKILL at `worktree add`/`remove`/`move` recovered idempotently with refs and loose content retained; six-way parallel `new` gave three successes and three clean exit-4 refusals with dead-holder reclaim.
- **Content-addressed diagnostic identity + rescan-before-fix** — the correct answer to stale-remedy races.
- **`withOperationTargetLocks`** — sorted, hashed, deterministic ordering; deadlock-free.
- **Error taxonomy and exit codes** — disciplined; `--json` errors are structured on stdout with `{kind, what, why, remedy, exitCode}`; 13 of 16 commands share one JSON envelope.
- **Linked-repository zero-mutation registration** — byte-identical refs, worktrees, HEAD, config, index, and content before and after; every trunk mutation refused with exit 3.
- **The `misplaced` diagnostic** — embeds both paths and the exact `git worktree move` command.
- **Config CAS** — stale-revision write refused with exit 4 and a byte-identical config.
- **No test asserts on its own mock.** The test defects are of a different kind: witnesses that cannot detect what they cite.

---

## Part 7 — Corrections made during review

Recorded because each was stated confidently and then proved wrong.

| Claim | Correction |
|---|---|
| "`main` is v1" | Wrong. Diverged at `da0b157`; `main` advanced independently to constitution 2.0.2. |
| "README golden path runs verbatim, exit 0 at every step" | Wrong — step 5 was skipped; `agent run` exits 5. |
| "The 180-row ledger is a stronger supersession record than most rewrites produce" | Substantially overstated — the 70 changed rows get the *weakest* checking. |
| "v3 dropped the unpushed guard, but refs are retained so nothing is lost" | Too narrow — a retained ref is not durability when `git branch -D` is sanctioned. Led to ruling ②. |
| "`--force` authorizes discarding uncommitted working state" | Incomplete — `delete --force` also destroys non-git files permanently. |
| "Split the flag by mechanism" | Wrong seam — invisible to the user. Led to ruling ④. |
| "`--discard-unsaved` names the property at risk" | Factually false — those files *are* saved. |

**Refuted candidate objections** (raised, then disproved): git-output parsing breaks on unusual refs/paths; crash-recovery and concurrency are unsound; `doctor` exiting 0 with findings defeats CI (`--strict` exits 3 as documented); the v1 retro's fail-open-on-unreadable-git class recurred (all 104 `tryRun` sites handle `exitCode`); forward-only recovery cannot cover what v1's rollback did.

---

## Part 8 — Known gaps in this review

**Not exercised anywhere:** network and auth failure modes (all fixtures used local `file://` remotes); non-UTF-8 refs and paths; SHA-256 object format; submodules; NFS; case-sensitive filesystems (all testing was macOS/APFS); cross-host lock reclaim; dirty-worktree merge and rebase conflict boundaries; interrupted operations in the practical-use pass.

**Witnesses are named but unwritten.** Most findings name the test that would have caught them. None exist. Given that TREE-23's _existing_ witness is built so it cannot detect the defect it cites, "add the test" is real work requiring care, not a checkbox.

**Measurement not independently reproduced:** the 3.1s/20-tree observation figure (A5) is the architecture reviewer's measurement, recorded as such.
