# Consolidated fix ledger — Grove v3

**Date:** 2026-08-23 **Status:** Implemented and locally verified except where a row says otherwise. The header previously still read "Decisions ruled; no code changed yet" long after the code changed. **Sources consolidated:** `adversarial-review-grove-v3-20260823.md` (5 profiles), `reviews/adversarial-review-grove-cli-practical-use-20260823.md`, `reviews/grove-full-usability-test-matrix-20260823.md` (5 rounds of real use).

This is the executable list. The review documents are the evidence; this is the work.

---

## Part 1 — Policy decisions (ruled)

These are authoritative. Several findings below are obsoleted or reshaped by them.

| # | Decision | Ruling |
|---|---|---|
| ① | `grove new <name>` with no `--repo` | Creates an **empty Grove**, as the help, the worked example, and `main` all state. Fan-out to every repository requires an explicit `--all`. *(Recorded on my recommendation; override if wrong.)* |
| ② | Restore semantics | Restore reconstitutes the **archived commit**, not the branch tip. Branch having moved is **not** an error — restore the recorded OID. If that object is gone, refuse by default; `--latest` opts into the current remote/bare tip. **Archive requires the branch be pushed to a remote**, or `--allow-unpushed`. |
| ③ | Native-worktree adoption | Adoption by **layout position** is correct and must keep working — that is the reconcile story. A worktree **outside the workspace** whose branch merely name-matches a Grove must still be observed and reported, but must **not** be selected for mutating operations without explicit scope, and must not be offered relocation. |
| ④ | Destructive-operation flag | `--force` is replaced by **`--allow-destructive`**, meaning: *you will lose work.* It covers uncommitted files (archive, delete, tree/trunk remove) and loose Grove content (delete). The durability check in ② is a separate axis and keeps **`--allow-unpushed`**. Refusals and forced runs must both **itemize exactly what is at stake / was destroyed**. |
| ⑤ | Schema 1/2 migration | **Delete the subsystem.** No prior-version support. |
| ⑥ | Version skew | No N-1 runtime compatibility. Refusal is correct — but the error MUST name the running version, the executable path, and the workspace schema. |
| ⑦ | Human vs JSON output | **JSON is a formatting option, not an information tier.** Every command renders the same facts in both modes. |
| ⑧ | `specs/001-grove-cli` | **Retired on this branch.** |

### Rationale worth preserving

**② corrects an earlier refutation.** The review initially refuted "v3 dropped the unpushed-work guard" on the grounds that refs are always retained. That was too narrow: v3 explicitly sanctions `git branch -D` as a native action, and the bare repository is local-only, so **a retained ref is not a durability guarantee**. If archive promises restorability to an exact commit, the snapshot must survive local ref deletion. The guard returns for a better reason than v1 had.

**② has a known tension.** Checking "is this pushed" against `refs/remotes/origin/*` is offline but only accurate as of the last fetch; a branch pushed from another machine reads as unpushed. Accepted deliberately: a false refusal is cheap and correctable by `--allow-unpushed`; a false _acceptance_ silently breaks the restore promise. This narrows v1's 002-work-safety-force-SC-007 offline guarantee for `archive` only.

**④ was iterated to four candidates; the rejections are the useful part.**

- **Splitting by mechanism** (`--discard-uncommitted` + `--discard-loose`) — rejected. It carves along a git-tracked/not seam that is invisible to the person running the command. An uncommitted edit and a loose file are the same thing to them: something that exists in only one place.
- **`--discard-work`** — rejected as ambiguous in Grove's own vocabulary, where a Grove _is_ a "unit of work," so the flag reads as "discard the Grove."
- **`--discard-changes`** — rejected: `grove changes` is an existing command meaning uncommitted changes only, so the flag would imply it does not cover loose files.
- **`--discard-unsaved`** — rejected as **factually false**. These files _are_ saved; the user's editor wrote them to disk. "Unsaved" conventionally means "in a buffer, not yet written," so on a destructive flag it invites exactly the wrong inference: _"I saved everything, so nothing will be lost."_ The risk is not that the files are unsaved — it is that they exist in **exactly one place**, with no commit, no remote, and no second copy.

