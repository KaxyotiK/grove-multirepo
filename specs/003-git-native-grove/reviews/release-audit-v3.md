# Grove v3 release audit

**Status:** Superseded by the Phase 9 corrective audit. The recorded commands passed, but the ID-only traceability method failed to detect the `TRUNK-01` readable-path regression and therefore cannot support the prior release-readiness conclusion.

**Baseline:** `e6aabeb0b7fddfedffb1c8bb514b0e21dc13f099` **Implementation milestone:** `2677be7` **Final audit milestone:** the commit containing this record **Run date:** 2026-08-22, America/New_York

## Final gates

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| module tests | 138 passed, 0 failed |
| CLI tests | 180 passed, 0 failed |
| end-to-end tests | 19 passed, 0 failed |
| complete `npm test` | 337 passed, 0 failed |
| `npm run scan` | PASS; ownership/compatibility/ref-deletion production exclusions clean |
| v2 scenario traceability | 180/180 across 14 families, 0 deferred |
| v3 scenario traceability | 10/10 across 9 families, 0 deferred |
| `git diff --check` | PASS |

The end-to-end total includes ART-05, which installed the packed artifact under a temporary isolated global prefix and started every documented command. It also includes built-artifact acquisition, raw-Git observation, managed lifecycle, forward recovery, and the V3LINK zero-mutation/linked-trunk refusal journey.

## Required topology evidence

- managed acquisition creates a bare common repository and a real peer initial trunk; main, non-main, remote-only, and unborn trunk cases pass;
- external link accepts checkout, subdirectory, linked worktree, and bare inputs, records canonical common-directory identity, and leaves refs/worktrees unchanged;
- every linked trunk mutation refuses before mutation while managed and linked Tree creation remains available under native occupied-branch arbitration;
- raw Git worktree/ref changes are visible on the next observation without claims, provenance, or live-state arrays;
- direct and recovered lifecycle teardown retain refs and fail closed for an unreachable detached HEAD, including a protecting ref removed after durable preflight;
- schema-1 and schema-2 migration retain managed bare anchors and valid worktrees in place, preserve linked identity, resume every evidence/ref/publication boundary, and reject unrelated drift.

## Comparison and review

The baseline had 420 test nodes; v3 has 337 after deletion/consolidation of ownership and rollback mechanism tests. Behavioral equivalence is accounted by the 180/180 retained scenario ledger, 10 corrected-v3 scenarios, and the domain mapping in `prior-release-regression-comparison-v3.md`. Spec Kit analysis accounts for 108/108 requirements and 71/71 tasks with no unmapped item or constitution conflict. Three adversarial profiles initially found one P0 and fourteen P1 defects; all are resolved with focused witnesses as recorded in `adversarial-review-grove-v3-20260822.md`.

No push, merge, publication, or installation outside test-owned temporary prefixes was performed.
