# Issue #9 round 6 evidence ledger

The round-six amendment is governed by constitution 6.0.0, FR-023/FR-023A and V3DES-01/03. Historical review and prior-release ledger entries retain their original wording. Task checkboxes in `tasks.md` are not completion evidence; the witnesses below are.

| Task | Status | Green witness |
|---|---|---|
| T-R6-1 | implemented:verified-local | `tests/cli/destructive-round6.test.ts` and `tests/module/git-bytes.test.ts` fail on archived `c3b2bbc` for the ignored-loss, replay, receipt and byte-inventory assertions; the red run logs were kept outside the repository. |
| T-R6-2 | implemented:verified-local | Focused 22/22 CLI plus the raw/text byte test; final full suite 235/235 module and 363 CLI pass with the existing issue #18 TODO. |
| T-R6-3 | implemented:verified-local | V3DES-03 old-flag and combined-flag CLI witnesses, registry audit, `README.md`, help registry, and the full traceability results: 180/180 inherited, 60/60 v3. |
| T-R6-4 | implemented:verified-local | Full local gate and isolated installed `grove --version` 0.3.0; the exact gate and install run logs were kept outside the repository. |

The detailed author report and the exact command/exit evidence were kept outside the repository.
