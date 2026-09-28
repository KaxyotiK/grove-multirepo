import { isAbsolute, normalize } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { GroveError } from "../errors.ts";
import { readManifest, writeManifest, type ManifestMeta } from "../store/manifest.ts";
import { workspaceConfig } from "../paths/layout.ts";
import { SCHEMA_VERSION, type AgentDefinition, type RepositoryRegistration, type WorkspaceConfig, type WorkspaceDefaults } from "../model/types.ts";
import { discoverWorkspace, type DiscoverOptions } from "./discovery.ts";
import type { CommandContext } from "../commands/registry.ts";
import { validateLayoutConfig } from "./layout.ts";
import { CONTROL_RE, visibleControl } from "../model/control.ts";
import { validateNamingConfig } from "./conventions.ts";
import { checkBranchName, checkGroveName, checkRemoteName, checkRepoName } from "../model/validate.ts";
import { VERSION, executablePath } from "../version.ts";

const TOP_KEYS = new Set(["kind", "schemaVersion", "_rev", "id", "name", "layout", "conventions", "defaults", "agents", "repositories"]);
const exactObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function refuse(path: string, why: string): never { throw new GroveError({ kind: "config", what: `${path} is not a valid workspace configuration`, why, remedy: "Fix the schema-v3 file.", detail: { path } }); }
/**
 * Ruling ⑥: there is no N-1 compatibility, so a skew refusal is correct — but it must be
 * diagnosable. A machine with several installed builds gives no way to tell *which* binary
 * refused unless the error says so, so name the running version, its resolved path, and both
 * schema numbers in the detail and in the human text.
 */
function skew(path: string, found: unknown, what: string): never {
  const executable = executablePath();
  throw new GroveError({
    kind: "version-skew",
    what,
    why: `grove ${VERSION} at ${executable} supports schema version ${SCHEMA_VERSION}`,
    remedy: "Use a Grove build supporting this schema, or recreate the workspace with this one.",
    detail: { path, found, supported: SCHEMA_VERSION, runningVersion: VERSION, executablePath: executable, workspaceSchema: found },
  });
}

function unknownKeys(path: string, obj: Record<string, unknown>, allowed: ReadonlySet<string>): void { for (const key of Object.keys(obj)) if (!allowed.has(key)) refuse(path, `unknown key "${key}"`); }

function defaultsAt(path: string, raw: unknown): WorkspaceDefaults {
  if (!exactObject(raw)) refuse(path, "defaults is missing or not an object");
  unknownKeys(path, raw, new Set(["agent", "branchPrefix", "syncStrategy"]));
  if (raw.agent !== undefined && typeof raw.agent !== "string") refuse(path, "defaults.agent must be a string");
  if (raw.branchPrefix !== undefined && typeof raw.branchPrefix !== "string") refuse(path, "defaults.branchPrefix must be a string");
  if (raw.syncStrategy !== undefined && !["fetch-only", "ff-only", "rebase"].includes(String(raw.syncStrategy))) refuse(path, "defaults.syncStrategy is invalid");
  return raw as WorkspaceDefaults;
}

function agentsAt(path: string, raw: unknown): Record<string, AgentDefinition> {
  if (!exactObject(raw)) refuse(path, "agents is missing or not an object");
  for (const [name, value] of Object.entries(raw)) {
    if (!exactObject(value)) refuse(path, `agent ${name} is not an object`);
    unknownKeys(path, value, new Set(["command", "args"]));
    if (typeof value.command !== "string" || !Array.isArray(value.args) || value.args.some((v) => typeof v !== "string")) refuse(path, `agent ${name} is invalid`);
  }
  return raw as Record<string, AgentDefinition>;
}

function repositoryAt(path: string, raw: unknown, index: number): RepositoryRegistration {
  if (!exactObject(raw)) refuse(path, `repositories[${index}] is not an object`);
  unknownKeys(path, raw, new Set(["id", "name", "location", "remote", "trunk"]));
  if (typeof raw.id !== "string" || raw.id.length === 0) refuse(path, `repositories[${index}].id is missing`);
  if (typeof raw.name !== "string" || checkRepoName(raw.name)) refuse(path, `repositories[${index}].name is invalid`);
  if (typeof raw.trunk !== "string" || checkBranchName(raw.trunk)) refuse(path, `repositories[${index}].trunk is invalid`);
  if (raw.remote !== null && (typeof raw.remote !== "string" || checkRemoteName(raw.remote))) refuse(path, `repositories[${index}].remote is invalid`);
  if (!exactObject(raw.location)) refuse(path, `repositories[${index}].location is invalid`);
  if (raw.location.kind === "managed") unknownKeys(path, raw.location, new Set(["kind"]));
  else if (raw.location.kind === "linked") { unknownKeys(path, raw.location, new Set(["kind", "commonGitDir"])); if (typeof raw.location.commonGitDir !== "string" || !isAbsolute(raw.location.commonGitDir) || normalize(raw.location.commonGitDir) !== raw.location.commonGitDir) refuse(path, `repositories[${index}].location.commonGitDir must be canonical and absolute`); }
  else refuse(path, `repositories[${index}].location.kind is invalid`);
  return raw as unknown as RepositoryRegistration;
}

