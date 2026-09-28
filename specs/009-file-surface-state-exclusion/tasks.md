# Tasks: Exclude Grove state from the file surface

> **Checkboxes in this file are NOT evidence of completion (P2.5 / ledger G-15, decision R3).** Evidence is a green executable witness: `V3SEC-04` in the traceability gate plus the full verify command. Acceptance does not read these boxes and neither should `/speckit-analyze`.

**Input**: Design documents from `specs/009-file-surface-state-exclusion/`

**Tests**: Required by FR-008 and the constitution; the `V3SEC-04` witness fails before the code change.

## Phase 1: Contract and failing witnesses

- [x] T001 Append the §8.7 file-surface amendment from `specs/009-file-surface-state-exclusion/contracts/file-surface-state-exclusion.md` to the "Behavioral guarantees" list in `specs/003-git-native-grove/contracts/cli-surface-v3.md`
- [x] T002 Add the `V3SEC-04` row from the same contract index after `V3SEC-03` in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md`
- [x] T003 [US1] Add a failing `V3SEC-04` refusal witness in `tests/cli/review.test.ts`: produce a pending `repo-add` with the test-only Git gate (`createGitGate`, as in `V3OPS-04` in `tests/cli/operations-v3.test.ts`); assert the record under `.grove/operations/` retains the remote; then for `file read` on `.grove/operations/<id>.json`, `./.grove/…`, `groves/../.grove/…`, `.GROVE/…` (only when the volume is case-insensitive, detected by probing the fixture root; skipped otherwise), a workspace symlink into `.grove`, and a missing `.grove/nope.json`, and `file ls` on `.grove`, assert exit `2`, error kind `invalid-input`, and the remote absent from stdout and stderr in `--json` and human mode
- [x] T004 [US2] Add a failing `V3SEC-04` listing witness in `tests/cli/review.test.ts`: `file ls` at workspace scope omits `.grove` and still lists `groves`, `repos`, and `trunks`
- [x] T005 [US3] Add a `V3SEC-04` scope witness in `tests/cli/review.test.ts`: `notes/.grove/x.txt` at workspace scope is readable (identity, not name), a directory named `.grove` inside a Tree is readable with `--grove/--tree`, and a Tree-scoped read of `README.md` succeeds

## Phase 2: User Story 1 — Refuse every route into `.grove` (Priority: P1)

**Independent Test**: T003 green.

- [x] T006 [US1] In `src/commands/files.ts`, return the workspace root from `scopeRoot` and add a helper that stats `<workspace>/.grove` and walks each existing ancestor of the resolved path up to the scope root, refusing `invalid-input` (why: inside Grove's internal state directory, which is not part of the file surface; remedy: read workspace content, use `grove doctor` for Grove state; detail: `{ path }`) on a device/inode match
- [x] T007 [US1] Call the helper in `readHandler` and `lsHandler` immediately after `resolveContained`, before any `stat`, `readdir`, or read, in `src/commands/files.ts`

**Checkpoint**: Every route refuses; nothing inside `.grove` is opened or disclosed.

## Phase 3: User Story 2 — Listing omits `.grove` (Priority: P1)

**Independent Test**: T004 green.

- [x] T008 [US2] In `lsHandler` in `src/commands/files.ts`, drop entries whose `lstat` device/inode equals the workspace `.grove` directory's

## Phase 4: User Story 3 — Other scopes unchanged (Priority: P2)

**Independent Test**: T005 green; FILE-01, FILE-02, FILE-05 unchanged.

- [x] T009 [US3] Run `node --test tests/cli/review.test.ts` and confirm the FILE-01/02/05 witnesses pass without edits

## Phase 5: Closure

- [x] T010 Revert the handler change temporarily and confirm T003 and T004 fail, then restore it (`src/commands/files.ts`)
- [x] T011 Run `specs/009-file-surface-state-exclusion/quickstart.md` against `dist/grove.mjs`
- [x] T012 Run `npm run typecheck && npm test && npm run scan && npm run traceability`, then `npm pack`, install the tarball under an isolated `--prefix`, and run the installed `grove --version` (constitution: bundled build and clean isolated install)
- [x] T013 Record the commit and the `V3SEC-04` witness (`specs/009-file-surface-state-exclusion/spec.md` Status → Implemented)

## Phase 6: Amendment — credentialed remotes and repository stores (2026-09-23, independent review)

**Independent Test**: `V3SEC-05` and `V3SEC-06` green; `V3SEC-04`, FILE-01/02/05 unchanged.

- [x] T014 [US4] Add failing `V3SEC-05` witnesses in `tests/cli/repository-acquisition.test.ts`: every credentialed form (`https://user:TOKEN@`, `https://TOKEN@`, upper-case scheme, `https::` helper form, `ftp://`, `git://`, `ssh://git:TOKEN@`) exits `2` `invalid-input` in human and `--json` mode with no credential in either stream, zero git invocations (test-only argv recorder), no `repos/ledger`, no operation record, byte-identical config; SSH and credential-free HTTPS remotes are not refused by the rule. Re-point the older failed-remote redaction test at a query/fragment URL, since userinfo no longer reaches the preflight
- [x] T015 [US4] Add the predicate matrix in `tests/module/validate.test.ts` (refused and accepted forms; the failure never contains the userinfo)
- [x] T016 [US5] Add failing `V3SEC-06` witnesses in `tests/cli/review.test.ts`: a token set by hand in `repos/alpha`'s `origin`; every route (direct, `./`, `..`, symlink, case variant when the volume is case-insensitive, the store itself, a missing path inside it, `file ls` of the store and of `refs`) refuses `2` naming the Git directory with no token in any output; `file ls repos` omits the store while trunk and Tree reads succeed; the same for a `vault/{repo}/.bare` template, an in-workspace linked repository (whose `repo link` is accepted without echoing its token), and an unfinished `repo add` anchor
- [x] T017 [US4] Add `checkRemoteCredentials`/`assertCredentialFreeRemote` to `src/model/validate.ts` and call it in `addHandler` in `src/commands/repo.ts` before name derivation and every Git call
- [x] T018 [US5] In `src/commands/files.ts`, collect repository store identities from the observed workspace and from `repo-add` operation records, refuse on an ancestor match in both handlers right after the `.grove` guard, and omit stores from listings
- [x] T019 Amend `cli-surface-v3.md` (`repo add`, `repo link`, file-surface guarantees) and add `V3SEC-05`/`V3SEC-06` to `acceptance-scenarios-v3.md`; add the README line (FR-015)
- [x] T020 Run the full verify command, `npm pack`, the isolated install, and the installed `grove --version`

