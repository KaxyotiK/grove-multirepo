# Quickstart: Grove CLI validation guide

This guide proves Grove works end-to-end, offline, against the **built artifact** (`dist/grove.mjs`) — the same binary users install. It mirrors the §11.14 golden path (E2E-01). It is a validation/run guide, not implementation detail; see `data-model.md` and `contracts/` for schemas and the command contract, and `contracts/acceptance-scenarios.md` (§11) for the full scenario matrix.

## Prerequisites

- Node ≥ 24 and Git on `PATH`.
- A checkout of this repo. No network access is required: all remotes are local `file://` fixtures.
- An **isolated** `HOME` and working tree (the test harness sets these), so nothing touches the developer's real `~/.grove`, config, or credentials.

## Build and install into an isolated prefix

```bash
npm ci
npm run typecheck        # strict TS, must be clean
npm run build            # -> dist/grove.mjs with #!/usr/bin/env node
node dist/grove.mjs --version   # exits 0, prints version (works with no node_modules)

# Optional: verify a clean global install under an isolated npm prefix
npm install --global .   # exposes `grove`
grove --version
```

## Golden path (offline, local file:// remotes)

Run from an empty temp directory that is your intended workspace root. Every step exits `0` or refuses exactly where §8.5.1 requires. Add `--json` to any step to get one JSON value on stdout.

```bash
grove init                              # create the workspace (.grove/, .bare/, trunks/, groves/)
grove status                            # workspace identity, config revision, empty repos/groves

grove repo add "file:///path/to/fixture-ledger.git"      # clone into .bare/, create default trunk
grove repo add "file:///path/to/fixture-reporting.git"
grove trunk add reporting release/2026.08                 # long-lived trunk worktree; claims branch

grove new pricing-fix \
  --repo ledger --repo reporting \
  --branch ledger=feature/pricing \
  --branch reporting=feature/quote-api                    # one journaled operation; two Trees

# ... edit files in the Tree worktrees, commit in each ...
grove changes pricing-fix                # uncommitted changes per Tree
grove commits pricing-fix                # commits ahead of base
grove against-trunk pricing-fix          # changed files vs trunk/base
git -C groves/pricing-fix/trees/<tree> diff -- <path>  # patch display stays standard Git

grove agent run pricing-fix --tree <tree> -- <agent-args>  # foreground child; returns its exit code

# push one Tree, leave one unpushed, then exercise safety:
grove archive pricing-fix                # REFUSES if any Tree is dirty or unpushed (lists them)
grove archive pricing-fix --force        # tears down unpushed Trees (warns); dirty still refuses
grove restore pricing-fix                # re-creates worktrees on the recorded branches
grove delete pricing-fix --force         # removes worktrees; deletes only `created` branches
```

## Expected outcomes (acceptance)

- **Layout**: after each step the on-disk tree, `config.json`/`grove.json` manifests, and Git state match §3–§5 (directories use the §5 encoding; recorded `directory` values are stable).
- **JSON drivability (001-grove-cli-SC-002)**: with `--json`, each stdout is exactly one valid JSON value, and a script can drive the whole path from the JSON alone (the fake agent writes only to stderr, so `agent run`'s trailing JSON result is stdout's sole content).
- **Safety (001-grove-cli-SC-003)**: `archive` and `delete` refuse dirty/unpushed Trees without `--force`, and `delete` also refuses loose non-git files in the Grove directory; each refusal itemizes every blocker and why `--force` is needed. `--force` overrides identically for both (a forced archive discards dirty work, just like delete); archive preserves loose files by moving the directory. `delete` leaves `adopted` branches in place.
- **Recovery (001-grove-cli-SC-004)**: killing any multi-step step (e.g. `new` after `git branch` before `git worktree add`, or mid-`archive`) leaves a §6.1 journal; a single `grove reconcile` finishes or rolls it back and reports exactly what it undid — no partial Grove, leaked branch, or half-archived state.
- **Isolation (001-grove-cli-SC-005/006/007)**: the full run creates nothing under `~/.grove`, `~/.config`, or outside the temp workspace; `GROVE_ROOT` in the environment changes nothing; after each successful command no Grove process, lock file, or socket remains; two workspaces never read each other.
- **Exit codes (001-grove-cli-SC-008)**: every refusal/failure returns the correct §9 code (see `contracts/exit-codes.md`).

## Test layers this maps to

1. **Module tests** (`node:test`) — ported §10.3 + fresh §10.3.1 (discovery, §5 encoding, containment, agent CRUD, CLI grammar).
2. **CLI subprocess tests** — every command scenario above, spawning `dist/grove.mjs`.
3. **Artifact/install/golden-path** — this script end-to-end (E2E-01/02/03) under an isolated npm prefix, on macOS and Linux, plus the PROC-07 exclusion scan.
