import { join } from "node:path";
export * from "../config/layout.ts";

export const GROVE_DIR = ".grove";
export const WORKSPACE_CONFIG = "config.json";
export const WORKSPACE_MARKER = join(GROVE_DIR, WORKSPACE_CONFIG);
export const LOCKS_DIR = "locks";
export const OPERATIONS_DIR = "operations";
export const CENTRAL_GROVES_DIR = "groves";
export const workspaceConfig = (ws: string): string => join(ws, GROVE_DIR, WORKSPACE_CONFIG);
export const groveDir = (ws: string): string => join(ws, GROVE_DIR);
export const locksDir = (ws: string): string => join(ws, GROVE_DIR, LOCKS_DIR);
export const operationsDir = (ws: string): string => join(ws, GROVE_DIR, OPERATIONS_DIR);
export const trunksDir = (ws: string): string => join(ws, "trunks");
export const grovesDir = (ws: string): string => join(ws, "groves");
export const centralGrovesDir = (ws: string): string => join(ws, GROVE_DIR, CENTRAL_GROVES_DIR);
export const manifestLock = (ws: string, id: string): string => join(locksDir(ws), `${id}.lock`);
export const tempFor = (path: string, token: string): string => { const i = path.lastIndexOf("/"); return `${path.slice(0, i + 1)}.${path.slice(i + 1)}.tmp.${token}`; };
export const isTempArtifact = (name: string): boolean => /^\..*\.tmp\..+$/.test(name);