## Phase 7: Round-2 review follow-ups (2026-09-23)

- [x] T021 [US4] Refuse userinfo after any number of slashes (`http:///TOKEN:pw@host`) and cross-check with WHATWG `URL` in `src/model/validate.ts`; three-slash forms added to the module and `V3SEC-05` witnesses, observed failing first (FR-009)
- [x] T022 [US5] Protect a recorded `repo add` anchor only while it is still a Git directory, and fail closed on a record that no longer loads, in `src/commands/files.ts`; witnesses for the replaced-anchor repro and a corrupt record observed failing first (FR-012)
- [x] T023 [US5] Witness the Tree-observed unregistered store in `tests/cli/review.test.ts` (non-vacuous by mutation) (FR-012)
- [x] T024 Pin `unsupported-step` → exit 4 at the command level in `tests/cli/operations-v3.test.ts`
- [x] T025 Correct the Git-anonymization claim in `cli-surface-v3.md` and this spec's edge cases
- [x] T026 [US4] Extend the FR-010 remedy to host-provided clone URLs that carry a user name

## Phase 8: Round-3 review follow-ups (2026-09-23)

- [x] T027 [US4] Make Git's authority rule (two or more slashes, authority to the first `/ ? #`) the primary parse and WHATWG an extra refuser only, in `src/model/validate.ts`; backslash forms refused and scp-like `host:/…@…` forms accepted in the module and `V3SEC-05` witnesses, observed failing first (FR-009, FR-011)
- [x] T028 [US4] Mask `redactRemote` output whole when Git's authority holds `@` or the value holds a backslash, in `src/model/result.ts`; module witness observed failing first (FR-010)
- [x] T029 [US5] Recognise a recorded store whose `HEAD` is a symlink, dangling or not (`lstat`), in `src/commands/files.ts`; the dangling-HEAD repro witness observed failing first (FR-012)
- [x] T030 Correct R7 (curl slash counts, the Git-not-WHATWG principle) and FR-012's fail-closed wording

## Phase 9: Round-4 review follow-ups (2026-09-23)

- [x] T031 [US4] Read `url.<base>.insteadOf` rules without the URL in argv (`Git.urlRewriteRules`), apply Git's longest-prefix rewrite (`rewriteRemoteUrl`), and check the typed and rewritten URLs in `repo add`; `V3SEC-05` witness with an insteadOf fixture config for the `web:` and `ssh://` variants, observed failing first (FR-009)
- [x] T032 [US4] Echo a plain SSH remote verbatim in `redactRemote`, and mask opaque and helper forms carrying `@`; module and CLI (`detail.remote`) witnesses observed failing first (FR-010, FR-011)
- [x] T033 [US4] Strip `<transport>::` prefixes repeatedly and treat `@` before the first `/` of a helper address without `://` as userinfo; module witnesses observed failing first (FR-009)
- [x] T034 Align the edge-case definition with R7, state transport stripping and insteadOf in `json-results-v1.md` and `cli-surface-v3.md`

