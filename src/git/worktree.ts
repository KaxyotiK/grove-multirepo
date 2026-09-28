/**
 * Read-only worktree inspection used by review and Git-native lifecycle operations.
 * An unreadable worktree is reported, never silently treated as clean.
 */

import type { Git } from "./adapter.ts";
import { nativePathFromBytes, type NativePath } from "../model/encoding.ts";
import { GroveError } from "../errors.ts";

export interface ChangeEntry {
  status: string;
  path: string;
  /** Exact identity when a native name cannot be decoded as UTF-8. */
  rawPathBase64?: string;
}
export type DestructiveConsent = "none" | "ignored" | "all";
export function destructiveConsent(values: Record<string, unknown>): DestructiveConsent {
  if (values["allow-destructive-all"] === true && values["allow-destructive-git-ignored"] === true) throw new GroveError({ kind: "invalid-input", what: "Choose one destructive permission level", why: "both destructive flags were supplied", remedy: "Use either --allow-destructive-all or --allow-destructive-git-ignored." });
  return values["allow-destructive-all"] === true ? "all" : values["allow-destructive-git-ignored"] === true ? "ignored" : "none";
}
export function consentAllows(change: ChangeEntry, consent: DestructiveConsent): boolean {
  return consent === "all" || (consent === "ignored" && change.status === "!!");
}
export function recordedConsent(input: Record<string, unknown>): DestructiveConsent {
  if (input.consent === "all" || input.consent === "ignored" || input.consent === "none") return input.consent;
  // Older pending plans retain their exact recorded set. They cannot acquire consent for ignored
  // files that the older inventory omitted: assertRecordedWork rejects every unrecorded path.
  return input.allowDestructive === true || input.force === true ? "all" : "none";
}
export interface RawChangeEntry { status: string; path: NativePath; originalPath?: NativePath }
export async function porcelainStatusRaw(g: Git, worktree: string): Promise<{ changes: RawChangeEntry[]; problem: string | null }> {
  const result = await g.tryRunBytes(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (result.exitCode !== 0) return { changes: [], problem: Buffer.from(result.stderr).toString("utf8").trim().split("\n")[0] ?? "unreadable worktree" };
  const fields = Buffer.from(result.stdout).toString("latin1").split("\0");
  const changes: RawChangeEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string;
    if (!field) continue;
    const status = field.slice(0, 2).trim();
    const path = nativePathFromBytes(Buffer.from(field.slice(3), "latin1"));
    if (status.includes("R") || status.includes("C")) {
      const original = fields[++i];
      changes.push({ status, path, ...(original ? { originalPath: nativePathFromBytes(Buffer.from(original, "latin1")) } : {}) });
    } else changes.push({ status, path });
  }
  // Git status collapses a wholly ignored directory even with --untracked-files=all. Enumerate
  // ignored files separately so consent records each child, including later additions.
  const ignored = await g.tryRunBytes(worktree, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  if (ignored.exitCode !== 0) return { changes: [], problem: Buffer.from(ignored.stderr).toString("utf8").trim().split("\n")[0] ?? "unreadable ignored work" };
  for (const field of Buffer.from(ignored.stdout).toString("latin1").split("\0")) {
    if (field) changes.push({ status: "!!", path: nativePathFromBytes(Buffer.from(field, "latin1")) });
  }
  return { changes, problem: null };
}

/** `git status --porcelain` for one worktree. `null` problem means the read succeeded. */
export async function porcelainStatus(
  g: Git,
  worktree: string,
): Promise<{ changes: ChangeEntry[]; problem: string | null }> {
  if (g.bytePreserving) {
    const raw = await porcelainStatusRaw(g, worktree);
    if (raw.problem === null) return { changes: raw.changes.map((change) => ({ status: change.status, path: change.path.utf8 ?? change.path.display, ...(change.path.utf8 === null ? { rawPathBase64: Buffer.from(change.path.raw).toString("base64") } : {}) })), problem: null };
  }
  const r = await g.tryRun(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (r.exitCode !== 0) return { changes: [], problem: r.stderr.trim().split("\n")[0] ?? "unreadable worktree" };
  const changes: ChangeEntry[] = [];
  const fields = r.stdout.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const status = field.slice(0, 2).trim();
    changes.push({ status, path: field.slice(3) });
    if (status.includes("R") || status.includes("C")) i++;
  }
  const ignored = await g.tryRun(worktree, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  if (ignored.exitCode !== 0) return { changes: [], problem: ignored.stderr.trim().split("\n")[0] ?? "unreadable ignored work" };
  for (const path of ignored.stdout.split("\0")) if (path) changes.push({ status: "!!", path });
  return { changes, problem: null };
}

export async function isDirty(g: Git, worktree: string): Promise<{ dirty: boolean; files: number; problem: string | null }> {
  const { changes, problem } = await porcelainStatus(g, worktree);
  return { dirty: changes.length > 0, files: changes.length, problem };
}

/**
 * Commits on the worktree's HEAD that are not on `base`.
 *
 * A non-zero git exit means the worktree is unreadable (missing, corrupt `.git`, permissions), NOT
 * "no commits" — a clean base..HEAD with nothing ahead exits 0 with empty output. So a non-zero
 * exit is surfaced as `problem`, never flattened to an empty list: a broken worktree must never be
 * reported as "0 commits" (the module contract, and the precedent set by porcelainStatus).
 */
export async function commitsAhead(
  g: Git,
  worktree: string,
  base: string,
  limit?: number,
): Promise<{ commits: { hash: string; subject: string }[]; problem: string | null }> {
  const args = ["log", "--format=%h%x00%s", ...(limit ? [`-n${limit}`] : []), `${base}..HEAD`];
  const r = await g.tryRun(worktree, args);
  if (r.exitCode !== 0) return { commits: [], problem: r.stderr.trim().split("\n")[0] ?? "unreadable worktree" };
  const commits = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash = "", subject = ""] = l.split("\x00"); // the --format uses %x00 between fields
      return { hash, subject };
    });
  return { commits, problem: null };
}