`--allow-destructive` wins because it asserts nothing about the state of the files. It names only the consequence, which is the sole claim that stays true across both commands and both kinds of content. Precision about _what_ is at stake moves to the output (Workstream 4), not the flag name.

**⑤ is the largest single simplification available.** Verified: package unpublished, no external users; the only schema-1/2 workspaces are local test fixtures kept outside the repository, one named `v1-backup`. **Action required before deleting:** those three old workspaces become permanently unreadable. Discard them deliberately or migrate them once while the command still exists.

---

## Part 2 — The work

Type key: **M** = mechanical, fix is obvious · **D** = needs design · **X** = obsoleted by a ruling

Status: `open` / `implemented:verified-local` / `done` / `deferred:<reason>`. Release gate #1 is **zero rows `open`** — this column is where closure is recorded, and the remediation plan's gate depends on it existing.

**Why `implemented:verified-local` exists.** The gate says a row may move to `done` only when its named witness is green **in CI**. GitHub Actions has never been enabled on this branch, so no row can legitimately reach `done` yet — including work that is finished and locally verified. This is the first concrete consequence of ledger item **G-11**, and it will block every phase from closing until someone with repository-admin rights turns Actions on.

Item IDs are workstream-prefixed (S/R/C/O/E/U/G/A/V) and are distinct from the `Source` column, where `matrix C-03`, `matrix O-01` etc. refer to the usability matrix's own scenario numbering.

### Workstream 1 — Security (do first)

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| S-1 | **Argv injection → arbitrary command execution.** `repo.ts:297` builds `["fetch","--prune",remote]` with no `--` and no validation, bypassing the guard at `adapter.ts:245-247`. Reproduced: a remote *named* `--upload-pack=touch /path` in a linked checkout executes on `grove repo fetch`, reported only as `evil: git-failed`. | M | Report P0-1 | implemented:verified-local |
| S-2 | **Validate `remote` in `workspace.ts:39`** with the same rigour as `name` and `trunk`, which both get grammar checks. Closes the class, not the instance. | M | Report P0-1 | implemented:verified-local |
| S-3 | **Regression test for the option-injection guard.** `grep -rn "upload-pack" tests/` returns nothing today — the guard has never been tested, which is why its bypass survived. | M | Report P0-1 | implemented:verified-local |

### Workstream 2 — Deletions (largest win; unblocks the rest)

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| R-1 | **Delete `src/commands/migrate.ts` + `src/migration/**`** — 724 lines. | M | Ruling ⑤ | implemented:verified-local |
| R-2 | **Delete `tests/cli/migration-v3.test.ts`** — 401 lines. | M | Ruling ⑤ | implemented:verified-local |
| R-3 | **Remove migration clauses from constitution Principle VI** and the schema-1/2 loader exemption. | M | Ruling ⑤ | implemented:verified-local |
| R-4 | **Remove the schema-1/2 remedy** from `workspace.ts:51` and `grove.ts:25`; replace with the ⑥ self-identifying error. Also fixes the inconsistency where `grove.ts:25` said *"Run the explicit ownership migration"* while `workspace.ts:51` named the actual command. | M | Rulings ⑤+⑥; Report P2-13 | implemented:verified-local |

Deleting this subsystem closes **P0-2** (migration wedge), **P1-5's instance** (the `GROVE_TEST_MIGRATION_CRASH_AFTER` hook lives only in `migrate.ts`), and every migration workflow and UX finding, without fixing any of them.

