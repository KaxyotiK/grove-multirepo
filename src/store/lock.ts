/**
 * The lock primitive (§6), used by every mutation.
 *
 * `O_EXCL`, not `mkdir` — one atomic syscall, so two waiters cannot both "win". Stale reclaim
 * goes through `rename()`, which is also atomic, gated behind its own `O_EXCL` intent file so
 * two stealers cannot both replace the lock. A live owner is never stolen.
 *
 * The lock's adjudication domain is a SINGLE MACHINE (by hardware UUID when available, otherwise
 * the legacy hostname). Same-machine holders are reclaimed when their
 * process is dead (fast path) or their heartbeat has frozen past `staleMs` (backstop for PID
 * reuse — a recycled PID looks alive forever, its heartbeat does not). A holder on a DIFFERENT
 * machine is never reclaimed automatically: cross-host clock skew and NFS attribute caching make
 * staleness untrustworthy, and worktrees are host-local anyway; the timeout refusal names the
 * remote holder so a human can delete the lock file if that machine is truly gone.
 *
 * `withLock` keeps the holder's heartbeat fresh while `fn` runs. Git operations are awaited
 * async spawns (src/git/adapter.ts), so the event loop is idle while they run and the pump's
 * timer fires; a live long-running op therefore never looks stale to a same-host waiter.
 */
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { GroveError } from "../errors.ts";

export interface HolderRecord {
  token: string;
  pid: number;
  host: string;
  machineId?: string;
  startedAt: number;
  heartbeatAt: number;
  op: string;
}

export interface LockOptions {
  /** How long a holder may go without a heartbeat before it is reclaimable. */
  staleMs?: number;
  /** Total time to wait for contention before refusing (§6: up to 5s for mutations). */
  timeoutMs?: number;
  /** How often `withLock` refreshes the heartbeat. Defaults to `staleMs / 3`. */
  heartbeatMs?: number;
  op?: string;
  now?: () => number;
  isPidAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Test seams for identity classification; production uses the Mac identity and hostname. */
  machineId?: () => string | null;
  host?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let cachedMachineId: string | null | undefined;

function localMachineId(): string | null {
  if (cachedMachineId !== undefined) return cachedMachineId;
  try {
    const result = spawnSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
      encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const matches = result.status === 0
      ? [...result.stdout.matchAll(/^\s*"IOPlatformUUID"\s*=\s*"([^"]+)"\s*$/gm)]
      : [];
    cachedMachineId = matches.length === 1 && UUID.test(matches[0]![1]!)
      ? matches[0]![1]!.toLowerCase()
      : null;
  } catch {
    cachedMachineId = null;
  }
  return cachedMachineId;
}

function machineIdFor(opts: Pick<LockOptions, "machineId">): string | null {
  const value = opts.machineId ? opts.machineId() : localMachineId();
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

function sameMachine(holder: HolderRecord, host: string, machineId: string | null): boolean {
  return machineId && typeof holder.machineId === "string" && UUID.test(holder.machineId)
    ? holder.machineId.toLowerCase() === machineId
    : holder.host === host;
}

export const DEFAULT_STALE_MS = 30_000;
/** §6: a mutation blocked by a held lock waits up to 5 seconds, then exits 4. */
export const DEFAULT_TIMEOUT_MS = 5_000;

const defaultPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

// `kill(pid, 0)` alone is vulnerable to PID reuse: a dead writer's number can belong to a new,
// unrelated process, making its lock look live. Record and compare the owning process's actual
// start time as §6 requires. If `ps` cannot answer, fail closed rather than stealing blindly.
const THIS_PROCESS_STARTED_AT = Math.floor((Date.now() - process.uptime() * 1_000) / 1_000) * 1_000;

function processStartedAt(pid: number): number | null {
  if (pid === process.pid) return THIS_PROCESS_STARTED_AT;
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    timeout: 1_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const value = Date.parse(result.stdout.trim());
  return Number.isFinite(value) ? Math.floor(value / 1_000) * 1_000 : null;
}

function defaultHolderAlive(holder: HolderRecord): boolean {
  if (!defaultPidAlive(holder.pid)) return false;
  const observed = processStartedAt(holder.pid);
  return observed === null || Math.abs(observed - holder.startedAt) < 1_500;
}

export interface Held {
  path: string;
  token: string;
  heartbeat(): void;
  release(): void;
}

function readHolder(path: string): HolderRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HolderRecord;
  } catch {
    // Missing, or caught mid-write. An unreadable record is treated as FRESH: refusing to
    // steal something we cannot read is the safe direction.
    return null;
  }
}

