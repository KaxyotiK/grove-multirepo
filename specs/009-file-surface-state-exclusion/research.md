# Research: Exclude Grove state from the file surface

## R1 — Identity, not path text

**Decision:** Decide "inside `.grove`" by comparing the device and inode of the workspace's `.grove` directory with each existing ancestor of the resolved target, from the target up to the scope root.

**Rationale:** Verified on this machine (APFS, case-insensitive): Node's `realpathSync` keeps the caller's spelling, so `.GROVE/ops/x.json` resolves to `…/.GROVE/ops/x.json` and a prefix comparison against `…/.grove` would miss it. Identity is independent of case, Unicode normalisation, `..`, and symlinks, and needs no platform branch.

**Alternatives considered:** Lower-casing the path (wrong on case-sensitive volumes, where `.GROVE` is a different directory); `realpathSync.native` (canonicalises case here, but ties correctness to a platform detail and still needs the missing-tail handling identity gets for free).

## R2 — Where the guard sits

**Decision:** A helper in `src/commands/files.ts`, called by both handlers right after `resolveContained` and before any `stat`, `readdir`, or open. It applies at every scope; Grove and Tree scopes can never reach `.grove` because `resolveContained` refuses escapes first and layout validation refuses a `.grove` segment (`src/config/layout.ts:66`).

**Rationale:** Refusing before `stat` means a missing path inside `.grove` is refused as excluded, not reported as missing, so the file surface does not disclose which state files exist.