### Workstream 3 — Command semantics (from the rulings)

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| C-1 | **`grove new` with no `--repo` creates zero Trees.** Today it creates a Tree and branch in *every* registered repository — reproduced independently twice, including across a linked repo. Add `--all` for opt-in fan-out. | M | Ruling ①; Report P1-15; matrix L-00 | implemented:verified-local |
| C-2 | **Rebuild the TREE-23 witness.** It creates the empty Grove *before any `repo add`*, so with zero repositories the fan-out is structurally impossible to observe. It passes while the behaviour is broken. | M | Report P1-15 | implemented:verified-local |
| C-3 | **Restore at the archived OID.** Today it *refuses* when the branch moved; it must succeed at the recorded commit. Add `--latest` for the tip. Report branch advancement without failing. | D | Ruling ②; Report A1 | implemented:verified-local |
| C-4 | **Archive requires a pushed branch** or `--allow-unpushed`, checked offline against `refs/remotes/*`. | D | Ruling ② | implemented:verified-local |
| C-5 | **Rename `--force` → `--allow-destructive`** across archive, delete, tree remove, trunk remove. Clean rename — no deprecation shim needed (⑤/⑥ establish no external users). | M | Ruling ④ | implemented:verified-local |
| C-6 | **Fix the false help text.** `lifecycle.ts:357,383` claim `--force` discards "unpushed work"; refs are always retained, so this describes a loss that cannot occur. Matrix L-07 calls it "a dangerous help defect." | M | Report P2-1; matrix L-07 | implemented:verified-local |
| C-7 | **Stop selecting out-of-workspace name-matched worktrees for mutating operations.** Reproduced: a worktree at `…/OUTSIDE-the-workspace` was claimed as a Tree, offered relocation into the workspace, and included in `sync`. Keep observing it; stop acting on it. | D | Ruling ③; matrix G-11 | implemented:verified-local |

### Workstream 4 — Output parity (one principle, one pass)

Ruling ⑦ collapses eight separately-reported findings into a single workstream.

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| O-1 | **`changes` / `commits` / `against-trunk` must identify the repository.** Two-repo Groves emit identical `refs/heads/x: N change(s)` lines — the default branch convention guarantees the collision. Reproduced independently twice. | M | Report P1-13; practical P1; matrix B-05 | implemented:verified-local |
| O-2 | **`doctor` must render subject, facts, and diagnostic id.** It drops all three, so `fix --diagnostic <id>` asks for an id `doctor` never prints, making quickstart step 8 unperformable without `--json`. | M | Report P1-13 | implemented:verified-local |
| O-3 | **`sync` must identify which target.** Three trunks in one repo render as `ledger: rebased / ledger: up-to-date / ledger: dirty` — on a mutating command with no dry-run. | M | Report P1-13 | implemented:verified-local |
| O-4 | **Forced runs must itemize what was destroyed.** `delete --allow-destructive` reports only "all refs were retained" while having `rm -rf`'d loose files. The *refusal* already itemizes correctly — mirror it. | M | Ruling ④; matrix L-03, L-06 | implemented:verified-local |
| O-5 | **`repo status` must render the promised roles, paths, and identity** — currently `worktrees=3`. | M | practical P2 | implemented:verified-local |
| O-6 | **`tree ls` must render the promised worktree state.** | M | practical P2 | implemented:verified-local |
| O-7 | **`ls --archived` reports `0 tree(s)`** for an archive that restore will rebuild into N Trees. | M | practical P2 | implemented:verified-local |
| O-11 | **`against-trunk` mangles non-ASCII paths.** `git/worktree.ts:93` runs `diff --name-status` **without `-z`** and splits on `\n`, bypassing the `NativePath` primitive the codebase uses correctly at `worktree.ts:16`. Verified: a file named `café.txt` is emitted in `--json` as `"caf\303\251.txt"` — C-quoted, escaped, quote-wrapped, and unusable to open the file. Renames (`R100\told\tnew`) are also unhandled. Same class as A-1: a good primitive exists and this call site does not use it. | M | help-audit `against-trunk` | implemented:verified-local |
| O-12 | **`status` and `repo status` human output is summary-only** where the product model promises identities and worktree roles. (Pairs with O-5.) | M | help-audit `status` | implemented:verified-local |
| O-9 | **`agent ls`, `config get`, `completion` do not use the shared JSON envelope** that the other 13 commands share (`{schemaVersion, command, outcome, targets, diagnostics, detail}`). `agent.ts` changed 156 lines on this branch and kept the v1 shape. | M | Report P2-8 | implemented:verified-local |
| O-10 | **Archive/delete refusals carry no structured `detail`** — `why: blockers.join("; ")` only, so scripts must string-split prose to learn which Trees blocked. | M | Report P2-11 | implemented:verified-local |
| O-8 | **Fix the `Uint8Array` vs `Buffer` leak** in one `facts` object (`conformance.ts:60`): `currentBranch` serializes as `{"0":114,…}`, `expectedBranch` as `{"type":"Buffer",…}`. `RefNameJson` already exists and is used in `show`. | M | Report P2-5; matrix G-05 | implemented:verified-local |

