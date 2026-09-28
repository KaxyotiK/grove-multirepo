> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** They drifted from reality in both directions: `002/tasks.md` reads 0/71 while being the declared _verified_ baseline, and `001` reads 63/69 including six deliverables that never existed. What is actually done is recorded in the ledger `Status` column of `specs/003-git-native-grove/reviews/fix-ledger-20260823.md`, and only with a green witness behind it. Maintaining a second record alongside it is how this drift started, so acceptance does not read these boxes and neither should `/speckit-analyze`.

---

description: "Task list for grove CLI implementation"
---

# Tasks: Grove CLI

**Input**: Design documents from `specs/001-grove-cli/` (plan.md, spec.md, research.md, data-model.md, quickstart.md) and `contracts/` (normative).

**Tests**: INCLUDED and REQUIRED. The constitution mandates tests-first, and §12.2 requires porting each §10.3 test before its module so it initially fails. Every task pair below writes/ports the test task before the implementation task.

**Organization**: A shared foundation (Setup + Foundational) must complete first because the §12 sequence layers safety primitives, discovery, encoding, and the rollback journal under every command. User-story phases (US1–US5, priority order) then deliver the command surface. The golden path (US2) is the MVP once US1 exists.

## Conventions

- **Source layout** (plan.md): `src/{cli.ts,commands/,config/,git/,model/,paths/,store/}`; `tests/{module/,cli/,e2e/,testkit/}`.
- **Provenance**: "port X" = copy from the pinned commit `f198d491…` per the §10.2 map, rewrite to workspace-local paths + direct calls, replace `Bun.*` with `node:*`, and **drop** all §10.4 excluded surface (server/RPC/session/daemon/migration). Local root: `~/.superset/worktrees/grove-ide/grove-cli`; raw-URL fallback in research.md.
- **CLI-subprocess rule**: every command scenario runs at `tests/cli/` against the **built** `dist/grove.mjs`, not in-process (§11 layer 2).
- **[P]** = parallelizable (different files, no incomplete dependency). Story labels [US1]–[US5] on story tasks only.

---

## Phase 1: Setup (Shared Infrastructure) — §12.1

**Purpose**: Repository scaffold, toolchain, and offline test harness. No Grove behavior yet.

- [x] T001 Create the `src/` and `tests/` tree from plan.md (empty module files with headers), and record §10.1 source provenance (pinned commit, local root, raw-URL base) in `docs/PROVENANCE.md`
- [x] T002 Author `package.json` (name `grovekit`, `bin: {grove: dist/grove.mjs}`, `engines: {node: ">=24"}`, scripts `build`/`test`/`typecheck`, `esbuild` as devDependency only) and commit `package-lock.json` via `npm install`
- [x] T003 [P] Author strict-ESM `tsconfig.json` (strict, NodeNext/ESM, no emit — esbuild bundles)
- [x] T004 [P] Author `build.mjs` (esbuild → `dist/grove.mjs`, prepend `#!/usr/bin/env node`, bundle prod deps only)
- [x] T005 [P] Implement `src/cli.ts` stub answering `--version`/`-V` and `--help`/`-h` only, wired to the build
- [x] T006 [P] Port the offline test harness to `tests/testkit/` — `fixture.ts`, `tmp.ts` (isolated HOME + workspace), `fake-agent.ts` (stderr-only) from pinned `packages/testkit/*`
- [x] T007 [P] Add the `PROC-07` exclusion-scan script (`scripts/legacy-scan.sh`) enforcing §13.1–§13.2 grep items (no `Bun.`, no `trail`/`canopy`, no excluded-path provenance, no `createServer|listen(|Socket`, no `detached: true`/`unref()`)
- [x] T008 Add CI workflow running `typecheck` + all three test layers + `legacy-scan.sh` on macOS and Linux for every push
- [x] T009 Verify scaffold: `npm ci && npm run typecheck && npm run build` clean, and `node dist/grove.mjs --version` exits `0` with no `node_modules` present

**Checkpoint**: Toolchain builds a runnable bundle; harness and gates exist.

---

## Phase 2: Foundational (Blocking Prerequisites) — §12.3, §12.5 primitives

**Purpose**: The copied-and-adapted safety primitives, §5 encoding, and the §6.1 journal that every user story depends on. ⚠️ No user-story work begins until this phase is complete.

**Tests-first**: each port task (test) precedes its module task and must fail first.

