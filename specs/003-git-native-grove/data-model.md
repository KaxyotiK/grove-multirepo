# Data Model: Git-native Grove

The model deliberately separates declared convention, observed Git truth, advisory state, diagnostics, and operations. Normative field-level definitions live in proposal sections 5-8 and the contracts in this package.

## Declared entities

### WorkspaceConfigV3

- `schemaVersion`: exactly 3.
- `layout`: validated managed bare repository-store, trunk-worktree, Grove, Tree, and archive templates.
- `conventions`: validated branch and Tree naming templates. Trunks use the normative readable `<branch-slug>@<repo-slug>` allocator within `layout.trunks`; no live trunk array is stored.
- `repositories`: ordered `RepositoryRegistration` values with syntactically unique stable IDs and aliases.
- `agents` and defaults: workspace-local presentation/execution preferences.

Pure config validation rejects unknown fields/versions, duplicate IDs/aliases, invalid templates, and lexical path violations without invoking Git. Repository add/link and observation separately resolve canonical common directories and refuse/diagnose duplicate Git identities. `layout.repositories` changes refuse while workspace repositories are registered; Grove/archive-root changes refuse while loose content would become undiscoverable.

### RepositoryRegistration

- Stable repository ID and presentation alias.
- Acquisition policy and anchor: managed-add derives a bare common directory from repository layout; external-link stores a canonical common-directory anchor.
- External anchors are strict UTF-8 canonical paths; `repo link` refuses a Git-resolved common directory that cannot round-trip losslessly. The anchor is intentionally path identity: a different repository later recreated at the exact same canonical path occupies that registration, while point-of-use actions still rescan current Git and revalidate the anchor.
- Preferred remote name and preferred trunk. For a linked repository the trunk is advisory and does not imply a worktree or local ref; Tree creation resolves a matching local branch first and then that preferred remote's tracking ref. Add records remote `origin`; link records `origin`, otherwise the sole remote, otherwise `null` and never guesses among multiple remotes.
- Trunk-management capability is derived from acquisition policy: managed-add permits it and external-link refuses it. A linked common directory being bare does not grant consent.

Does not contain live refs, worktrees, branch state, or trunk entries.

### CentralGroveManifest

- Stable Grove ID, display name, advisory lifecycle state, revision/hash.
- Defaults, Tree settings/order, archive recipes, and archived loose-content evidence.
- Advisory Tree keys use stable repository ID plus Tree name.

Does not prove a repository, ref, branch, path, or worktree exists.

## Observed entities

### RefName

- Canonical raw bytes.
- Ref namespace/kind when recognized.
- Escaped display form and exact JSON union: `{ encoding: "utf8", value }` or `{ encoding: "base64", value, display }`.

Identity and branch keys use raw canonical bytes; display strings never feed identity. The JSON union appears in command-specific `before`, `after`, or `detail` fixtures, and replacement-character strings never stand in for raw refs.

### NativePath

- Raw path bytes exactly as emitted by Git porcelain.
- Optional valid UTF-8 value and optional canonical UTF-8 path.
- Tagged invocation identity: `{ kind: "canonical-utf8", value }` for valid UTF-8 paths, otherwise `{ kind: "raw-unsupported", value: rawAbsoluteBytes }` using the exact absolute porcelain bytes.
- Deterministic escaped display form and exact JSON union: `{ encoding: "utf8", value }` or `{ encoding: "base64", value, display }`.

Filesystem identity never starts from replacement-character text. A non-UTF-8 native path is observable as external `unsupported-native-path`, cannot match UTF-8 layout, and is refused by Grove mutation APIs with a raw Git remedy. A valid UTF-8 path containing a newline remains valid native input, round-trips through the UTF-8 JSON arm, and receives its actual layout/conformance classification.

### ObservedRepository

- Canonical common-directory identity and available anchors.
- `registration: RepositoryRegistration | null` and `registrationStatus: "registered" | "unregistered"`; candidate repositories remain fully observable without a configured ID.
- Current local/remote refs, remotes, capabilities, and observed worktrees.

### ObservedWorktree

- Byte-preserving `NativePath` and common-directory identity.
- Role: managed repository store, trunk-layout worktree, Grove Tree, external, or unclassified. A managed store is not a worktree; there is no primary-checkout role.
- HEAD state: attached, detached, or unborn; raw branch ref when attached; nullable HEAD OID.
- Upstream, dirty, sequencer, locked, prunable, missing/corrupt, ahead/behind facts.

All fields are invocation-scoped observations, never persisted as authoritative Grove state. For a managed trunk, the registered path is conforming only when its final component is the exact readable base or a valid collision/truncation suffix for the observed local branch and repository. Historical valid v1 suffix allocations remain recognizable from observed Git worktree paths after schema-3 registration without becoming a persisted v3 live-state record or requiring a legacy ownership loader.

### ObservedWorkspace

