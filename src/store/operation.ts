import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { GroveError } from "../errors.ts";
import { createIdGenerator } from "../model/ids.ts";
import { locksDir, operationsDir, tempFor } from "../paths/layout.ts";
import { withLock } from "./lock.ts";

/** Compatibility witness: schema-3 target locks still share this workspace serialization key. */
export const operationLockPath = (workspaceRoot: string): string => join(locksDir(workspaceRoot), "op-workspace.lock");

/** Run an entire declared mutation under the one workspace serialization key. */
export function withOperation<T>(workspaceRoot: string, op: string, fn: () => Promise<T>): Promise<T> {
  return withLock(operationLockPath(workspaceRoot), { op }, fn);
}

export type OperationState = "planned" | "running" | "recoverable" | "conflicted" | "completed" | "abandoned" | "interrupted-observation";
export type StepClassification = "planned" | "pending" | "completed" | "recoverable-intermediate" | "conflicted";

export interface OperationStepPlan {
  id: string;
  kind: string;
  input: unknown;
}

export interface OperationTargetPlan {
  selector: Record<string, string>;
  steps: OperationStepPlan[];
}

export interface OperationPlan {
  kind: string;
  scope: Record<string, string>;
  targetLocks: string[];
  targets: OperationTargetPlan[];
  secret?: unknown;
}

export interface OperationStep extends OperationStepPlan {
  selector: Record<string, string>;
  classification: StepClassification;
  preState?: unknown;
  postState?: unknown;
  error?: { reason: string; detail?: unknown };
}

export interface OperationRecord {
  version: 1;
  id: string;
  kind: string;
  scope: Record<string, string>;
  state: OperationState;
  createdAt: string;
  updatedAt: string;
  targetLocks: string[];
  targets: OperationTargetPlan[];
  steps: OperationStep[];
  secret?: unknown;
  file: string;
}

export interface DirectoryTargetIdentity {
  role: "grove-content" | "active-grove" | "archive-grove" | "grove-metadata";
  selector: { grove: string };
  relativePath: string;
  canonicalPath: string;
  expectedPresent: boolean;
  device: number | null;
  inode: number | null;
}

/** Capture the non-following filesystem identity required before a recursive replay. */
export function captureDirectoryTarget(root: string, role: DirectoryTargetIdentity["role"], selector: DirectoryTargetIdentity["selector"], path: string): DirectoryTargetIdentity {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  const present = existsSync(absolutePath);
  const stat = present ? lstatSync(absolutePath) : null;
  return {
    role,
    selector,
    relativePath: relative(absoluteRoot, absolutePath),
    canonicalPath: present ? realpathSync(absolutePath) : absolutePath,
    expectedPresent: present,
    device: stat?.dev ?? null,
    inode: stat?.ino ?? null,
  };
}

function body(record: OperationRecord): Omit<OperationRecord, "file"> {
  const { file: _file, ...value } = record;
  return value;
}

