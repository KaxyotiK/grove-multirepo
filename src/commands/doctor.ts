import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { observeWorkspace } from "../model/observed.ts";
import { completeResult } from "../model/result.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";
import { pendingOperationRemedy, pendingOperations } from "../store/operation.ts";
import { DEFAULT_STALE_MS, scanStaleLocks } from "../store/lock.ts";
import { locksDir } from "../paths/layout.ts";
import { makeDiagnostic } from "../model/conformance.ts";

function subjectOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

async function doctorHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, new Git(createGitRunner()));

  const repository = parsed.values.repo === undefined ? null : snapshot.repositories.find((candidate) =>
    candidate.registration?.id === parsed.values.repo || candidate.registration?.name === parsed.values.repo,
  );
  if (parsed.values.repo !== undefined && !repository) {
    throw new GroveError({ kind: "invalid-input", what: `No repository "${parsed.values.repo}"`, why: "the selector matches no configured repository", remedy: "Run `grove repo ls`." });
  }
  const grove = parsed.values.grove === undefined ? null : snapshot.groves.find((candidate) =>
    candidate.name === parsed.values.grove || candidate.metadata?.manifest.id === parsed.values.grove,
  );
  if (parsed.values.grove !== undefined && !grove) {
    throw new GroveError({ kind: "invalid-input", what: `No Grove "${parsed.values.grove}"`, why: "the selector matches no observed or advisory Grove", remedy: "Run `grove ls`." });
  }

  const diagnostics = snapshot.diagnostics.filter((diagnostic) => {
    const subject = subjectOf(diagnostic.subject);
    if (repository && subject.repositoryId !== repository.registration?.id) return false;
    if (grove && subject.grove !== grove.name) return false;
    return true;
  });
  const selectors = repository || grove
    ? [{ ...(repository?.registration ? { repositoryId: repository.registration.id, repositoryAlias: repository.registration.name } : {}), ...(grove ? { grove: grove.name } : {}) }]
    : [{ path: ws.root }];
  // E-9. `scanStaleLocks` existed with a docstring promising "`reconcile` surfaces these so an
  // orphaned lock that would silently wedge every future mutation is visible instead of
  // mysterious" — and had ZERO production callers, so the promise was false and the lock stayed
  // mysterious. Surfacing it here, beside the pending-operation diagnostic, makes the docstring
  // true. A live same-host holder with a fresh heartbeat is not reported, so an in-progress
  // mutation is not flagged.
  for (const finding of scanStaleLocks(locksDir(ws.root))) {
    if (finding.kind === "orphaned-steal-marker") {
      diagnostics.push(makeDiagnostic({
        code: "orphaned-steal-marker",
        severity: "info",
        subject: { kind: "lock-steal-marker", path: finding.file },
        facts: {
          lock: finding.lock,
          lockState: finding.lockState,
          reason: finding.reason,
          recovery: finding.recovery,
        },
        summary: "An orphaned steal marker will be reclaimed automatically by the next successful lock acquisition",
        remedy: finding.lockState === "held"
          ? "Wait for or resolve the associated lock holder, then retry the intended Grove mutation; the first successful lock acquisition will remove this marker."
          : "Retry the intended Grove mutation; the next successful lock acquisition will remove this marker.",
      }));
      continue;
    }
    const automatic = finding.recovery === "automatic";
    const reclaimBlocked = automatic && finding.stealMarker === "fresh";
    diagnostics.push(makeDiagnostic({
      code: "stale-lock",
      severity: automatic ? "info" : "policy",
      subject: { kind: "lock", path: finding.file },
      facts: {
        reason: finding.reason,
        holder: finding.holder,
        recovery: finding.recovery,
        ...(finding.stealMarker ? { stealMarker: finding.stealMarker } : {}),
      },
      summary: reclaimBlocked
        ? "A stale lock is waiting for another reclaim attempt"
        : automatic
          ? "A stale lock will be reclaimed automatically by the next mutation"
          : "A lock file requires manual recovery",
      remedy: reclaimBlocked
        ? `Another reclaim is in progress or was interrupted. Retry once the steal marker is older than the ${DEFAULT_STALE_MS / 1_000}-second stale window.`
        : automatic
          ? "Retry the intended Grove mutation; it will reclaim this lock before proceeding."
          : "Confirm no Grove process is running against this workspace, then remove the lock file.",
    }));
  }

  // E-6. A pending operation holds target locks, so the next mutating command refuses with a
  // message about an operation the user has no read-only way to discover. Surface it where they
  // are already looking.
  for (const record of pendingOperations(ws.root)) {
    diagnostics.push(makeDiagnostic({
      code: "pending-operation",
      severity: "policy",
      subject: { kind: "operation", operationId: record.id },
      facts: { kind: record.kind, state: record.state, targetLocks: record.targetLocks },
      summary: "A structural operation is still pending",
      remedy: pendingOperationRemedy(record),
    }));
  }
  const detail = {
    observedAt: snapshot.completedAt,
    filters: { repository: repository?.registration?.name ?? null, grove: grove?.name ?? null },
    counts: {
      total: diagnostics.length,
      info: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
      policy: diagnostics.filter((diagnostic) => diagnostic.severity === "policy").length,
      blocking: diagnostics.filter((diagnostic) => diagnostic.severity === "blocking").length,
    },
  };
  const result = completeResult("doctor", selectors.map((selector) => ({ selector, before: null, action: "audit", after: detail, reason: null })), diagnostics, detail);
  // P7.2 (ledger E-2). `--strict` gated on `policy` ALONE, so a workspace whose JSON reported
  // `{blocking: 1}` — and where `grove new` fails outright — exited 0 under the flag whose entire
  // purpose is "fail if anything is wrong". Blocking is strictly worse than policy; gate on both.
  const exit = parsed.values.strict && diagnostics.some((diagnostic) => diagnostic.severity === "policy" || diagnostic.severity === "blocking") ? 3 : 0;
  return ctx.emit.result(result, exit);
}

export function registerDoctor(): void {
  register({
    path: "doctor",
    summary: "Audit observed Git state and layout conventions without mutation.",
    usage: "doctor [--repo <repo>] [--grove <grove>] [--strict]",
    args: [
      { name: "--repo <repo>", desc: "Limit diagnostics to one repository id or alias." },
      { name: "--grove <grove>", desc: "Limit diagnostics to one observed Grove." },
      { name: "--strict", desc: "Exit 3 when policy OR blocking diagnostics are present; info-only findings still exit 0." },
    ],
    examples: ["grove doctor", "grove doctor --grove pricing-fix --strict"],
    handler: doctorHandler,
  });
}