## Phase 10: Round-5 review follow-ups (2026-09-23)

- [x] T035 [US4] Judge a helper address as scheme-guessed whenever it is not URL-shaped, cutting its head at `/ ? #`; `…/a://../..` and `…?u=http://y` forms refused in the module and `V3SEC-05` witnesses, observed failing first (FR-009)
- [x] T036 [US4] Replace the modelled `insteadOf` rewrite with Git's own answer (`Git.resolveRemoteUrl`, `ls-remote --get-url`), checked at the workspace root, in the new store before its first fetch, and before `repo fetch`, `sync`, and the `reconcile` resume of a managed repository; `V3SEC-05` witnesses for `includeIf gitdir:`, later fetches with a linked exemption, and the resume, observed failing first (FR-009)
- [x] T037 [US4] Do not quote Git's stderr when resolution fails; witness with a malformed `GIT_CONFIG_KEY_0`, observed failing first (FR-010)
- [x] T038 [US4] Strip query and fragment from an echoed `ssh://` URL, and treat `%3A` in userinfo as a password; witnesses observed failing first (FR-010, FR-011)
- [x] T039 [US4] Make the rewrite refusal's why and remedy truthful (Grove's policy; change the rewrite rule), leaving the owner's pending decision on config-supplied credentials untouched

## Phase 11: Round-6 review follow-ups (2026-09-23)

- [x] T040 [US4] Redact a linked Tree's URL-valued `branch.<name>.remote` in `sync` results and the recorded post-state unless it is a validated name listed by `git remote`; add a `V3SEC-05` CLI witness and search the remaining commands for the same result/record pattern
- [x] T041 Make `reconcile` classify a missing interrupted `repo add` store as conflicted `stale-plan`, classify other destination-resolution failures as recoverable `git-failed`, continue through later records, and still run the audit; witness two pending records plus successful abandon of the first
- [x] T042 [US4] Parse SSH login fields through the first path slash, refuse `:`, `%3A`, `?`, or `#` in that login, and require the URL and SSH-transport readings to agree before `redactRemote` echoes an SSH URL; add module and CLI `V3SEC-05` witnesses
- [x] T043 [US4] Withhold Git stderr from repository-inspection diagnostics; witness `repo fetch` and `ls` with a malformed config key carrying a token
- [x] T044 Align `acceptance-scenarios-v3.md`, `cli-surface-v3.md`, `json-results-v1.md`, this spec, and R7 with the round-6 output, refusal, abandon, and SSH parsing behavior
- [x] T045 State the FR-009 boundary: Grove re-checks Git's own network calls, not third-party checkout filters such as Git LFS smudge
- [x] T046 Run every new witness red against `78c2375`, then run the full verification, package/install, and installed-version proofs on the round-6 head

## Phase 12: Round-7 review follow-ups (2026-09-23)

- [x] T047 [US4] Parse SSH URL and scp-like logins after percent decoding with Git's bracket-aware host boundary; refuse decoded `:`, `?`, or `#` login delimiters, with every round-7 form in module and CLI `V3SEC-05` witnesses
- [x] T048 [US4] Make remote redaction use the same decoded, bracket-aware SSH reading and mask ambiguous `@` forms; witness the round-7 forms and a linked `%40` branch remote in streams and `.grove`
- [x] T049 [US4] Echo a listed branch remote name only when remote redaction leaves it unchanged; witness a deliberately configured URL-shaped remote name
- [x] T050 Catch native Git failures per selected reconcile operation, record recoverable `git-failed`, continue later records and the audit, and witness an unreachable transport with two pending records
- [x] T051 Give reconcile failure targets `detail.why` and `detail.remedy`; witness resolution failure from a corrupt store config and an operation-specific abandon remedy for a missing store
- [x] T052 Correct the SSH parsing and redaction descriptions in feature 009, `cli-surface-v3`, `json-results-v1`, and research; copy the FR-009 Git-vs-third-party-filter boundary into `cli-surface-v3`
- [x] T053 Run every new witness red against `0b1f376`, then run the full verification, package/install, and installed-version proofs on the round-7 head

## Phase 13: Round-8 review follow-ups (2026-09-23)

