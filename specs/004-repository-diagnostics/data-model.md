# Data model: Shared repository diagnostics

All entities are derived and never persisted.

## RepositoryDiagnostic

```text
RepositoryDiagnostic
├── repositoryId: string
├── repository: string
├── objectStore: string
├── effectiveDefault: string | null
├── defaultSource: "override" | "remote" | null
├── healthy: boolean
├── problems: RepositoryProblem[]
└── trunks: TrunkDiagnostic[]
```

`healthy` equals `problems.length === 0`; it is not independently assigned.

## RepositoryProblem

Stable discriminated kinds:

- `object-store-unreadable`: repository and object-store path.
- `default-unresolved`: repository plus resolver reason/remedy.
- `trunk-missing`: repository, recorded branch, directory, and expected path.
- `trunk-branch-mismatch`: repository, recorded branch, actual branch or detached state, directory.
- `trunk-branch-unreadable`: repository, recorded branch, directory, and read failure.

Every kind carries a deterministic human rendering. Problems are ordered by repository config order, then object store/default, then trunk config order.

## TrunkDiagnostic

```text
TrunkDiagnostic
├── id: string
├── repository: string
├── branch: string
├── directory: string
├── path: string
├── healthy: boolean
└── problems: RepositoryProblem[]
```

Only trunk-related kinds appear in a trunk's `problems`. Its `healthy` value follows the same empty list rule. Repository-level object/default problems remain visible through `repo status` and `reconcile`.

## Invariants

- Derivation is read-only and network-free.
- Unknown state is represented as a problem, never as healthy.
- Commands may filter or render the result but may not recompute health.
- No manifest or workspace schema changes.