- One bounded observation generation.
- Ordered configured and unregistered repositories.
- Observed active Groves/Trees plus central advisory entries.
- Diagnostics derived from this generation.

## Identity and selector entities

### TreeSelector

- Stable repository ID.
- Validated Tree name.

Aliases and paths are presentation/resolution input only. Missing selectors remain stale; alias reuse never rebinds them.

### Diagnostic

- Version, stable code, severity/policy class.
- Canonical subject kind/key.
- Code-specific observed and expected facts that change the remedy.
- Stable hash ID over canonical byte-preserving identity serialization.
- Human summary and actionable remedy.

State transition: observed -> unchanged on rescan; observed -> stale/disappeared when facts change; fixable -> applied only after rescan and point-of-use revalidation.

## Operation entities

### StructuralOperation

- Version, operation ID, kind, scope, creation/update timestamps, target lock keys.
- Ordered immutable target plans and steps.
- Per-step exact pre-state, recognized intermediate states, observable postcondition, current classification, and result.
- Mode-`0600` records under a mode-`0700` operation directory; resumable credential-bearing inputs stay local and are redacted from results/diagnostics.
- Canonical target ownership keys: every worktree target includes `worktree:<canonical-absolute-path>` and, when attached or planned, `repository:<stable-id>:branch:<validated-short-branch>`; Grove-scoped targets also include `grove:<name>`. Creation, removal, restore, and reconcile use the identical keys.
- Destructive directory steps persist the layout role/selector, current workspace-relative and canonical absolute paths, expected presence, and `lstat` device/inode identity when present. Recovery recomputes the current role/selector expansion and requires every field to match before recursive mutation.
- Durable operation state is distinct from command outcome: `planned -> running -> completed`; `running -> recoverable | conflicted`; `recoverable -> running` on observed resume; `conflicted -> abandoned`. A command may return the `partial` outcome whenever durable state is `recoverable` or `conflicted` after any observable side effect, but `partial` is not itself a durable operation state. (A `stale` state was declared but never assigned; it was removed 2026-09-23. A plan invalidated by observation is recorded as `conflicted` with reason `stale-plan`.)

Successful artifacts remain after failure or abandonment. There is no compensation/ref-deletion state.

### SyncObservation

- Selected targets, strategy, fetch intent/result, observed upstream/ref tips, integration result, and interruption classification.
- States: running -> complete/partial/needs-user/interrupted-observation.

An interrupted sync is closed, never replayed; a new sync begins from fresh observation.

### CommandResultV1

- Exact `schemaVersion: 1`, `command`, and `outcome` of `complete`, `partial`, `blocked`, or `needs-user`.
- Optional operation ID and exactly one ordered target entry per selected/planned target.
- Each target contains selector, before, action, nullable after, nullable stable reason, and optional detail; diagnostics are top-level.
- Optional command detail and overall exit derived from classified target failures and needs-user precedence.
- `partial` means at least one selected target is incomplete after any observable repository/ref/fetch/worktree/filesystem/advisory side effect, even when no target fully completed; `blocked` means no such side effect occurred.
- For an integration strategy, if any selected target has a native Git sequencer before the attempt or one is created during it, `outcome` is `needs-user`; a higher classified failure may change only exit precedence, never that outcome. Fetch-only records fetch evidence without local-integration dirty/sequencer gating.

## Foreign-schema boundary

### ForeignSchemaRefusal

- Encountered schema value and accepted schema value (`3`).
- Running Grove package version and resolved executable path.
- Stable config-class error classification and equivalent human/JSON facts.
- One structured emission value is the sole source for both human and JSON serialization; command handlers own neither a second human result nor direct command-output writes.
- No decoded repository, worktree, ref, claim, provenance, or operation fields from the foreign document; refusal occurs at the schema boundary before mutation.

This is an ephemeral pre-result error, not stored workspace state. There is no migration marker, plan, preservation record, or resumable publication state in schema 3.

### ArchiveSnapshot

- Version, archive timestamp, archived loose-content path, and layout revision/evidence.
- Ordered `recipes[]`, one per selected Tree and keyed by stable repository ID plus Tree identity.

### ArchiveRecipe

- Stable repository identity evidence, Tree identity, branch/ref or detached OID restoration hint, prior path, and observation evidence.

It is advisory and must be rebound through the current stable repository registration and revalidated against current Git before restore. Successful restore additionally proves the final common-directory identity, HEAD/branch, and clean status.

## Relationships

- One `WorkspaceConfigV3` declares many ordered `RepositoryRegistration` values.
- One observed repository may match exactly one registration; duplicate matches are invalid.
- One central Grove manifest may reference many Tree selectors across repositories.
- Observed worktree paths may correlate to zero or one Grove/Tree layout slot.
- Diagnostics compare declared/advisory entities with one observation generation.
- Structural operations reference canonical identities and immutable observations, never presentation aliases alone.