- [x] T054 [US4] Match Git's SSH `host_end` precedence (`@[` before a leading `[`) and parse scp-like input without percent decoding; add every round-8 refused form and the accepted IPv6, port, ordinary scp, and percent-in-path forms to the module matrix
- [x] T055 [US4] Narrow plain scp-like result echo to exactly one `@`, with brackets permitted only around an IPv6 literal host, and mask every bracketed-login form before the plain-SSH exemption
- [x] T056 [US4] Add `V3SEC-05` CLI witnesses for bracket-precedence `repo add` refusal and a linked `sync` branch remote absent from both streams and every `.grove` file
- [x] T057 Keep reconcile's per-operation native-Git catch under its target lock, persist and return a fixed stderr-free why, and accurately report steps completed earlier in the same resume run
- [x] T058 Correct the SSH parsing and redaction descriptions in feature 009, its research, `cli-surface-v3`, `json-results-v1`, and `V3SEC-05` to state scheme-only decoding and Git's bracket precedence
- [x] T059 Record the round-8 reconcile detail and completed-step guarantees in `cli-surface-v3` and `json-results-v1`
- [x] T060 Run every new witness red against `1f3aebf`, then run the full verification, package/install, and installed-version proofs on the round-8 head

## Phase 14: Git-config credential opt-in and argv-error redaction (2026-09-23)

- [x] T061 [US4] Amend 003 and 009 contract/spec/research for exact per-invocation Git-config opt-in, unconditional typed-URL refusal, recovery recheck, and no resolved credential persistence (FR-009, FR-010)
- [x] T062 [US4] Add red built-CLI V3SEC-05 witnesses for missing/non-`1`/`1` env, typed URLs, later fetch/sync, retained-remote recovery, and stream/record secrecy; add V3SEC-07 argv/link-error witnesses in both modes (FR-009, FR-017)
- [x] T063 [US4] Implement exact `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` check at managed Git-resolution point of use; preserve direct-input and linked policy; sanitize any now-reachable transport failure path (FR-009, FR-010)
- [x] T064 [US4] Redact credentialed argv values in all failed error fields and suppress `repo link` normalized path/Git stderr disclosure; preserve ordinary SSH output (FR-017)
- [x] T065 [US4] Document the switch in help and README; complete V3SEC-05/V3SEC-07 traceability, round-8 Git parser differential proof, full verify, pack, and isolated installed-version proof (FR-015, FR-017)

## Phase 15: Recheck between managed network calls (2026-09-24)

- [x] T066 [US4] Add built-CLI `V3SEC-05` fake-sentinel races where the first `repo add` advertisement changes `insteadOf` before the in-lock inspection and resumed acquisition's inspection changes it before store fetch; observe both red on `ef2df8f` (FR-009)
- [x] T067 [US4] Re-resolve in the matching Git context immediately before those later network calls, preserving lock/stale-plan and completed-step evidence; audit `repo fetch` and `sync` single-fetch paths and linked exemption (FR-009, FR-010)
- [x] T068 [US4] Amend the 003/009 contracts and research for the race and legacy direct records, run full verification, package and isolated installed-version proof, and prepare the exact clean author head for independent review (FR-009, FR-015)
- [x] T069 [US4] Reproduce a legacy directly credentialed retained original at pending `remote-add` and `fetch`, with absent and `1` opt-in respectively; record both built-CLI behavioral reds on `ef2df8f` (FR-009)
- [x] T070 [US4] Refuse a legacy direct original before every unfinished `repo-add` step can write or spend it, preserve the conflicted record with safe evidence, and run both focused witnesses green (FR-009, FR-010)

## Requirement coverage

| Requirement | Tasks |
|---|---|
| FR-001 | T003, T006–T007 |
| FR-002 | T003, T007 |
| FR-003 | T003, T006 |
| FR-004 | T004, T008 |
| FR-005 | T005, T009 |
| FR-006 | T007 (no other file touched), T012 |
| FR-007 | T001–T002 |
| FR-008 | T003–T005, T010 |
| FR-009 | T014, T015, T017, T021, T027, T031, T033, T035, T036, T042, T045, T047, T050–T052, T054, T056, T058, T061–T063, T066–T069, T070 |
| FR-010 | T014, T017, T026, T028, T032, T037, T038, T039, T040, T042–T044, T048–T049, T051–T052, T055–T059, T061, T063, T067, T070 |
| FR-011 | T014, T015, T027, T032, T038, T042, T047–T048, T054–T055, T058 |
| FR-012 | T016, T018, T022, T023, T029 |
| FR-013 | T016, T018 |
| FR-014 | T016, T018, T020 |
| FR-015 | T019, T065, T068 |
| FR-016 | T014–T016 |
| FR-017 | T062, T064–T065 |

## Dependencies and strategy

T001–T002 land the contract; T003–T005 are red witnesses in one file, written together and observed failing. T006 → T007 → T008 all edit `src/commands/files.ts` in order. T001–T008 land as **one commit**, so the constitution's rule that every phase leaves the repository buildable with its relevant tests passing holds at every commit; the red state is observed locally, never committed. The feature ships atomically; there is no useful partial slice.

## Format validation

All 70 tasks use the required checkbox, sequential ID, story label where applicable, and concrete path.
