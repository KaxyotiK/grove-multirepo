/** Ownership-free schema-3 declarations. Git remains authoritative for refs and worktrees. */
export const SCHEMA_VERSION = 3 as const;

export type SyncStrategy = "fetch-only" | "ff-only" | "rebase";
export interface LayoutConfig { repositories: string; trunks: string; groves: string; trees: string; archives: string }
export interface NamingConfig { branch: string; tree: string }
export interface AgentDefinition { command: string; args: string[] }
export interface WorkspaceDefaults { agent?: string; branchPrefix?: string; syncStrategy?: SyncStrategy }
export type RepositoryLocation = { kind: "managed" } | { kind: "linked"; commonGitDir: string };
export interface RepositoryRegistration { id: string; name: string; location: RepositoryLocation; remote: string | null; trunk: string }
export type RepositoryEntry = RepositoryRegistration;
export interface WorkspaceConfig {
  kind: "workspace"; schemaVersion: 3; _rev: number; id: string; name: string;
  layout: LayoutConfig; conventions: NamingConfig; defaults: WorkspaceDefaults;
  agents: Record<string, AgentDefinition>; repositories: RepositoryRegistration[];
}

export interface TreeSelector { repositoryId: string; tree: string }
export interface TreeSettings { selector: TreeSelector; defaultAgent: string | null; workingDir: string | null }
export interface ArchiveRecipe { selector: TreeSelector; repositoryAlias: string | null; commonGitDir: string; branch: unknown | null; headOid: string | null; priorPath: unknown }
export interface ArchiveSnapshot { version: 1; archivedAt: string; looseContentPath: string | null; layoutRevision: string; recipes: ArchiveRecipe[] }
export interface GroveManifest {
  kind: "grove"; schemaVersion: 3; _rev: number; id: string; name: string;
  state: "active" | "archived"; createdAt: string; defaultAgent: string | null;
  defaultBase: string | null; treeOrder: TreeSelector[]; treeSettings: TreeSettings[];
  archiveSnapshot: ArchiveSnapshot | null;
}