### Workstream 5 — Operational dead-ends

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| E-1 | **A failed `repo add` can never be completed or abandoned.** `repo.ts:104` hardcodes `recoverable-intermediate`; `operation.ts:262` permits abandon only from `conflicted`/`stale`; **`"stale"` is never assigned anywhere in the codebase.** The remedy names a transition that cannot occur. Escape is `rm` on the operation JSON. | D | Report P1-8 | implemented:verified-local |
| E-2 | **`doctor --strict` ignores `blocking` severity.** `doctor.ts:51` gates on `policy` only, while `blocking` is emitted at `observed.ts:20,217,241`. Reproduced: `{blocking: 1}` in JSON, exit 0 from `--strict`, on a workspace where `grove new` fails. | M | Report P1-9 | implemented:verified-local |
| E-3 | **`repo remove` on a managed repo with live Trees is a one-way door.** Re-add refuses (path exists), `repo link` refuses (already registered); the link that eventually works demotes it to `linked` irreversibly, orphaning a live worktree in Grove's own trunk layout. | D | Report P1-10 | implemented:verified-local |
| E-4 | **`stale-metadata` is detected, unfixable, and its remedy refuses.** `tree remove --forget-settings` resolves Trees from *observed* worktrees, so it exits 2 once the worktree is gone. `doctor --strict` then exits 3 forever. | D | Report P1-11 | implemented:verified-local |
| E-5 | **Archived Groves have no observation.** Nothing scans the `archive` layout role. Reproduced: delete `.grove/groves/x.json` and `ls --archived`, `doctor`, `doctor --strict` (exit 0) and `restore` all behave as though the workspace is clean while `archives/x/` sits on disk. Emit an `orphaned-archive` diagnostic. | M | Report A2 | implemented:verified-local |
| E-6 | **No read-only command reports stuck operations.** `doctor` never reads `operationsDir`; `reconcile` reports resumed/abandoned but not pending. | M | Report P2-6 | implemented:verified-local |
| E-8 | **Operation records are never pruned, and retain raw remotes.** Every mutating command `readdir`s and `JSON.parse`s all of them; at 5000 records (39 MB) `reconcile` goes 432→717 ms and `new` 854→1073 ms. Completed `repo add` records keep `secret.remote` — a possibly credential-bearing URL — forever, while `json-results-v1.md:74` permits that only for *a resumable operation*. | M | Report P2-19 | implemented:verified-local |
| E-9 | **`scanStaleLocks` has no production caller** despite its docstring claiming *"`reconcile` surfaces these"*. Either wire it into `reconcile`/`doctor` or delete it. Mitigated today only by the acquisition-timeout refusal, which does name the holder. | M | Report P2-7 | implemented:verified-local |
| E-7 | **Version-skew error must self-identify** — running version, executable path, workspace schema. This is what left a real session unable to tell which of several installed builds had failed. | M | Ruling ⑥; practical P1; matrix P-01 | implemented:verified-local |