export interface StaleLock {
  kind: "stale-lock";
  file: string;
  holder: HolderRecord | null;
  reason: string;
  recovery: "automatic" | "manual";
  stealMarker?: "fresh";
}

export interface OrphanedStealMarker {
  kind: "orphaned-steal-marker";
  file: string;
  lock: string;
  lockState: "absent" | "reclaimable" | "held";
  reason: string;
  recovery: "automatic";
}

export type LockAuditFinding = StaleLock | OrphanedStealMarker;

function stealMarkerIsAged(path: string, observedAt: number, staleMs: number): boolean {
  return observedAt - Number(statSync(path).mtimeMs) > staleMs;
}

/**
 * Report stale lock files and orphaned steal markers, classifying whether the next mutation will
 * reclaim them automatically. Cross-host locks require manual action; dead/frozen same-host
 * holders, aged unreadable records, and aged steal markers use the same age rules as `acquire`.
 * A live same-host holder with a fresh heartbeat is not reported. A marker within the stale window
 * is not reported as orphaned, but it annotates an automatically reclaimable lock because it can
 * temporarily block the recovery advertised for that lock.
 */
export function scanStaleLocks(
  locksDirPath: string,
  opts: Pick<LockOptions, "now" | "isPidAlive" | "staleMs" | "machineId" | "host"> = {},
): LockAuditFinding[] {
  const now = opts.now ?? (() => Date.now());
  const holderAlive = opts.isPidAlive
    ? (holder: HolderRecord) => opts.isPidAlive!(holder.pid)
    : defaultHolderAlive;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const host = opts.host?.() ?? hostname();
  let files: string[];
  try {
    files = readdirSync(locksDirPath).filter((f) => !f.endsWith(".tmp"));
  } catch {
    return []; // no locks/ directory — nothing held
  }
  const fileSet = new Set(files);
  const stealMarkers = new Map<string, "fresh" | "orphaned">();
  for (const f of files) {
    if (!f.endsWith(".steal")) continue;
    try {
      stealMarkers.set(
        f,
        stealMarkerIsAged(join(locksDirPath, f), now(), staleMs) ? "orphaned" : "fresh",
      );
    } catch {
      /* vanished — omit it from this audit */
    }
  }
  const out: LockAuditFinding[] = [];
  const lockClassifications = new Map<string, {
    state: OrphanedStealMarker["lockState"];
    finding: StaleLock | null;
  }>();
  const classifyLock = (file: string): {
    state: OrphanedStealMarker["lockState"];
    finding: StaleLock | null;
  } => {
    const cached = lockClassifications.get(file);
    if (cached) return cached;
    const path = join(locksDirPath, file);
    const holder = readHolder(path);
    let classification: {
      state: OrphanedStealMarker["lockState"];
      finding: StaleLock | null;
    };
    if (holder === null) {
      try {
        classification = now() - statSync(path).mtimeMs > staleMs
          ? {
              state: "reclaimable",
              finding: { kind: "stale-lock", file, holder, reason: "record is unreadable and has not been touched past the stale window", recovery: "automatic" },
            }
          : { state: "held", finding: null };
      } catch {
        classification = { state: "absent", finding: null };
      }
    } else if (!sameMachine(holder, host, machineIdFor(opts))) {
      classification = {
        state: "held",
        finding: { kind: "stale-lock", file, holder, reason: `held from another host (${holder.host}); cross-host locks are never reclaimed automatically`, recovery: "manual" },
      };
    } else if (!holderAlive(holder)) {
      classification = {
        state: "reclaimable",
        finding: { kind: "stale-lock", file, holder, reason: `holder pid ${holder.pid} and recorded process start no longer identify a live process`, recovery: "automatic" },
      };
    } else if (now() - holder.heartbeatAt > staleMs) {
      classification = {
        state: "reclaimable",
        finding: { kind: "stale-lock", file, holder, reason: "the holder's heartbeat has frozen past the stale window", recovery: "automatic" },
      };
    } else {
      classification = { state: "held", finding: null };
    }
    lockClassifications.set(file, classification);
    return classification;
  };
  const pushStaleLock = (finding: StaleLock): void => {
    if (
      finding.recovery === "automatic" &&
      stealMarkers.get(`${finding.file}.steal`) === "fresh"
    ) {
      out.push({ ...finding, stealMarker: "fresh" });
      return;
    }
    out.push(finding);
  };
  for (const f of files) {
    if (f.endsWith(".steal")) {
      if (stealMarkers.get(f) === "orphaned") {
        const lock = f.slice(0, -".steal".length);
        const lockState = !lock.endsWith(".steal") && fileSet.has(lock)
          ? classifyLock(lock).state
          : "absent";
        out.push({
          kind: "orphaned-steal-marker",
          file: f,
          lock,
          lockState,
          reason: "steal marker has not been touched past the stale window",
          recovery: "automatic",
        });
      }
      continue;
    }
    const finding = classifyLock(f).finding;
    if (finding) pushStaleLock(finding);
  }
  return out;
}

