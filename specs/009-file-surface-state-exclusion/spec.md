# Feature Specification: Exclude Grove state from the file surface

> **Amended 2026-09-23 (PR #15 review).** The feature also refuses credentialed remotes in `repo add` (`V3SEC-05`) and excludes repository Git directories from the file surface (`V3SEC-06`). See [Amendment: credentialed remotes and repository stores](#amendment-credentialed-remotes-and-repository-stores).

**Feature Branch**: `release/grove-multirepo`

**Feature Directory**: `009-file-surface-state-exclusion`

**Created**: 2026-09-23

**Status**: Implemented

**Input**: User description: "Exclude Grove's internal state directory from the file surface. At workspace scope, `file ls` and `file read` refuse any path that resolves into the workspace's `.grove/` directory, and `file ls` of the workspace root omits the `.grove` entry."

**Amendment input** (repository owner, PR #15 review): "`repo add` runs `git remote add` in the managed bare repository, so Git stores the exact URL, token included, in `repos/<repo>/config`, and `grove file read repos/<repo>/config` prints it. Grove does not support credentials embedded in remote URLs: refuse them in `repo add` before any mutation, and exclude the repository store from the file surface as insurance against a token added later by hand."

**Authority**: §8.7 and §11 FILE-01, FILE-02, FILE-05; `specs/003-git-native-grove/contracts/` `cli-surface-v3.md` and `json-results-v1.md` (remote redaction; retained remote on a resumable record).

**Issue**: #11 in the private development tracker

## Why this feature exists

Every Grove result redacts credentials from remote URLs (`json-results-v1`). A resumable `repo-add` record retains the exact typed remote for recovery, so the file-surface boundary also protects legacy records created before credentialed typed URLs were refused. Current acquisitions retain only credential-free typed URLs, never Git's credentialed resolved destination.

The file surface (§8.7) exists so agents can browse workspace content through Grove. At workspace scope it previously reached `.grove/`, so `grove file read .grove/operations/<id>.json` could print a retained remote verbatim. No operating-system boundary was crossed, but Grove's own agent-facing surface could leak a credential into an agent transcript. `.grove/` is Grove's internal state, not workspace content; nothing a user or agent needs from the file surface lives there.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Grove's own read surface never reveals retained secrets (Priority: P1)

An agent browsing a workspace through `grove file ls` / `grove file read` cannot reach Grove's internal state, so even a credential in a legacy pending acquisition record never appears in its output.

**Why this priority**: It is the defect. Every other Grove output already redacts the remote.

**Independent Test**: With a fixture simulating a legacy pending `repo-add` whose remote carries userinfo, attempt to read the operation record through the file surface by every route that resolves into `.grove/`; each refuses, and the credential never appears on stdout or stderr.

**Acceptance Scenarios**:

1. **Given** a workspace with a legacy pending `repo-add` record retaining a remote with userinfo, **When** `grove file read .grove/operations/<id>.json` runs at workspace scope, **Then** it exits `2` with a classified refusal naming the path and a remedy, and the credential appears in neither output stream, in human or `--json` mode.
2. **Given** the same workspace, **When** the path reaches `.grove/` by `.grove`, `./.grove/...`, `x/../.grove/...`, a case variant on a case-insensitive filesystem, or a symlink inside the workspace whose target is in `.grove/`, **Then** each refuses identically and opens nothing.
3. **Given** the same workspace, **When** `grove file ls` runs on any of those paths, **Then** it refuses identically.

---

### User Story 2 - Workspace listing shows workspace content only (Priority: P1)

A user or agent listing the workspace root sees its content, not Grove's state directory.

**Why this priority**: Listing `.grove` invites the read that Story 1 refuses; the surface should be consistent.

**Independent Test**: `grove file ls` at workspace scope on `.` lists every other entry and omits `.grove`.

**Acceptance Scenarios**:

1. **Given** an initialised workspace, **When** `grove file ls` runs at workspace scope with no path, **Then** the result omits `.grove` and still lists every other top-level entry, in human and `--json` mode.

---

### User Story 3 - Grove- and Tree-scoped reads are unchanged (Priority: P2)

Reads scoped with `--grove` or `--grove --tree` behave exactly as before, including a Tree's own files and FILE-01/FILE-02/FILE-05 refusals.

**Why this priority**: The change must not narrow legitimate content access.

**Independent Test**: The existing FILE-01, FILE-02, and FILE-05 witnesses pass unchanged, and a Grove- or Tree-scoped read of ordinary content succeeds.

**Acceptance Scenarios**:

1. **Given** a Grove with a Tree, **When** `grove file read <path> --grove <g> --tree <t>` reads a tracked file, **Then** it succeeds with unchanged content and result shape.

### Edge Cases

- A file or directory elsewhere named `.grove` (for example inside a Tree, or `notes/.grove`) is ordinary content: only the workspace's own state directory is excluded.
- A path that does not exist but would resolve into `.grove/` is refused as excluded, not reported as missing, so the refusal does not disclose which state files exist.
- A symlink inside the workspace pointing into `.grove/` is refused after real-path resolution, matching FILE-02's rule for scope escapes.
- Grove- and Tree-scope roots already cannot contain `.grove/`; their containment rules (FILE-01) refuse any route out of scope before this exclusion applies.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: At workspace scope, `file read` MUST refuse any path whose real-path resolution is the workspace's `.grove` directory or lies inside it, before opening any file.
- **FR-002**: At workspace scope, `file ls` MUST refuse the same set of paths before listing.
- **FR-003**: The refusal MUST be `invalid-input` (exit `2`), consistent with FILE-01 scope refusals, name the requested path, state that Grove's internal state is not part of the file surface, and give a remedy.
- **FR-004**: `file ls` at workspace scope MUST omit the `.grove` entry when listing the workspace root, in human and `--json` results alike.
- **FR-005**: The exclusion MUST apply only to the workspace's own `.grove` directory. Other paths named `.grove` and all Grove- and Tree-scoped reads are unaffected.
- **FR-006**: No other command changes. `reconcile`, `doctor`, and operation recovery keep reading `.grove/` directly.
- **FR-007**: Add v3 acceptance scenario `V3SEC-04` to `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md` and amend the §8.7 file-surface contract in `cli-surface-v3.md` to state the exclusion.
- **FR-008**: Add failing witnesses before the implementation change.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **009-file-surface-state-exclusion-SC-001**: Across every listed route into `.grove/` (direct, `./`, `..`-traversal, case variant, symlink), 100% of `file read` and `file ls` attempts at workspace scope refuse with exit `2`, and a retained remote credential appears in zero bytes of output.
- **009-file-surface-state-exclusion-SC-002**: A workspace-root listing contains zero `.grove` entries and every other top-level entry.
- **009-file-surface-state-exclusion-SC-003**: The FILE-01, FILE-02, and FILE-05 witnesses pass unchanged, and Grove- and Tree-scoped reads of ordinary content succeed.
- **009-file-surface-state-exclusion-SC-004**: Typecheck, all test layers, scan, and traceability pass, with `V3SEC-04` cited by an executable test title.

## Assumptions

- `.grove/` holds only Grove's internal state (config, advisory Grove records, operations, locks); nothing in it is workspace content a user needs through the file surface. Users who need it can read it directly with ordinary tools.
- Hiding `.grove` from the listing is not a security boundary against the same local user; the goal is that Grove's own read surface honours the redaction guarantee its other outputs make.
- The workspace config path is fixed at `<workspace>/.grove`; no layout setting relocates it.

## Amendment: credentialed remotes and repository stores

### Why the amendment exists

`V3SEC-04` closed one route to a retained remote. An independent review of PR #15 found a second, permanent one: `repo add` configures `origin` with `git remote add -- origin <remote>`, so Git keeps the exact URL in the managed repository's own config. With a remote such as `http://user:SECRET123@127.0.0.1:<port>/ledger.git`, `grove file read repos/ledger/config` printed the token long after the operation finished. Redaction cannot reach a file Git owns.

The repository owner decided that Grove does not support credentials in URLs passed directly to `repo add`. The supported ways to add a repository are SSH (`git@github.com:org/repo.git`) or HTTPS without credentials plus a Git credential helper (the macOS Keychain helper, or `gh auth setup-git`); a token in the typed URL is the pattern Git and GitHub warn against. Credentials supplied only through the user's Git configuration require the per-invocation opt-in described below. The file-surface exclusion is kept as insurance against a credential added by hand afterwards (`git remote set-url` inside the store).

### User Story 4 - `repo add` refuses a credentialed remote (Priority: P1)

A user or agent who passes a remote URL carrying credentials is refused before anything happens, is told why and what to use instead, and never sees the credential repeated back.

**Why this priority**: It removes the only path by which Grove itself writes a credential to disk.

**Independent Test**: `repo add` with each credentialed form exits `2` with no Git invocation, no repository directory, no operation record, an unchanged workspace config, and the credential absent from both output streams in human and `--json` mode.

**Acceptance Scenarios**:

1. **Given** an initialised workspace, **When** `grove repo add https://user:TOKEN@host/org/repo.git` or `grove repo add https://TOKEN@host/org/repo.git` runs, **Then** it exits `2` with `invalid-input`, the error names embedded credentials as the problem and an SSH URL or a credential helper as the remedy, and neither `user` nor `TOKEN` appears in any output.
2. **Given** the same workspace, **When** the remote is `git@host:org/repo.git`, `ssh://git@host/org/repo.git`, or `https://host/org/repo.git`, **Then** this rule does not refuse it.

### User Story 5 - The file surface never reaches a repository Git directory (Priority: P1)

An agent browsing the workspace cannot read a repository's Git internals, so a credential that a user later puts into a remote by hand never appears in its output. Code in trunks and Trees stays readable.

**Why this priority**: It is the insurance the owner asked for, and it closes the reported route for any URL already on disk.

**Independent Test**: With a token set by hand in a store's `origin`, every route into the store is refused with exit `2` and the token appears in no output; `file ls` of the parent omits the store.

**Acceptance Scenarios**:

1. **Given** a managed repository whose `origin` carries a token set by hand, **When** `file read`/`file ls` reach its store by direct path, `./`, `..`-traversal, a symlink, a case variant on a case-insensitive volume, or a missing path inside it, **Then** each refuses with exit `2` naming the repository's Git directory, and the token appears in no output.
2. **Given** a custom `layout.repositories` template (for example `vault/{repo}/.bare`), a linked repository whose Git directory lies inside the workspace, or the anchor of an unfinished `repo add`, **When** the file surface reaches it, **Then** it refuses identically.
3. **Given** the same workspace, **When** `file ls repos` runs, **Then** the store is omitted; and `file read trunks/<trunk>/README.md` and a Tree-scoped read still succeed.

### Edge cases (amendment)

- **What counts as userinfo (the definition FR-009 uses; rationale in research R7).** Userinfo is found the way Git and curl find it, not the way WHATWG does:
  - every leading `<transport>::` remote-helper prefix is stripped, repeatedly (`a::b::http://…`);
  - after the scheme come two or more forward slashes (`http:///TOKEN@host` authenticates exactly like `http://TOKEN@host`; a single slash, `host:/path`, is scp-like SSH and never reaches curl);
  - the authority runs to the first `/`, `?`, or `#`, so a backslash is an ordinary authority character (`http://TOKEN\@host` sends TOKEN as the user name), and userinfo is what precedes the last `@` in it; for `file:`, three slashes mean an empty host;
  - a helper address that is not URL-shaped by the rules above is scheme-guessed by curl, so an `@` before its first `/`, `?`, or `#` is userinfo (`http::TOKEN@host/x`, also when `://` appears later in its path or query);
  - for an SSH scheme, Git percent-decodes only a `scheme://` SSH URL before it splits the host and path; scp-like input is parsed raw. To select the bracketed host field, Git looks for the first `@[` and then, only if it is absent, a leading `[`. It skips slashes inside a bracketed host field and takes the login through the last `@` in the field. A resulting login containing `:`, `?`, or `#` is refused, so encoded URL separators such as `%3A` and `%40`, query/fragment characters, and bracketed forms cannot hide a credential-shaped value;
  - WHATWG `URL` only adds refusals.
- **Other schemes.** Userinfo is refused in every scheme (`ftp`, `ftps`, `git`, `file`, helper addresses) with one exception: a bare user name in an SSH URL (`ssh://`, `git+ssh://`, `ssh+git://`) names an account, not a secret. A password is refused even in an SSH URL. A plain scp-like `user@host:path` is accepted, but its raw bracket-aware SSH login is subject to the same credential-shaped delimiter check.
- **`url.<base>.insteadOf` rewrites.** Git rewrites the typed URL before choosing a transport, and stores the typed URL. Which rules apply depends on the repository Git runs in: conditional includes (`includeIf "gitdir:…"`, `onbranch:`, `hasconfig:remote.*.url:`) are evaluated against it. Grove does not model the rewrite; it asks Git (`git ls-remote --get-url`, local only, no network) where each network call really goes, in the context that call runs in, and applies the same rule to Git's answer. The SSH user-name exemption therefore holds only if Git's answer is still SSH. The check is made
  - at the workspace root, for the preflight `ls-remote` (the typed URL has already passed, so it is in that argv exactly as it would be in the `ls-remote` that follows);
  - in the new store, after `git remote add` and before its first fetch. A refusal there comes after the store exists, so it is a `partial` result whose `fetch` target carries reason `refused-policy` (exit `3`), with the why and remedy in the target's `detail`; the record is `conflicted`, and the remedy requires `grove reconcile --abandon <operationId>` to close it before retrying;
  - again before every later Git network call for a managed repository, because Git re-reads its configuration on each call: `repo fetch`, `sync`, and `reconcile` resuming an interrupted `repo add` (both its `ls-remote` from the workspace and its fetch from the store). A refused target reports `refused-policy` and is not fetched. A linked repository is exempt: `repo link` accepts its remotes as the user configured them (next edge case). `pushInsteadOf` is not consulted: it applies only to pushes, and Grove never pushes.
- **Credentials that come only from the user's own Git configuration** (for example `url."https://x-access-token:TOKEN@github.com/".insteadOf https://github.com/`) are refused by default for managed repository network calls. Setting `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` for one invocation permits them; an absent variable or any other value does not. The opt-in does not permit a credentialed URL directly passed to `repo add`. It is neither stored nor inherited by a later invocation. A recovery run re-resolves the retained, credential-free original URL and rechecks its current Git configuration and environment before contacting the remote. Neither a resolved credentialed URL nor a credential value is written to Grove records or results.
- **Credentialed values in errors.** A malformed subcommand, surplus positional, invalid option, or `repo link` path can carry a pasted URL. Errors in human and JSON modes redact its credential from all fields and do not retain it in operation records. An ordinary plain SSH account name remains visible when it is safe to show.
- **`repo link` of a repository whose remote already carries credentials** is accepted. Grove does not write that config and records only the preferred remote name. When `sync` reads a URL-valued `branch.<name>.remote`, it redacts the value before placing it in a result or operation record; only a value that passes the remote-name check, is listed by `git remote`, and is unchanged by remote redaction is echoed as a name. Git's own messages do not reliably hide a remote URL: with Git 2.50.1, a connection failure or an authentication failure strips `alice:SECRET@`, but a user-name-only URL is printed verbatim in `could not read Password for 'http://TOKEN@host'`. Grove does not surface that stderr: `repo fetch` and `sync` classify a failed fetch as `git-failed` and discard it (a future change that surfaces Git stderr from a linked remote must redact it). Only the file surface could reach the linked config, and only when the linked Git directory lies inside the workspace; FR-013 covers it. Refusing would reject valid Git state created outside Grove (constitution I), and warning would require Grove to read the URL it otherwise never touches.
- **A query or fragment after an SSH URL's path** (`?token=…`) is not userinfo and is not refused; results strip it (`json-results-v1`), and the store exclusion keeps the stored copy off the file surface. A `?` or `#` inside the SSH login field before its last `@` is refused as described above.
- **A Git directory Grove never registered or created** (a clone a user drops into the workspace) is ordinary workspace content. The file surface is not a secret scanner; its guarantee covers what Grove itself registered, observed, or created.

### Functional Requirements (amendment)

- **FR-009**: `repo add` MUST refuse a remote URL with userinfo, as defined in the edge cases above, in the typed URL regardless of the opt-in. By default it also refuses userinfo in Git's own answer to where the URL goes (after `insteadOf`), before any Git network call, directory creation, operation record, or config change. A credential in the typed URL is refused before any Git invocation at all; asking Git where a passed URL goes (`ls-remote --get-url`, local only) is the only Git call that may precede a root-context refusal. `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` permits credentials introduced only by Git configuration for that invocation's managed network calls. An absent variable or any other value refuses them. A refusal that only the new store's context produces is made after `git remote add` and before the store's first fetch (see the edge case). The same check MUST be repeated before every later Git network call for a managed repository, including recovery with the current environment and Git configuration. That includes `repo add`'s second, in-lock remote inspection after its first network call, and a resumed add's store fetch after its workspace remote inspection. The store and workspace contexts are resolved in the order that leaves the workspace check adjacent to its network call, with the store checked again immediately before fetch. Grove MUST NOT persist the opt-in or a resolved credentialed URL. Recovery MUST validate the retained original URL before any unfinished step can write or spend it, including `remote-add`; a directly credentialed original in a legacy record is refused regardless of opt-in, with no implicit deletion of the operation record. This covers network calls made by Git itself; it does not cover an independently configured third-party checkout filter such as Git LFS smudge.
- **FR-010**: The typed-input and root-context FR-009 refusal MUST be `invalid-input` (exit `2`), consistent with other input refusals; MUST name embedded credentials as the problem and an SSH URL, or an HTTPS URL without credentials plus a Git credential helper, as the remedy; and MUST NOT echo the userinfo or the unredacted URL in human or `--json` mode.
- **FR-011**: SSH remotes (scp-like and `ssh://user@`) and credential-free remotes MUST NOT be refused by FR-009.
- **FR-012**: `file read` and `file ls` MUST refuse any path whose resolution is, or lies inside, a repository store: each registered repository's store (a managed repository's expanded `layout.repositories` directory under any template; a linked repository's recorded common directory), each unregistered repository observed through a Tree, and the anchor of every recorded `repo add` while that path still looks like a Git directory (`objects/` and `refs/` beside a `HEAD` that is a regular file or a symlink, dangling or not, never followed; wider than Git's own test). Records are never deleted, so an anchor later replaced by an ordinary checkout is readable again. A record that no longer loads (unparseable JSON, or a shape the operation store rejects) fails closed: every `"anchor"` string its raw text still holds is protected under the same Git-directory test. A record that does load but holds a malformed step (for example `"steps": [null]`) does not fail closed: today `file ls`/`file read` stop with an internal error (exit `1`) before listing or reading anything; that crash is tracked as an open issue. The test is the same device/inode ancestor walk as FR-001, before anything is opened.
- **FR-013**: The FR-012 refusal MUST be `invalid-input` (exit `2`), name the path and the repository's Git directory, and give a remedy; `file ls` MUST omit a store from a parent listing.
- **FR-014**: Code in trunks and Trees, and every Grove- and Tree-scoped read, MUST stay readable. The `.grove` exclusion (FR-001–FR-005) is unchanged.
- **FR-015**: Add `V3SEC-05` and `V3SEC-06` after `V3SEC-04` in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md`, each cited by an executable test title; amend the `repo add` rules and the file-surface guarantees in `cli-surface-v3.md`; and add one README line recommending SSH or a credential helper and stating that credentialed URLs are refused.
- **FR-016**: Add failing witnesses before the implementation change.
- **FR-017**: Errors that echo a credentialed URL supplied as a malformed command, option, positional, or `repo link` path MUST redact its credential in every human and JSON field and MUST NOT retain it in a Grove record. Plain SSH account names remain available in ordinary non-secret output.

### Success Criteria (amendment)

- **009-file-surface-state-exclusion-SC-005**: Across every listed credentialed form, 100% of `repo add` attempts exit `2` with zero Git network calls (zero Git invocations at all when the typed URL carries the credential), zero new directories or operation records, byte-identical workspace config, and zero bytes of the credential in either output stream.
- **009-file-surface-state-exclusion-SC-006**: Across every listed route into a repository store, 100% of `file read`/`file ls` attempts refuse with exit `2` and a hand-set remote credential appears in zero bytes of output; a parent listing contains zero store entries.
- **009-file-surface-state-exclusion-SC-007**: The `V3SEC-04`, FILE-01, FILE-02, and FILE-05 witnesses pass unchanged, and trunk and Tree reads of ordinary content succeed.
- **009-file-surface-state-exclusion-SC-008**: With credentials supplied only by Git config, 100% of managed acquisition, later fetch/sync, and interrupted-add recovery attempts refuse before network by default and with any value other than `1`; value `1` reaches the configured transport. On every path the credential appears in zero bytes of Grove output and records, while typed credentialed URLs remain refused before Git runs.
- **009-file-surface-state-exclusion-SC-009**: In both output modes, 100% of malformed command, option, positional, and `repo link` path errors with credentialed URL arguments omit the credential from output and retained records.

### Assumptions (amendment)

- **Known limitation: hard links.** A hard link to a file inside `.grove` (or inside a repository store) created by the local user elsewhere in the workspace has its own directory entry, so the ancestor walk does not recognise it and the file surface reads it. Git never materialises hard links, so no checkout or Grove operation produces one; creating one takes a deliberate local action by the same user the guard is not a boundary against (see the base assumptions).
- **Known limitation: an unreadable record.** A `repo-add` record so damaged that no `"anchor"` string survives in its text cannot name its store, so that store is protected only if it is also registered or observed. `reconcile` reports the damaged record under `operationErrors`.
- A linked repository's Git directory outside the workspace is already unreachable: containment (FILE-01/FILE-02) refuses every path outside the scope.

### Follow-up (recorded, not implemented)

- Grove retains the exact remote on resumable `repo-add` operation records (`secret.remote`, `src/store/operation.ts`), scrubs it on terminal transitions, and keeps it out of the durable step plan. That machinery existed partly to protect credentialed URLs. With FR-009 no credentialed URL reaches a record, so it can be simplified later; it is left unchanged here because `reconcile` still needs the exact remote to resume, and the simplification is not required for this fix.
