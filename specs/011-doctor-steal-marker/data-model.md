# Data model: Diagnose orphaned steal markers

No persisted entity or schema changes. The marker remains the same internal token file and lock records remain unchanged.

## In-memory lock audit finding

```text
LockAuditFinding
├── stale-lock
│   ├── file: lock filename
│   ├── holder: HolderRecord | null
│   ├── reason: stable classification text
│   ├── recovery: automatic | manual
│   └── stealMarker?: fresh
└── orphaned-steal-marker
    ├── file: marker filename ending in .steal
    ├── lock: associated lock filename
    ├── lockState: absent | reclaimable | held
    ├── reason: stable classification text
    └── recovery: automatic
```

Validation rules:

- A marker finding exists only when `now - marker.mtime > staleMs`.
- `lock` is `file` with the terminal `.steal` suffix removed.
- Fresh markers produce no orphan finding; `.tmp` entries produce no finding.
- A fresh marker beside an automatically reclaimable stale lock is not an orphan finding; it is carried as `stealMarker: fresh` on that stale-lock finding.
- An orphan's `lockState` is `absent` when the lock does not exist, `reclaimable` when acquisition can automatically replace it, and `held` when acquisition must first wait for or resolve it.
- A vanished entry produces no finding.

Acquisition cleanup is path-specific: direct creation checks and removes a strictly aged marker after obtaining the lock; reclaim removes a pre-existing aged marker while contending for the intent file and removes its own fresh marker in `finally`. There is no useful post-reclaim cleanup.

## Diagnostic projection

```text
code:     orphaned-steal-marker
severity: info
subject:  { kind: lock-steal-marker, path: finding.file }
facts:    { lock: finding.lock, lockState: finding.lockState, reason: finding.reason, recovery: automatic }
summary:  marker will be reclaimed automatically by the next successful acquisition
remedy:   if held, wait for or resolve the holder before retry; otherwise retry the mutation
```

The marker mtime and computed age are observation facts only and do not enter diagnostic identity. Associated-lock state does enter orphan identity because it changes whether the remedy can advise an immediate retry. The categorical `stealMarker: fresh` fact does enter stale-lock identity because it changes the remedy to explain the in-progress/interrupted reclaim and the 30-second stale window.