### Workstream 6 — Onboarding and ergonomics

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| U-1 | **README golden path fails at step 5.** `agent add codex codex` then `agent run` exits 5 — `agent add` sets no default. Either make it set one or fix the README. | M | Report P1-12 | implemented:verified-local |
| U-2 | **The `--from` remedy is wrong and blames the wrong flag.** Following `→ Pass --from <revision>` literally yields `Invalid --branch "main"`. Bare `--from` is correct for `tree add`/`trunk add`, so the shared parser string is wrong only for `new`. | M | Report P1-14 | implemented:verified-local |
| U-3 | **Removed commands give no migration hint** — `grove diff` yields a bare "Unknown command", with arguments quoted *into* the command name. | M | Report P2-2 | implemented:verified-local |
| U-4 | **Mistyped global flags report as missing commands** — `grove --progress json ls` → "Unknown command '--progress json ls'". | M | Report P2-3 | implemented:verified-local |
| U-5 | **`trunk remove --help` omits the linked-repository policy** that the command enforces. | M | matrix K-02 | implemented:verified-local |
| U-6 | **Document the `sync` selection matrix** — plain `grove sync` at workspace root correctly refuses as ambiguous, but `Usage: sync [<grove>]` invites the misreading. | M | practical P2 | implemented:verified-local |
| U-7 | **Document a teardown runbook.** Nothing deletes refs or repository storage by design, so complete teardown is a native-Git/filesystem task with no guidance. | M | practical P2 | implemented:verified-local |
| U-13 | **`repo fetch` help says remote-less repositories are "skipped"**, while the implementation classifies `no-remote` as an incomplete target and can exit 5. Align help with the result contract. | M | help-audit `repo fetch` | implemented:verified-local |
| U-14 | **`doctor` help does not state that `info` and `blocking`-only diagnostics leave `--strict` at exit 0.** Documents the E-2 defect until E-2 is fixed; revisit together. | M | help-audit `doctor` | implemented:verified-local (reopened and actually closed in adversarial round 2) |
| U-15 | **`repo remove` recovery/re-registration journey is undocumented** — the one-way door in E-3 has no help-level warning. | M | help-audit `repo remove` | implemented:verified-local |
| U-16 | **`tree remove` unreadable-state force wording has no witness.** Either prove the contract or correct the wording. | M | help-audit `tree remove` | implemented:verified-local |
| U-9 | **`config set` help understates the settable surface.** Runtime accepts `layout` and `conventions` per FR-013/014; help lists only name/defaults/agents. `layout` is load-bearing, so this is not cosmetic. | M | matrix C-05 | implemented:verified-local |
| U-10 | **`tree reorder` omission semantics contradict help.** Help says list every Tree exactly once; the implementation appends omitted Trees and exits 0. Pick one and make both agree. | M | matrix O-01 | implemented:verified-local |
| U-11 | **`grove agent run` on a multi-Tree Grove says "Run `grove tree ls` and pass --tree"**; §8.8 requires it to list the Trees. | M | Report P2-10 | implemented:verified-local |
| U-12 | **Remove the unregistered `diffHandler`** (`review.ts:116-131`) whose message still advertises `grove diff <grove> <tree> <path>` for a surface the spec forbids. | M | Report P2-9 | implemented:verified-local (reopened and actually closed in adversarial round 2) |
| U-8 | **Long operations are silent.** `progress.ts` declares four event types; only `command-start`/`command-end` are emitted, and git's own progress is piped to a swallowed stream. No `isTTY` anywhere. | D | Report P2-4 | implemented:verified-local |

