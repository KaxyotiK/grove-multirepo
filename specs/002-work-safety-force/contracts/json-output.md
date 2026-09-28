# Staged addition: `--json` shape for work-safety

**Amendment**: AM-001 (JSON portion) · **Applies to**: `specs/001-grove-cli/contracts/cli-surface.md` §8.5.1 · **Satisfies**: FR-010, FR-011, FR-012

`--json` stdout is exactly one JSON value (§8.1). These are the work-safety fields inside it. Both shapes are additive: no existing field is renamed or removed.

## Refusal — inside the §9 error object

Work-safety refusals exit `5` (failed precondition) via `GroveError` kind `refused-precondition`, and carry their itemization in `detail`, so a script can act on the blockers without parsing prose.

```json
{
  "error": {
    "what": "Cannot delete \"checkout-redesign\" without --force — delete would permanently destroy:",
    "why": "api:feat/pricing — dirty: 3 uncommitted files, saved in no commit\n  web:feat/nav — commits reachable from no other ref",
    "remedy": "Save what you need first (commit and push the work; move the content out), or pass --force to delete anyway and lose it.",
    "exitCode": 5,
    "detail": {
      "subject": "checkout-redesign",
      "blockers": [
        { "kind": "dirty",         "repo": "api", "branch": "feat/pricing", "treeId": "01J…", "files": 3 },
        { "kind": "at-risk-local", "repo": "web", "branch": "feat/nav",     "treeId": "01J…", "provenance": "created" },
        { "kind": "unknown",       "repo": "ops", "branch": "feat/deploy",  "treeId": "01J…", "problem": "worktree unreadable: EACCES" },
        { "kind": "loose",         "path": "scratch-notes.md" }
      ]
    }
  }
}
```

**Rules**

- `blockers` MUST contain one entry per blocking item — never a summary count, never an empty array on a refusal (FR-010).
- `kind` is one of `dirty` | `at-risk-local` | `unknown` | `loose`.
- `files` appears only on `dirty`; `provenance` only on `at-risk-local`; `problem` only on `unknown`; `path` only on `loose`.
- A Tree that is not a blocker MUST NOT appear. The array is the itemization, not a classification dump.
- `why` remains the human-readable rendering of the same list, so text and JSON cannot disagree.

## Discard report — inside the success object

Emitted by every `--force` run of `archive`, `delete`, `repo remove`, `repo delete-branch`, `tree remove`, and `trunk remove`, and by unforced `archive` for the branch notice of §8.5.1 item 3.

`tree remove` and `trunk remove` are included even though their blockers are already correct — each removes uncommitted work and no ref, which is exactly what it refuses on. Only their _reporting_ is missing. The list is derived from the destruction table, not maintained by hand: any command whose row marks a column _removes_ emits `discarded`.

```json
{
  "grove": "checkout-redesign",
  "archived": true,
  "path": "/ws/groves/.archive/checkout-redesign",
  "discarded": {
    "nothing": false,
    "uncommitted": [ { "repo": "api", "branch": "feat/pricing", "files": 3 } ],
    "branches":    [ { "repo": "web", "branch": "feat/nav" } ],
    "loose":       [ "scratch-notes.md" ],
    "unknown":     [ { "repo": "ops", "branch": "feat/deploy", "problem": "worktree unreadable: EACCES" } ]
  }
}
```

**Rules**

- `discarded` MUST be present on every command that can destroy data, forced or not.
- `nothing` MUST be `true` exactly when all four arrays are empty, and the human-readable output MUST then say nothing was discarded rather than warning of loss (FR-011).
- `branches` lists only refs whose commits were genuinely at risk. A `created` ref deleted while its commits survive in the trunk is not a discard.
- `unknown` entries MUST be listed, not omitted — they were destroyed and their contents are unknowable after the fact.
- `archive`'s "this branch now exists only locally" notice is **not** a discard — archive retains the ref. It is a separate sibling field so the two are never conflated:

  ```json
  "localOnly": [ { "repo": "web", "branch": "feat/nav" } ]
  ```

  `localOnly` is informational and never affects `nothing`, which reports destruction only. An archive that discards nothing emits `"discarded": { "nothing": true, … }` alongside a populated `localOnly`.

## Exit codes

Unchanged from §9. Work-safety refusals are `5` (failed precondition), the code the shipped implementation already returns for this family. An unreadable worktree that blocks without `--force` is also `5`, not `7` — the I/O problem is the _reason_, but the outcome is a refused precondition with a `--force` remedy. This feature does not renumber any exit code.
