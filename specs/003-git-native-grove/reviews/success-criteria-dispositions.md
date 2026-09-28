# Success-criteria dispositions — `003-git-native-grove`

P2.3 / ledger G-8. Every criterion in `spec.md` must be **cited by a test title** or appear here with a stated reason. `tests/module/success-criteria.test.ts` enforces both directions: a criterion with neither fails the gate, and a row here for a criterion that _is_ now cited fails as stale, so this file cannot rot into a permanent waiver list.

Ten of the sixteen criteria were attached to the witness that already proved them rather than dispositioned — a disposition for work that is in fact tested would be a lie by omission. What remains are four criteria whose subject no longer exists and two that measure a review process rather than a program behaviour.

| Criterion | Reason there is no executable witness |
|---|---|
| 003-git-native-grove-SC-009 | **Void.** Measures migration dry-run fidelity. Ruling ⑤ deleted the migration subsystem, so the subject does not exist. Retained, not renumbered — IDs are stable citation keys. A schema-1/2 workspace is now refused by `V3VER-01`. |
| 003-git-native-grove-SC-010 | **Void.** Measures migration interruption/abort/resume states. Same reason as 003-git-native-grove-SC-009. |
| 003-git-native-grove-SC-011 | **Void.** Measures pre-publication verification of migrated worktrees. Same reason as 003-git-native-grove-SC-009. |
| 003-git-native-grove-SC-012 | **Void.** Measures post-migration retention of old stores and preservation refs. Same reason as 003-git-native-grove-SC-009. |
| 003-git-native-grove-SC-014 | **Not a program behaviour.** Measures `/speckit-analyze` reporting zero unmapped requirements, tasks, and constitution conflicts before implementation. Its evidence is an analyze report, not a test run; it is release gate #2 and is checked there. A test asserting it would have to re-implement the analyzer. |
| 003-git-native-grove-SC-015 | **Not a program behaviour, and CURRENTLY NOT MET — stated plainly rather than dispositioned away.** The criterion is *"0 unresolved P0/P1/P2 findings **and** every proposal acceptance criterion has an executable verification"*. An earlier version of this row dropped the second conjunct and re-read the first as "zero rows spelled `open`" — an artifact state, not the outcome. Nine rows are `deferred`, and their sources include one P1 (G-11) and several P2s (A-4…A-8), so findings are unresolved, not absent. Adversarial round 1 additionally reopened E-9, U-9 and G-6; E-9 and U-9 are now closed and G-6 is explicitly deferred. This criterion is met when those are closed and the deferrals are either resolved or accepted by name. |