- [x] T010 [P] Port `ids.test.ts` → `tests/module/ids.test.ts` (monotonic ULIDs, collision-safe short IDs)
- [x] T011 [P] Port `validate.test.ts` → `tests/module/validate.test.ts` (Git-ref + argv-safety; Grove/Tree validation replacing Trail)
- [x] T012 [P] Port containment cases from `paths.test.ts` → `tests/module/paths.test.ts` (bounded relative-path + containment; explicit case/platform behavior)
- [x] T013 [P] Port `store.test.ts` + `steal.test.ts` → `tests/module/store.test.ts` (revision CAS, temp-write+fsync+atomic rename; exclusive lock, heartbeat, atomic stale reclamation)
- [x] T014 [P] Port `claim.test.ts` → `tests/module/claim.test.ts` (branch claim under lock; out-of-band worktree detection)
- [x] T015 [P] Write fresh `tests/module/encoding.test.ts` from §5/§11.4 (slug rules, `~40`/`~7e`/byte encoding, boundary truncation + Tree-ID suffix, case-folded collision keys, non-UTF-8 rejection)
- [x] T016 Implement `src/errors.ts` — typed `GroveError` with what/why/remedy fields and exact §9 exit-code mapping (port `core/errors.ts`, drop legacy kinds)
- [x] T017 [P] Implement `src/model/ids.ts` (port `core/ids.ts`) — make T010 pass
- [x] T018 [P] Implement `src/model/validate.ts` (port `core/validate.ts`) — make T011 pass
- [x] T019 [P] Implement `src/paths/fs.ts` (port `core/fs-paths.ts`) — make T012 pass
- [x] T020 [P] Implement `src/store/manifest.ts` (port `store/manifest.ts`, `Bun.CryptoHasher`→`node:crypto`) — CAS/atomic writes for T013, **and the read-only path (FR-016)**: complete-file validation returning a consistent snapshot, or reporting a concurrent revision change and retrying within a small bound (no global lock)
- [x] T021 [P] Implement `src/store/lock.ts` (port `store/lock.ts`, locks into `<ws>/.grove/locks/`) — make T013 pass
- [x] T022 Implement `src/git/adapter.ts` (port `git/adapter.ts`, `Bun.spawn`→`node:child_process`; injectable runner, exact-ref checks, porcelain worktree parsing; drop noninteractive Git env)
- [x] T023 Implement `src/git/claim.ts` (port `git/claim.ts`; Trail→Grove/Tree ownership) — make T014 pass (depends on T021, T022)
- [x] T024 Implement `src/model/encoding.ts` (§5 encoding/collision) — make T015 pass
- [x] T025 [P] Implement `src/model/scope.ts` (guide from `daemon/scope.ts`; Grove/Tree→working dir; drop Canopy/Trail/UI/terminal concerns)
- [x] T026 Implement `src/store/journal.ts` — D-014 rollback journal at `<ws>/.grove/journal/` (per-operation+target keys, keep-directory flag, record branch-create before worktree-add) with `tests/module/journal.test.ts` (§6.1 record/rollback/finish)
- [x] T027 Implement the CLI dispatch skeleton in `src/cli.ts` — `node:util.parseArgs`, §8.1 two-layer grammar, global options (`--workspace`, `--json`, `--progress=json`, `--`), the single-JSON success/error envelope routed through `GroveError`, and a resolved-workspace context object passed to commands
- [x] T028 Verify §9 mapping: `tests/module/exit-codes.test.ts` asserts every `GroveError` kind maps to the exact contracts/exit-codes.md value; run `legacy-scan.sh` clean

**Checkpoint**: Foundation ready — all safety primitives, encoding, journal, and dispatch exist and are green.

---

## Phase 3: User Story 1 — Establish a workspace (Priority: P1) 🎯 MVP-foundation — §12.4

**Goal**: `grove init` + reliable §2 discovery, plus `status`, `config get/set`, and `reconcile`.

**Independent Test**: `grove init` in an empty dir, then `grove status` from that dir and a nested subdir resolve the same workspace; a command from an unrelated dir reports "No Grove workspace found"; a malformed nearest config refuses without falling back.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T029 [P] [US1] Write `tests/module/discovery.test.ts` from §2/§11.1 (exhaustive — no carryover): `--workspace` precedence, upward walk, realpath containment, malformed/unsupported nearest config refuses, no `GROVE_*` reads
- [x] T030 [P] [US1] Write `tests/module/init.test.ts` from §7/§11.2 (atomic creation, partial-failure rollback, idempotency) using `canopy-creation.test.ts` as reference only
- [x] T031 [P] [US1] Write `tests/cli/workspace.test.ts` against `dist/grove.mjs`: `init` (+`--name`/`--nested`), `status`, `config get`, `config set --values --expect` (CAS + stale refusal), `reconcile` on a clean workspace (RECON-04), and the isolation checks (ISO-04/05, DISC-09)

