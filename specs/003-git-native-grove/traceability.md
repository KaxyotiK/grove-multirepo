# Traceability ledger: Git-native Grove v2-base redesign

Every task in [tasks.md](tasks.md) cites one or more stable rows below. Requirement ranges use the identifiers defined in [spec.md](spec.md); executable witnesses are added before the row closes.

| Ledger row | Requirements/outcomes | Owning tasks | Executable witness |
|---|---|---|---|
| TRACE-BASE | FR-047, FR-051A | T001 | baseline review; full v2 command run |
| TRACE-ACQ | FR-007, FR-011A-E, FR-018A-C | T002 | baseline inventory and repository tests |
| TRACE-DEC1 | FR-011A-E, FR-018A-C, 003-git-native-grove-SC-016 | T003, T030-T038 | acquisition matrix |
| TRACE-DEC2 | FR-046 | T004, T008, T014-T015 | self-identifying foreign-schema refusal and legacy-runtime exclusion |
| TRACE-GOV | FR-049A-C, FR-050 | T005, T065 | constitution/spec/docs audit |
| TRACE-PARITY | FR-051A-B, 003-git-native-grove-SC-016 | T006, T030-T038, T068 | before/after acquisition audit |
| TRACE-ANALYZE | FR-051A-B, 003-git-native-grove-SC-014 | T007, T069 | Spec Kit analysis reports |
| TRACE-FND-SCHEMA | FR-007, FR-009-FR-017, FR-046 | T008, T014-T015, T021 | workspace/Grove v3 module tests and foreign-schema refusal |
| TRACE-FND-LAYOUT | FR-006A-C, FR-009-FR-014C | T009, T016 | layout-v3/path module tests |
| TRACE-FND-GIT | FR-001-FR-006C, FR-011B, FR-026A | T010, T017 | raw Git bytes/capability tests |
| TRACE-FND-OBS | FR-003-FR-006C, FR-011A-E, FR-015-FR-017 | T011, T018 | observed-workspace tests |
| TRACE-FND-DIAG | FR-027-FR-029, 003-git-native-grove-SC-005 | T012, T019 | diagnostic identity tests |
| TRACE-FND-RESULT | FR-032A-FR-033B | T013, T020 | output/result tests |
| TRACE-US1-READ | FR-002-FR-008, FR-015-FR-017, 003-git-native-grove-SC-001-SC-002 | T023, T025-T026, T028 | raw-Git CLI/E2E |
| TRACE-US3-DOCTOR | FR-027-FR-029, FR-032A-FR-033B | T024, T027 | repository-diagnostic and audit-fixes CLI fixtures |
| TRACE-US2-ACQ | FR-011A-E, FR-018A-C, 003-git-native-grove-SC-016 | T030, T035, T038 | repository-acquisition CLI/E2E |
| TRACE-US2-TRUNK | FR-011D-E, FR-018A-B, FR-021, FR-035 | T031, T036, T038 | trunk-repo and trunk-scenarios snapshot tests |
| TRACE-US2-OPS | FR-019-FR-026A, FR-035 | T032-T033, T038 | operation crash E2E |
| TRACE-US2-CREATE | FR-018-FR-026A | T034, T037-T038 | creation matrix |
| TRACE-US4-SYNC | FR-030-FR-033B | T039, T041-T043 | sync-v3 CLI/E2E |
| TRACE-US4-RESULT | FR-011E, FR-032A-FR-033B | T040, T042-T043 | mixed-result fixtures |
| TRACE-US5-LIFE | FR-021-FR-026, FR-034A-FR-038, 003-git-native-grove-SC-003, 003-git-native-grove-SC-008 | T044, T048-T050, T054 | lifecycle-v3 ref snapshots |
| TRACE-US5-META | FR-012B, FR-015-FR-017 | T045, T047, T049 | metadata catalog tests |
| TRACE-US3-FIX | FR-021, FR-026-FR-029 | T046, T052, T054 | audit-fixes and lifecycle-v3 tests |
| TRACE-US5-REPO | FR-037-FR-038, FR-047 | T051 | unregister/command tests |
| TRACE-US5-REMOVE | FR-007-FR-008, FR-035, FR-038 | T053, T063 | source scan and ref tests |
| TRACE-US6-REFUSAL | FR-046 | T008, T015, T063, T087, T095 | version-skew tests and exclusion scan |
| RETIRED-US6-MIGRATE | VOID FR-039A-FR-045, VOID 003-git-native-grove-SC-009-SC-012 | retired T055-T062 | historical only; no task or witness required and no runtime may implement it |
| TRACE-PHASE-GATE | FR-001-FR-038, FR-046, FR-051B | T022, T029, T038, T043, T054, T095 | focused phase suites plus declared typecheck/build/scan/traceability gates |
| TRACE-CUTOVER | FR-007-FR-008, FR-046 | T063 | legacy scan |
| TRACE-COMMANDS | FR-047-FR-049B, 003-git-native-grove-SC-013 | T064 | dispatch/help/completion audit |
| TRACE-DOCS | FR-049A-C | T065 | documentation diff/review |
| TRACE-ARTIFACT | FR-011A-E, FR-018A-C, FR-049C, 003-git-native-grove-SC-016 | T066 | installed artifact E2E |
| TRACE-SCENARIOS | FR-051A-B | T067 | traceability validator |
| TRACE-FINAL-REVIEW | FR-051A-B, 003-git-native-grove-SC-014-SC-015 | T069 | consistency/adversarial reports |
| TRACE-FINAL-GATE | FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-016 | T022, T029, T038, T043, T054, T070-T071, T095 | full gates and release audit |
| TRACE-CORR-GOV | FR-010-FR-012D, FR-051A-B, 003-git-native-grove-SC-015-SC-016 | T072 | Decision 003 and aligned corrective artifacts |
| TRACE-CORR-ACQ | FR-010-FR-012D, FR-018A-C, FR-020, FR-032A, 003-git-native-grove-SC-016 | T073, T078-T079 | exact readable-trunk/collision/symlink/link-base/order module, CLI, and installed witnesses |
| TRACE-CORR-LIFE | FR-021-FR-026, FR-033A, FR-034A-FR-036, 003-git-native-grove-SC-006, 003-git-native-grove-SC-008 | T074, T081 | stale restore, hook dirtiness, pending ownership, detached-race lifecycle witnesses |
| TRACE-CORR-OPS | FR-021-FR-026, FR-033A | T074, T080 | relocated replay, target ownership, clean completion, and stable refusal recovery witnesses |
| RETIRED-CORR-MIGRATE | VOID FR-039A-FR-045, VOID 003-git-native-grove-SC-009-SC-012 | retired T075, T082 | historical only; constitution 5.0.0 forbids this evidence target |
| TRACE-OUT-ARCH | FR-033A-C, FR-046, FR-049B-C, FR-051A-B, 003-git-native-grove-SC-013-SC-017 | T097-T103 | `tests/module/output.test.ts`; `tests/module/output-architecture.test.ts`; `tests/cli/output-parity.test.ts`; output-parity correction audit |
| TRACE-CORR-PARITY | FR-051A-B, 003-git-native-grove-SC-015-SC-016 | T076 | exact inherited-scenario disposition/witness ledger and validator meta-tests |
| TRACE-CORR-ANALYZE | FR-051A-B, 003-git-native-grove-SC-014-SC-015 | T077 | corrective Spec Kit analysis report |
| TRACE-CORR-REVIEW | 003-git-native-grove-SC-015 | T085 | durable corrective adversarial round log |
| TRACE-CORR-GATE | FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-016 | T083-T084, T086 | focused/full/installed gates and corrective release audit |
| TRACE-CONV-DOCS | FR-046, FR-049A-C, 003-git-native-grove-SC-014 | T087-T088 | constitution-aligned spec/plan/contracts/validation guide |
| TRACE-CONV-TRACE | FR-051A-B, 003-git-native-grove-SC-014-SC-016 | T089 | existing ledger/marker repair with zero traceability findings |
| TRACE-CONV-ANALYZE | FR-051A-B, 003-git-native-grove-SC-014 | T090 | fresh convergence analysis report before source implementation |
| TRACE-CONV-DESTRUCTIVE | FR-033A-B, FR-035, 003-git-native-grove-SC-008 | T091-T092 | forced Tree/trunk removal human/JSON filename parity |
| TRACE-CONV-LOCK | FR-027-FR-029 | T093-T094 | same-host reclaimable versus cross-host/manual lock diagnosis |
| TRACE-CONV-GATE | FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-016 | T095 | full local macOS and installed-artifact release evidence |
| TRACE-CONV-REVIEW | 003-git-native-grove-SC-015 | T096 | bounded final review and production-checklist closure |
| TRACE-LIVE-F01 | FR-033A, Contract V3OPS-05 | T104 | whole-record terminal remote-secrecy witness in `tests/cli/operations-v3.test.ts` |
| TRACE-LIVE-F02 | FR-033A-C, Constitution IV | T105 | combined dirty-Tree/loose-Grove human and JSON refusal witness in `tests/cli/destructive-v3.test.ts` |
| TRACE-LIVE-F03 | FR-016, Constitution I-II | T106 | write-then-fresh-read Tree order witnesses in help/config integrity suites |
| TRACE-LIVE-F04 | FR-037, Decision 001 | T107 | managed and linked unregister topology witness in `tests/cli/trunk-repo.test.ts` |
| TRACE-LIVE-F05 | FR-016, Constitution II/V | T108 | workspace/Grove/Tree stale-agent diagnostic witness in `tests/cli/repository-diagnostic.test.ts` |
| TRACE-LIVE-GATE | FR-049A-C, FR-051A-B, 003-git-native-grove-SC-013-SC-017 | T109 | full gates, active local artifact, and five-finding live correction audit |
| TRACE-HELP-PRESENT | FR-033B-D, FR-049B-C, FR-051A-B, 003-git-native-grove-SC-013-SC-018 | T110-T115 | `tests/module/help.test.ts`; `tests/module/output-architecture.test.ts`; `tests/cli/help-formatting.test.ts`; focused/full gates; help-formatting correction audit |
| TRACE-OUT-FLUSH | FR-033A, Contract V3OUT-04, Constitution III | T-FLUSH-1-T-FLUSH-3 | `tests/cli/output-flush-v3.test.ts`; `reviews/json-output-flush-ledger.md` |
| TRACE-LOOSE-CONSENT | FR-023, FR-023A, Contract V3DES-09, V3DES-10, Constitution IV | T-LOOSE-1-T-LOOSE-3 | `tests/cli/loose-consent-inventory.test.ts`; `tests/module/loose-inventory.test.ts`; `reviews/loose-consent-inventory-ledger.md` |
| TRACE-PARTIAL-RECEIPT | FR-023A, FR-024, Contract V3DES-11, V3DES-12, V3DES-13, V3OPS-08, Constitution IV, V | T-PARTIAL-1-T-PARTIAL-5 | `tests/cli/partial-receipt-v3.test.ts`; `reviews/partial-receipt-ledger.md` |
| TRACE-RELATIVE-REPO-PATH | FR-011A-E, FR-018A-C, Contract V3ACQ-02, V3SEC-05, V3SEC-07 | issue #22 | `tests/cli/relative-repo-path-v3.test.ts`; `reviews/relative-repo-path-ledger.md` |
| TRACE-OP-RECORD-SHAPE | Contract V3FSF-01 | issue #23 | `tests/cli/regressions.test.ts`; malformed operation steps are reported by file readers and excluded from recovery resume |

## Command disposition inventory

The proposal section 8 table is exhaustive. These rows bind implementation ownership without copying its behavior text.

| Disposition | Commands | Owning phase |
|---|---|---|
| Foundation/schema | `init`, `config get`, `config set`, `status` | 2–3 |
| Observed reads/lookups | `repo ls/status`, `ls`, `show`, `tree ls`, `trunk ls`, `agent run`, review and file commands | 3 |
| Corrected acquisition/creation | `repo add/link`, `new`, `tree add`, `trunk add`, `reconcile` recovery | 4 |
| Explicit sync | `repo fetch`, `sync`, `trunk sync` delegate | 5 |
| Ref-safe lifecycle | Tree/trunk remove/configure/reorder, Grove lifecycle, `repo remove`, `fix` | 6 |
| Foreign-schema refusal | every command refuses during schema loading; there is no `migrate` command | 7 |
| Unchanged metadata/process | `agent add/ls/remove`, foreground agent execution contract, `completion` mechanism | 2–8 regression gates |
| Removed | `repo delete-branch`; native Git is the replacement | 6 and 8 |
