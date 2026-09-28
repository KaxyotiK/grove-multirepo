# Research: Crash recovery witnesses

## R1 — Boundary mechanism

**Decision:** Prepend a fixture directory containing a `git` proxy to the child `PATH`. The proxy delegates to the resolved real Git binary, and for one exact argument signature writes a post-mutation sentinel then blocks.

**Rationale:** This creates the required window without modifying production code or simulating Git.

**Alternatives considered:** Production fault environment variable (ships a dangerous hook); timing sleep and blind kill (vacuous/flaky); mocked unit runner (does not prove built CLI state).

## R2 — Process cleanup

**Decision:** Spawn the CLI in its own POSIX process group and kill the group after the sentinel. Always reap and remove sentinels in `finally`.

**Rationale:** Killing only the Node parent can strand the blocking proxy.

## R3 — Non-vacuity

**Decision:** Assert the real Git mutation's expected filesystem effect and the pre-recorded journal step both exist before killing. Timeout if the sentinel is absent.

**Rationale:** A green test must prove it reached post-mutation/pre-acknowledgement, not merely that reconcile works on an earlier interruption.

## R4 — Outcome assertion

**Decision:** After reconcile, validate lifecycle location, every recorded Tree worktree/branch, loose file preservation, empty pending journals, and no live lock/process.

**Rationale:** Exit zero alone can coexist with split-brain state.