export function validateWorkspaceConfig(path: string, raw: unknown): WorkspaceConfig {
  if (!exactObject(raw)) refuse(path, "the top-level value is not an object");
  if (raw.kind !== "workspace") refuse(path, `expected "kind":"workspace"`);
  if (typeof raw.schemaVersion !== "number") refuse(path, "schemaVersion is missing or not a number");
  if (raw.schemaVersion !== SCHEMA_VERSION) throw skew(path, raw.schemaVersion, `${path} uses schema version ${raw.schemaVersion}`);
  unknownKeys(path, raw, TOP_KEYS);
  if (!Number.isSafeInteger(raw._rev) || Number(raw._rev) < 0) refuse(path, "_rev must be a nonnegative integer");
  if (typeof raw.id !== "string" || raw.id.length === 0) refuse(path, "id is missing");
  if (typeof raw.name !== "string" || checkGroveName(raw.name)) refuse(path, "name is invalid");
  const layout = validateLayoutConfig(raw.layout);
  const conventions = validateNamingConfig(raw.conventions);
  const defaults = defaultsAt(path, raw.defaults);
  const agents = agentsAt(path, raw.agents);
  if (!Array.isArray(raw.repositories)) refuse(path, "repositories is missing or not an array");
  const repositories = raw.repositories.map((v, i) => repositoryAt(path, v, i));
  const ids = new Set<string>(), names = new Set<string>();
  for (const repo of repositories) { if (ids.has(repo.id)) refuse(path, `duplicate repository id ${repo.id}`); ids.add(repo.id); const folded = repo.name.toLowerCase(); if (names.has(folded)) refuse(path, `duplicate repository alias ${repo.name}`); names.add(folded); }
  return { kind: "workspace", schemaVersion: 3, _rev: raw._rev as number, id: raw.id, name: raw.name, layout, conventions, defaults, agents, repositories };
}

export interface LoadedWorkspace { root: string; path: string; config: WorkspaceConfig; meta: ManifestMeta }
export function loadWorkspaceAt(root: string): LoadedWorkspace { const path = workspaceConfig(root); const { value, meta } = readManifest<WorkspaceConfig>(path); return { root, path, config: validateWorkspaceConfig(path, value), meta }; }
export function requireWorkspace(input: CommandContext | DiscoverOptions): LoadedWorkspace {
  if ("spec" in input) {
    if (input.spec.workspaceIndependent) throw new Error(`grove ${input.spec.path} is declared workspaceIndependent but required a workspace`);
    return loadWorkspaceAt(discoverWorkspace({ cwd: input.cwd, workspace: input.globals.workspace }));
  }
  return loadWorkspaceAt(discoverWorkspace(input));
}
export function saveWorkspace(ws: LoadedWorkspace, next: WorkspaceConfig): Promise<ManifestMeta> { validateWorkspaceConfig(ws.path, next); return writeManifest(ws.path, next, { workspace: ws.root, expected: ws.meta }); }

export interface ConfigChangeEvidence { hasGroveLooseContent: boolean; hasArchiveLooseContent: boolean }
/**
 * Values a config CHANGE may not introduce.
 *
 * `agent add` rejects control and bidi-override characters on write (src/commands/agent.ts: agent
 * definitions live in the COMMITTED, shared `.grove/config.json`, so a crafted value travels with
 * a repo). `config set` writes the same `agents` and `defaults` keys and skipped that check, so
 * `config set --values '{"defaults":{"agent":"<ESC>[31mPWNED<ESC>[0m"}}'` smuggled ESC bytes in and
 * `agent run`'s not-found error then printed them raw.
 *
 * This is deliberately a CHANGE-time rule, not a load-time one. A workspace whose config already
 * contains such a value must stay openable — `agent ls` and `file ls` escape stored values with
 * `visibleControl` for exactly that case, and refusing to load would brick the workspace instead of
 * showing the user what is wrong with it. Reject on write; escape on display.
 */
function assertNoIntroducedControl(next: WorkspaceConfig): void {
  const check = (value: string, label: string): void => {
    if (!CONTROL_RE.test(value)) return;
    throw new GroveError({
      kind: "invalid-input",
      what: `Cannot use a control character in ${label}`,
      why: "the value contains a control or bidi-override character (e.g. ESC or U+202E), which could inject or reorder terminal output for anyone who checks out this workspace",
      remedy: "Remove control and bidirectional-formatting characters from the value.",
      detail: { label },
    });
  };
  if (next.defaults.agent) check(next.defaults.agent, "defaults.agent");
  if (next.defaults.branchPrefix) check(next.defaults.branchPrefix, "defaults.branchPrefix");
  for (const [name, definition] of Object.entries(next.agents)) {
    check(name, `the agent name "${visibleControl(name)}"`);
    check(definition.command, `agent ${visibleControl(name)}'s command`);
    definition.args.forEach((arg, index) => check(arg, `agent ${visibleControl(name)}'s args[${index}]`));
  }
}

export function validateWorkspaceConfigChange(current: WorkspaceConfig, next: WorkspaceConfig, evidence: ConfigChangeEvidence): void {
  assertNoIntroducedControl(next);
  if (current.layout.repositories !== next.layout.repositories && current.repositories.some((repo) => repo.location.kind === "managed")) throw new GroveError({ kind: "refused-policy", what: "Cannot change layout.repositories", why: "managed repositories are still registered at paths derived only from the current template", remedy: "Unregister and natively relocate/re-register those repositories first." });
  if (current.layout.groves !== next.layout.groves && evidence.hasGroveLooseContent) throw new GroveError({ kind: "refused-policy", what: "Cannot change layout.groves", why: "loose Grove content would become undiscoverable", remedy: "Move, archive, or remove the loose content first." });
  if (current.layout.archives !== next.layout.archives && evidence.hasArchiveLooseContent) throw new GroveError({ kind: "refused-policy", what: "Cannot change layout.archives", why: "archived loose content would become undiscoverable", remedy: "Restore, move, or remove the archived loose content first." });
}
