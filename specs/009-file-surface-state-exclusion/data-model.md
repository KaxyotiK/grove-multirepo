# Data model: Exclude Grove state from the file surface

No stored entity or schema changes. The operation record, including its retained `secret` on a resumable `repo-add`, is unchanged; only one read surface stops reaching it.

## Surface transition

```text
file read <path in .grove/>  (workspace scope)  ──> refused, invalid-input, exit 2, nothing opened
file ls   <path in .grove/>  (workspace scope)  ──> refused, invalid-input, exit 2, nothing listed
file ls   .                  (workspace scope)  ──> every entry except the `.grove` directory
Grove/Tree-scoped file ls/read                  ──> unchanged
```

## Amendment surface transitions

```text
repo add <remote with userinfo>                 ──> refused, invalid-input, exit 2, no Git run, nothing written
file read/ls <path in a repository store>       ──> refused, invalid-input, exit 2, nothing opened
file ls <parent of a repository store>          ──> every entry except the store
```

No stored entity changes. The operation record's retained `secret.remote` is unchanged (see the spec's follow-up note).
