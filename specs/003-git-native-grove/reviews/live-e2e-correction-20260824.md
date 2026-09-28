# Installed-CLI live E2E correction audit — 2026-08-24

## Scope and source

This audit closes only the five defects in a live-E2E report kept outside the repository. The implementation started from worktree HEAD `32b60038a840`; no migration, new command, platform/CI expansion, publish, push, or merge work was performed.

The reviewer-owned requirements-quality checklist is `checklists/live-e2e-corrections.md`. Its markers remain reviewer-owned; implementation completion is recorded by T104–T109 and the evidence below.

## Failing witnesses and corrections

Each witness was observed failing against the prior built artifact before its source correction.

| Finding | Red witness | Bounded correction | Focused/live result |
|---|---|---|---|
| F1 raw remote retained | V3OPS-05 searched the complete serialized terminal operation record and found the exact supplied remote | `repo add` plans retain only a redacted placeholder; terminal secret scrubbing removes duplicates from the whole durable record while resumable records keep the recovery secret | exact remote absent from every operation record in the fresh workspace |
| F2 incomplete delete refusal | combined dirty Tree plus loose Grove refusal omitted `my-notes.txt` and `subdir` | delete preflight now gathers both loss classes before one refusal and emits both in human and JSON detail | exit 5 in both modes; `tracked-edit.txt`, `secret-draft.md`, `my-notes.txt`, and `subdir` all disclosed; Grove retained |
| F3 stale Tree presentation order | persisted `[work@beta, work@alpha]` reread as `[work@alpha, work@beta]` | observation applies advisory `treeOrder` only to presentation after Git establishes live Tree existence/state | fresh installed `tree ls` returned `[work@beta, work@alpha]` |
| F4 false managed checkout fact | managed unregister returned its bare common repository as `checkoutRetained` | unregister results now distinguish managed bare common storage from a linked external checkout/common directory | managed and linked results both returned `checkoutRetained: null` and the correct `commonGitDirRetained`; raw Git snapshots were unchanged |
| F5 silent stale agent preferences | removing an agent referenced by workspace/Grove/Tree defaults produced no diagnostic | observation emits stable non-blocking `stale-agent-preference` policy diagnostics at all three scopes | `doctor --strict` exited 3 with sources `workspace-default`, `grove-default`, and `tree-default`; raw Git snapshot was unchanged |

The strengthened repository-removal assertion made eight existing REPO-04/05/06/07/11/12/13/16 ledger citations stale. Their assertion strings were updated to cite the same strengthened witness; no ledger schema, counting rule, marker model, or product scope changed.

## Automated verification

- Focused corrective/regression run: 45 tests passed, 0 failed.
- `npm run typecheck`: passed.
- `npm test`: 459 passed, 0 failed (177 module, 262 CLI, 20 E2E).
- `npm run scan`: passed, including PROC-07 and built-artifact scanning.
- `npm run traceability`: passed; prior-release ledger 180 scenarios/184 witnesses and v3 ledger 42 scenarios, with 0 deferred.
- `npm run build`: passed; `dist/grove.mjs` SHA-256 `337bc8db64232955e021f376dc17f093f0d793741faa5702130be4e2ed17424e`.

## Active local CLI and fresh live acceptance

- Command: `grove` (installed globally)
- Resolved artifact: this worktree's `dist/grove.mjs`
- Reported version: `0.3.0`
- Fresh evidence root: kept outside the repository

The installed command initialized a new workspace, managed two populated repositories (`alpha` and `beta`) as bare common repositories with peer `main@alpha` and `main@beta` trunks, created a two-repository Grove, persisted and freshly reread the requested Tree order, and registered a third normal repository (`gamma`) through `repo link` without changing its refs or worktree list. The linked repository reported no Grove trunks, supported ordinary `tree add`, and remained unchanged after unregister. All five finding-specific assertions in the table above then passed in that same fresh workspace.

## Verdict

The five reported live defects and their proof gaps are corrected. Automated and installed-CLI evidence is green, the locally active CLI resolves to this rebuilt worktree, and no out-of-scope release action was taken.