### Workstream 7 — Governance and traceability

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| G-1 | **Retire `specs/001-grove-cli`**: supersession banners on all six contract files; resolve the **90 live `§`-citations** in `src/` and `tests/` that currently point at descriptions of deleted subsystems (`safety.md` still marks the rollback journal normative; `cli-surface.md` still lists `repo delete-branch`). | M | Ruling ⑧; Report P1-4 | implemented:verified-local |
| G-2 | **Rewrite `AGENTS.md` / `CLAUDE.md`** to point at `specs/003-git-native-grove/`, and add `npm run traceability` to its verify line. | M | Report P1-4, P2-15 | implemented:verified-local |
| G-3 | **Restore `--allow-destructive` governance to the constitution.** `grep -c force` currently returns **0** — feature 002's entire governance outcome vanished while `lifecycle.ts` still implements it. | M | Ruling ④; Report P1-3 | implemented:verified-local |
| G-4 | **Fix the constitution's amendment record.** The `2.0.2 → 3.0.0` header asserts a supersession of a version that only ever existed on `main`; "Removed sections: none" is false. Drop the dangling requirement to reconcile `docs/future-state.md`, which no longer exists at that path. | M | Report P1-3 | implemented:verified-local |
| G-5 | **The ledger switches off clause-checking for superseded rows.** `scenario-traceability.mjs:189` decomposes clauses only when `disposition === "preserved"`; 63 of 70 superseded rows carry fewer obligations than their text has clauses. `ARCH-07` asserts a **v1** guarantee (§6.1 journal, rollback) is "established" by v3 evidence. | D | Report P1-1 | **open** — the consolidation rule was strengthened and all 63 rows re-authored, but round 3's independent reader showed the clause splitter had been loosened at the same time (removing the `and` split collapsed 65 independent predicates), and that the counting rule was per-row so one assertion could discharge unlimited obligations across scenarios. Both are now fixed in `scenario-traceability.mjs`; the honest gate reports **54 of 180 rows red**. This row cannot be `verified-local` while its own named witness (`npm run traceability`) is red. |
| G-6 | **The v3 gate runs with no ledger** — `--contract` without `--ledger`, so all ten V3 scenarios are gated by ID-in-title alone: the exact method the project declared insufficient after TRUNK-01. | D | Report P1-2 | deferred: authoring a 41-row v3 ledger is new scope beyond this remediation; the v3 leg remains ID-in-title only, which is stated at the release gate rather than implied to be fixed |
| G-7 | **Two more vacuous witnesses**: `RECON-06` never re-runs after fixing (its row demands the diagnostic disappear); `RECON-05` never runs `ls`/`show` though its outcome names both. | M | Report P2-20 | implemented:verified-local |
| G-8 | **Namespace success-criteria IDs.** All nine specs number from `003-git-native-grove-SC-001`, so `003-git-native-grove-SC-004` denotes nine different things; only `003-git-native-grove-SC-008` and `003-git-native-grove-SC-016` are cited by any test. | M | Report P1-6 | implemented:verified-local |
| G-9 | **Broaden the `legacy-scan` env-hook regex** from the literal `GROVE_TEST_GIT_FAULT_CONFIG` to `GROVE_TEST_*`. The instance disappears with D-1, but the gate weakness remains. | M | Report P1-5 | implemented:verified-local |
| G-10 | **Reconcile or delete both backlogs.** `backlog.md` lists open items against deleted files and says "currently 0.1.0"; `docs/BACKLOG.md` is stamped branch `002-work-safety-force`. | M | Report P2-14 | implemented:verified-local |
| G-12 | **`acceptance-scenarios-v3.md` contradicts the ledger.** Its final bullet lists `CMD-11` and "the remaining unchanged IDs" as *preserved*; the ledger marks `CMD-11`, `RECON-01/02/03/05/06`, `REPO-20/21`, `TREE-09` as *superseded* (`CMD-11` exit 2→3). | M | Report P2-16 | implemented:verified-local |
| G-13 | **`cli-surface-v3.md:3` names a non-contract document as "Normative source"** — a 1835-line proposal outside `specs/` carrying three stacked "supersedes every statement below" banners. Reintroduces the exact failure mode `contracts/README.md:10-14` exists to prevent. | M | Report P2-17 | implemented:verified-local |
| G-14 | **Resolve the feature-numbering collision.** Two `003-` directories; `004`–`008` landed 2026-08-20 and `003-git-native-grove` 2026-08-22, so the numbering implies the reverse of the real order. `main`'s merged v2 contracts are replaced with no supersession record. | M | Report P2-18 | implemented:verified-local |
| G-16 | **A committed review document is binary to git.** `specs/001-grove-cli/reviews/coverage-audit-20260815.md` contains a raw NUL byte, so git classifies it as binary and its diffs have never rendered — a review record that cannot itself be reviewed. (`docs/reviews/adversarial-review-20260815.md` carries ESC bytes but stays text.) Add a repo-wide control-byte check to `npm run scan` so no document can become undiffable again. | M | found during plan review | implemented:verified-local |
| G-15 | **Task state is not evidence and must stop being treated as such.** `002/tasks.md` is **0/71 checked** and is the declared verified baseline; `001` is 63/69 with six deliverables that never existed; no review record exists for `003-repository-default-policy`, `004`, `005`, or `006`; and `consolidated-review-20260816.md:685` required T040/T054 to carry a note that the claimed kill-mid-operation witness does not exist — `tasks.md:124` and `:177` are still `[X]` with no note. Either reconcile task state with reality or declare checkboxes non-authoritative and remove them from acceptance. | M | Report P1-7 | implemented:verified-local |
| G-11 | **Get CI running.** It never ran on v3 — the release audit concedes "locally on macOS", `backlog.md` says Actions is disabled. The Linux matrix and the Linux-only offline check have never executed on this code. | M | Report P1-5 | deferred: GitHub Actions not in use yet; verification is local |

