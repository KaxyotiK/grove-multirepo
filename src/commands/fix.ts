import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, createGitRunner } from "../git/adapter.ts";
import { assertWorktreeMutationPath, observeWorkspace } from "../model/observed.ts";
import { planMove, type Diagnostic } from "../model/conformance.ts";
import { requireWorkspace } from "../config/workspace.ts";
import { commandResultExit, completeResult } from "../model/result.ts";
import { assertTargetsAvailable, beginOperation, recordCompleted, recordPending, recordStepFailure, withOperationTargetLocks } from "../store/operation.ts";
import { register, type CommandContext } from "./registry.ts";
import { planObservedMove } from "../model/plan.ts";
import { parseCommand } from "./args.ts";
import { containedPath } from "../paths/fs.ts";
import { resolveLayoutTarget } from "../config/layout.ts";

const subject = (diagnostic: Diagnostic): Record<string, unknown> => typeof diagnostic.subject === "object" && diagnostic.subject !== null ? diagnostic.subject as Record<string, unknown> : {};
const mutationFailureReason = (error: unknown): "stale-plan" | "git-failed" => GroveError.is(error) && error.kind !== "git" ? "stale-plan" : "git-failed";

async function fixHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  if (!parsed.values.move) throw new GroveError({ kind: "invalid-input", what: "fix requires an explicit repair mode", why: "no --move was supplied", remedy: "Preview with `grove fix --move --dry-run`." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const git = new Git(createGitRunner());
  const initial = await observeWorkspace(ws, git);
  let diagnostics = initial.diagnostics.filter((diagnostic) => diagnostic.code === "misplaced");
  if (parsed.values.diagnostic) diagnostics = diagnostics.filter((diagnostic) => diagnostic.id === parsed.values.diagnostic);
  if (parsed.values.repo) diagnostics = diagnostics.filter((diagnostic) => { const value = subject(diagnostic).repositoryId; return value === parsed.values.repo || initial.repositories.find((repository) => repository.registration?.id === value)?.registration?.name === parsed.values.repo; });
  if (parsed.values.grove) diagnostics = diagnostics.filter((diagnostic) => subject(diagnostic).grove === parsed.values.grove || initial.groves.find((grove) => grove.metadata?.manifest.id === parsed.values.grove)?.name === subject(diagnostic).grove);
  if (parsed.values.diagnostic && diagnostics.length !== 1) throw new GroveError({ kind: "refused-conflict", what: `Diagnostic ${parsed.values.diagnostic} is stale or ambiguous`, why: `${diagnostics.length} current move diagnostics match`, remedy: "Run `grove doctor` and select one current diagnostic id." });
  const plans = diagnostics.map(planMove).filter((plan): plan is NonNullable<ReturnType<typeof planMove>> => plan !== null);
  if (plans.length === 0) throw new GroveError({ kind: "refused-precondition", what: "No safe worktree moves are available", why: "the current filters match no uniquely planned misplaced diagnostic", remedy: "Run `grove doctor` or adjust the filters." });
  for (const plan of plans) if (existsSync(plan.to)) throw new GroveError({ kind: "refused-conflict", what: `Cannot move worktree to ${plan.to}`, why: "the exact destination is occupied", remedy: "Move the conflicting path and rerun doctor." });
  const previewTargets = plans.map((plan) => ({ selector: { path: plan.from, ...(subject(diagnostics.find((diagnostic) => diagnostic.id === plan.diagnosticId) as Diagnostic).grove ? { grove: String(subject(diagnostics.find((diagnostic) => diagnostic.id === plan.diagnosticId) as Diagnostic).grove) } : {}) }, before: { path: plan.from, diagnosticId: plan.diagnosticId }, action: "move-worktree", after: { path: plan.to }, reason: null }));
  if (parsed.values["dry-run"]) return ctx.emit.result(completeResult("fix --move", previewTargets, diagnostics, { dryRun: true, moves: plans }), 0);
  const targetLocks = plans.flatMap((plan) => [`worktree:${plan.from}`, `path:${plan.to}`]);
  return withOperationTargetLocks(ws.root, targetLocks, "fix-move", async () => {
    assertTargetsAvailable(ws.root, targetLocks);
    const current = await observeWorkspace(ws, git);
    for (const plan of plans) {
      const currentDiagnostic = current.diagnostics.find((diagnostic) => diagnostic.id === plan.diagnosticId && diagnostic.code === "misplaced");
      const decision = planObservedMove({ diagnosticId: plan.diagnosticId, currentDiagnosticId: currentDiagnostic?.id ?? null, from: plan.from, to: plan.to, sourcePresent: existsSync(plan.from), destinationPresent: existsSync(plan.to) });
      if (decision.reason) throw new GroveError({ kind: "refused-conflict", what: `Diagnostic ${plan.diagnosticId} became stale`, why: "its remedy-changing observed facts or path occupancy no longer match", remedy: "Run `grove doctor` and preview again." });
      const currentSubject = currentDiagnostic ? subject(currentDiagnostic) : {};
      const groveName = typeof currentSubject.grove === "string" ? String(currentSubject.grove) : undefined;
      resolveLayoutTarget(current.layout, plan.to);
      containedPath(ws.root, plan.from, `Cannot move worktree ${plan.from}`);
      containedPath(ws.root, plan.to, `Cannot move worktree ${plan.from}`);
      assertWorktreeMutationPath(current, plan.from, { allowObservedPath: plan.from, ...(groveName ? { groveName } : {}) });
      assertWorktreeMutationPath(current, plan.to, groveName ? { groveName } : {});
    }
    const operation = beginOperation(ws.root, { kind: "fix-move", scope: {}, targetLocks, targets: plans.map((plan, index) => {
      const diagnostic = diagnostics.find((candidate) => candidate.id === plan.diagnosticId) as Diagnostic;
      const repositoryId = subject(diagnostic).repositoryId;
      const repository = current.repositories.find((candidate) => candidate.registration?.id === repositoryId);
      const worktree = repository?.worktrees.find((candidate) => candidate.path.utf8 === plan.from);
      return { selector: { repositoryId: typeof repositoryId === "string" ? repositoryId : "", path: plan.from }, steps: [{ id: `move-${index}`, kind: "worktree-move", input: { ...plan, commonGitDir: repository?.commonGitDir ?? null, headOid: worktree?.headOid ?? null } }] };
    }) });
    const results = [];
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index]!;
      const diagnostic = diagnostics.find((candidate) => candidate.id === plan.diagnosticId) as Diagnostic;
      const repositoryId = subject(diagnostic).repositoryId;
      const repository = current.repositories.find((candidate) => candidate.registration?.id === repositoryId);
      const worktree = repository?.worktrees.filter((candidate) => candidate.path.utf8 === plan.from);
      if (!repository || worktree?.length !== 1) { recordStepFailure(operation, `move-${index}`, "conflicted", "stale-plan"); results.push({ selector: { path: plan.from }, before: { diagnosticId: plan.diagnosticId }, action: "move-worktree", after: null, reason: "stale-plan" }); continue; }
      recordPending(operation, `move-${index}`, { from: plan.from, to: plan.to, diagnosticId: plan.diagnosticId, headOid: worktree[0]!.headOid });
      try {
        const groveName = typeof subject(diagnostic).grove === "string" ? String(subject(diagnostic).grove) : undefined;
        const mutationSnapshot = await observeWorkspace(requireWorkspace({ cwd: ws.root, workspace: ws.root }), git);
        const mutationDiagnostic = mutationSnapshot.diagnostics.find((candidate) => candidate.id === plan.diagnosticId && candidate.code === "misplaced");
        const mutationRepository = mutationSnapshot.repositories.find((candidate) => candidate.registration?.id === repositoryId);
        const mutationWorktree = mutationRepository?.worktrees.find((candidate) => candidate.path.utf8 === plan.from);
        if (!mutationDiagnostic || !mutationRepository || mutationRepository.problem || mutationRepository.commonGitDir !== repository.commonGitDir || !mutationWorktree || mutationWorktree.headOid !== worktree[0]!.headOid) throw new GroveError({ kind: "refused-conflict", what: `Diagnostic ${plan.diagnosticId} became stale`, why: "the repository or worktree identity changed at the point of use", remedy: "Run `grove doctor` and preview again.", detail: { reason: "stale-plan" } });
        resolveLayoutTarget(mutationSnapshot.layout, plan.to);
        assertWorktreeMutationPath(mutationSnapshot, plan.from, { allowObservedPath: plan.from, ...(groveName ? { groveName } : {}) });
        assertWorktreeMutationPath(mutationSnapshot, plan.to, groveName ? { groveName } : {});
        const from = containedPath(ws.root, plan.from, `Cannot move worktree ${plan.from}`);
        const to = containedPath(ws.root, plan.to, `Cannot move worktree ${plan.from}`);
        mkdirSync(dirname(to), { recursive: true });
        await git.moveWorktree(
          mutationRepository.commonGitDir,
          from,
          to,
        );
        recordCompleted(operation, `move-${index}`, { path: plan.to, headOid: worktree[0]!.headOid }); results.push({ selector: { path: plan.from }, before: { path: plan.from, diagnosticId: plan.diagnosticId }, action: "move-worktree", after: { path: plan.to }, reason: null });
      }
      catch (error) { const reason = mutationFailureReason(error); recordStepFailure(operation, `move-${index}`, "conflicted", reason, { error: String((error as Error).message ?? error) }); results.push({ selector: { path: plan.from }, before: { path: plan.from, diagnosticId: plan.diagnosticId }, action: "move-worktree", after: null, reason }); }
    }
    const failed = results.some((result) => result.reason !== null);
    const result = { ...completeResult("fix --move", results, current.diagnostics, { dryRun: false, moves: plans }), outcome: failed ? "partial" as const : "complete" as const, operationId: operation.id };
    return ctx.emit.result(result, commandResultExit(result));
  });
}

export function registerFix(): void {
  register({ path: "fix", summary: "Apply explicit, freshly revalidated conformance repairs.", usage: "fix --move [--diagnostic <id>] [--repo <repo>] [--grove <grove>] [--dry-run]", args: [
    { name: "--move", desc: "Move uniquely misplaced native worktrees to their exact compiled paths." },
    { name: "--diagnostic <id>", desc: "Require one exact current diagnostic identity." },
    { name: "--repo <repo>", desc: "Limit moves to one repository." },
    { name: "--grove <grove>", desc: "Limit moves to one Grove." },
    { name: "--dry-run", desc: "Show the exact move plan without mutation." },
  ], note: "Always rescans under target locks before mutation and refuses stale or occupied plans.", examples: ["grove fix --move --dry-run", "grove fix --move --diagnostic <sha256>"], handler: fixHandler, mutates: true });
}