### Implementation for User Story 1

- [x] T032 [US1] Implement `src/config/discovery.ts` (port `daemon/resolve.ts`; marker exactly `.grove/config.json`, §2 precedence incl. `--workspace`, realpath) — make T029 pass
- [x] T033 [US1] Implement `src/commands/init.ts` (§7 create+validate+atomic marker publish, idempotent, `--nested`/`--name`) — make T030 pass
- [x] T034 [US1] Implement `src/commands/workspace.ts` — `status`, `config get`, `config set` (CAS on `name`/`defaults`/`agents` only; structural arrays read-only)
- [x] T035 [US1] Implement `src/commands/reconcile.ts` (port `daemon/reconcile.ts`) — drift report (manifest/fs/Git-ref/worktree, incl. RECON-05: an out-of-band Grove directory rename — report each worktree whose Git linkage no longer matches its recorded path and rebind nothing; the Grove already lists under its new directory name since the path is the name) + finish/rollback pending §6.1 journal as its **only** mutation (reconcile reports drift, it does not otherwise repair — §8.3); drop layout-migration/daemon state
- [x] T036 [US1] Wire US1 commands into `src/cli.ts` dispatch; make T031 pass; run `legacy-scan.sh`

**Checkpoint**: A workspace can be created, discovered, inspected, and reconciled.

---

## Phase 4: User Story 2 — Create a unit of work and run an agent (Priority: P1) 🎯 MVP golden path — §12.5–§12.6

**Goal**: Register repositories, create a Grove with Trees (journaled), and run an agent foreground.

**Independent Test**: `repo add` a fixture, `grove new my-work --repo <repo>`, confirm the Tree worktree on the derived branch, then `agent run my-work -- <args>` runs the configured agent in the Tree and returns its exit code.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [ ] T037 [P] [US2] Port `repos.test.ts` + `repo-status.test.ts` → `tests/module/repo.test.ts` (add/link/remove rules, health via real broken fixtures)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: `tests/module/repo.test.ts` does not exist and never did. The behaviour is partly covered by tests/cli/trunk-repo.test.ts and tests/cli/regressions.test.ts (CLI layer, not module), so this is not zero coverage — but the task was checked off against an artifact that was never written, which is how a task list stops being evidence. Unchecked until the named tests exist or the task is rewritten to name the real ones.
- [x] T038 [P] [US2] Port `trails.test.ts` + `trail-membership.test.ts` → `tests/module/grove.test.ts` (Grove/Tree lifecycle, journaled `new`, derived-branch provenance, refuse-adopt)
- [ ] T039 [P] [US2] Port `execution.test.ts` (validation cases only) → `tests/module/agent.test.ts`; add fresh agent-CRUD tests from §8.8/§11.9 (definition = command+args; no signals/hooks/session)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: `tests/module/agent.test.ts` does not exist and never did. The behaviour is partly covered by tests/cli/regressions.test.ts and tests/cli/golden-path.test.ts (CLI layer, not module), so this is not zero coverage — but the task was checked off against an artifact that was never written, which is how a task list stops being evidence. Unchecked until the named tests exist or the task is rewritten to name the real ones.
- [x] T040 [P] [US2] Write `tests/cli/golden-path.test.ts` against `dist/grove.mjs`: `repo add` → `new` (single + multi-repo with `--branch` overrides + `--prefix`) → worktree/branch assertions → `agent run` (fake agent) → `--json` drivability (E2E-03 shape), plus PROC-08 (kill after `git branch` before `worktree add` → reconcile rolls back)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: the "kill mid-operation" recovery witness this claims does not exist. `tests/cli/golden-path.test.ts:96` exercises an ordinary in-process failure and its rollback, which is a different guarantee — a killed process leaves a journal that `reconcile` must finish or undo, and nothing tests that. Tracked as ARCH-07 / ARCH-11, both deferred in `scripts/scenario-traceability.sh` pending the §6.1 fault-injection harness (backlog Phase 004). The rest of the task's coverage is real and stays checked.

