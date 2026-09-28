# Contract: Naming, slugs & collisions

**Owns:** §5 · **Status:** closed-to-new-behaviour

> **Closed to new behaviour.** `specs/001-grove-cli/contracts/` is the stable `§` citation authority and the home of the 180 regression scenario IDs — it is never renumbered and never deleted. It is **retired** in the sense that no new behaviour is written here: the Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which supersedes this file wherever the two disagree. Sections describing subsystems v3 deleted carry their own **Superseded** note; a `§` citation into one of those fails `tests/module/citations.test.ts`.

Section numbers are stable citation keys. Code comments, tests, and specs cite `§5`-style references; this file is where they resolve. Do not renumber sections.

---

## 5. Naming

Tree worktrees use:

```text
groves/<grove>/trees/<branch-slug>@<repo-slug>/
```

Trunk worktrees (§8.4.1) use the identical encoding one level below the workspace root:

```text
trunks/<branch-slug>@<repo-slug>/
```

Examples:

| Exact branch | Repository | Folder base |
|---|---|---|
| `main` | `ledger` | `main@ledger` |
| `feature/pricing` | `ledger` | `feature_pricing@ledger` |
| `release/2026.08` | `api` | `release_2026.08@api` |
| `team@experiment` | `api` | `team~40experiment@api` |

### 5.1 Slug rules

1. Validate the exact branch with Git ref-format rules.
2. Preserve ASCII letters, digits, `.`, `_`, and `-`, including case.
3. Convert `/` to `_`.
4. Encode `@` as `~40` so the only unescaped `@` is the branch/repository separator.
5. Encode `~` as `~7e`.
6. Encode every other character as lowercase UTF-8 bytes prefixed by `~`.
7. Do not collapse underscores.
8. Limit the branch slug to 96 ASCII bytes and repository slug to 48 ASCII bytes.
9. Truncate only at encoding boundaries. Truncated names always receive a Tree-ID suffix.
10. Reject non-UTF-8 refs instead of rewriting them lossily.

Examples:

| Input | Encoded fragment |
|---|---|
| `/` | `_` |
| `@` | `~40` |
| `~` | `~7e` |
| `é` | `~c3~a9` |

### 5.2 Collision handling

`/ → _` creates real collisions: `feature/a` and `feature_a` have the same readable base. Case-only names also collide on common macOS filesystems.

Grove compares allocated folder names using an ASCII-case-folded collision key. When a base collides, or was truncated, Grove appends the shortest unique Tree-ID suffix:

```text
feature_a@ledger
feature_a@ledger~01K9F3Q2
```

The allocated directory is written into `grove.json` and remains stable.

Exact matching rules:

- Git branch identity is the exact, case-sensitive `branch` string in `grove.json`.
- Repository identity is the durable repository ID.
- Grove verifies the exact `refs/heads/<branch>` ref.
- Reconcile verifies the worktree's Git `HEAD` against the manifest.
- Directory existence never proves Tree identity.
- Grove never reconstructs a branch name by parsing the folder.

Repository names must match:

```text
[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?
```

They are limited to 48 bytes and must be unique under ASCII case-folding.

### 5.3 Grove names

- Grove names use the §5.2 repository-name pattern, limited to 64 bytes.
- Names are unique under ASCII case-folding across active **and** archived Groves.
- Names starting with `.` are refused; `groves/.archive/` is a reserved directory, not a Grove.
- The name is the directory under `groves/`; `grove rename` moves the directory.
- Every Grove is named: `grove new` requires a name (exit 2 otherwise), so there is no unnamed/ID-only Grove state.