### Workstream 9 — Config and validation integrity

Found in the usability matrix's later rounds. Three of these are data-integrity defects, not polish.

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| V-1 | **`config set` deletes sibling keys instead of merging.** Patching one key in `defaults` and one in `agents` silently removed `defaults.syncStrategy`, `defaults.branchPrefix`, and agent `beta` — exit 0. The documented contract (commit `5c36b18`, `docs/BACKLOG.md`) is explicit: *"keyed objects merge by key; `null` removes a keyed value; arrays replace wholesale."* Implementation does the opposite. **Silent config data loss.** | M | matrix C-03 | implemented:verified-local |
| V-2 | **Top-level JSON grammar is unvalidated and inconsistent.** `null` → internal **exit 1**; `[]` → **success, revision bumped**; `42` → exit 2 with raw implementation error text; a bare string → exit 3 treated as key `"0"`. Constitution: *"Invalid or unsupported schema MUST NOT silently fall back to defaults."* Also violates the exit-code contract (internal `1` for user input). | M | matrix C-04 | implemented:verified-local |
| V-3 | **`tree reorder` persists a duplicate selector.** Repeating a Tree selector exits 0 and writes the duplicate into `treeOrder`. Expected: refuse, manifest byte-identical. | M | matrix O-02 | implemented:verified-local |
| V-5 | **`defaults.syncStrategy` is written, validated, and never read.** `init.ts:148` writes it into every new workspace and `workspace.ts:23` validates it, but `sync.ts:60` hard-codes `parsed.values.strategy ?? "ff-only"` and never consults config. A user who sets `rebase` silently gets `ff-only`. Either honour it or remove the key. | M | help-audit `sync` | implemented:verified-local |
| V-4 | **Invalid default review base is accepted at write time and fails at read time.** Setting a Git-invalid `bad..ref` exits 0 with no warning and `doctor` reports clean; later `commits` and `against-trunk` fail on **all** Trees with exit 6. Constitution requires revision inputs be *"validated before use."* Validate at configure time. | M | matrix D-01 | implemented:verified-local |

### Workstream 8 — Architecture (schedule, not blockers)