/**
 * Files changed on HEAD relative to `base` (three-dot, i.e. since the merge-base).
 * As with commitsAhead, a non-zero git exit is an unreadable worktree, surfaced as `problem`
 * rather than reported as "0 files".
 */
export async function changedAgainst(
  g: Git,
  worktree: string,
  base: string,
): Promise<{ files: ChangeEntry[]; problem: string | null }> {
  // O-11. This ran WITHOUT `-z` and split on newlines, bypassing the NativePath primitive used
  // correctly by porcelainStatusRaw above. git then applies its own quoting to any non-ASCII path,
  // so `café.txt` came out as the literal 12 characters `"caf\303\251.txt"` — quoted, escaped, and
  // useless for opening the file. A path Grove emits must be a path the caller can open.
  //
  // `-z` records are NUL-separated: <status>\0<path>\0, and for R/C a SECOND path follows.
  const r = await g.tryRunBytes(worktree, ["diff", "--name-status", "-z", `${base}...HEAD`]);
  if (r.exitCode !== 0) return { files: [], problem: Buffer.from(r.stderr).toString("utf8").trim().split("\n")[0] ?? "unreadable worktree" };
  const fields = Buffer.from(r.stdout).toString("latin1").split("\0");
  const files: ChangeEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) continue;
    const rename = status.startsWith("R") || status.startsWith("C");
    // A rename/copy record spends two path fields; the destination is the one that exists now.
    const from = fields[++i];
    const to = rename ? fields[++i] : undefined;
    const chosen = to ?? from;
    if (chosen === undefined) break;
    const path = nativePathFromBytes(Buffer.from(chosen, "latin1"));
    // Projected as `utf8 ?? display` to match porcelainStatus, so `path` stays a string and the
    // JSON contract shape is unchanged (sole consumer: review.ts).
    files.push({ status, path: path.utf8 ?? path.display });
  }
  return { files, problem: null };
}

export async function assertWorktreeHeadRetained(g: Git, commonGitDir: string, worktree: string, expectedHead: string | null): Promise<void> {
  const current = await g.currentHead(worktree).catch(() => null);
  if (!current || current.oid !== expectedHead) throw new GroveError({ kind: "refused-conflict", what: `Cannot remove worktree ${worktree}`, why: "HEAD changed after the removal plan was recorded", remedy: "Re-observe the worktree and start a new removal plan." });
  if (current.detached && current.oid && !(await g.isCommitReachableFromRef(commonGitDir, current.oid))) {
    throw new GroveError({ kind: "refused-precondition", what: "Cannot remove an unreachable detached worktree", why: `HEAD ${current.oid} is no longer reachable from any ref`, remedy: "Create a native ref for the commit before removal.", detail: { reason: "unreachable-detached", headOid: current.oid } });
  }
}

/** FR-023: consent is a recorded set, never permission to discard future work. */
export async function assertRecordedWork(g: Git, path: string, recorded: unknown, consent: DestructiveConsent): Promise<ChangeEntry[]> {
  const recordedWork = Array.isArray(recorded) ? recorded.filter((entry): entry is ChangeEntry => typeof entry?.status === "string" && typeof entry?.path === "string" && (entry.rawPathBase64 === undefined || typeof entry.rawPathBase64 === "string")) : [];
  const current = await porcelainStatus(g, path);
  const unexpected = current.changes.filter(entry => !consentAllows(entry, consent) || !recordedWork.some(known => known.status === entry.status && known.path === entry.path && known.rawPathBase64 === entry.rawPathBase64));
  if (current.problem !== null || unexpected.length) throw new GroveError({
    kind: "refused-conflict", what: `Cannot remove worktree ${path}`,
    why: current.problem ?? `uncommitted work was not in the recorded consent: ${unexpected.map(entry => entry.path).join(", ")}`,
    remedy: "Inspect the retained work and start a new removal plan.",
    detail: { reason: "stale-plan", recordedWork, currentWork: current.changes, unexpectedWork: unexpected },
  });
  return current.changes;
}
