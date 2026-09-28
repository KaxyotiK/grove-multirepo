# Changelog

## Unreleased

- `reconcile --audit-only` now reports the same pending-operation and lock diagnostics as `doctor`.
- Interrupted deletion of a Grove without central metadata can resume; after abandonment, an explicit `delete` can remove its identity-matched empty scaffold or re-plan current loose content under the usual consent flags.
- Lifecycle recovery errors identify the pending operation and the exact `grove reconcile` command.
- Independent interrupted `repo add` operations can all resume after unrelated workspace config updates; real alias and path conflicts still refuse.
- `grove delete` uses fewer Git calls for Groves with multiple Trees while retaining its work and loose-content safety checks.

## 0.1.0

First public release, published to npm as `grove-multirepo`. The command is `grove`. Requires macOS, Node 24 or newer, and Git.

### Destructive commands protect your work

- `--allow-destructive` is replaced by two flags: `--allow-destructive-git-ignored` permits losing ignored files only, and `--allow-destructive-all` permits all otherwise-authorized content loss. Neither bypasses ownership checks, recorded recovery consent, or `--allow-unpushed`. Ignored content is protected by default.
- Loose Grove content is consented to per path. An interrupted `delete` refuses to resume, and a direct `delete` refuses to proceed, if anything appeared since the plan was recorded. Nested Git repositories and symlinks are never followed.
- When `archive` or `delete` fails partway, the result and the operation record list what earlier steps already removed, file by file.
- Recovery after a failure stays resumable, and every remedy names a command that works. `doctor` recommends resume or abandon according to the operation's state.

### Credentials never leak

- Remote URLs with credentials typed into the command are refused.
- Credentials introduced only by your own Git configuration are refused by default. `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` permits them for one invocation. Grove stores neither the setting nor the resolved URL.
- Output, argument errors and records are redacted. Repository stores and retained acquisition records stay out of `file ls` and `file read`.

### Recovery and diagnosis

- An interrupted `repo add` whose remote is gone can be abandoned explicitly. Only content Grove provably created is removed.
- A Tree sitting in another repository's `{repo}` layout slot is reported as `misplaced`, and `fix --move` can repair it.
- `doctor` reports orphaned lock-steal markers.
- `repo add ../repo.git` resolves a relative local path from the directory you run it in.
- `repo link` and `repo configure` set the branch new Trees start from with `--base`, replacing `--trunk`, which suggested a trunk that those commands never create. `repo add --trunk` is unchanged.
- Piped output of any size arrives complete before Grove exits.

### Known issues

Open issues are tracked on GitHub. None of them is known to lose data.
