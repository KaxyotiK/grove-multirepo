# Contract: Workspace Config v3

**Normative content**: this file, with Decisions 001–003 and the corrective rulings in `cli-surface-v3.md`. It states every configuration and advisory-metadata rule it depends on. _Historical input (not normative):_ the pre-ruling proposal §5, moved here by feature `010`.

## Shape

```json
{
  "kind": "workspace",
  "schemaVersion": 3,
  "_rev": 7,
  "id": "01K...",
  "name": "acme",
  "layout": {
    "repositories": "repos/{repo}",
    "trunks": "trunks/{trunk}",
    "groves": "groves/{grove}",
    "trees": "groves/{grove}/trees/{tree}",
    "archives": "archives/{grove}"
  },
  "conventions": { "branch": "{branchPrefix}{grove}", "tree": "{grove}@{repo}" },
  "defaults": { "agent": "codex", "branchPrefix": "", "syncStrategy": "ff-only" },
  "agents": { "codex": { "command": "codex", "args": [] } },
  "repositories": [
    { "id": "01K...", "name": "api", "location": { "kind": "managed" }, "remote": "origin", "trunk": "main" }
  ]
}
```

The key sets are closed: top level `kind`, `schemaVersion`, `_rev`, `id`, `name`, `layout`, `conventions`, `defaults`, `agents`, `repositories`; `defaults` holds `agent`, `branchPrefix`, `syncStrategy`; each agent holds `command`, `args`; each repository holds `id`, `name`, `location`, `remote`, `trunk`, where `location` is `{ "kind": "managed" }` or `{ "kind": "linked", "commonGitDir": "<absolute path>" }`. The values shown for `layout` and `conventions` are the defaults.

## Layout templates

| Key | Allowed tokens | Required | Meaning |
|---|---|---|---|
| `repositories` | `{repo}` | `{repo}` | Managed bare common-directory store created by `repo add`. |
| `trunks` | `{trunk}` | `{trunk}` | Every managed long-lived trunk worktree. |
| `groves` | `{grove}` | `{grove}` | Grove directory; source of active Grove names. |
| `trees` | `{grove}`, `{tree}`, `{repo}` | `{grove}`, `{tree}` | Tree worktrees. |
| `archives` | `{grove}` | `{grove}` | Archived loose Grove content; advisory metadata stays central. |

- A template is `/`-separated, workspace-relative, and has no empty, `.`, or `..` segment.
- A token occupies a whole segment, appears at most once, and must be allowed for its key; every required token appears exactly once.
- A static segment matches `[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?` or is exactly `.bare`, and is never `.grove`.
- Without `{repo}` in `trees`, two repositories cannot use the same Tree name in one Grove: creation refuses and raw state is diagnosed. With it, the repository-ID selector distinguishes them.
- `trees` is structurally nested under `groves`. That required Grove/Tree containment is the only ancestor relationship: every other pair's segment languages diverge before either template ends, with static segments compared case-insensitively and any token treated as matching a peer token or static segment. Thus no other role expansion can equal or be an ancestor of another role's root; in particular archives cannot overlap active Groves or Trees. This overlap check is deliberately conservative: it does not special-case `.bare` or `{trunk}` allocation grammar, so it refuses some layouts whose stricter role-specific name grammar would prevent a collision.
- `{trunk}` is the allocation described below; raw `{branch}`, lossy `{branchSlug}`, and opaque `{branchKey}` tokens do not exist. Reverse matching extracts only single-segment names; a trunk's branch is always read from Git, never parsed from its path.
- A `{repo}` segment in a Tree path is compared with the registration whose Git worktree list reports the worktree; the path does not decide ownership. The comparison uses the ASCII case-folding under which repository names are unique, so a segment that spells the owner's name in another case names the owner and conforms. When the segment names any other repository, the Tree is `misplaced` (FR-006), keeps its observed Grove and Tree names, and its expected path is the `trees` expansion for its owning registration's name (`V3LAY-07`, `V3LAY-08`, `V3LAY-09`).

## Naming templates

- `conventions.tree` produces the default Tree name from `{grove}` and `{repo}`; the default is `{grove}@{repo}`. `conventions.branch` produces the default branch from `{branchPrefix}`, `{grove}`, `{repo}`, and `{tree}`, using the resolved Tree name; the default is `{branchPrefix}{grove}`. The one-way dependency prevents cycles.
- A template is 1–512 UTF-8 bytes of literals plus whole brace tokens. It contains at least one allowed token, repeats none, and has no unknown token, stray brace, or escape syntax. Adjacent tokens are allowed. Substituted values are never re-interpreted.
- After expansion a Tree name passes the one-segment Tree-name grammar (at most 172 UTF-8 bytes, case-fold checked), and a branch is at most 1024 UTF-8 bytes, is not option-like, and passes native `git check-ref-format --branch`. Both checks run at plan preflight and again at the Git boundary.
- The branch convention is a convention only: a worktree on another branch stays valid and is reported `nonconforming-branch` when the expected branch is unambiguous. An occupied derived Tree name or branch requires an explicit override; Grove never appends a suffix. `tree add --name` is the exact final identity.