function persist(record: OperationRecord): void {
  const directory = dirname(record.file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = tempFor(record.file, Math.random().toString(36).slice(2, 10));
  const fd = openSync(temporary, "wx", 0o600);
  writeSync(fd, `${JSON.stringify(body(record), null, 2)}\n`, 0, "utf8");
  fsyncSync(fd);
  closeSync(fd);
  chmodSync(temporary, 0o600);
  renameSync(temporary, record.file);
  const parent = openSync(directory, "r");
  fsyncSync(parent);
  closeSync(parent);
}

export function beginOperation(root: string, plan: OperationPlan): OperationRecord {
  const id = createIdGenerator().ulid();
  const now = new Date().toISOString();
  const file = join(operationsDir(root), `${id}.json`);
  const targets = plan.targets.map((target) => ({
    ...target,
    steps: target.steps.map((operationStep) => {
      if (typeof operationStep.input !== "object" || operationStep.input === null) return operationStep;
      const input = operationStep.input as Record<string, unknown>;
      if (operationStep.kind === "directory-remove" && !("targetIdentity" in input) && plan.kind === "grove-delete" && typeof plan.scope.grove === "string" && typeof input.path === "string") {
        return { ...operationStep, input: { ...input, targetIdentity: captureDirectoryTarget(root, "grove-content", { grove: plan.scope.grove }, input.path) } };
      }
      if (operationStep.kind === "central-metadata-remove" && !("targetIdentity" in input) && plan.kind === "grove-delete" && typeof plan.scope.grove === "string" && typeof input.path === "string") {
        return { ...operationStep, input: { ...input, targetIdentity: captureDirectoryTarget(root, "grove-metadata", { grove: plan.scope.grove }, input.path) } };
      }
      if ((operationStep.kind === "directory-move" || operationStep.kind === "directory-merge") && !("fromIdentity" in input) && !("toIdentity" in input) && typeof plan.scope.grove === "string" && typeof input.from === "string" && typeof input.to === "string") {
        const newName = typeof plan.scope.newName === "string" ? plan.scope.newName : plan.scope.grove;
        const roles = plan.kind === "grove-archive"
          ? ["active-grove", "archive-grove"] as const
          : plan.kind === "grove-restore"
            ? ["archive-grove", "active-grove"] as const
            : plan.kind === "grove-rename"
              ? (operationStep.kind === "directory-merge" ? ["active-grove", "active-grove"] as const : ["archive-grove", "archive-grove"] as const)
              : null;
        if (roles) return { ...operationStep, input: {
          ...input,
          fromIdentity: captureDirectoryTarget(root, roles[0], { grove: plan.scope.grove }, input.from),
          toIdentity: captureDirectoryTarget(root, roles[1], { grove: newName }, input.to),
        } };
      }
      return operationStep;
    }),
  }));
  const record: OperationRecord = {
    version: 1,
    id,
    kind: plan.kind,
    scope: plan.scope,
    state: "planned",
    createdAt: now,
    updatedAt: now,
    targetLocks: [...plan.targetLocks],
    targets,
    steps: targets.flatMap((target) => target.steps.map((step) => ({ ...step, selector: target.selector, classification: "planned" as const }))),
    ...(plan.secret === undefined ? {} : { secret: plan.secret }),
    file,
  };
  persist(record);
  return record;
}

function step(record: OperationRecord, id: string): OperationStep {
  const matches = record.steps.filter((candidate) => candidate.id === id);
  if (matches.length !== 1) throw new GroveError({ kind: "config", what: `Operation ${record.id} has no unique step ${id}`, why: `${matches.length} matching steps`, remedy: "Inspect the durable operation record." });
  return matches[0] as OperationStep;
}

function update(record: OperationRecord): void {
  record.updatedAt = new Date().toISOString();
  persist(record);
}

export function recordPending(record: OperationRecord, stepId: string, preState: unknown): void {
  const value = step(record, stepId);
  if (value.classification !== "planned" && value.classification !== "recoverable-intermediate") throw new GroveError({ kind: "refused-conflict", what: `Cannot pend operation step ${stepId}`, why: `its state is ${value.classification}`, remedy: "Reobserve the operation before retrying." });
  value.classification = "pending";
  value.preState = preState;
  record.state = "running";
  update(record);
}

export function recordCompleted(record: OperationRecord, stepId: string, postState: unknown): void {
  const value = step(record, stepId);
  if (value.classification !== "pending" && value.classification !== "completed") throw new GroveError({ kind: "refused-conflict", what: `Cannot complete operation step ${stepId}`, why: `its state is ${value.classification}`, remedy: "Reobserve the operation before retrying." });
  value.classification = "completed";
  value.postState = postState;
  if (record.steps.every((candidate) => candidate.classification === "completed")) {
    record.state = "completed";
    scrubSecret(record);
  }
  update(record);
}

/**
 * E-9. `json-results-v1.md` permits retaining a raw remote — credentials and all — ONLY for a
 * **resumable** operation. Scrubbing only on `completed` left the secret on every record that ended
 * any other way, and those are exactly the records that linger: a failed acquisition reaches
 * `conflicted` (decision B3), `resumeOperation` returns immediately on a conflicted step, and
 * `abandon` did not scrub either. A `https://user:token@host/repo.git` therefore persisted
 * indefinitely in a record that could never be resumed.
 */
function scrubSecret(record: OperationRecord): void {
  const secretStrings = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") { secretStrings.add(value); return; }
    if (Array.isArray(value)) { for (const entry of value) collect(entry); return; }
    if (value && typeof value === "object") for (const entry of Object.values(value as Record<string, unknown>)) collect(entry);
  };
  collect(record.secret);
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") return secretStrings.has(value) ? "<redacted-secret>" : value;
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, scrub(entry)]));
    return value;
  };
  // Defense in depth: terminal records must not retain a secret that a future caller accidentally
  // copied into immutable plan, pre/post-state, or failure detail. Resumable records keep the exact
  // value only in `secret`; terminal transitions scrub every duplicate before persistence.
  record.scope = scrub(record.scope) as Record<string, string>;
  record.targetLocks = scrub(record.targetLocks) as string[];
  record.targets = scrub(record.targets) as OperationTargetPlan[];
  record.steps = scrub(record.steps) as OperationStep[];
  delete record.secret;
}

export function recordStepFailure(record: OperationRecord, stepId: string, classification: "recoverable-intermediate" | "conflicted", reason: string, detail?: unknown): void {
  const value = step(record, stepId);
  value.classification = classification;
  // Git's stderr and thrown exception text can contain the effective remote URL, including
  // credentials supplied by local Git configuration. Keep structured evidence, never raw
  // diagnostics in a durable operation record (including records that can be resumed).
  const safeDetail = detail && typeof detail === "object" && !Array.isArray(detail)
    ? Object.fromEntries(Object.entries(detail).filter(([key]) => key !== "stderr" && key !== "error"))
    : detail;
  value.error = { reason, ...(safeDetail === undefined ? {} : { detail: safeDetail }) };
  record.state = classification === "conflicted" ? "conflicted" : "recoverable";
  // `resumeOperation` returns immediately on a conflicted step, so a conflicted record is terminal
  // in the only sense that matters here: nothing will ever spend the secret again.
  if (record.state === "conflicted") scrubSecret(record);
  update(record);
}

