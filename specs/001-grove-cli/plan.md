# Implementation Plan: Grove CLI

**Branch**: `001-grove-cli` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-grove-cli/spec.md`

## Summary

Grove is a single-command, workspace-local CLI (`grove`) for managing multi-repository units of work ("Groves") built on Git worktrees, with no daemon, server, or global state. The implementation ports proven safety primitives and domain rules from the pinned `grove-ide` source (§10.2/§10.3) into a flat, single-package `src/` tree, rewrites them to workspace-local paths and direct in-process calls, and builds one bundled artifact `dist/grove.mjs` (command `grove`, npm package `grovekit`). Work proceeds in the §12 order: scaffold → ported safety primitives → discovery + `init` → manifests/encoding/journal/trunks → remaining foreground commands → help/completion → full test layers + exclusion scan + bundled-install CI on macOS and Linux.

The authoritative technical design is `specs/001-grove-cli/contracts/` (§1–§9 behaviour, §11 acceptance scenarios), with §10 provenance in `docs/PROVENANCE.md` and §13 legacy-creep in `docs/LEGACY-CHECKLIST.md`; §12 (implementation sequence) is complete and retired. This plan does not restate them; it references them and records the concrete build structure.

## Technical Context

**Language/Version**: Strict TypeScript on ESM; runtime Node 24 LTS, declared `"engines": { "node": ">=24" }` (dev machine runs Node 26, which satisfies it).

**Primary Dependencies**: Node standard library only at runtime — `node:util.parseArgs` (CLI parsing + direct subcommand dispatch), `node:child_process` (Git and agent processes), `node:crypto` (hashing/IDs), `node:fs`/`node:path` (atomic manifests, containment). Git is an external process dependency. `esbuild` is a build-time dev dependency; no runtime frameworks.

**Storage**: Workspace-local JSON files only — `<workspace>/.grove/config.json` and `groves/*/grove.json`, plus lock files under `.grove/locks/` and rollback journals under `.grove/journal/`. No database. Nothing is written outside the resolved workspace.

**Testing**: Node's built-in `node:test` / `node:assert` in three layers — (1) module tests against `src/` modules, (2) CLI subprocess tests against the built `dist/grove.mjs`, (3) artifact/ install/golden-path tests under an isolated npm prefix. All Git fixtures are local `file://` remotes; the whole suite runs offline against an isolated temporary HOME and workspace tree.

**Target Platform**: macOS (case-insensitive filesystem) and Linux. Windows is out of scope and untested at launch.

**Project Type**: Single-package command-line tool (one npm package, one `bin`, one bundled artifact). Not a library graph, web service, or desktop app.

**Performance Goals**: Not throughput-bound. The operative goals are interactive-command latency (each invocation resolves, does one operation, and exits) and safety-window bounds — a mutation blocked by a held lock waits at most 5 seconds before exiting `4`.

**Constraints**: No daemon/server/socket/RPC/background process; no global or user-level state; no `GROVE_*` environment reads; the bundle must run with no `node_modules`, no Bun, no TypeScript, no display server, no source checkout, and no experimental Node flags. Atomic manifest writes; §6 locks; §6.1 recoverable journals; §9 exit-code taxonomy exactly.

**Scale/Scope**: The full §8 command surface (~40 commands across workspace, repo, trunk, grove, tree, review/file, agent), §5 path encoding, §6 concurrency safety, and §8.5.1 work-safety — sourced from the `specs/001-grove-cli/contracts/` contracts and the 001-grove-cli spec's 30 functional requirements.

**Source provenance (§10.1)**: pinned commit `f198d491b4b5f481f28edf19503de56c28bb1cab` of the private `grove-ide` repository (branch `grove-cli` at planning time; not publicly accessible). Local checkout `~/.superset/worktrees/grove-ide/grove-cli`; fallback documented in `research.md`. Do not silently re-pin.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle | How this plan complies | Gate |
|---|---|---|
| I. One Command, No Background | Single `bin: grove`; every command resolves→acts→exits; agent runs are one foreground `spawn` with inherited stdio (replacing the source's launch hierarchy, §10.2 `execution.ts`); no server/socket/session code is ported (§10.4 exclusions). | PASS |
| II. Workspace-Local State Only | Discovery is `--workspace` then upward walk to `.grove/config.json`; `resolve.ts` is rewritten to drop global roots; only `.grove/` and `groves/*/grove.json` are read/written; no `GROVE_*` reads; no global registry. | PASS |
| III. Single Source of Truth | Durable ULIDs (`ids.ts`) own identity; the recorded `directory` is stable; archived/materialized derive from path; the Grove name is the folder with no competing manifest field; reconcile reports drift without rebinding. | PASS |
| IV. Safety by Construction | Ported `lock.ts` (exclusive-create, heartbeat, atomic stale reclamation), `manifest.ts` (CAS + temp-write + fsync + atomic rename), and the D-014 rollback journal (`trails.ts`) pointed at `.grove/journal/`. Work-safety classification is network-free and, as of constitution 2.0.0 and feature 002, **derived** from the §8.5.1 destruction table rather than asserted per command: a command blocks on exactly what it removes, `unknown` fails closed, and `--force` reports what it destroyed. Re-checked against 2.0.0 on 2026-08-18 (AM-005). | PASS |
| V. Refuse, Never Guess | Ported typed `GroveError` (what/why/remedy + exit code); malformed/unknown-version config refuses; no migration/adoption path is ported (`layout-migration.ts` excluded); §8.9 families exit `2`. | PASS |
| VI. No Legacy Creep | Flat single-package `src/`; no `@grove/*` boundaries; only §10.2 files copied, §10.4 paths excluded; `Bun.*` → `node:*`; the PROC-07 exclusion scan + §13 checklist gate CI. | PASS |
| Tech & Artifact Constraints | Strict TS/ESM, Node ≥24, npm + committed `package-lock.json`, `node:util.parseArgs`, `node:test`, esbuild build-only, single `dist/grove.mjs` (`grove`), macOS/Linux. | PASS |
| Dev Workflow & Quality Gates | Tests-first (port §10.3 to fail, then implement); three §11 test layers; PROC-07 scan and bundled-install verification in CI on macOS + Linux. | PASS |

No violations. **Complexity Tracking is empty by design.**

## Project Structure

### Documentation (this feature)

```text
specs/001-grove-cli/
├── plan.md              # This file
├── research.md          # Phase 0 — pinned provenance, decisions, alternatives
├── data-model.md        # Phase 1 — entities, manifest schemas, invariants, state
├── quickstart.md        # Phase 1 — offline golden-path validation guide
├── contracts/
│   ├── cli-surface.md    # §8 command grammar, references, global options
│   └── exit-codes.md     # §9 exit-code taxonomy contract
└── tasks.md             # Created by /speckit-tasks (NOT this command)
```

### Source Code (repository root)

```text
src/
├── cli.ts                # Entry: parseArgs, global options, direct subcommand dispatch, --json
├── commands/             # One foreground function per §8 command; no transport/handler layer
│   ├── init.ts           # grove init (§7)
│   ├── workspace.ts      # status, config get/set, reconcile (§8.3) — reconcile.ts split as needed
│   ├── repo.ts           # repo add/link/ls/status/fetch/remove/delete-branch (§8.4)
│   ├── trunk.ts          # trunk ls/add/remove/sync (§8.4.1)
│   ├── grove.ts          # new/ls/show/rename/archive/restore/delete/configure (§8.5)
│   ├── tree.ts           # tree ls/add/remove/configure/reorder (§8.6)
│   ├── review.ts         # changes/commits/against-trunk (§8.7) + dirty checks
│   ├── files.ts          # file ls/read (§8.7)
│   ├── agent.ts          # agent ls/add/remove/run (§8.8)
│   └── reconcile.ts      # drift report + §6.1 journal finish/rollback (§8.3)
├── config/
│   └── discovery.ts      # §2 workspace resolution (--workspace, upward walk, realpath)
├── git/
│   ├── adapter.ts        # injectable runner, exact-ref checks, porcelain worktree parsing
│   └── claim.ts          # branch claim + worktree-add under lock; out-of-band detection
├── model/
│   ├── ids.ts            # injectable monotonic ULIDs + collision-safe short IDs
│   ├── validate.ts       # Git-ref + argv-safety; Grove/Tree validation
│   ├── scope.ts          # resolve Grove/Tree → working directory (guide only)
│   └── encoding.ts       # §5 slug/encoding, truncation, case-folded collision keys (NEW)
├── paths/
│   └── fs.ts             # bounded relative-path + containment predicates (explicit case/platform)
└── store/
    ├── lock.ts           # exclusive-file locks under <ws>/.grove/locks/
    └── manifest.ts       # revision CAS, temp-write, fsync, atomic rename (node:crypto)

tests/
├── module/               # Layer 1: node:test against src/ modules (§10.3 + §10.3.1)
├── cli/                  # Layer 2: subprocess tests spawning dist/grove.mjs
├── e2e/                  # Layer 3: artifact/install/golden-path under isolated npm prefix
└── testkit/              # Offline fixtures, tmp home/workspace, fake-agent (§10.3)

package.json              # name "grovekit", bin { grove: dist/grove.mjs }, engines >=24
package-lock.json         # committed
tsconfig.json             # strict, ESM
build.mjs / npm scripts   # esbuild → dist/grove.mjs (+ #!/usr/bin/env node), build/test/typecheck
scripts/legacy-scan.sh    # PROC-07 exclusion scan (§13.1–§13.2 grep gate)
docs/PROVENANCE.md        # pinned §10.1 source provenance record
.github/workflows/ci.yml  # typecheck + 3 test layers + legacy-scan on macOS & Linux
```

**Structure Decision**: Single-package, flat `src/` tree exactly as §10 prescribes. Internal folders (`commands/`, `git/`, `model/`, `store/`, `config/`, `paths/`) are ordinary source organization, **not** shipped packages or transports — the §10.2 files are copied here and rewritten to direct function calls returning values or throwing `GroveError`. `src/model/encoding.ts` and `src/config/discovery.ts` carry the most net-new logic (§10.3.1: §5 encoding and §2 discovery have no test carryover, so their §11.4/§11.1 outlines are normative).

## Implementation Phasing (per §12)

Each phase ports its tests first (they fail), then implements to green; all three §11 layers plus the PROC-07 scan gate the phase.

1. **Scaffold & toolchain** — §12.1: `package.json`/`tsconfig`/esbuild/`node:test` wiring, `src/cli.ts` answering `--version`, provenance recorded (§10.1). Exit: `npm ci && build && typecheck` clean; bundle runs with no `node_modules`.
2. **Safety primitives** — §12.3 (+ ported §10.3 module tests): `errors`, `ids`, `validate`, `paths/fs`, `store/lock`, `store/manifest`, `git/adapter`, `git/claim`, with `Bun.*` → `node:*`. Exit: module tests green; exit codes map to §9; PROC-07 clean.
3. **Discovery & `init`** — §12.4: `config/discovery.ts` (§2, exhaustive §11.1) and `init` (§7, atomic §11.2). Exit: discovery + isolation + init scenarios green at layers 1–2.
4. **Manifests, encoding, journal, trunks** — §12.5: `grove.json`, `model/encoding.ts` (§5, §11.4), exact branch matching, §6.1 journal, trunk worktrees, workspace-local repo/worktree ops.
5. **Remaining foreground commands** — §12.6: repo/trunk/grove/tree/review/files/agent/reconcile via direct calls, honoring §8.5.1 work-safety and §8.7 containment.
6. **Help & completion** — §12.7: generated from command definitions (dispatch-audit pattern only).
7. **Full verification** — §12.8: all three §11 layers, PROC-07 exclusion scan, bundle build, clean global install under an isolated npm prefix, CI on macOS + Linux for every push.

## Complexity Tracking

> No Constitution Check violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
