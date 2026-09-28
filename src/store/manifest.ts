/**
 * Manifest read/write with compare-and-swap (§6, D-006).
 *
 * CAS alone is a TOCTOU gap: two writers pass the same baseline and `rename()` has no
 * compare-and-swap, so the second clobbers the first and neither is told. The check-to-rename
 * window is therefore held under a lock. `fsync(dir)` after `rename` makes the rename itself
 * durable, not just the bytes.
 *
 * The read path (FR-016) validates the complete file and returns a consistent snapshot with its
 * revision; a caller detecting a concurrent revision change re-reads within a small bound. Reads
 * take no lock.
 *
 * Ported from the pinned source: the legacy Bun crypto hasher → `node:crypto`; the legacy
 * runtime-specific parse-error localisation is dropped (Node is the only runtime).
 */
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { GroveError } from "../errors.ts";
import { manifestLock, tempFor } from "../paths/layout.ts";
import { withLock } from "./lock.ts";

export interface ManifestMeta {
  size: number;
  mtimeNs: bigint;
  sha256: string;
  /** The PRIMARY CAS key — monotonic, inside the content. `stat` alone admits an ABA. */
  rev: number;
}

export interface ReadResult<T> {
  value: T;
  meta: ManifestMeta;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

const lockIdFor = (path: string): string => sha256(path).slice(0, 32);

/** 1-indexed line of a JSON syntax error, or `undefined` if it cannot be located. */
export function locateParseError(raw: string, err: unknown): number | undefined {
  const msg = String((err as { message?: string })?.message ?? err);
  const pos = /position (\d+)/.exec(msg);
  if (pos?.[1]) return raw.slice(0, Number(pos[1])).split("\n").length;
  const lines = raw.split("\n");
  for (let i = 1; i <= lines.length; i++) {
    try {
      JSON.parse(lines.slice(0, i).join("\n"));
      return undefined;
    } catch {
      /* keep going */
    }
  }
  return undefined;
}

export function readManifest<T extends { _rev?: number }>(path: string): ReadResult<T> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new GroveError({
      kind: "io",
      what: `Cannot read ${path}`,
      why: (e as NodeJS.ErrnoException).code ?? "unreadable",
      remedy: "Check the file exists and is readable.",
      cause: e,
    });
  }

  let value: T;
  try {
    value = JSON.parse(raw) as T;
  } catch (e) {
    const line = locateParseError(raw, e);
    throw new GroveError({
      kind: "config",
      what: `${path} is not valid JSON`,
      why: line !== undefined ? `parse error on line ${line}` : String(e),
      remedy: "Fix the syntax error, or restore the file from a backup.",
      detail: { path, line },
      cause: e,
    });
  }

  const st = statSync(path, { bigint: true });
  return {
    value,
    meta: { size: Number(st.size), mtimeNs: st.mtimeNs, sha256: sha256(raw), rev: value._rev ?? 0 },
  };
}

export interface WriteOptions {
  /** The workspace root, whose `.grove/locks/` holds the manifest write-lock. */
  workspace: string;
  /** Omit for a first write (the file must not already exist). */
  expected?: ManifestMeta;
  staleMs?: number;
  timeoutMs?: number;
}

export async function writeManifest<T extends { _rev?: number }>(
  path: string,
  next: T,
  opts: WriteOptions,
): Promise<ManifestMeta> {
  const lockPath = manifestLock(opts.workspace, lockIdFor(path));

  return withLock(
    lockPath,
    {
      op: `write ${path}`,
      ...(opts.staleMs !== undefined ? { staleMs: opts.staleMs } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    },
    async () => {
      // ── the compare, INSIDE the lock
      let current: ReadResult<T> | null = null;
      try {
        current = readManifest<T>(path);
      } catch (e) {
        if (!(GroveError.is(e) && e.kind === "io")) throw e; // a parse error is still a conflict
      }

      if (opts.expected === undefined && current !== null) {
        throw new GroveError({
          kind: "refused-conflict",
          what: `${path} already exists`,
          why: "a first write was attempted against a file that is already there",
          remedy: "Read the file first and supply its version, or choose another path.",
          detail: { path },
        });
      }
      if (opts.expected !== undefined) {
        if (current === null) {
          throw new GroveError({
            kind: "refused-conflict",
            what: `${path} has been deleted`,
            why: "it existed when it was read and is gone now",
            remedy: "Re-read the current state and retry.",
            detail: { path },
          });
        }
        if (current.meta.rev !== opts.expected.rev || current.meta.sha256 !== opts.expected.sha256) {
          throw new GroveError({
            kind: "refused-conflict",
            what: `${path} changed since it was read`,
            why: `expected revision ${opts.expected.rev}, found ${current.meta.rev}`,
            remedy: "Re-read the current state, reapply the change, and retry.",
            detail: { path, expectedRev: opts.expected.rev, actualRev: current.meta.rev },
          });
        }
      }

      // ── the swap
      const body = { ...next, _rev: (opts.expected?.rev ?? 0) + 1 };
      const serialised = `${JSON.stringify(body, null, 2)}\n`;
      const tmp = tempFor(path, Math.random().toString(36).slice(2, 10));

      try {
        const fd = openSync(tmp, "wx");
        writeSync(fd, serialised, 0, "utf8");
        fsyncSync(fd); // the bytes are durable …
        closeSync(fd);
        renameSync(tmp, path);

        const dir = openSync(dirname(path), "r");
        fsyncSync(dir); // … and so is the rename.
        closeSync(dir);
      } catch (e) {
        try {
          unlinkSync(tmp);
        } catch {
          /* already gone, or never created */
        }
        throw new GroveError({
          kind: "io",
          what: `Cannot write ${path}`,
          why: (e as NodeJS.ErrnoException).code ?? String(e),
          remedy: "Check the directory exists, is writable, and the disk is not full.",
          detail: { path, code: (e as NodeJS.ErrnoException).code },
          cause: e,
        });
      }

      const st = statSync(path, { bigint: true });
      return { size: Number(st.size), mtimeNs: st.mtimeNs, sha256: sha256(serialised), rev: body._rev };
    },
  );
}
