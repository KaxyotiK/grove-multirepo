# Research: Repository default policy

**Date:** 2026-08-20  
**Authority:** §4, §8.4, §8.4.1, §11; constitution Principles III and V

## R1 — Store intent, derive remote state

**Decision:** Replace `RepositoryEntry.trunk` with `defaultBranch: string | null`. A non-null value is only an explicit user override. When null, derive the branch from the selected remote's cached symbolic HEAD. Never persist a remote-derived branch.

**Rationale:** The old field copied mutable Git state and immediately drifted for linked checkouts. An override is user intent and therefore belongs in Grove; remote HEAD is Git state and belongs in Git.

**Alternatives considered:** Keep the snapshot (rejected: P0-8); follow linked checkout HEAD (rejected: current checkout is not a repository default); store a Tree-level fallback (rejected: no legacy preservation and a second source of truth).

## R2 — Use one local resolver

**Decision:** One async resolver accepts the Git adapter, workspace root, and repository. It returns `{ branch, source: "override" | "remote" }` after verifying the local branch ref. Resolution is `defaultBranch` → `refs/remotes/<remote>/HEAD` → typed exit-5 refusal.

**Rationale:** A chokepoint makes the rule testable. Verifying the local branch keeps existing §8.7 comparison and branch-creation semantics, which operate on local refs.

**Alternatives considered:** Let each handler derive a base (rejected: the defect was divergent derivation); return the remote-tracking ref itself (rejected: the contract defines local comparison branches); query the hosting remote (rejected: offline requirement).

## R3 — Seed managed cached HEAD at clone time

**Decision:** `repo add` may read the newly cloned bare store's symbolic HEAD because clone has just set it from the remote. It seeds `refs/remotes/origin/HEAD` inside Grove's managed store, then uses the same resolver as linked mode. Later resolution never uses bare or checkout HEAD.

**Rationale:** A bare repository does not reliably materialize `refs/remotes/origin/HEAD` after adding a fetch refspec. Seeding Git-owned cached metadata during the already-networked clone keeps subsequent resolution uniform and offline.

**Alternatives considered:** Special-case managed resolution forever (rejected: violates parity); run `git remote set-head --auto` later (rejected: network access); store clone HEAD in config (rejected: duplicates Git state).

## R4 — Store the selected remote name, not its URL

**Decision:** `RepositoryEntry.remote` is `"origin"`, another explicit Git remote name, or null. `repo add` selects `origin`; `repo link` selects `origin` when it exists unless `--remote` names another local remote. Fetch, tracking, sync, and remote-branch checks use that name.

**Rationale:** URLs are live Git configuration and may change. Grove needs only policy selecting one remote when several exist.

**Alternatives considered:** Store URL (rejected: stale snapshot); infer the only remote (rejected: guessing); always hardcode origin (rejected: makes `repo configure --remote` inert).

## R5 — Configuration is local, atomic policy editing

**Decision:** `repo configure` supports paired set/clear options for `defaultBranch` and `remote`. It validates branch syntax/local existence and remote-name existence, performs no fetch, allows a valid configuration with no currently effective default, and writes once under the workspace lock.

**Rationale:** Clearing policy must work offline and may intentionally leave a local-only repository without a default. Refusal belongs to the later operation that actually requires one.

**Alternatives considered:** Require remote HEAD during configure (rejected: prevents clearing and offline correction); modify Git remotes (rejected: outside Grove policy ownership); remove/re-link (rejected: blocked by existing Grove references).

## R6 — No legacy transition

**Decision:** Increment the shared manifest schema version to 2, update all writers/fixtures, and reject schema version 1. Add no migration, compatibility keys, aliases, or backfill.

**Rationale:** The constitution forbids migration/adoption, and the user confirmed there is no adopted installation to preserve.

**Alternatives considered:** Accept both shapes (rejected: two authorities); rewrite on load (rejected: forbidden migration); retain an unused `trunk` key (rejected: unknown-key discipline).

## R7 — Linked trunk warning is part of success output

**Decision:** Successful `trunk add` for a linked repository includes a structured warning object with a stable kind, branch, and message. Human output appends a `Warning:` line. Managed success has no warning field.

**Rationale:** The warning is operation-specific and must survive JSON mode without contaminating JSON stdout or relying on prose-only stderr.

**Alternatives considered:** Help-only warning (rejected: too far from the conflicting action); stderr prose in JSON mode (rejected: not structured); refuse linked trunks (rejected by D4).

## R8 — Remove configured-trunk worktree coupling

**Decision:** `trunk remove` protects dirty work but no longer refuses merely because its branch is the effective repository default: trunk entries are worktrees, not default policy. `repo delete-branch` still refuses the current effective default because deleting that local ref makes default-dependent operations unusable.

**Rationale:** Removing a trunk worktree retains its branch; deleting the branch does not. The guards must follow what each operation changes.

**Alternatives considered:** Preserve both old guards (rejected: continues conflation); remove both (rejected: permits deletion of the required local default ref).