### Implementation for User Story 2

- [x] T041 [US2] Implement `src/commands/repo.ts` (port `daemon/repos.ts`) — `repo add` (clone into `.bare/`, derive name, default trunk worktree), `repo link`, `repo ls`, `repo status`, `repo fetch`; resolved-workspace context replaces global roots — make T037 pass
- [x] T042 [US2] Implement `src/commands/grove.ts` `new`/`ls`/`show` (port lifecycle from `daemon/trails.ts`; Trail→Grove) — journaled `new`, §5 encoding for Tree dirs, `created`/`adopted` provenance, refuse silent adopt, empty Groves; **Grove-name authority (constitution III): the folder under `groves/` is the name; `grove.json` has NO `name` field — reject a manifest containing a `name` key as an unknown-key error (§4.1, Principle V), never tolerate or derive it** — make T038 pass (depends on T024, T026, T041)
- [x] T043 [US2] Implement `src/commands/tree.ts` `tree add`/`tree ls` (from `daemon/trails.ts` membership) — create/adopt one Tree, claim branch, `--from` base
- [x] T044 [US2] Implement `src/commands/agent.ts` (port `daemon/agents.ts` CRUD + `daemon/execution.ts` validation) — `agent add`/`ls`/`remove` (workspace-local, command+args, inherits env) and `agent run` as one foreground `spawn` with inherited stdio/terminal + signal forwarding, agent-choice hierarchy, `--json` result after child exits — make T039 pass
- [x] T045 [US2] Wire US2 commands into dispatch; make T040 pass; run `legacy-scan.sh`

**Checkpoint**: MVP golden path works end-to-end against the built artifact.

---

## Phase 5: User Story 3 — Review work across a Grove (Priority: P2) — §12.6

**Goal**: Read-only, scope- and path-contained review and file commands.

**Independent Test**: In a Grove with committed + uncommitted changes, `changes`/`commits`/ `against-trunk` report correctly and a file path escaping the scope is refused.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [ ] T046 [P] [US3] Port `changes.test.ts` + `commits.test.ts` + `dirty.test.ts` → `tests/module/review.test.ts` (changes, commits-ahead-of-base, dirty checks; per-Tree base = `defaultBase` else repo trunk; missing base refuses)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: `tests/module/review.test.ts` does not exist and never did. The behaviour is partly covered by tests/cli/review.test.ts (CLI layer; the specified module path was never created), so this is not zero coverage — but the task was checked off against an artifact that was never written, which is how a task list stops being evidence. Unchecked until the named tests exist or the task is rewritten to name the real ones.
- [ ] T047 [P] [US3] Port `files.test.ts` + §8.7 containment cases → `tests/module/files.test.ts` (bounded listing/reading; absolute + resolved-escape refusal)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: `tests/module/files.test.ts` does not exist and never did. The behaviour is partly covered by tests/cli/review.test.ts and tests/cli/regressions.test.ts (CLI layer), so this is not zero coverage — but the task was checked off against an artifact that was never written, which is how a task list stops being evidence. Unchecked until the named tests exist or the task is rewritten to name the real ones.
- [x] T048 [P] [US3] Write `tests/cli/review.test.ts` against `dist/grove.mjs`: `changes`/`commits`/`against-trunk`/`file ls`/`file read` incl. containment refusals and the removed-command witness (FILE-*, §11.8)

### Implementation for User Story 3

- [x] T049 [US3] Implement `src/commands/review.ts` (port `daemon/changes.ts` + `daemon/dirty.ts`) — `changes`/`commits`/`against-trunk`; per-Tree base resolution + refuse-missing-base; no transport layer — make T046 pass
- [x] T050 [US3] Implement `src/commands/files.ts` (port `daemon/files.ts`; remove UI shaping) — `file ls`/`file read` with `src/paths/fs.ts` containment — make T047 pass
- [x] T051 [US3] Wire US3 commands into dispatch; make T048 pass; run `legacy-scan.sh`

**Checkpoint**: Multi-repo review works from the CLI.

---

## Phase 6: User Story 4 — Archive, restore, and delete safely (Priority: P2) — §12.6

**Goal**: Grove lifecycle with §8.5.1 work-safety, journaled archive/restore, provenance-aware delete, plus `rename`, `configure`, and `tree remove/configure/reorder`.

