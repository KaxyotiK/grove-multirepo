# Phase 1 Data Model: Grove CLI

All state is workspace-local JSON, written atomically with revision compare-and-swap. Schemas and rules are normative in `specs/001-grove-cli/contracts/` §4–§6; this document is the design-time summary. `schemaVersion` is validated exactly — unknown versions and unknown keys are errors (never rewritten). `_rev` increments on every successful CAS write.

## Entities

### Workspace — `<workspace>/.grove/config.json`

`kind: "workspace"`. Fields: `schemaVersion`, `_rev`, `id` (durable ULID), `name`, `defaults` (`agent`, `branchPrefix`), `agents` (map of name → `{command, args}`), `repositories[]`.

- Identity: `id` is durable, never derived from the folder; `name` defaults to the canonical target basename at `init`.
- Mutable via `grove config set` (CAS): only `name`, `defaults`, `agents`. The structural `repositories`/`trunks` arrays are read-only to it — changed only through §8.4/§8.4.1 commands.
- Invalid configuration is never replaced by defaults; relative paths resolve against the workspace root.

### Repository — `repositories[]` element

Fields: `id` (durable), `name` (§5.2 pattern, ≤48 bytes, case-folded-unique), `mode` (`managed` | `linked`), `remote` (selected Git remote name, nullable), `defaultBranch` (nullable explicit override), `trunks[]`.

- `managed`: cloned into `.bare/<repo>/`; gains a default trunk worktree at `repo add`.
- `linked`: registered at the checkout's canonical path; never moved/rewritten/deleted; no default trunk worktree (the linked checkout is the long-lived checkout).
- Effective default is derived from explicit `defaultBranch`, then cached selected-remote HEAD, otherwise refused. The remote-derived branch is never persisted and linked checkout HEAD is never a default source.
- No `remote` ⇒ fetch/sync skip it across-all and refuse when named. Default-dependent commands still work only when `defaultBranch` is set and resolves locally.
- Loading validates the repository name, selected remote, and override against their §5 grammars. A linked path is absolute and normalized.

### Trunk — `repositories[].trunks[]` element

Fields: `id` (durable, used for directory suffixes), `branch` (exact), `directory` (`<branch-slug>@<repo-slug>` under `trunks/`).

- Long-lived branch worktree owned by the workspace, not a Grove. Claims its branch.
- Loading validates the exact branch with §5.1 and requires `directory` to be one safe path segment beneath `trunks/`.
- A trunk is only a worktree; repository-default policy is independent. Removing a clean trunk retains its branch and does not change repository policy.

### Grove — `groves/<name>/grove.json` (or `.archive/<name>/` when archived)

`kind: "grove"`. Fields: `schemaVersion`, `_rev`, `id` (durable), `createdAt`, `defaultAgent` (nullable), `defaultBase` (nullable), `trees[]`. There is **no** `name` field.

- **Name authority (constitution III)**: the Grove's name _is_ its directory under `groves/` (§5.3); the manifest carries no `name`. A `grove.json` that contains a `name` key is an **unknown key** and is **refused** per §4.1 (Principle V — no silent tolerance, no deriving it). There is no migration path, so there is no "legacy" manifest to accommodate.
- **Archived** iff the directory lives under `groves/.archive/` (path is truth; no flag).
- **Materialized** is derivable: active Grove's Trees have worktrees; archived Grove's Trees do not.
- Mutable via `grove configure` (CAS): `defaultAgent`, `defaultBase` (`null` clears, absent leaves alone).

### Tree — `grove.json` `trees[]` element

Fields: `id` (durable), `repositoryId` (durable ref), `branch` (exact, case-sensitive), `directory` (allocated `<branch-slug>@<repo-slug>`, recorded and stable), `provenance` (`created` | `adopted`), `workingDir` (nullable, contained), `defaultAgent` (nullable).

- One Git worktree of one repository on one branch inside a Grove.
- `provenance` governs `grove delete --force`: only `created` branch refs are removed; `adopted` branches pre-existed and are left in place.
- Order persists as the array order (`grove tree reorder`). Grove order is not stored (§8.6).

### Lock — `<workspace>/.grove/locks/<...>`

Exclusive-create file; contents identify PID, process start time, operation, affected IDs. Held only for a mutation's duration; a live owner is never stolen; stale locks reclaimed only after process verification.

### Journal — `<workspace>/.grove/journal/<operation>-<target>`

Durable §6.1 rollback record for a multi-step Git mutation. Records branch creation **before** the subsequent `git worktree add`; per-operation+target file names prevent concurrent operations from sharing a journal; a `tree add` journal records that the Grove directory pre-existed (its rollback removes only the added Tree). `grove reconcile` finishes or rolls it back.

## Key relationships

```text
Workspace 1───* Repository 1───* Trunk            (structural, in .grove/config.json)
Workspace 1───* Grove     1───* Tree *───1 Repository (by durable repositoryId)
Tree *───1 Branch (exact ref, verified in the repo's object store)
Grove/Trunk/Tree ──claims──> Branch (a branch is claimed by at most one worktree)
```

## Identity, state & invariants

- **Identity is manifest-owned** (durable IDs + exact branch). Directory existence never proves identity or state. Grove never reconstructs a branch from a folder name.
- **Location-state is filesystem-owned** (archived/materialized by path; Grove name by directory).
- **Branch-claim uniqueness**: a branch checked out as a trunk, a Tree, or any other worktree (including a linked checkout) is claimed; `new`/`tree add`/`trunk add` refuse it and name the holder. Archived Trees retain their claims.
- **Work-safety classification** (archive/delete, network-free, from last fetch): `dirty` (uncommitted) | `unpushed` (clean but commits absent from remote counterpart, or no remote counterpart) | `synced`. Dirty/unpushed Trees refuse without `--force`; `delete` additionally refuses on loose non-git files in the Grove directory (it `rm -rf`s the directory; archive moves it, preserving them). A refusal itemizes every blocker. `--force` overrides identically for both commands, discarding dirty work in either.
- **Atomicity**: every manifest write is temp-file + fsync + atomic rename under CAS; multi-step Git mutations are recoverable via the journal.

## State transitions

**Grove lifecycle** — `new` → _active_ (`groves/<name>/`, worktrees present); `archive` → _archived_ (`groves/.archive/<name>/`, worktrees torn down, branches retained in object store); `restore` → _active_ (worktrees re-created on recorded branches); `delete` → _gone_ (worktrees removed, `created` branches deleted, claims released). `rename` moves the directory + worktrees (`git worktree move`) without changing identity. Every mutating transition is journaled (§6.1) and lock-guarded (§6).

**Tree lifecycle** — `tree add` (create or adopt a branch, add worktree) → present; `tree remove` (tear down worktree, release claim, branch ref survives) → absent. `configure`/`reorder` mutate Tree-owned settings/order under CAS.
