# Coverage & gap audit — grove CLI (2026-08-15)

Prompted by a real bug found this session: `grove delete` `rm -rf`'d a Grove directory holding loose non-git files **without `--force`**, because its work-safety gate inspected only git Trees — a Grove with zero Trees had nothing to inspect (now fixed, commit `f6b2541`).

This audit sweeps all ~40 commands for that **gap class** — _a destructive/mutating operation whose precondition inspects only PART of the state it affects_ — plus adjacent classes (validation holes, fail-open errors, terminal injection, untested paths). Six parallel passes, one per command family. Every Tier 1–3 finding below was **independently re-verified** at the cited `file:line`. Static analysis; no untrusted code executed.

Severity: **data-loss** > **correctness** > **security(injection)** > **coverage gap**.

---

## Tier 1 — Latent data-loss defects (verified)

### D1. `repo delete-branch` force-deletes (`git branch -D`) — destroys unpushed/unmerged commits, no `--force`, exit 0

- **`src/commands/repo.ts:286-302`** → **`src/git/adapter.ts:171-174`** (`git branch -D`).
- The gate checks only _claim state_: is the branch a configured trunk (`:292`) or claimed by a Tree (`:296`). It inspects **nothing about the branch's commits**, then force-deletes. `-D` (unlike `-d`) does not refuse an unmerged branch. There is no `--force` flag on the command and no unpushed check — so an unclaimed local branch whose commits are on no remote and in no worktree is silently, unrecoverably destroyed with **exit 0**.
- This is the exact seed class (partial-state gate) in the command family where the original reported bug lived, and it is the **highest-severity finding**: a no-flag, no-warning, exit-0 data-loss path.
- **Repro:** `git -C .bare/alpha branch feat origin/main`, commit onto `feat` (or drop origin's copy); `grove repo delete-branch alpha feat` → exit 0, commit gone.
- **Fix:** classify the branch (ahead of `origin/<b>`, or no remote counterpart) as delete/archive do; refuse without `--force`; add a `--force` flag. **Witness:** unclaimed branch ahead of remote ⇒ `delete-branch` exits 5 without `--force`.

### D2. `trunk / tree / repo remove` fail **open** on an unreadable worktree — force-teardown despite uncommitted work

- **`src/commands/trunk.ts:109-113`**, **`src/commands/tree.ts:139-143`**, **`src/commands/repo.ts:257-261`**.
- All three do `const d = await isDirty(...); if (d.dirty) refuse;` and **drop `d.problem`**. `isDirty` returns `{dirty:false, problem:"…"}` when `git status` can't be read (corrupt `.git`, locked index, permission loss) — so the gate sees "not dirty", skips the refusal, and runs `git worktree remove --force`, deleting the directory and any uncommitted files in it.
- **Asymmetry = the bug:** `grove delete`/`archive` route through `classifyWork` (`src/git/worktree.ts:87-95`), which **throws** `refused-precondition` on `problem`. These three open-code a weaker check that fails open. The one-line `problem`-drop is duplicated in all three.
- **Fix:** treat `problem` as "undeterminable ⇒ refuse without `--force`", matching `classifyWork`. **Witness (×3):** stub `status --porcelain` to exit non-zero ⇒ `remove` exits 5 without `--force`.

### D3. `grove delete` destroys **gitignored** files in a Tree worktree without `--force` _(debatable — design call)_

- **`src/commands/lifecycle.ts:136`** (`rmSync`) with **`src/git/worktree.ts:19`** (`status --porcelain`, no `--ignored`) and **`src/model/safety.ts:64-66`** (`unmanagedEntries` does not recurse into known Tree dirs).
- A pushed/synced Tree whose worktree holds a gitignored `.env`/secret passes every gate, then `rmSync` deletes it. `archive` _moves_ the dir, so the same file survives — a delete-vs-archive asymmetry. **Honest caveat:** git treats ignored files as disposable, so reasonable people differ on whether this is a defect; flagged for a **product decision**, not auto-fixed.

---

## Tier 2 — Correctness defects (verified)

### C1. Read commands report a false "clean" for a missing/corrupt worktree

- **`src/git/worktree.ts:42`** (`commitsAhead`), **`:55`** (`changedAgainst`), **`:67-68`** (`fileDiff`, no exit check) — via `commits` / `against-trunk` / `diff` (`src/commands/review.ts:66,80,98`).
- Each swallows a non-zero git exit into an empty result: a broken/missing worktree yields `"0 commit(s)"`, `"0 file(s)"`, or `"(no changes)"` at **exit 0**. This directly violates the file's own header contract (`worktree.ts:3`: "An unreadable worktree is reported, never silently treated as clean") and is inconsistent with `porcelainStatus`/`classifyWork` in the same file. A reviewer can conclude a branch has no work and delete it. (`diff` is partly protected — a _missing_ dir is caught by `resolveContained`; a _present-but-corrupt_ worktree is not.)
- **Fix:** surface a `problem`/error instead of `[]`/empty on non-zero exit. **Witness:** Tree with its worktree `rm -rf`'d ⇒ `commits`/`against-trunk` report the unreadable Tree, not "0".

### C2. `--force` cannot override an unreadable worktree in `archive`/`delete`

- **`src/commands/lifecycle.ts:48-51,115-116`**: `classifyGrove` runs _before_ the `--force` gate, and `classifyWork` throws on an unreadable worktree regardless of force. The remedy literally says "pass --force to proceed anyway," but `--force` never runs — you cannot force-delete a broken Grove, the exact case force exists for.
- **Fix:** let `--force` short-circuit classification (or catch-and-continue under force).

### C3. `commits --limit` is unvalidated — fails open to "0 commits"

- **`src/commands/review.ts:62`** → `commitsAhead` (`worktree.ts:40`). `--limit abc` → `NaN` → silently ignored; `--limit -5`/`0`/`3.5` → `git log -n…` errors → `[]` → `"0 commit(s)"` at exit 0. Never the `invalid-input` (exit 2) the taxonomy requires. **Witness:** `--limit abc` ⇒ exit 2.

### C4. `config set` accepts structurally-wrong values `init`/grammar would reject

- **`src/config/workspace.ts:59-60`**: `typeof x !== "object" || x === null` lets an **array** pass for `defaults`/`agents` (`typeof [] === "object"`). `grove config set --values '{"defaults":[]}'` persists a corrupt-shaped config.
- **`src/commands/workspace.ts:106-121`** never applies `assertGroveName`, so `--values '{"name":""}'` / `"-x"` / `"a/b"` / >64 bytes / control chars all persist — every one refused by `init` (`src/commands/init.ts:64`). The `init`-guaranteed-valid name can be made invalid afterward.
- **Fix:** reject non-plain-object `defaults`/`agents`; run `assertGroveName` on `name` in the merge validator.

### C5. `reconcile` — crashes on corrupt manifests it should repair, and is blind to two drift classes

- **Crash:** `src/commands/reconcile.ts:36,49` call `objectStoreFor`/`branchExists` unguarded. Manifest validation (`src/config/grove.ts:71-78`) checks only `trees[].directory` — not `branch` / `repositoryId` / `provenance`. A shape-valid manifest with `branch:"-x"` → `assertBranchName` throws → reconcile exits 2; `branch` missing → TypeError → exit **1 (internal)**. The _recovery_ tool crashes on the corrupt state it exists to handle.
- **Blind spots:** `scanDrift` only walks manifest→disk, never disk→manifest, so an orphaned `.bare/<repo>` (store on disk, absent from config) and a stale/cross-host **lock** in `.grove/locks/` are never reported (a cross-host lock is never auto-reclaimed, so it silently wedges every future mutation with no reconcile visibility).
- **Fix:** wrap per-entry scans (collect as drift, like `scanGroves`); enumerate `.bare/` and `locks/`. **Witness:** corrupt manifest (`branch:"-x"`) ⇒ reconcile reports drift, exit 0.

### C6. `init` I/O failures surface as exit 1 (internal) instead of io=7

- **`src/commands/init.ts:33-42,121`**: `mkdirSync`/`writeFileSync` scaffolding is outside any `GroveError` wrap (unlike `writeManifest` at `:133`). `init` into a read-only parent / full disk → raw `EACCES`/`ENOSPC` → exit 1, not the io=7 the taxonomy mandates. **Witness:** init into a `0555` parent ⇒ exit 7.

---

## Tier 3 — Terminal-escape injection via repo-borne data (verified)

### S1. `file ls` renders untrusted filenames raw

- **`src/commands/files.ts:43`**: `entries.map((e) => \`… ${e.name}\`)`writes`readdirSync`names to the terminal unsanitized. A repo shipping a file named with an ESC/OSC/CSI sequence injects it into a teammate's terminal.`agent.ts`routes stored values through`visible()`for exactly this;`file ls`bypasses it (and git's`core.quotePath`that protects`changes`/`against-trunk` paths).
- **Fix:** escape control bytes in rendered names (reuse `agent.ts`'s `visible()`).

### S2. Control-char defense covers only C0+DEL — C1 controls and bidi overrides slip through

- **`src/commands/agent.ts:25`** (`CONTROL_RE = /[\0-\x1f\x7f]/`) and `visible()` (`:38`). Misses C1 (e.g. CSI U+009B) and bidi overrides (U+202E "Trojan Source", isolates U+2066–2069). Not re-validated on load, so a hand-crafted `.grove/config.json` sails through `validateWorkspaceConfig`; `agent ls` / the run-error path then emit it raw, visually reordering the command a teammate believes will run.
- **Fix:** widen the class to include C1 + bidi controls; escape at render.

---

## Tier 4 — Coverage gaps (behavior appears correct; no test)

- **trunk:** the `trunk remove` dirty gate (both directions) + branch-ref-retained guarantee; `trunk sync` dirty/diverged skip paths; `trunk add` claim-conflict (exit 4) / remote-only adoption / missing-base (exit 2). _(trunk-repo.test.ts)_
- **repo:** `repo remove` happy path + every gate (dirty/unpushed/no-remote/linked-left-in-place); `repo fetch` and `repo status` are **entirely untested**; `repo add` name-collision; `repo link` of a plain non-repo folder.
- **lifecycle:** no end-to-end rollback test for archive/restore/rename journals (crash-mid-op); `tree add` branch-claim conflict not CLI-tested; name-validation not exercised through `rename`/`tree add` CLI (only unit-level).
- **read/create:** `treeContexts` aborts a whole read command (exit 8) when one Tree references an unknown repo — no resilience for the healthy Trees (`src/model/treectx.ts:42-50`); `ls` silently drops corrupt Groves collected in `scanGroves().errors` (no warning/count).
- **paths/robustness:** `diff` relative-path slice (`review.ts:97`) uses non-canonical `worktreePath` length — corrupts under a symlinked ancestor (currently latent); `treeWorkingDir` containment (`src/model/scope.ts:29-30`) is lexical-only (no realpath), unlike `resolveContained`; `file read` (`files.ts:63`) has no size cap / binary detection.
- **store:** journal `worktree-removed` rollback path untested; lock "corrupt-yet-mtime-fresh ⇒ refuse" direction untested.
- **completion:** reads `ctx.argv[0]` directly, so extra flags are silently ignored (cosmetic).

---

## Cross-cutting root causes

1. **Partial-state gates (the seed class):** D1, D2, C4, C5 all check one facet and act on another.
2. **Fail-open on unreadable git state:** C1/C2/D2 — non-zero git exit or `isDirty.problem` becomes "clean/empty" instead of "unknown ⇒ report/refuse". `classifyWork` is the correct model; several call sites diverge from it.
3. **Validation applied at one entry point but not another:** `init` vs `config set` (C4); `assertBranchName` inside the adapter but not on `--default-base`/`--from`/manifest `branch`.

## Recommended fix order

1. **D1** (repo delete-branch) and **D2** (remove trio fail-open) — same class as the fixed bug, real data loss.
2. **C1** (read false-clean) and **C5** (reconcile crash/blind) — the inspect/recover tools lying.
3. **C2, C3, C4, C6** — correctness/taxonomy.
4. **S1, S2** — injection hardening.
5. **D3** — product decision (ignored-file semantics).
6. Tier 4 witnesses alongside each fix.

---

## Resolution (applied 2026-08-15)

All verified defects fixed with regression witnesses; suite now **164 tests, 0 fail** (was 146).

| # | Fix | Witness |
|---|-----|---------|
| D1 | `repo delete-branch` gains `--force`; refuses a branch with commits not on the remote | `audit-fixes.test.ts` D1 ×2 |
| D2 | `trunk/tree/repo remove` fail CLOSED on an unreadable worktree (honor `isDirty.problem`); forced teardown made robust via new `Git.forceRemoveWorktree` (fs fallback + prune) so `--force` can still remove a corrupt worktree | `audit-fixes.test.ts` D2 ×3 |
| C1 | `commitsAhead`/`changedAgainst`/`fileDiff` surface a `problem` instead of a false empty result; `commits`/`against-trunk` report it per-Tree, `diff` errors | `audit-fixes.test.ts` C1 ×2 |
| C2 | archive/delete skip classification under `--force` so it can't block the force it's meant to override | `audit-fixes.test.ts` C2 |
| C3 | `commits --limit` rejects non-positive-integer input (exit 2) | `audit-fixes.test.ts` C3 |
| C4 | `config set` rejects an array for `defaults`/`agents` and enforces the `init` name grammar | `audit-fixes.test.ts` C4 |
| C5 | `reconcile` wraps per-Tree scan (corrupt manifest → drift, not crash); adds disk→config bare-store scan + stale-lock reporting (`scanStaleLocks`) | `audit-fixes.test.ts` C5 ×2 |
| C6 | `init` scaffolding I/O failure → io (exit 7), not internal (exit 1) | `audit-fixes.test.ts` C6 |
| S1 | `file ls` escapes control/bidi bytes in filenames (shared `model/control.ts`) | `audit-fixes.test.ts` S1 |
| S2 | control-char class widened to C1 + bidi (Trojan-Source); `agent add` rejects, `agent ls` escapes at render | `audit-fixes.test.ts` S2 ×2, `control.test.ts` |

**D3 (gitignored files destroyed by `grove delete` without `--force`) — WON'T FIX (product decision, 2026-08-15).** Git treats ignored files as disposable/regenerable, and `delete` already refuses on dirty/unpushed/loose-non-git content; refusing on every ignored file (`dist/`, `node_modules/`) would make `delete` noisy and rarely succeed without `--force`. Behavior left as-is by decision. No code change.

Spec updated: FR-019 (delete-branch work-safety), 001-grove-cli-SC-003 (fail-closed + delete-branch), and the `repo delete-branch` help. Tier 4 coverage gaps not individually fixed are left as noted above.