export async function acquire(lockPath: string, opts: LockOptions = {}): Promise<Held> {
  // The lock owns its own directory, so a first-ever command need not pre-create locks/.
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new GroveError({
      kind: "io",
      what: `Cannot create the lock directory for ${lockPath}`,
      why: `${code ?? "unknown error"} while creating ${dirname(lockPath)}`,
      remedy: "Check the parent directory is writable and the disk is not full.",
      detail: { lockPath, code },
      cause: e,
    });
  }

  const now = opts.now ?? (() => Date.now());
  const identityCache = new Map<string, boolean>();
  const holderAlive = opts.isPidAlive
    ? (holder: HolderRecord) => opts.isPidAlive!(holder.pid)
    : (holder: HolderRecord) => {
        const key = `${holder.pid}:${holder.startedAt}`;
        const cached = identityCache.get(key);
        if (cached !== undefined) return cached;
        const alive = defaultHolderAlive(holder);
        identityCache.set(key, alive);
        return alive;
      };
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const deadline = now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const host = opts.host?.() ?? hostname();
  const machineId = machineIdFor(opts);
  const token = `${process.pid}-${now()}-${Math.random().toString(36).slice(2, 10)}`;

  // A direct O_EXCL success never visits the reclaim branch, so it must clear an aged marker left
  // from an earlier operation. Reclaim handles a pre-existing marker while contending for its
  // intent file and removes the marker it creates in `finally`; it does not use this cleanup.
  const cleanupAgedStealMarker = (): void => {
    const intent = `${lockPath}.steal`;
    try {
      if (stealMarkerIsAged(intent, now(), staleMs)) unlinkSync(intent);
    } catch {
      /* absent, fresh, or raced away */
    }
  };

  const record = (): HolderRecord => ({
    token,
    pid: process.pid,
    host,
    ...(machineId ? { machineId } : {}),
    startedAt: THIS_PROCESS_STARTED_AT,
    heartbeatAt: now(),
    op: opts.op ?? "unspecified",
  });

  const held = (): Held => ({
    path: lockPath,
    token,
    heartbeat() {
      try {
        const fd = openSync(lockPath, "r+");
        const cur = readHolder(lockPath);
        if (cur?.token === token) {
          // Truncate first so a shrinking record cannot leave trailing garbage. If a stealer
          // renamed a new lock in between, this fd points at the replaced inode: harmless.
          ftruncateSync(fd, 0);
          writeSync(fd, JSON.stringify({ ...cur, heartbeatAt: now() }), 0, "utf8");
        }
        closeSync(fd);
      } catch {
        /* a lost heartbeat is not fatal; staleness will be re-evaluated */
      }
    },
    release() {
      if (readHolder(lockPath)?.token === token) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      }
    },
  });

  for (;;) {
    try {
      const fd = openSync(lockPath, "wx"); // O_CREAT | O_EXCL | O_WRONLY — one syscall
      writeSync(fd, JSON.stringify(record()), 0, "utf8");
      closeSync(fd);
      cleanupAgedStealMarker();
      return held();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw new GroveError({
          kind: "io",
          what: `Cannot take the lock at ${lockPath}`,
          why: `${code ?? "unknown error"} while creating the lock file`,
          remedy: "Check the directory exists, is writable, and the disk is not full.",
          detail: { lockPath, code },
          cause: e,
        });
      }
    }

    const holder = readHolder(lockPath);
    let reclaimable = false;
    if (holder === null) {
      // The file exists (O_EXCL said EEXIST) but the record is unreadable — corrupt, or caught
      // mid-write. Age it by file mtime, which a live holder's heartbeat keeps fresh: a
      // fresh-but-unreadable record stays safe, and a corrupt husk cannot wedge the workspace.
      try {
        reclaimable = now() - statSync(lockPath).mtimeMs > staleMs;
      } catch {
        /* vanished between open and stat — loop and retry the O_EXCL create */
      }
    } else if (sameMachine(holder, host, machineId)) {
      // Same machine — the only domain we adjudicate. A dead PID is the fast path; a frozen
      // heartbeat is the backstop for PID reuse, where a recycled PID stays "alive" forever.
      reclaimable = !holderAlive(holder) || now() - holder.heartbeatAt > staleMs;
    }
    // A holder on a different host is NEVER auto-reclaimed; see the module doc.

    if (reclaimable) {
      const intent = `${lockPath}.steal`;
      let gotIntent = false;
      try {
        const ifd = openSync(intent, "wx");
        writeSync(ifd, token, 0, "utf8");
        closeSync(ifd);
        gotIntent = true;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw new GroveError({
            kind: "io",
            what: `Cannot reclaim the lock at ${lockPath}`,
            why: `${code ?? "unknown error"} while creating the steal marker`,
            remedy: "Check the directory is writable and the disk is not full.",
            detail: { lockPath, code },
            cause: e,
          });
        }
        try {
          if (stealMarkerIsAged(intent, now(), staleMs)) unlinkSync(intent);
        } catch {
          /* raced away */
        }
      }

      if (gotIntent) {
        let reclaimed = false;
        try {
          // Re-check under the intent file, with the SAME predicate as above.
          const fresh = readHolder(lockPath);
          let stillReclaimable: boolean;
          if (fresh === null) {
            try {
              stillReclaimable = now() - statSync(lockPath).mtimeMs > staleMs;
            } catch {
              stillReclaimable = true; // gone entirely — the rename below simply creates it
            }
          } else {
            stillReclaimable =
              sameMachine(fresh, host, machineId) &&
              (!holderAlive(fresh) || now() - fresh.heartbeatAt > staleMs);
          }
          if (stillReclaimable) {
            const temp = join(dirname(lockPath), `.lock.${token}.tmp`);
            const fd = openSync(temp, "wx");
            writeSync(fd, JSON.stringify(record()), 0, "utf8");
            closeSync(fd);
            renameSync(temp, lockPath);
            reclaimed = true;
          }
        } finally {
          try {
            unlinkSync(intent);
          } catch {
            /* already gone */
          }
        }
        if (reclaimed) {
          return held();
        }
      }
      // Fall through to the SAME deadline check as the held-and-live path. `continue`ing here put
      // the reclaim path outside its own `timeoutMs`: a contended reclaim (a `.steal` marker left
      // behind by a SIGKILL between its creation and the `finally` that unlinks it) spun until the
      // marker aged out at `staleMs` — 30s against a declared 5s budget — instead of refusing at
      // exit 4 as safety.md §"waits up to 5 seconds for release" requires.
    }

    if (now() >= deadline) {
      throw new GroveError({
        kind: "refused-conflict",
        what: "Another operation holds this lock",
        why: holder
          ? `held by pid ${holder.pid} on ${holder.host} since ${new Date(holder.startedAt).toISOString()} (${holder.op})`
          : "the lock is held by an unidentified process",
        remedy:
          holder && !sameMachine(holder, host, machineId)
            ? `Wait for it to finish. Locks held from another host are never reclaimed automatically; if ${holder.host} is truly gone, delete ${lockPath} by hand.`
            : "Wait for it to finish, or re-run once the other operation completes.",
        detail: { lockPath, holder },
      });
    }
    await sleep(10);
  }
}

