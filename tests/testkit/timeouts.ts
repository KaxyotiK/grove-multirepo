/**
 * Reaching a fault boundary includes process startup and all preceding Grove/Git work. This is
 * a deadlock guard, not a latency assertion: allow contention at the suite's default concurrency.
 * The waiters still fail immediately when the process exits before reaching its boundary.
 */
export const BOUNDARY_READY_TIMEOUT_MS = 60_000;
