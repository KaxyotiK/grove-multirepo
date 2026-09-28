# Contract: Architecture, discovery, layout & configuration

**Owns:** §1–§4 · **Status:** closed-to-new-behaviour

> **Closed to new behaviour.** `specs/001-grove-cli/contracts/` is the stable `§` citation authority and the home of the 180 regression scenario IDs — it is never renumbered and never deleted. It is **retired** in the sense that no new behaviour is written here: the Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which supersedes this file wherever the two disagree. Sections describing subsystems v3 deleted carry their own **Superseded** note; a `§` citation into one of those fails `tests/module/citations.test.ts`.

Section numbers are stable citation keys. Code comments, tests, and specs cite `§1–§4`-style references; this file is where they resolve. Do not renumber sections.

---

# Grove: single CLI, workspace-local state

> **Status:** adopted plan for this repository
>
> **Date:** 2026-08-15 (source references verified against the pinned commit on this date)
>
> **Scope:** this repository (`grove-cli`); the old `grove-ide` repository is reference material only

## 1. The product

Grove is one command-line program, exposed as one command:

```text
grove
```

That is the whole product. There is no IDE, daemon, RPC layer, server, socket, background service, event bus, global workspace registry, SQLite database, offline projection, or global Grove configuration.

Each invocation:

1. finds the current Grove workspace;
2. reads configuration from that workspace;
3. runs the requested filesystem/Git/process operation;
4. writes workspace files atomically when necessary;
5. exits.

Agent commands run in the foreground using the current terminal. Grove does not detach, supervise, attach to, resume, or remotely control agent processes.

## 2. Workspace discovery

Every workspace has exactly one configuration authority:

```text
<workspace>/.grove/config.json
```

For commands that require a workspace, Grove starts at `cwd` and walks upward. The nearest `.grove/config.json` wins.

Precedence is:

1. `--workspace <path>`;
2. upward discovery from `cwd`.

There is no environment-variable workspace selection. Grove reads no `GROVE_*` environment variables; an inherited variable such as `GROVE_ROOT` has no effect. Scripts that need an explicit workspace pass `--workspace`, which is visible at the call site.

Rules:

- The marker is the exact file `.grove/config.json`; `.grove/` alone is insufficient.
- An unreadable, malformed, or unsupported nearest config is an error. Grove does not skip it and bind to an ancestor.
- Grove never scans siblings or descendants.
- Grove never reads `~/.grove` for configuration or workspace selection.
- Nested workspaces are legal; the nearest marker wins.
- All resolved roots use canonical real paths for containment checks.
- If there is no marker, Grove performs no mutation and instructs the user to run `grove init`.

Required error:

```text
No Grove workspace found from <cwd>.
Run `grove init` in the workspace root, or `grove init <path>`.
Expected: <workspace>/.grove/config.json
```

## 3. Folder structure

### 3.1 One workspace with multiple Groves

```text
~/projects/finance/
├── .grove/
│   ├── config.json
│   ├── .gitignore
│   ├── locks/                              temporary command locks only
│   └── journal/                            pending multi-step operation journals (§6.1)
├── .bare/                                  managed Git object stores
│   ├── ledger/
│   └── reporting/
├── trunks/                                 long-lived trunk worktrees (§8.4.1)
│   ├── main@ledger/                        default trunk, created by repo add
│   ├── main@reporting/
│   └── release_2026.08@reporting/          any long-running branch can be a trunk
└── groves/
    ├── pricing-fix/
    │   ├── grove.json
    │   ├── NOTES.md
    │   └── trees/
    │       ├── feature_pricing@ledger/
    │       └── feature_quote-api@reporting/
    ├── audit-export/
    │   ├── grove.json
    │   └── trees/
    │       └── feature_audit-export@reporting/
    ├── tax-engine/
    │   ├── grove.json
    │   └── trees/
    │       ├── feature_tax-engine@ledger/
    │       └── feature_tax-api@reporting/
    └── .archive/
        └── old-reconciliation/
            ├── grove.json                  everything outside trees/ moves intact —
            ├── NOTES.md                    manifest, notes, any Grove-level files;
            └── trees/                      worktrees are torn down on archive and
                                            re-created on restore (§8.5.1); branches
                                            survive in .bare/
```

### 3.2 Multiple independent Grove workspaces

