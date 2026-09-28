# Research: Diagnose orphaned steal markers

## R1 — Orphan boundary

**Decision:** Report a `.steal` marker only when its own modification time is strictly older than the configured stale window, matching acquisition's `age > staleMs` reclaim predicate.

**Rationale:** The file contains an acquisition token, not a holder record. It has no host, process-start identity, or heartbeat, so a PID-shaped prefix cannot safely distinguish its creator from a reused PID or a process on another host. The protected steal section performs only local filesystem operations and has no legitimate reason to remain unchanged past the stale window. Before then, fail closed and treat it as in progress. The direct-create path is where post-acquisition cleanup does real work: it has obtained an absent lock without visiting reclaim, so it removes a pre-existing marker only after the marker passes the strict boundary. Reclaim instead applies the same predicate earlier when its exclusive intent creation sees a pre-existing marker, then removes the fresh intent marker it creates in `finally`. It needs no post-success cleanup.

**Alternatives considered:** Parse the token and probe its PID (unsafe identity inference); classify from the associated lock holder (describes the lock being stolen, not the stealer); report every marker (false positive during every legitimate stale-lock reclaim).

## R2 — Scan result shape

**Decision:** Change the scanner's result to a discriminated union: existing `stale-lock` findings retain file, holder, reason, and recovery and gain optional `stealMarker: "fresh"` when automatic reclaim is temporarily contended; `orphaned-steal-marker` findings carry marker file, associated lock file, associated-lock state (`absent`, `reclaimable`, or `held`), stable reason, and automatic recovery.

**Rationale:** The two findings have different subjects and facts. A discriminant forces the presentation layer to map each explicitly and prevents a marker from masquerading as a holder lock. The scanner remains one read of the directory and one classification authority.

**Alternatives considered:** A second scan function (duplicates directory traversal and filtering); pretend a marker is a stale lock with a null holder (loses diagnostic identity); return two arrays (larger caller change for one additional finding kind).

## R3 — Stable diagnostic identity

**Decision:** Use code `orphaned-steal-marker`, severity `info`, subject `{ kind: "lock-steal-marker", path: markerFile }`, and facts `{ lock: lockFile, lockState, reason, recovery: "automatic" }`. `lockState` is `held` when a retry cannot yet acquire the lock, `reclaimable` when acquisition can reclaim it, and `absent` when no associated lock exists. It changes the remedy and therefore the ID. A fresh marker on an automatically reclaimable stale lock adds `stealMarker: "fresh"` to that diagnostic's facts because it changes the retry remedy. Exclude mtime, observed age, and observation time.

**Rationale:** Code plus marker path distinguishes the subject. The associated lock and recovery class can change the remedy and therefore belong in facts. Volatile age would change the ID on every audit and violates `json-results-v1.md`'s exclusion of timestamps and observation facts.

**Alternatives considered:** Reuse `stale-lock` (hides the distinct obstruction); severity `policy` (automatic recovery requires no policy decision); include token/mtime (unstable and not remedy-relevant); prescribe manual removal (unnecessary and invites racing a live operation).

## R4 — Contract location

**Decision:** Add the diagnostic rule to `cli-surface-v3.md` and the witness to `acceptance-scenarios-v3.md`; rely on the existing diagnostic identity rule in `json-results-v1.md` without restating it.

**Rationale:** The CLI contract owns read-only `doctor` behaviour. The JSON contract already governs IDs, subjects, facts, remedies, and human/machine parity generically.

**Alternatives considered:** Amend `json-results-v1.md` with a code-specific shape (duplicates the CLI rule); edit the closed v2 authority (forbidden and unnecessary).

## R5 — Witness shape

**Decision:** `V3DIAG-04` creates an aged marker beside a dead same-host lock, runs `doctor` twice, asserts the exact diagnostic shape, stable ID, and no audit mutation, then proves normal mutations remove the aged marker both beside a stale lock and with no lock present. It separately creates a fresh marker, asserts zero orphan diagnostics, and proves the marker changes the stale-lock fact, identity, and 30-second remedy. Module tests pin the scan union, unreadable-lock case, and exact `staleMs`/`staleMs + 1` boundary with an injected clock. A direct-acquisition witness preserves markers aged exactly `staleMs` and `staleMs - 1` and is mutation-tested by removing its age guard in a scratch copy. A built-CLI witness proves held-state wait wording and the ID change after the lock becomes absent.

**Rationale:** One executable title covers visibility, identity, read-only behaviour, recovery, and the false-positive boundary. Using real mtimes proves the same threshold the production scanner and acquisition consume.

**Alternatives considered:** Mock the clock only (does not witness the built CLI); assert only the code (does not prove stability, remedy, or live-marker exclusion).
