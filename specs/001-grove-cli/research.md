# Phase 0 Research: Grove CLI

The design is fully pinned in `specs/001-grove-cli/contracts/`; there were no open `NEEDS CLARIFICATION` items in the spec. This document records the decisions that shape implementation, each with rationale and the alternatives the source design already rejected.

## D1. Reuse pinned `grove-ide` primitives, don't rewrite from scratch

- **Decision**: Copy and adapt the proven, tested primitives and domain rules from the pinned commit (§10.2), rewriting them to workspace-local paths and direct function calls; write fresh code only for the genuinely new areas (§10.3.1).
- **Rationale**: Locking, atomic manifests with CAS, branch claims, Git worktree parsing, and the D-014 rollback journal are crash- and race-tested. Reimplementing them would re-introduce bugs the source already fixed. The constitution's Safety-by-Construction principle is satisfied by reuse, not reinvention.
- **Alternatives rejected**: (a) Green-field rewrite — discards tested safety code. (b) Depend on the old packages — violates No Legacy Creep (package graph, daemon coupling, Bun).

## D2. Pinned source provenance and fallback

- **Decision**: All source references are pinned to commit `f198d491b4b5f481f28edf19503de56c28bb1cab` of the private `grove-ide` repository (branch `grove-cli` at planning time; not publicly accessible). Local checkout: `~/.superset/worktrees/grove-ide/grove-cli`; durable fallback is that repository's raw files at the same pinned commit, which require access to the private repository.
- **Rationale**: The local checkout is a Superset worktree that may be pruned; the raw URLs survive. Verified 2026-08-15 that the checkout is at the pinned commit and every §10.2/§10.3 path exists, and that Bun APIs appear only in `manifest.ts` (`Bun.CryptoHasher`) and `adapter.ts` (`Bun.spawn`).
- **Alternatives rejected**: Tracking `main`/`grove-cli` tips — the design forbids silent re-pinning; a new commit must be reviewed and recorded explicitly.

## D3. Runtime toolchain fixed to Node standard library + esbuild

- **Decision**: Strict TypeScript/ESM; Node 24 LTS (`engines >=24`); `node:util.parseArgs` for CLI parsing with direct subcommand dispatch; `node:child_process`; `node:crypto`; `node:test`; esbuild for the build only. Replace `Bun.CryptoHasher` → `node:crypto` and `Bun.spawn` → `node:child_process`; drop the daemon's noninteractive Git environment (Git credential behavior passes through untouched).
- **Rationale**: Zero runtime framework dependencies keep the single bundled artifact portable and match the constitution's Technology & Artifact Constraints. `parseArgs` is sufficient for the two-layer §8.1 grammar.
- **Alternatives rejected**: Bun runtime/test (excluded by §10.4); a CLI framework like commander/ yargs (unneeded dependency weight; direct dispatch is simpler and audit-friendly).

## D4. Single bundled artifact, single package

- **Decision**: One npm package `grovekit` exposing one `bin` (`grove` → `dist/grove.mjs`), built by esbuild with a `#!/usr/bin/env node` shebang, runnable with no `node_modules`/Bun/TypeScript/ display/source-checkout and no experimental flags. `npm pack` ships only `dist/`, `package.json`, `README.md`, and license.
- **Rationale**: Matches §10 and keeps the No Legacy Creep boundary mechanically checkable.
- **Note on naming**: The design (§10, as amended 2026-08-15) uses npm package name **`grovekit`** because `grove` and `grove-cli` are taken on the registry; the installed **command remains `grove`** and the **repository stays `grove-cli`**. The spec and constitution refer to the command and repo, so no conflict.
- **Alternatives rejected**: Native binary (adds toolchain, not needed — Node LTS is the runtime prerequisite); multi-package build (violates single-package rule).

## D5. Areas with no test carryover are specified by §11, written fresh

- **Decision**: Write fresh tests (and treat the §11 outlines as normative) for: workspace discovery (§2 / §11.1), §5 Tree path encoding (§11.4), §8.7 path containment (port only containment cases from the old `paths.test.ts`), agent-definition CRUD (§11.9), and the §8.1 CLI grammar (reuse only the dispatch-audit pattern, §11.5).
- **Rationale**: The source's global-resolution model is exactly what this project removes, the §5 encoding is new, and the old dispatch/agent tests live in excluded RPC/daemon modules. §10.3.1 makes these the normative specification.
- **Alternatives rejected**: Porting the old resolve/dispatch tests — they assert global state and RPC surfaces this project excludes.

## D6. Testing strategy: three offline layers, tests-first

- **Decision**: Layer 1 module tests (`node:test`) against `src/`; Layer 2 subprocess tests against the built `dist/grove.mjs`; Layer 3 artifact/install/golden-path under an isolated npm prefix. Every command scenario runs at Layer 2 against the real artifact, not in-process. Isolated temporary HOME + workspace; all Git remotes are local `file://`; the suite is fully offline. Port §10.3 tests first so they fail, then implement (§12.2).
- **Rationale**: Testing the shipped artifact catches bundling/entry-point regressions; offline + isolated HOME enforces Workspace-Local State Only (no `~/.grove`, no credentials, no network).
- **Alternatives rejected**: In-process-only testing (misses the artifact users install); network-dependent fixtures (non-hermetic, and would contradict the network-free safety judgments).

## D7. Legacy-creep enforcement is automated in CI

- **Decision**: The §13.1–§13.2 grep-able items run as the PROC-07 exclusion scan in CI (no Bun API, no excluded-path provenance, no legacy vocabulary `trail`/`canopy`, no server/socket/RPC, no detached processes); the remaining §13 items are release-review steps on the built artifact. CI runs all three test layers plus the scan on macOS and Linux for every push.
- **Rationale**: Mechanical gating is the only reliable defense against creep (constitution VI).
- **Alternatives rejected**: Manual-only review — misses partial pastes and stray imports.