/** A real-clock sleep whose timer never holds the process open after release. */
const unrefSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });

/**
 * Run `fn` under the lock, releasing it whatever happens.
 *
 * While `fn` runs, a pump refreshes the holder's heartbeat every `heartbeatMs` (default
 * `staleMs / 3`) so an op that legitimately outlives `staleMs` — a huge repo, a slow disk —
 * is never mistaken for a crashed one by a same-host waiter. The pump's wake-ups only fire
 * when the event loop is free; that holds for this workload because every git call is an
 * awaited async spawn. A long SYNCHRONOUS block would starve the pump — do not introduce
 * `spawnSync`-style git calls inside a lock.
 *
 * Determinism: the pump waits with `opts.sleep` when injected, so fake-clock tests control
 * every tick; `stop` wins the race at completion, so no timer outlives the lock.
 */
export async function withLock<T>(
  lockPath: string,
  opts: LockOptions,
  fn: (held: Held) => Promise<T>,
): Promise<T> {
  const held = await acquire(lockPath, opts);

  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const intervalMs = opts.heartbeatMs ?? Math.max(250, Math.floor(staleMs / 3));
  const sleep = opts.sleep ?? unrefSleep;
  let stop!: () => void;
  const stopped = new Promise<void>((r) => {
    stop = r;
  });
  const pump = (async () => {
    for (;;) {
      const halted = await Promise.race([
        stopped.then(() => true),
        sleep(intervalMs).then(() => false),
      ]);
      if (halted) return;
      held.heartbeat();
    }
  })();

  try {
    return await fn(held);
  } finally {
    stop();
    await pump;
    held.release();
  }
}
