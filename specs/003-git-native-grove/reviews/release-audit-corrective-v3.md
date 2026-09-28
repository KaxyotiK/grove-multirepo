# Grove v3 corrective release audit

**Status:** FINAL PASS — T095/T096 complete **Baseline:** `e6aabeb0b7fddfedffb1c8bb514b0e21dc13f099` **Implementation milestone:** `c5f4d2714027e36779a6dd5caa829445da4e97a3` **Run date:** 2026-08-24, America/New_York **Venue:** local macOS

## Terminal gates

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| module tests | 172 passed, 0 failed |
| CLI tests | 260 passed, 0 failed |
| E2E tests | 20 passed, 0 failed |
| complete `npm test` | 452 passed, 0 failed |
| `npm run scan` | PASS, including PROC-07 and all removed-runtime exclusions |
| inherited scenario traceability | 180/180 scenarios, 14 families, 184 witnesses, 0 deferred, 0 findings |
| v3 scenario traceability | 41/41 scenarios, 17 families, 0 deferred, 0 findings |
| `npm run build` | PASS; `dist/grove.mjs` built |
| isolated temporary-prefix npm installation | PASS; installed CLI reports `0.3.0` |
| installed `repo add` scenario | PASS; managed anchor is bare and initial peer is exactly `trunks/main@managed` on `main` |
| installed `repo link` scenario | PASS; registration is ref/worktree-neutral, all three trunk mutations refuse, and ordinary Tree creation uses remote-only `develop` without creating a local `develop` branch |
| installed managed-layout collision control | PASS; `repo link` records `kind:linked` and refuses trunk mutation even when an external bare common directory occupies `repos/<alias>` |
| adversarial convergence | PASS; existing five-round ledger closed without reset at zero unresolved in-scope P0/P1/P2 |

The installed scenarios packed the current project and installed it with `npm install --global --prefix <temporary-prefix> --ignore-scripts --no-audit --no-fund`. The prefix and workspace were isolated under `/tmp`; no developer/global installation was changed.

## Corrective witness evidence

- Forced `tree remove` and `trunk remove` now return every discarded filename in JSON while retaining the existing human output and removal policy. The new witnesses failed against the preceding implementation and pass at the implementation milestone.
- Same-host dead and frozen stale locks are diagnosed as automatically reclaimable by the next mutation. Cross-host stale locks remain manual-action policy findings. Lock acquisition and reclaim behavior were not changed.
- The current traceability validator reports zero stale/orphan assertion markers, incorrect live citations, missing live proof obligations, or deferred scenarios without changing its schema, counting rules, architecture, or claim model.
- Fresh Spec Kit analysis records 87/87 live requirements and 86/86 active tasks mapped, with zero constitution conflicts and zero unresolved HIGH/CRITICAL findings.

## Acquisition and trunk evidence

- `repo add` creates a bare common repository and a real peer worktree at the readable default `trunks/main@<repo>` path. Additional long-running branches use the same observed lifecycle.
- `repo link` accepts external Git topology without creating a trunk ref or checkout. Its preferred trunk is advisory, ordinary Grove Tree creation remains supported, and every linked trunk mutation refuses before mutation.
- Git observation owns refs, HEAD, upstreams, branches, and worktrees; schema-3 metadata contains no live trunk/Tree arrays, claims, or provenance.

## Scope and limitations

The terminal implementation and bounded review are green. Verification is intentionally limited to local macOS. No CI, additional-platform, Windows-support, command, storage-domain, migration, or evidence-architecture scope was added. The durable review retains one historical round-3 advisory whose proposed remedy would change the documented `file read` surface; it remains an explicitly out-of-scope follow-up rather than being silently acted on or counted as an unresolved in-scope release finding. No push, merge, publish, or non-isolated installation was performed.
