# Contract traceability: Diagnose orphaned steal markers

This is a non-normative index. The owning contracts govern if it disagrees.

| Topic | Authority |
|---|---|
| Lock acquisition, timeout, and stale reclaim | §6 |
| Read-only doctor surface | §8.4; `specs/003-git-native-grove/contracts/cli-surface-v3.md` |
| Diagnostic identity and parity | `specs/003-git-native-grove/contracts/json-results-v1.md` |
| New witness | `V3DIAG-04` in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md` |

## Amendment text (to land in `cli-surface-v3.md`)

> `doctor` reports an aged lock-reclamation `<lock>.steal` marker as an `orphaned-steal-marker` info diagnostic. Its subject identifies the marker; its facts identify the associated lock, its `absent`, `reclaimable`, or `held` state, stable age classification, and `automatic` recovery. Lock state enters identity and selects either a held-state wait/resolve remedy or an immediate retry remedy; the next successful acquisition removes the marker. Direct creation performs post-acquisition cleanup, while reclaim handles a pre-existing aged marker during intent contention and its own fresh marker in `finally`. Marker mtime and observed age do not enter diagnostic identity. A marker at or within the stale window is not reported as orphaned. Beside an automatically reclaimable same-host lock it becomes the remedy-changing `stealMarker: "fresh"` fact on `stale-lock`; the remedy names an in-progress or interrupted reclaim and retry after the 30-second stale window. The audit never removes either file.

## Scenario row (to land after `V3DIAG-03`)

| ID | Required observation | Executable witness |
|---|---|---|
| V3DIAG-04 | `doctor` reports an aged orphaned `.steal` marker without mutation; associated-lock state changes its identity and held-state remedy; direct acquisition preserves markers at the stale boundary and removes strictly aged ones; and a fresh marker changes a reclaimable stale-lock identity and remedy without becoming an orphan diagnostic. | Doctor CLI integration |