export function loadOperation(file: string): OperationRecord {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new GroveError({ kind: "config", what: `Cannot load operation record ${file}`, why: String((error as Error).message ?? error), remedy: "Inspect the restrictive local record before recovery." }); }
  if (typeof raw !== "object" || raw === null || (raw as { version?: unknown }).version !== 1 || typeof (raw as { id?: unknown }).id !== "string" || !Array.isArray((raw as { steps?: unknown }).steps)) throw new GroveError({ kind: "config", what: `Invalid operation record ${file}`, why: "the versioned shape is incomplete", remedy: "Inspect the record before recovery." });
  return { ...(raw as Omit<OperationRecord, "file">), file };
}

export function scanOperations(root: string): { records: OperationRecord[]; errors: Array<{ file: string; why: string }> } {
  const directory = operationsDir(root);
  let names: string[];
  try { names = readdirSync(directory).filter((name) => name.endsWith(".json")); } catch { return { records: [], errors: [] }; }
  const records: OperationRecord[] = [];
  const errors: Array<{ file: string; why: string }> = [];
  for (const name of names.sort()) {
    const file = join(directory, name);
    try { records.push(loadOperation(file)); } catch (error) { errors.push({ file, why: String((error as Error).message ?? error) }); }
  }
  return { records, errors };
}

export function pendingOperations(root: string): OperationRecord[] {
  return scanOperations(root).records.filter((record) => !["completed", "abandoned", "interrupted-observation"].includes(record.state));
}

export function assertTargetsAvailable(root: string, targetLocks: readonly string[], excludeOperationId?: string): void {
  const requested = new Set(targetLocks);
  const pending = pendingOperations(root).find((record) => record.id !== excludeOperationId && record.targetLocks.some((lock) => requested.has(lock)));
  if (pending) throw new GroveError({ kind: "refused-conflict", what: "A structural operation is already pending for this target", why: `operation ${pending.id} (${pending.kind}, ${pending.state}) owns the target`, remedy: pendingOperationRemedy(pending), detail: { operationId: pending.id, kind: pending.kind, state: pending.state } });
}

/**
 * The next action for a pending operation, from its durable state (constitution V). A conflicted
 * record never resumes, so it is inspected and abandoned; any other pending record resumes with
 * `reconcile`, and abandonment is offered only where `canAbandonOperation` would accept it.
 */
export function pendingOperationRemedy(record: OperationRecord): string {
  if (record.state === "conflicted") return `Inspect operation ${record.id} (\`.grove/operations/${record.id}.json\` and the paths it names); it cannot resume. Run \`grove reconcile --abandon ${record.id}\` to close it, leaving completed work in place.`;
  return canAbandonOperation(record)
    ? `Run \`grove reconcile --operation ${record.id}\` to resume, or \`grove reconcile --abandon ${record.id}\` to explicitly close this eligible operation.`
    : `Run \`grove reconcile --operation ${record.id}\` (or \`grove reconcile\`) to resume it after correcting any reported cause; it is not eligible for abandonment in this state.`;
}

/**
 * Hold every logical operation target through one deterministic, process-safe lock set.
 * Callers reobserve and persist their operation only inside this boundary, closing the
 * check/persist/mutate race between otherwise independent Grove processes.
 */
export async function withOperationTargetLocks<T>(root: string, targetLocks: readonly string[], op: string, fn: () => Promise<T>): Promise<T> {
  const keys = [...new Set(targetLocks)].sort();
  const run = async (index: number): Promise<T> => {
    if (index === keys.length) return fn();
    const key = keys[index] as string;
    const digest = createHash("sha256").update(key).digest("hex");
    return withLock(join(locksDir(root), `target-${digest}.lock`), { op }, () => run(index + 1));
  };
  return run(0);
}

export function findOperation(root: string, id: string): OperationRecord | null {
  return scanOperations(root).records.find((record) => record.id === id) ?? null;
}

export function canAbandonOperation(record: OperationRecord): boolean {
  return record.state === "conflicted" || (
    record.kind === "repo-add" && record.state === "recoverable" &&
    record.steps.some((candidate) => candidate.classification === "recoverable-intermediate" && candidate.error?.reason === "git-failed")
  );
}

export function abandonOperation(record: OperationRecord): void {
  if (!canAbandonOperation(record)) throw new GroveError({ kind: "refused-precondition", what: `Cannot abandon operation ${record.id}`, why: `its durable state is ${record.state} without eligible failed-acquisition evidence`, remedy: "Resume recoverable work, or wait until an eligible failure or conflict is recorded." });
  record.state = "abandoned";
  scrubSecret(record);
  update(record);
}

export function closeInterruptedSyncAttempt(record: OperationRecord): void {
  if (record.kind !== "sync-attempt") throw new GroveError({ kind: "invalid-input", what: `Operation ${record.id} is not a sync attempt`, why: `kind is ${record.kind}`, remedy: "Resume structural work through normal reconciliation." });
  record.state = "interrupted-observation";
  update(record);
}