**Independent Test**: Archive with a dirty Tree (refused) → commit → archive (worktrees torn down, files moved to `.archive/`) → restore (worktrees re-created) → delete under the same checks.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [x] T052 [P] [US4] Write `tests/module/work-safety.test.ts` from §8.5.1 (dirty/unpushed/synced classification, network-free from last fetch; itemized refusals; `--force` overrides archive and delete identically — dirty discarded either way; loose-file guard for delete; delete provenance rules)
- [ ] T053 [P] [US4] Port `object-config.test.ts` + `order-branches.test.ts` → `tests/module/tree-config.test.ts` (`null` clears / absent leaves alone; reorder order/membership disagreements)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: `tests/module/tree-config.test.ts` does not exist and never did. The behaviour is partly covered by tests/cli/regressions.test.ts and tests/cli/lifecycle.test.ts (CLI layer), so this is not zero coverage — but the task was checked off against an artifact that was never written, which is how a task list stops being evidence. Unchecked until the named tests exist or the task is rewritten to name the real ones.
- [x] T054 [P] [US4] Write `tests/cli/lifecycle.test.ts` against `dist/grove.mjs`: `rename`, `archive`/`restore`/`delete` (ARCH-*, incl. dirty/unpushed/loose-file iterations, forced-discard symmetry, and archive preserving loose files), `tree remove/configure/reorder`, and kill-mid-op recovery via `reconcile` (ARCH-07/11)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: the "kill mid-operation" recovery witness this claims does not exist. `tests/cli/golden-path.test.ts:96` exercises an ordinary in-process failure and its rollback, which is a different guarantee — a killed process leaves a journal that `reconcile` must finish or undo, and nothing tests that. Tracked as ARCH-07 / ARCH-11, both deferred in `scripts/scenario-traceability.sh` pending the §6.1 fault-injection harness (backlog Phase 004). The rest of the task's coverage is real and stays checked.

### Implementation for User Story 4

- [x] T055 [US4] Implement work-safety classification in `src/commands/grove.ts` (reuse `daemon/dirty.ts`) — make T052 pass
- [x] T056 [US4] Implement `grove archive`/`restore`/`delete`/`rename`/`configure` (journaled per §6.1; archive tears down worktrees + moves Grove-level files; restore re-creates; delete removes only `created` branches; archived Trees retain claims)
- [x] T057 [US4] Implement `src/commands/tree.ts` `tree remove`/`configure`/`reorder` (release claim, keep branch ref; contained `--working-dir`; array-order persistence) — make T053 pass
- [x] T058 [US4] Wire US4 commands into dispatch; make T054 pass; run `legacy-scan.sh`

**Checkpoint**: Full Grove/Tree lifecycle is safe and recoverable.

---

## Phase 7: User Story 5 — Maintain trunks, repos, and completion (Priority: P3) — §12.6

**Goal**: Trunk worktrees, destructive repo operations, and shell completion.

**Independent Test**: `trunk add` claims a branch; `trunk sync` fast-forwards clean trunks; `repo remove`/`delete-branch` enforce the §8.4 rules; `completion` emits a valid script.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [ ] T059 [P] [US5] Write `tests/module/trunk.test.ts` from §8.4.1 (add/remove/sync; fast-forward-only; claim semantics; configured-trunk removal refusal; no-remote handling)
  - **RECORD CORRECTED 2026-08-18 (P2-12)**: `tests/module/trunk.test.ts` does not exist and never did. The behaviour is partly covered by tests/cli/trunk-repo.test.ts (CLI layer), so this is not zero coverage — but the task was checked off against an artifact that was never written, which is how a task list stops being evidence. Unchecked until the named tests exist or the task is rewritten to name the real ones.
- [x] T060 [P] [US5] Write `tests/cli/trunk-repo.test.ts` against `dist/grove.mjs`: `trunk ls/add/remove/sync` (TRUNK-_), `repo remove [--force]` + `repo delete-branch` (REPO-_, references block even forced), `completion bash|zsh|fish`

### Implementation for User Story 5

- [x] T061 [US5] Implement `src/commands/trunk.ts` (§8.4.1) — `trunk ls/add/remove/sync`; fast-forward-only sync; claim; configured-trunk protection — make T059 pass
- [x] T062 [US5] Implement `repo remove` + `repo delete-branch` in `src/commands/repo.ts` (§8.4 dirty/unpushed/reference rules; managed vs linked)
- [x] T063 [US5] Implement `grove completion <bash|zsh|fish>` generated from command definitions (F2 — completion is a US5 command, so it ships here, not in Polish), wire US5 commands into dispatch; make T060 pass; run `legacy-scan.sh`

