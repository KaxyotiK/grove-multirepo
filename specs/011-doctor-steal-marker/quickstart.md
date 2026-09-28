# Quickstart: Diagnose orphaned steal markers

Run after `npm run build` in an initialised workspace.

## 1. Aged orphan

Place a stale lock at `.grove/locks/op-workspace.lock`, create `.grove/locks/op-workspace.lock.steal`, and set the marker's modification time to more than 30 seconds ago. Run:

```bash
node dist/grove.mjs --json doctor
```

Expected: one `orphaned-steal-marker` info diagnostic naming both files, `automatic` recovery, and a retry remedy. Running the command again returns the same ID. Both files remain byte-for-byte and mtime unchanged.

## 2. Automatic recovery with no lock

Remove `op-workspace.lock` but leave the aged marker, then run a mutation that needs that lock.

Expected: direct acquisition removes the aged marker before returning and proceeds. A following `doctor` reports no orphan. Reclaim handles a pre-existing aged marker earlier, while contending for the intent file, and removes the fresh marker it creates in `finally`.

At the injected-clock boundary, direct acquisition preserves a marker aged exactly `staleMs` and one aged `staleMs - 1`; changing the cleanup to unconditional deletion must fail this witness.

## 3. Fresh in-progress marker

Recreate the marker with a current mtime and run `doctor` immediately.

Expected: zero `orphaned-steal-marker` diagnostics. If a same-host reclaimable lock is present, `stale-lock` contains `stealMarker: "fresh"`, has a distinct ID from the unblocked finding, and says another reclaim is in progress or was interrupted and to retry after the 30-second stale window.

Use the injected clock in the module witness to confirm exactly `staleMs` is fresh and `staleMs + 1` is orphaned, including a fresh marker beside an aged unreadable lock.

## 4. Aged marker beside a healthy holder

Place an aged marker beside a healthy same-host lock and run `doctor`, then remove only the lock and run `doctor` again.

Expected: both audits leave the marker unchanged. The first orphan has `lockState: "held"` and says to wait for or resolve the holder before retrying. The second has `lockState: "absent"`, permits an immediate retry, and has a different ID.

## 5. Gates

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```

Then create the npm package, install it under an isolated temporary prefix, and run the installed `grove --version`.
