import { GroveError } from "../errors.ts";
import { assertBranchName, assertRepoName, assertTreeName } from "../model/validate.ts";

export interface NamingConfig { branch: string; tree: string }
export const DEFAULT_CONVENTIONS: Readonly<NamingConfig> = Object.freeze({ branch: "{branchPrefix}{grove}", tree: "{grove}@{repo}" });
const TOKENS = { branch: new Set(["branchPrefix", "grove", "repo", "tree"]), tree: new Set(["grove", "repo"]) } as const;

function validateTemplate(kind: keyof typeof TOKENS, raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || Buffer.byteLength(raw) > 512) throw new GroveError({ kind: "config", what: "Invalid naming convention", why: `${kind} must be 1-512 UTF-8 bytes`, remedy: "Use a bounded naming template." });
  const found = [...raw.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1] as string);
  if (raw.replace(/\{[^{}]+\}/g, "").includes("{") || raw.replace(/\{[^{}]+\}/g, "").includes("}")) throw new GroveError({ kind: "config", what: "Invalid naming convention", why: `${kind} contains a partial brace token`, remedy: "Use only documented whole brace tokens." });
  if (found.length === 0 || found.some((t) => !TOKENS[kind].has(t as never)) || new Set(found).size !== found.length) throw new GroveError({ kind: "config", what: "Invalid naming convention", why: `${kind} must contain unique allowed identity tokens`, remedy: "Use only documented naming tokens once each." });
  return raw;
}

export function validateNamingConfig(raw: unknown): NamingConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GroveError({ kind: "config", what: "Invalid naming convention", why: "conventions must be an object", remedy: "Provide branch and tree templates." });
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).some((k) => k !== "branch" && k !== "tree")) throw new GroveError({ kind: "config", what: "Invalid naming convention", why: "unknown conventions key", remedy: "Use only branch and tree." });
  return { branch: validateTemplate("branch", obj.branch), tree: validateTemplate("tree", obj.tree) };
}

function render(template: string, values: Record<string, string>): string { return template.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? ""); }
export function expectedTreeName(config: NamingConfig, input: { grove: string; repo: string }): string { assertRepoName(input.repo); const value = render(config.tree, input); assertTreeName(value); return value; }
export function expectedBranch(config: NamingConfig, input: { branchPrefix: string; grove: string; repo: string; tree: string }): string { const value = render(config.branch, input); assertBranchName(value); return value; }
export function parseDisplayTreeSelector(input: string): { repositoryAlias?: string; tree: string } { const parts = input.split("/"); if (parts.length === 1) { assertTreeName(parts[0] as string); return { tree: parts[0] as string }; } if (parts.length === 2) { assertRepoName(parts[0] as string); assertTreeName(parts[1] as string); return { repositoryAlias: parts[0], tree: parts[1] as string }; } throw new GroveError({ kind: "invalid-input", what: "Invalid Tree selector", why: "expected <tree> or <repo>/<tree>", remedy: "Use a listed Tree selector." }); }
export const formatDisplayTreeSelector = (repoAlias: string, tree: string): string => `${repoAlias}/${tree}`;