**Checkpoint**: All supporting-resource commands complete.

---

## Phase 8: Polish & Cross-Cutting — §12.7–§12.8, §13

**Purpose**: Generated help/completion, full verification, legacy-creep gate, and docs.

- [x] T064 Generate `--help` output from command definitions and add `tests/module/dispatch-audit.test.ts` (reuse `dispatch.test.ts` audit idea only: surface generated, never hand-listed; every mutation reachable) — confirms both `--help` and the `completion` from T063 derive from the same definitions
- [x] T065 [P] Author `tests/e2e/golden-path.test.ts` (§11.14 E2E-01/02/03) under an isolated npm prefix: build → `npm install --global .` → drive the full quickstart.md path through the installed `grove`, and via `--json` only
- [x] T066 [P] Add `tests/e2e/artifact.test.ts` (§11.7 ART-01–06): bundle runs with no `node_modules`/Bun/TS/display; `npm pack` file list is only `dist/`, `package.json`, `README.md`, license; bundle-content scan has no legacy vocab/RPC/excluded code
- [x] T067 Run the full §13 legacy-creep checklist against the built artifact (grep-able items via `legacy-scan.sh` in CI + manual release-review items); fix any hit — no grandfathered exceptions
- [x] T068 [P] Update `README.md` with install (`grovekit` package, `grove` command) and the golden path; confirm `docs/PROVENANCE.md` matches §10.1
- [x] T069 Full verification: all three §11 layers green on macOS + Linux CI; `typecheck` clean; `quickstart.md` validation passes end-to-end

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2)** → depends on Setup; **BLOCKS all user stories** (primitives, encoding, journal, dispatch).
- **US1 (P3 phase)** → depends on Foundational. Delivers workspace + discovery.
- **US2 (P4)** → depends on Foundational + US1 (needs a discoverable workspace). MVP golden path.
- **US3 (P5)**, **US4 (P6)**, **US5 (P7)** → depend on Foundational + US1; each also needs US2's Groves/Trees to exercise real fixtures, but their command code is independent and independently testable.
- **Polish (P8)** → depends on all targeted stories (`--help` + dispatch audit generated once all commands exist; `completion` itself ships in US5 per F2).

### Within a story

- Test tasks precede their implementation task and must fail first (§12.2).
- Modules before the commands that use them; commands wired into dispatch last; `legacy-scan.sh` after each story.

### Parallel opportunities

- Setup: T003–T007 in parallel.
- Foundational: all test ports T010–T015 in parallel; then T017–T021 + T025 in parallel (distinct files); T022→T023, T024, T026 gated by their tests.
- Each story's test tasks ([P]) run in parallel; implementation tasks touching the same command file are sequential (e.g. US2 T041→T042; US4/US5 both touch `repo.ts`/`tree.ts` so sequence those).

---

## Parallel Example: Foundational test ports

```bash
# Launch the §10.3 test ports together (all different files, all must fail first):
Task: "Port ids.test.ts → tests/module/ids.test.ts"
Task: "Port validate.test.ts → tests/module/validate.test.ts"
Task: "Port containment cases → tests/module/paths.test.ts"
Task: "Port store.test.ts + steal.test.ts → tests/module/store.test.ts"
Task: "Port claim.test.ts → tests/module/claim.test.ts"
Task: "Write fresh tests/module/encoding.test.ts from §5/§11.4"
```

---

## Implementation Strategy

### MVP scope

1. Phase 1 Setup → Phase 2 Foundational (critical, blocks everything).
2. Phase 3 US1 (workspace exists and is discoverable).
3. Phase 4 US2 (golden path: repo add → new → agent run). **STOP and validate the golden path** — this is the North Star MVP.

### Incremental delivery

US1 → US2 (MVP) → US3 (review) → US4 (lifecycle safety) → US5 (trunk/repo/completion) → Polish. Each story is an independently testable increment that does not break earlier ones. CI runs all three §11 layers + the PROC-07 scan on macOS and Linux at every push throughout.

## Notes

- Tests are REQUIRED here (constitution + §12.2), organized test-before-module.
- `[P]` = different files, no incomplete dependency. Commands sharing a file (`repo.ts`, `tree.ts`, `grove.ts`) are sequenced, not parallel.
- Never carry over server/RPC/session/daemon/migration surface (§10.4); `legacy-scan.sh` gates it.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