| ID | Item | Type | Source | Status |
|---|---|---|---|---|
| A-1 | **Route duplicated git invocations through the port.** 66 raw `tryRun` sites vs 9 through `run`; **15 adapter methods have zero callers** while `Git.fetch` — sole holder of the injection guard — has one. This is the class S-1 came from, and it lets forward and resume paths diverge silently. | D | Report A3 | deferred: Phase 9, not release-blocking (decision R4) |
| A-2 | **Shared operation executor + typed step vocabulary.** `store/operation.ts:132-152` hardcodes lifecycle command kinds (persistence knowing command policy); `reconcile.ts` dispatches on the `step.kind × record.kind` cross product with `kind: string` and `input: unknown`. Every new multi-step command must be written twice with no compiler link. Schedule **before** the next multi-step command. | D | Report A4 | deferred: Phase 9, not release-blocking (decision R4) |
| A-3 | **Scoped observation.** `observeWorkspace` has 40 call sites; scoped `observeRepository` has zero. Serial `for … await`, ~5 subprocesses per worktree; measured 3.1s for `grove ls` at 20 trees, linear. Observation is also fused with policy — you cannot observe without evaluating conformance. | D | Report A5 | deferred: Phase 9, not release-blocking (decision R4) |
| A-4 | **Resolve the conformance model's contradiction.** `expectedPath` is set to the Tree's *current* path (so `misplaced` can never fire in-layout) while `expectedBranch` is enforced against convention — producing permanent `nonconforming-branch` diagnostics after `grove rename`, with `fix --move` refusing and stale tree directories reported by nothing. | D | Report P2 (arch) | deferred: Phase 9, not release-blocking (decision R4) |
| A-5 | **`fix` automates 1 of 9 diagnostic codes** via a hardcoded `planMove`; a second automatable remedy needs edits in four files. Replace with a code→remedy registry. | D | Report P2 (arch) | deferred: Phase 9, not release-blocking (decision R4) |
| A-6 | **Layering cleanups**: `config/workspace.ts:8` imports `CommandContext` from the command layer; `paths/layout.ts` is `export * from config/layout.ts` (two paths, one concept); `model/plan.ts` ↔ `store/operation.ts` mutual dependency; `conformance.ts` remedy strings embed CLI syntax; `planLifecycleRemoval` is vestigial and contradicted by `refuseUnsafe`; `compileLayout` compiles nothing. | D | Report P2 (arch) | deferred: Phase 9, not release-blocking (decision R4) |
| A-8 | **The global workspace mutation lock spans unbounded network I/O.** `cli.ts:195-198` wraps every `mutates: true` command in one lock; `repo add` (clone) and `sync` (fetch) run inside it with a 5s acquisition timeout, so concurrent mutating commands fail exit 4 during a large clone. `docs/BACKLOG.md` still scopes this deferral to `trunk sync`, which now delegates to `sync`. | D | Report P2-12 | deferred: Phase 9, not release-blocking (decision R4) |
| A-7 | **`reconcile` is three verbs under one name** — resume, abandon, audit — and `--audit-only` is exactly `doctor`. | D | Report P2 (arch) | deferred: Phase 9, not release-blocking (decision R4) |

### Obsoleted by rulings — do not work these

| Item | Why |
|---|---|
| P0-2 migration wedge (fingerprint over reflog/index bytes; abort refused post-publication; workspace bricked by `git status`) | **X** — subsystem deleted (⑤) |
| P1-5 instance: `GROVE_TEST_MIGRATION_CRASH_AFTER` in `dist/grove.mjs` | **X** — hook lives only in `migrate.ts` (⑤). Gate weakness survives as G-9. |
| `migrate --dry-run` human/JSON disparity | **X** — ⑤ |
| Migration consent-gate naming (`--accept-head-reflog-archive`) | **X** — ⑤ |
| Migration workflow: point of no return, resume/abort matrix, old-binary readability | **X** — ⑤ |
| N-1 runtime compatibility support | **X** — ⑥. Reduced to E-7. |
| Amending `json-results-v1.md` to permit lossy human output | **X** — ⑦ rules the contract binding; it is a bug class. |

---

## Part 3 — Honest gaps in this ledger

**Fix clarity is not uniform.** Of **72 actionable items**, **55 are M** — the fix is obvious and small. **17 are D** and need design before they can be estimated, concentrated in Workstreams 5 and 8. Seven further items are obsoleted outright by the rulings and appear only so nobody works them.

**Witnesses are named but unwritten.** Most findings name the test that would have caught them. None of those tests exist. Given that P1-15's _existing_ witness is constructed so it cannot detect the defect it cites, "add the test" is real work requiring care, not a checkbox.

**Coverage gaps across all three reviews.** Not exercised anywhere: schema-2 fixtures (moot under ⑤), network and auth failure modes, non-UTF-8 refs and paths, SHA-256 object format, submodules, NFS, case-sensitive filesystems (all testing was macOS/APFS), cross-host lock reclaim, and — from the practical session — dirty-worktree merge/rebase conflict boundaries and interrupted operations.

**What is validated and should not be disturbed.** The G-series in the usability matrix put the core thesis through ten rounds of native-Git manipulation — worktree move, branch rename, detach, native removal, native re-add — and it held every time. Migration isolation, byte-preserving `NativePath`/`RefName` encoding, content-addressed diagnostic identity with rescan-before-fix, and deterministic sorted lock ordering are all first-rate and are not on this list.

**No fundamental restructure is indicated.** Every item above is a bounded correction.