```text
~/projects/
├── finance/
│   ├── .grove/config.json                  id: workspace-finance
│   ├── trunks/main@ledger/
│   └── groves/
│       ├── pricing-fix/
│       │   ├── grove.json
│       │   └── trees/feature_pricing@ledger/
│       └── audit-export/
│           ├── grove.json
│           └── trees/feature_audit-export@ledger/
├── quoting/
│   ├── .grove/config.json                  id: workspace-quoting
│   ├── trunks/main@api/
│   └── groves/
│       ├── quote-cache/
│       │   ├── grove.json
│       │   └── trees/feature_quote-cache@api/
│       └── carrier-rules/
│           ├── grove.json
│           └── trees/feature_carrier-rules@api/
├── operations/
│   ├── .grove/config.json                  id: workspace-operations
│   ├── trunks/main@deploy/
│   └── groves/
│       ├── deploy-automation/
│       │   ├── grove.json
│       │   └── trees/feature_automation@deploy/
│       └── rollback-safety/
│           ├── grove.json
│           └── trees/feature_rollback-safety@deploy/
└── scratch/                                not a Grove workspace
    └── experiment/
```

Resolution examples:

| Current directory | Configuration used |
|---|---|
| `~/projects/finance` | `finance/.grove/config.json` |
| `~/projects/finance/trunks/main@ledger` | `finance/.grove/config.json` |
| `~/projects/finance/trunks/main@ledger/src` | `finance/.grove/config.json` |
| `~/projects/finance/groves/pricing-fix` | `finance/.grove/config.json` |
| `~/projects/quoting/trunks/main@api` | `quoting/.grove/config.json` |
| `~/projects/operations/trunks/main@deploy` | `operations/.grove/config.json` |
| `~/projects` | none |
| `~/projects/scratch/experiment` | none |

Finance never reads quoting or operations configuration.

## 4. Configuration files

### 4.1 Workspace configuration

`.grove/config.json` contains only workspace-owned configuration:

```json
{
  "kind": "workspace",
  "schemaVersion": 2,
  "_rev": 1,
  "id": "01K...",
  "name": "finance",
  "defaults": {
    "agent": "codex",
    "branchPrefix": "jc/"
  },
  "agents": {
    "codex": {
      "command": "codex",
      "args": []
    }
  },
  "repositories": [
    {
      "id": "01K...",
      "name": "ledger",
      "mode": "managed",
      "remote": "origin",
      "defaultBranch": null,
      "trunks": [
        {
          "id": "01K...",
          "branch": "main",
          "directory": "main@ledger"
        }
      ]
    }
  ]
}
```

Rules:

- `id` is durable and never derived from the folder name.
- `_rev` is incremented for compare-and-swap writes.
- Unknown keys and unsupported schema versions are errors.
- Invalid configuration is never replaced by defaults.
- Relative paths resolve against the workspace root.
- Agent definitions, defaults, and repositories are workspace-local.
- A repository's `remote` is the selected Git remote name, not its URL. `defaultBranch` is null or an explicit user override; a default derived from the selected remote's locally cached symbolic HEAD remains Git-owned state and is never copied into this file.
- Repository defaults resolve in exactly one order: explicit `defaultBranch`, cached selected-remote HEAD, then refusal. Resolution is local-only and never treats a linked checkout's current HEAD as the repository default.
- Repository defaults, `trunks[]` worktrees, and Grove `defaultBase` comparison targets are separate facts. No Tree stores a fallback copy of the repository default.
- Repository names, selected remote names, default branches, and trunk branches are validated with their §5 grammars when configuration loads. A linked repository path is absolute and normalized; each trunk directory is one safe path segment under `trunks/`.
- There are no global behavior defaults.
- Work-safety checks (§8.5.1) are not configurable; the only override is each command's `--force` flag.

### 4.2 Grove configuration

Each unit of work owns `groves/<name>/grove.json`:

```json
{
  "kind": "grove",
  "schemaVersion": 1,
  "_rev": 1,
  "id": "01K...",
  "createdAt": "2026-08-15T12:00:00Z",
  "defaultAgent": "codex",
  "defaultBase": "main",
  "trees": [
    {
      "id": "01K...",
      "repositoryId": "01K...",
      "branch": "feature/pricing",
      "directory": "feature_pricing@ledger",
      "provenance": "created",
      "workingDir": null,
      "defaultAgent": null
    }
  ]
}
```

The manifest stores exact identity. Folder names are readable paths only.

Archived state is not a manifest field: a Grove is archived exactly when its directory lives under `groves/.archive/` — the path is the truth, and no flag can disagree with it. Materialization is derivable the same way: an active Grove's Trees always have worktrees, an archived Grove's Trees never do (§8.5.1), so the manifest stores no flag for it either. The Grove's name is not a manifest field for the same reason: the name is the directory under `groves/` (§5.3), so `grove rename` moves the directory and there is no stored name that could disagree with the path. A Grove is always named — its name is its location.