**Alternatives considered:** Inside `resolveContained` (changes a shared primitive's contract for callers that cannot hit the case); only at workspace scope (an extra branch with no reachable difference).

## R3 — Listing omission

**Decision:** `file ls` drops any entry whose `lstat` identity equals `.grove`'s. A symlink entry that points at `.grove` is still listed by name; following it through `file read`/`file ls` is refused by R1.

**Rationale:** Omit exactly the state directory itself, by identity, so an unrelated `.GROVE` directory on a case-sensitive volume still lists.

## R4 — Refusal shape

**Decision:** `invalid-input`, exit `2`, like FILE-01. `what` is the existing handler text; `why` says the path is inside Grove's internal state directory, which is not part of the file surface; `remedy` points at workspace content and at `grove doctor` for Grove's own state. `detail` carries the requested path only.

## R5 — Witness fixture

**Decision:** Produce a real pending `repo-add` by failing its fetch with the existing test-only Git gate (the `V3OPS-04` pattern), assert the record on disk does retain the remote (so the test cannot pass vacuously), then assert every route refuses and the remote appears in neither output stream.

## R6 — Refuse credentialed remotes rather than redact them (amendment)

**Decision:** `repo add` refuses a remote URL with userinfo before any Git invocation.

**Rationale:** Git stores the URL passed to `git remote add` verbatim in the repository config, a file Git owns; Grove's result redaction cannot reach it, and rewriting it would contradict constitution I. Refusing at input is the only point where Grove controls the value. The owner ruled that credentials in remote URLs are unsupported; SSH or a credential helper is the supported path.

**Alternatives considered:** Strip userinfo before `git remote add` (silently changes what the user asked for and breaks authentication without saying why); configure a credential helper from the URL (writes a secret somewhere else Grove owns).

## R7 — Which userinfo is a credential

**Decision:** Any userinfo in any scheme is refused, except a bare user name in `ssh://`, `git+ssh://`, or `ssh+git://`. A `<transport>::<address>` form is judged by its address. scp-like `user@host:path` and local paths have no URL userinfo.

**Rationale:** In curl-backed transports (`http`, `https`, `ftp`, `ftps`) the user-name slot is sent as authentication, and GitHub accepts a token there, so `https://TOKEN@host` must be refused as firmly as `user:TOKEN@`. `git://` has no authentication, so userinfo there is at best meaningless and at worst a pasted token. An SSH user name (`git@`) is an account, and SSH never takes a password from the URL, so an SSH URL carrying one is still refused.

**Principle (round-3 review): find the authority as Git and curl do, not as WHATWG does.** Git's `credential_from_url` ends the authority at `strcspn(cp, "/?#")`, and curl does the same, so every other character, including a backslash, belongs to it. WHATWG treats `\` as `/` in special schemes, so it reads `http://TOKEN\@host` as host `token` while Git and curl send `TOKEN` as the user name. Two bypasses followed from trusting the wrong reading, both verified against a local `git http-backend` (Git 2.50.1, curl 8.7.1): `http:///TOKEN:pw@host/x.git` (round 2) and `http://TOKEN:pw\@host/x.git` (round 3, which also made `redactRemote` print the token as a WHATWG host). The rule now is:

- **Primary parse, Git's:** a scheme, then two or more forward slashes, then the authority up to the first `/`, `?`, or `#`; userinfo is what precedes the last `@` in it. curl accepts one to three slashes after the scheme and rejects four or more; one slash never reaches curl, because Git reads `host:/path` as scp-like SSH, so the parse starts at two (refusing four or more is harmless). For `file:`, three slashes mean an empty host and a path.
- **Helper prefixes (rounds 4-5):** every leading `<transport>::` is stripped, not only the first (`a::b::c::http://TOKEN@h/x`), and a helper address that is not URL-shaped by the rule above is scheme-guessed by curl, so an `@` before its first `/`, `?`, or `#` is userinfo (`http::TOKEN@host/x` reached `git ls-remote` with the token in argv). Round 5: the test is "not URL-shaped", not "contains no `://`", because `http::TOKEN@host/x.git/a://../..` and `…/x.git?u=http://y` carry `://` later and still reached the network with TOKEN as the user. `ext::<command>` addresses that name `user@host` are refused by the same rule; `ext::` is disabled by default in Git (`protocol.ext.allow=never`), so the false positive is accepted.
- **SSH host/login parsing (rounds 5–8):** Git percent-decodes only a `scheme://` SSH URL before it splits host and path; scp-like input is parsed raw. Git selects the bracketed host field by looking for the first `@[` and then, only if it is absent, a leading `[`. It skips slashes inside a bracketed host field and takes the login through the last `@` in the field. Thus `%3A` and `%40` can create URL delimiters before parsing, while `%HH` in scp-like input stays literal; and `[x]@[git:TOKEN/@host]:path` passes `[x]@git:TOKEN/` as the SSH login. A resulting login containing `:`, `?`, or `#` is refused. Redaction treats an SSH value as plain only when the URL/scp and SSH-transport readings agree; a scp-like plain echo additionally has exactly one `@` and no brackets except an IPv6 literal host, so encoded, multi-login, or bracket-disguised values are masked whole.
- **`insteadOf`: Git's own answer, in the right repository (rounds 4-5):** Git applies `url.<base>.insteadOf` to the typed URL before choosing a transport and stores the typed URL, so `web:TOKEN:pw@host/x` with `url."http://".insteadOf web:`, or `ssh://TOKEN@host/x` with `url."http://".insteadOf ssh://`, went out as HTTP Basic auth. Round 4 read the rules with `git config --get-regexp` at the workspace root and modelled the rewrite. That was wrong twice: conditional includes (`includeIf "gitdir:…"`, `onbranch:`, `hasconfig:`) are evaluated against the repository Git runs in, so a rule that applies only inside the store was invisible at the root; and Git orders equal-length prefixes by base in first-appearance order, which the model did not. Round 5 asks Git instead: `git ls-remote --get-url -- <remote>` (local only, no network) in the context of each network call: at the workspace root for the preflight `ls-remote`, in the store before its first fetch, and before every later fetch of a managed repository (`repo fetch`, `sync`, the `reconcile` resume). At the root the typed URL, which has already passed the check, is in that argv exactly as it would be in the `ls-remote` that follows, so the round-4 objection to argv does not hold. Git's stderr from the resolution is never quoted: a malformed `GIT_CONFIG_KEY_n` that holds a credential is echoed in it. `pushInsteadOf` is not consulted: Grove never pushes.
- **WHATWG `URL`, an extra refuser only:** a non-empty `username` or `password` also refuses, under the same SSH exception. It never accepts anything the primary parse refuses.
- **Redaction follows the same rule:** a value whose Git-style authority contains `@`, that holds a backslash or control character anywhere, or whose opaque or helper form carries an `@` renders as `<redacted-remote>` rather than being rewritten through WHATWG. The exception (round 4): a plain SSH remote that passes the check (`ssh://git@host/x`, `git@host:x`) is echoed verbatim, user name included, because FR-011 treats that user name as an account and Git stores the remote as typed. Round 5: an `ssh://` URL still loses its query and fragment, like every parsed URL; scp-like `user@host:path` is not a URL, so a `?` or `#` there is part of the path and stays. Rounds 7–8: encoded URL delimiters and Git's exact bracket precedence are applied before this exemption is granted; a scp-like exemption requires exactly one `@` and permits brackets only around an IPv6 literal host.

**Alternatives considered:** Refuse only `http(s)` (leaves the same token pasteable into `ftp://`/`git://`).

## R8 — Refusal shape

**Decision:** `invalid-input`, exit `2`, like every other argument refusal and like FILE-01. `why` names the scheme and whether a password is present, never the value; `remedy` names an SSH URL or an HTTPS URL plus a credential helper (macOS Keychain, `gh auth setup-git`); `detail` carries only the rule. The check runs before name derivation and before the capability probe, so no Git process sees the credential.

## R9 — Which directories are repository stores

**Decision:** The observed workspace's repositories (`anchorPath` and `commonGitDir`, which cover a managed store at its expanded `layout.repositories` path under any template, a linked repository's recorded Git directory, and unregistered repositories observed through a Tree), plus the `repository-init-bare` anchor of every `repo-add` operation record in any state.

