import { createHash } from "node:crypto";

export interface DiagnosticIdentity {
  version: number;
  code: string;
  subject: unknown;
  facts: unknown;
}

function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

export function diagnosticId(identity: DiagnosticIdentity): string {
  return createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex");
}

export interface Diagnostic {
  id: string;
  version: 1;
  code: string;
  severity: "info" | "policy" | "blocking";
  subject: unknown;
  facts: unknown;
  summary: string;
  remedy: string;
}

export function makeDiagnostic(input: Omit<Diagnostic, "id" | "version">): Diagnostic {
  const identity = { version: 1, code: input.code, subject: input.subject, facts: input.facts };
  return { ...input, version: 1, id: diagnosticId(identity) };
}

export interface WorktreeAuditInput {
  repositoryId: string;
  grove?: string;
  tree?: string;
  currentPath: { utf8: string | null; raw: Uint8Array; display: string };
  expectedPath?: string | null;
  branch?: { utf8: string | null; raw: Uint8Array } | null;
  expectedBranch?: string | null;
  detached?: boolean;
  unborn?: boolean;
  prunable?: boolean;
  branchPresent?: boolean | null;
}

export function auditWorktree(input: WorktreeAuditInput): Diagnostic[] {
  const subject = { kind: "worktree", repositoryId: input.repositoryId, ...(input.grove ? { grove: input.grove } : {}), ...(input.tree ? { tree: input.tree } : {}) };
  if (input.currentPath.utf8 === null) return [makeDiagnostic({ code: "unsupported-native-path", severity: "policy", subject, facts: { currentPath: input.currentPath.raw }, summary: "Native worktree path is not valid UTF-8", remedy: "Use native Git with the escaped/base64 path evidence." })];
  const diagnostics: Diagnostic[] = [];
  if (input.prunable) diagnostics.push(makeDiagnostic({ code: "prunable", severity: "policy", subject, facts: { currentPath: input.currentPath.utf8 }, summary: "Git reports prunable worktree metadata", remedy: "Inspect and prune it explicitly with native Git." }));
  if (input.detached) diagnostics.push(makeDiagnostic({ code: "detached", severity: "info", subject, facts: { currentPath: input.currentPath.utf8 }, summary: "Worktree HEAD is detached", remedy: "Create or switch to a native branch if desired." }));
  if (input.unborn) diagnostics.push(makeDiagnostic({ code: "unborn", severity: "info", subject, facts: { currentPath: input.currentPath.utf8 }, summary: "Worktree branch has no commit yet", remedy: "Create the first commit with native Git." }));
  if (input.branch && input.branchPresent === false) diagnostics.push(makeDiagnostic({ code: "missing-ref", severity: "policy", subject, facts: { currentPath: input.currentPath.utf8, branch: input.branch.raw }, summary: "Worktree HEAD names a branch ref that no longer exists", remedy: "Restore the ref or repair the worktree HEAD explicitly with native Git." }));
  if (input.expectedPath && input.currentPath.utf8 !== input.expectedPath) diagnostics.push(makeDiagnostic({ code: "misplaced", severity: "policy", subject, facts: { currentPath: input.currentPath.utf8, expectedPath: input.expectedPath }, summary: "Worktree is outside its configured layout path", remedy: `Run \`git worktree move -- ${JSON.stringify(input.currentPath.utf8)} ${JSON.stringify(input.expectedPath)}\` or \`grove fix --move\`.` }));
  if (input.expectedBranch && input.branch?.utf8 && input.branch.utf8 !== `refs/heads/${input.expectedBranch}`) diagnostics.push(makeDiagnostic({ code: "nonconforming-branch", severity: "policy", subject, facts: { currentBranch: input.branch.raw, expectedBranch: Buffer.from(`refs/heads/${input.expectedBranch}`) }, summary: "Worktree branch differs from the naming convention", remedy: "Keep the valid Git branch or switch explicitly with native Git." }));
  return diagnostics;
}

export interface GitMoveOperation { kind: "move-worktree"; from: string; to: string; diagnosticId: string }
export function planMove(diagnostic: Diagnostic): GitMoveOperation | null { if (diagnostic.code !== "misplaced") return null; const facts = diagnostic.facts as { currentPath?: unknown; expectedPath?: unknown }; if (typeof facts.currentPath !== "string" || typeof facts.expectedPath !== "string") return null; return { kind: "move-worktree", from: facts.currentPath, to: facts.expectedPath, diagnosticId: diagnostic.id }; }
