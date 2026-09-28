# Issue #9 round 7 evidence ledger

Constitution 6.0.0 Principle IV, FR-021/FR-023/FR-023A and V3DES-01 govern this correction. The round-six ledger remains a historical statement of its own verification, but independent review found its structural ownership claim overbroad for nested Git repositories and populated submodules. This ledger supersedes that claim for those shapes. Task checkboxes in `tasks.md` are not completion evidence.

| Task | Status | Witness |
|---|---|---|
| T-R7-1 | implemented:verified-local | Frozen `9341205` bundle: `tests/cli/destructive-round7.test.ts` 9/9 behavioral failures, plus 5/5 cross-command failures; the red run logs were kept outside the repository. Each old run removed or moved independent Git content at exit 0; no failure depends on flag spelling. |
| T-R7-2 | implemented:verified-local | Focused round-seven CLI 14/14 and module structural observation pass. Native-byte scan identifies nested `.git` directories/files and bare Git roots, exempts only the observed outer worktree's own `.git`, avoids following symlinks and refuses inspection errors. Direct and replay paths share the structural mutation guard. |
| T-R7-3 | implemented:verified-local | Active FR-023A, V3DES-01, CLI contract and plan include independent Git ownership; historical report and round-six ledger remain unchanged. |
| T-R7-4 | implemented:verified-local | Frozen-source full gate: 236/236 module, 377 pass/1 existing TODO/0 fail CLI, 20/20 E2E; PROC-07 scan pass; inherited 180/180 plus semantic 180 rows/184 witnesses; v3 60/60. Isolated pack installed `grove --version` 0.3.0. The exact gate output and package hashes were kept outside the repository. |

macOS rejected a synthetic invalid-UTF-8 filename with `EILSEQ`, so actual disk reproduction uses addressable names. The scan itself uses Buffer directory names and returns `rawPathBase64` for undecodable owners; existing module byte tests cover that projection. No network, credential, or unrelated issue scope is included.