**Rationale:** A template such as `{repo}` or `vault/{repo}/.bare` rules out matching by layout pattern: `{repo}` would match every top-level directory, including `groves` and `trunks`. Exact identities of known stores are unambiguous. The operation records add the one store Grove creates that may be registered nowhere — an interrupted or abandoned acquisition, which keeps its bare repository.

**Alternatives considered:** Refuse any directory that looks like a Git directory (`HEAD`, `objects/`, `refs/`) — broader, but it would also hide bare-repository fixtures committed inside Trees, and its guarantee would rest on a heuristic; exclude the whole static parent (`repos/`) — impossible for a template with no static parent.

## R10 — `repo link` of an already-credentialed repository

**Decision:** Accept. See the spec's amendment edge cases.

**Rationale:** Grove does not write a linked repository's config and records only the remote name; the file surface is the only Grove output that could print the URL, and R9 covers an in-workspace linked Git directory. Refusing would reject valid Git state created outside Grove (constitution I). A warning would require Grove to read a URL it otherwise never touches.

## R11 — Per-invocation Git-config credential opt-in

**Decision:** Keep the direct `repo add` URL check unconditional. When Git's local `ls-remote --get-url` answer contains credentials introduced through Git configuration, permit a managed network call only if `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS` is exactly `1` in that invocation. Check it at each call, including recovery; retain only the original credential-free input.

**Rationale:** Git owns `insteadOf` resolution, including conditional includes and later edits. A workspace setting or cached answer would make a later recovery inherit consent that the caller did not give. A directly supplied credentialed URL would be written into the managed store and is therefore still refused before Git sees it. The opt-in allows existing user Git configuration without copying its resolved credential into Grove state.

## R12 — Credentialed argv in errors

**Decision:** Redact credentialed URL argv tokens throughout a failing error envelope, including nested JSON detail; suppress Git stderr and normalized filesystem spellings on a failed `repo link` path. Successful result rendering and ordinary plain SSH account output keep their existing rules.

**Rationale:** Parser messages, unknown-command text, surplus positional detail, and `repo link` errors can repeat the original argument through different fields. Applying the same redaction at error presentation catches every such field, while the link boundary must also avoid a normalized path that no longer equals the original argv token. A fixed Git failure reason avoids quoting untrusted stderr.

## R13 — Recheck after an earlier network call

**Decision:** Treat each managed Git network invocation as a separate destination check. `repo add` re-resolves the workspace URL before its second, in-lock `ls-remote`; resumed acquisition resolves the store first and the workspace immediately before its `ls-remote`, then re-resolves the store after that inspection and before fetching.

**Rationale:** Git config can change while a prior `ls-remote` runs. A previous successful check does not authorize the next Git process, even in the same Grove invocation. Local `ls-remote --get-url` checks use the relevant Git context; neither the resolved credential nor Git stderr is retained. `repo fetch` and `sync` have one managed fetch per selected target and already check its destination before that fetch; linked targets retain their documented exemption.

## R14 — Legacy directly credentialed recovery records

**Decision:** Before resuming any unfinished `repo-add` step, validate its retained original URL under the unconditional direct-input credential rule. Refuse a credentialed original even with `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1`, mark the step conflicted, scrub its retained secret, and leave the operation record for explicit abandon.

**Rationale:** Older records can contain input that current `repo add` rejects. A check of Git's resolved destination alone cannot distinguish those inputs from credentials introduced by a Git config rewrite. At the `remote-add` boundary, the old URL could be written to managed Git config before a later fetch refuses; at the `fetch` boundary, opt-in could allow a network request with the directly supplied secret. The guard runs before either Git invocation and does not perform implicit cleanup of historical Git state.
