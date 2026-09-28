# Issue #22 relative `repo add` path: evidence ledger

**Authority:** `cli-surface-v3.md` `repo add` (local-path paragraph); V3ACQ-02; V3SEC-05 and V3SEC-07 unchanged. **Base:** release head `9958673e187336740adff82ae6646457e2a0d529`.

At the base, `grove repo add ../origin.git --name alpha` from the workspace root passed preflight (`ls-remote` runs at the root) and then failed the store's fetch (`partial`, `git-failed`, exit 6), because Git resolved the recorded relative path from the store directory. It left the store, a trunk path and a conflicted operation that locked the alias until abandon. From a subdirectory, preflight itself resolved the path from the root.

| Requirement | Status | Witness |
| --- | --- | --- |
| A relative local path from the workspace root is resolved against it and fetched | implemented:verified-local | V3ACQ-02 root case |
| A relative local path from a workspace subdirectory is resolved against that subdirectory | implemented:verified-local | V3ACQ-02 subdirectory case |
| A relative `file://` URL is resolved against the invocation directory | implemented:verified-local | V3ACQ-02 `file://` case |
| A nonexistent relative path is `invalid-input` with a remedy before any mutation, in `--json` and human mode | implemented:verified-local | V3ACQ-02 missing-path case |
| An interrupted add resumes from another directory against the recorded absolute path | implemented:verified-local | V3ACQ-02 Git gate at the store fetch, SIGKILL, `reconcile --operation` from `trunks/` |
| An absolute path is recorded exactly as given | implemented:verified-local | V3ACQ-02 control |
| A `file://<host>/<abs>` URL, which Git reads ignoring the host, is used as written | implemented:verified-local | V3ACQ-02 control (review F1) |
| An scp-like remote is not a local path: served verbatim, and a relative-looking `host:path` reaches SSH unchanged | implemented:verified-local | V3ACQ-02 control |

**Red.** Before any product edit, `tests/cli/relative-repo-path-v3.test.ts` ran against a build of the base: 7 tests, 2 pass, 5 fail; the red run log was kept outside the repository. The root case exited 6 `partial` with `../origins/alpha.git` stored and a `conflicted` record; the subdirectory and `file://` cases failed preflight and created no store; the interrupted add recorded the relative path for resume; the missing path exited 6 `git`, not 2 `invalid-input`. Both controls passed, as they must.

**Review F1.** The independent review of `e4907bc` (kept outside the repository) found that `file://<hostname>/<abs>`, which exits 0 on the base, was refused as a missing local path: every `file://` path not starting with `/` or `localhost/` was treated as relative. A `file://` URL is now resolved only when Git cannot use it as written (no `/` after `file://`, or a first segment of `.` or `..`). Red on `e4907bc`: 8 tests, 7 pass, 1 fail, the new witness exiting 2; the red run log was kept outside the repository.
