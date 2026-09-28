# Data model: Repository default policy

**Schema target:** workspace/Grove manifest schema version 2; no migration from version 1.

## RepositoryEntry

```text
RepositoryEntry
├── id: string
├── name: string
├── mode: "managed" | "linked"
├── remote: string | null
├── defaultBranch: string | null
├── path?: string
└── trunks: TrunkEntry[]
```

### Field ownership

- `remote` is the selected Git **remote name**, not its URL. Null means Grove follows no remote.
- `defaultBranch` is an explicit repository-level override only. Null means derive from cached Git metadata; a derived value is never written back.
- `path` remains required for linked entries and absent for managed entries.
- `trunks` records actual long-lived worktrees. No element is implicitly “the configured default.”

### Validation

- Repository objects reject unknown keys.
- Repository names, selected remote names, default branches, and trunk branches receive their existing argv-safe name/ref grammar validation while loading as well as before mutation.
- Linked entries require an absolute, normalized path; managed entries do not accept a linked path.
- A trunk directory is one safe allocated path segment and cannot escape the workspace trunk root.
- Schema version 1 refuses as version skew; no field conversion occurs.

## EffectiveRepositoryDefault (derived, never stored)

```text
EffectiveRepositoryDefault
├── branch: string
└── source: "override" | "remote"
```

Resolution:

```text
defaultBranch != null
  ├── local refs/heads/<defaultBranch> exists → override result
  └── missing → refused-precondition

defaultBranch == null && remote != null
  ├── refs/remotes/<remote>/HEAD is symbolic
  ├── target belongs to <remote>
  ├── corresponding local refs/heads/<branch> exists → remote result
  └── otherwise → refused-precondition

defaultBranch == null && remote == null → refused-precondition
```

The resolver is read-only and network-free.

## TrunkEntry

Unchanged shape: durable ID, exact branch, stable allocated directory. Its meaning is narrowed to an actual worktree. Removing a clean trunk worktree is allowed even when its branch is the effective repository default because the branch ref survives.

## GroveManifest.defaultBase

Unchanged nullable string. When non-null, it is the Grove's explicit comparison target. When null, review consumers resolve the repository's effective default at invocation time. No Tree stores a copy, so a repository-policy change applies immediately.

## Repository policy transitions

```text
defaultBranch: null ──set──> branch ──replace──> other branch
       ▲                            │
       └──────────── clear ─────────┘

remote: null ──set──> name ──replace──> other name
    ▲                         │
    └──────── clear ──────────┘
```

Each command may update one or both axes in one atomic workspace revision. Validation failure leaves both axes unchanged. Transitions do not mutate Git configuration or worktrees.

## Output model: LinkedTrunkWarning

```text
LinkedTrunkWarning
├── kind: "linked-branch-one-worktree"
├── branch: string
└── message: string
```

It appears only on successful `trunk add` for `mode: "linked"` and explains that the branch cannot be checked out elsewhere until this trunk is removed.