## Guarantees

- `schemaVersion` is exactly `3`; unknown versions and keys refuse with the config-class exit.
- `layout` is the sole workspace authority for managed bare common-directory stores, trunk worktrees, Grove, Tree, and archive loose-content locations.
- `conventions` contains exactly the `branch` and `tree` templates above. The default Tree identity is `{grove}@{repo}`. The default trunk layout is `trunks/{trunk}`, where `{trunk}` is the readable `<branch-slug>@<repo-slug>` allocation; no live trunk naming record exists.
- Tree identities accept the safe `@` separator and legacy `~` slug escapes with a 172-byte limit, allowing observed valid prior `<branch-slug>@<repo-slug>` paths to remain recognizable after schema-3 registration without reading legacy ownership state.
- Pure config validation enforces unique stable IDs and aliases without invoking Git. Repository add/link and observation separately resolve canonical common directories and refuse or diagnose two registrations resolving to one Git identity.
- Repository registrations contain acquisition policy, preferred remote names, and preferred trunks but no live branch/worktree arrays. A managed registration derives its bare common-directory anchor from `layout.repositories` and permits trunk management. A linked registration stores an external canonical common-directory anchor and refuses trunk mutation. Add fixes/records remote `origin`; link records `origin`, otherwise its sole remote, otherwise `null`, and remote-dependent behavior with `null` never guesses among remotes.
- External repository common-directory anchors must round-trip through strict UTF-8 and are deliberately path-identified: non-UTF-8 anchors refuse, while a repository recreated at the same canonical anchor path occupies the existing registration. Every action still observes and revalidates current Git at point of use.
- Central Grove metadata is advisory and keyed by stable identities, never alias alone. An archive snapshot is one versioned aggregate with timestamp and loose-content path/layout evidence plus an ordered recipe for every selected `{repositoryId, tree}`.
- Layout uses only permitted whole-segment tokens with required tokens exactly once. Naming uses only declared tokens, permits adjacent whole tokens, has bounded expansion, and post-validates names/refs.
- Trunk allocation encodes validated UTF-8 branch/repository names with the normative slug grammar. A non-truncated case-fold-unique base is exact; collision/truncation uses the shortest case-fold-unique `~<hash-prefix>` beginning at eight lowercase hexadecimal characters of SHA-256 over canonical full-ref bytes. Git's registered worktree path remains the live fact.
- Expanded paths are absolute, contained by their compiled root, collision-checked including case-fold behavior, and symlink-safe at mutation time. A lexical expansion that canonicalizes through a symlink to a different path refuses before mutation.
- Config changes never move common repositories, worktrees, or loose content. `layout.repositories` changes refuse while managed repositories are registered. Grove/archive-root changes refuse while existing loose content would become undiscoverable; otherwise later observation reports resulting convention diagnostics.

## Compatibility

Normal v3 loading accepts exactly schema 3 and never interprets schema 1 or 2. There is no migration command or versioned legacy loader. A foreign schema is refused before mutation with the running version, resolved executable path, encountered schema, and accepted schema.

## Grove metadata

Advisory metadata lives at `.grove/groves/<grove>.json`, never under a configurable layout path, so a layout change cannot orphan it. Its closed key set is `kind` (`"grove"`), `schemaVersion` (`3`), `_rev`, `id`, `name`, `state` (`"active"` or `"archived"`), `createdAt`, `defaultAgent`, `defaultBase`, `treeOrder`, `treeSettings`, and `archiveSnapshot`.

- `state` is advisory; it never proves a worktree exists. There is no `trees[]` array.
- The durable Tree selector is `{ repositoryId, tree }`. `treeOrder` is a list of selectors; `treeSettings` entries hold `selector`, `defaultAgent`, and `workingDir`. The CLI accepts `<repo-alias>/<tree>`, or `<tree>` when unique within the Grove. Unknown or removed repository IDs are reported as stale metadata and never execute; alias reuse cannot rebind them.
- `archiveSnapshot` is `null` or `{ version: 1, archivedAt, looseContentPath, layoutRevision, recipes[] }`, with one recipe per archived Tree in selector order: `selector`, `repositoryAlias`, `commonGitDir`, `branch`, `headOid`, `priorPath`. Restore requires the same repository ID and re-observes each recipe. Archive durability and restore binding follow ruling ②.

## Metadata-free Groves

A correctly placed raw Git worktree forms an observed Grove with no metadata file. Read commands, agent launch with workspace defaults, rename, and delete work on it by name. The first command needing Grove-owned metadata creates it atomically with create-if-absent semantics; a racing loser reloads the winner's metadata. Lookup by ID works only for Groves with metadata. A metadata file never proves that a Grove or Tree exists.
