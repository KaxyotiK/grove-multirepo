# Before/after scenario audit: Git-native Grove

**Purpose:** Preserve verified v2 product behavior where required and make every breaking v3 change explicit before implementation.

**Current production audit:** **CLOSED** through `66bccd4` (2026-08-24). Checked “Before” items are historical facts verified at `e6aabeb`; checked “After” items require current implementation plus a passing direct witness. Unchecked items are the bounded remaining release work. This file is the production-completion checklist; the reviewer-owned files under `checklists/` assess requirements quality and do not prove implementation completion.

## Before: verified at `e6aabeb`

Evidence for this historical section is recorded in `reviews/v2-baseline-20260822.md`; these markers describe the measured baseline and are not claims about current v3 behavior.

- [x] `repo add` creates a bare common repository and initial trunk-layout worktree.
- [x] additional long-running trunk branches create peer worktrees.
- [x] `repo link` creates no initial trunk and leaves its ordinary checkout untouched.
- [x] linked repositories support Grove Tree creation without a duplicate primary checkout.
- [x] v2 safety, crash recovery, packaging, and 180-scenario traceability gates pass.
- [x] v2 persists repository trunk arrays, Tree arrays, branch provenance, and claims.
- [x] v2 permits linked-repository trunk mutation after registration.
- [x] v2 rejects linked-worktree, subdirectory, and bare-repository inputs to `repo link`.
- [x] v2 rollback/lifecycle paths may delete Grove-classified created refs.

## After: release-blocking target

- [x] `repo add` still creates a managed bare common repository and real initial peer trunk at the exact readable default `trunks/main@<repo>` path.
- [x] main and other long-running branches share the same observed trunk lifecycle.
- [x] `repo link` accepts standard checkout, linked worktree, subdirectory, and bare anchor.
- [x] `repo link` creates no ref, branch, trunk, or worktree and stores canonical common identity.
- [x] `trunk add`, `trunk remove`, and `trunk sync` refuse linked repositories before mutation.
- [x] Tree creation works for managed and linked repositories, uses a linked configured remote-only preferred trunk without creating a local trunk, and never forces an occupied branch.
- [x] Git observation, not config/manifests, owns refs, HEAD, upstreams, branches, and worktrees.
- [x] workspace config and central Grove metadata contain no live trunk/Tree arrays, claims, or provenance.
- [x] structural recovery retains partial artifacts and never deletes or resets refs as cleanup.
- [x] doctor/fix/sync and versioned results use stable identities and target-complete outcomes.
- [x] every registered Grove command success/error uses one structured value for human and JSON output; handlers cannot provide a second human projection or bypass the shared emitter.
- [x] schema-1/schema-2 ownership state is refused with the running version, executable path, and both schema versions; normal v3 never interprets or reparents it. Managed bare repositories and attached worktrees remain valid Git topology when registered under schema 3.
- [x] every inherited scenario has an exact preserved/superseded disposition and named executable witness; IDs and test counts are not treated as semantic proof. **Current evidence:** `npm run traceability` passes 180/180 inherited scenarios with 184 witnesses and zero findings; no evidence-architecture redesign was performed.
- [x] migration-only pseudoref, bundle, preservation-ref, and ownership-loader runtime paths are absent, as constitution 5.0.0 requires.
- [x] restore/reconcile/removal refuse stale, dirty, relocated, concurrently detached, or pending-operation-owned targets without reversing later user intent or deleting unrelated paths.
- [x] full typecheck, module, CLI, E2E, scan, exact traceability, bundle-install, and acquisition E2E gates pass on the final implementation. **Current evidence:** typecheck, 177 module tests, 261 CLI tests, 20 E2E tests (458 total), scan, build, both traceability legs, and isolated installed-artifact `repo add`/`repo link`/layout-collision scenarios pass through `66bccd4`.
- [x] corrective architecture/workflow/implementation review closes with no unresolved in-scope P0/P1/P2 bug or proof gap. **Current evidence:** round 4 is truthfully consumed as incomplete; final round 5 and all post-fix re-reviews close clean without exceeding five total rounds.

## Checked-item evidence audit

| Production claim | Current direct evidence | Audit |
|---|---|---|
| Managed `repo add`, readable initial/additional peer trunks | `tests/cli/repository-acquisition.test.ts`; `tests/cli/trunk-scenarios.test.ts`; `tests/cli/trunk-repo.test.ts` | retained |
| External `repo link` input matrix and zero trunk/ref/worktree mutation | `tests/cli/repository-acquisition.test.ts`; `tests/cli/repository-scenarios.test.ts` | retained |
| Linked Tree creation and linked trunk-mutation refusal | `tests/cli/repository-acquisition.test.ts`; `tests/cli/trunk-scenarios.test.ts` | retained |
| Git-owned observation; no live trunk/Tree arrays, claims, or provenance | `tests/module/workspace-v3.test.ts`; `tests/cli/trunk-scenarios.test.ts`; `scripts/legacy-scan.sh` | retained |
| Forward recovery retains refs and refuses stale/rebound/dirty targets | `tests/cli/corrective-lifecycle-v3.test.ts`; `tests/cli/operations-v3.test.ts`; `tests/e2e/operation-recovery-v3.test.ts` | retained |
| Doctor/fix/sync/results expose stable identities and target-complete outcomes | `tests/cli/repository-diagnostic.test.ts`; `tests/cli/sync-v3.test.ts`; `tests/cli/output-parity.test.ts` | retained, except stale-lock item below |
| One-payload human/JSON output across every registered command | `tests/module/output.test.ts`; `tests/module/output-architecture.test.ts`; `tests/cli/output-parity.test.ts` | corrected and structurally enforced |
| Schema refusal/no migration runtime | `tests/cli/version-skew.test.ts`; `tests/module/scan-rules.test.ts` | retained |
| Full release gates and adversarial convergence | `npm run traceability`; `reviews/adversarial-review-remediation-20260824.md` | reopened |

## Remaining bounded production work

- [x] Forced `tree remove` and `trunk remove` include every discarded filename in JSON results as well as human output, with red-before/green-after witnesses. This completes existing ruling ④; it adds no capability.
- [x] `doctor` distinguishes automatically reclaimable same-host stale locks from genuinely manual-action lock states; `doctor --strict` no longer claims a dead same-host lock is permanent when the next mutation reclaims it.
- [x] Live feature artifacts are reconciled with constitution 5.0.0: foreign schemas refuse without migration, and release verification is local macOS with no CI/additional-platform work added.
- [x] The existing traceability failure received an in-scope repair: stale/orphan markers and incorrect citations were corrected and existing witnesses strengthened without assertion-local inversion or another evidence architecture.
- [x] After the above work, the full local macOS release matrix passed against `c5f4d27`, including installed-artifact `repo add`/`repo link` and managed-layout collision scenarios; `reviews/release-audit-corrective-v3.md` records current evidence.
- [x] The durable adversarial review and this checklist close with no unresolved in-scope production bug and every mandatory gate green; no exception was required.
- [x] Human/JSON parity is enforced across the complete registered surface by the callback-free emitter and registry-derived architecture audit; `repo link` exposes repository, operation, remote, trunk, and path facts in both modes. See `reviews/output-parity-correction-20260824.md`.
