# Feature specifications

## Read this before trusting a directory number

**The numeric prefixes are not chronological and two of them collide.** Recorded here because the numbering silently implies an order that does not exist, and a reader who assumes it will draw the wrong conclusions about what supersedes what (ledger G-14).

| Directory | Landed | Note |
|---|---|---|
| `001-grove-cli` | 1st | The stable `§` citation authority and the home of the 180 regression scenario IDs. Closed to new behaviour — see its `contracts/README.md`. |
| `002-work-safety-force` | 2nd | `--force` derivation. |
| `004-repository-diagnostics` | 3rd | |
| `005-remove-grove-diff` | 4th | |
| `006-command-schema` | 5th | |
| `007-crash-recovery-tests` | 6th | |
| `008-full-scenario-traceability` | 7th | Built the traceability gate. |
| `003-repository-default-policy` | 8th | **Numbered 003 but landed after 008.** |
| `003-git-native-grove` | 9th, current | **A second `003`.** The Git-native revision; where new behaviour is written. |
| `009-file-surface-state-exclusion` | 10th | Excludes `.grove/` from the workspace-scoped file surface; amended to refuse credentialed `repo add` remotes and exclude repository stores. Amends `003`'s contracts. |
| `010-self-contained-v3-contracts` | 11th | Moves the proposal rules the v3 contracts relied on into them; deletes the proposal. |
| `011-doctor-steal-marker` | 12th | Makes the read-only lock audit diagnose automatically recoverable orphaned `.steal` markers. |

So `004`–`008` all predate both `003-` directories, and `003-` is ambiguous on its own — always name the full directory. This is also why success-criteria IDs are namespaced by full directory name (`003-git-native-grove-SC-004`) rather than by number: `003-SC-004` would still be ambiguous.

## Authority order

1. `.specify/memory/constitution.md` — principles and governance.
2. `specs/001-grove-cli/contracts/` — `§` numbering and the 180 scenario IDs. Closed to new behaviour.
3. `specs/003-git-native-grove/contracts/` — the Git-native revision. **Supersedes `001` wherever the two disagree.**
4. `specs/<NNN>-*/spec.md` — per-feature deltas.

Nothing outside `specs/` is normative. The pre-ruling Git-native proposal is historical input only; the rules the v3 contracts need from it were moved into them by feature `010`.

## Removed historical documents

These were deleted from the tree before public release. Older specs, plans, and tasks still cite them by their old paths. They are kept in the private development history, not in this repository.

- `.archive/build-plan.md`, `.archive/future-state.md`
- `backlog.md`
- `docs/decisions-and-tasks-20260820.md`, `docs/design-decisions-20260819.md`
- `docs/retro-failure-analysis.md`, `docs/retro-post-build-fixes.md`, `docs/retro-timeline.md`
- `docs/herdr-sidebar-capability-assessment.md`
- `docs/git-native-grove-proposal.md` (the pre-ruling v3 proposal; its §5, §8.2, and §8.4 now live in `config-v3.md`, `cli-surface-v3.md`, and `json-results-v1.md`)
- `docs/LEGACY-CHECKLIST.md` (enforced by `scripts/legacy-scan.sh`), `docs/PROVENANCE.md`
- `docs/help-authoring-context.md` (current content moved into [README: How it works](../README.md#how-it-works) and [CONTRIBUTING: Writing help text](../CONTRIBUTING.md#writing-help-text))
- `docs/reviews/` (all five reviews)
- `reviews/` (usability and red-team write-ups)
- the dated review records under `specs/001-grove-cli/reviews/` and `specs/003-git-native-grove/reviews/` that nothing cited
- `specs/003-git-native-grove/remediation-plan-20260823.md` (superseded by `tasks.md` and the `reviews/` ledgers it spun off; nothing cited it); kept in the private development history, not in this repository

## A gap in the record

`main`'s merged v2 contracts were replaced without a supersession record, and `main`'s constitution independently reached 2.0.2 while this branch reached 5.0.0 from the same 1.0.0 ancestor — the two `2.0.0` amendments are different amendments sharing a number. The verified lineage is in the constitution's `VERSION LINEAGE` block. It is recorded rather than repaired: amendment records are historical and must not be rewritten.
