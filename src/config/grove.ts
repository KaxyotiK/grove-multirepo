import { existsSync } from "node:fs";
import { basename } from "node:path";
import { GroveError } from "../errors.ts";
import { readManifest, writeManifest, type ManifestMeta } from "../store/manifest.ts";
import { centralGroveManifest } from "./layout.ts";
import { SCHEMA_VERSION, type GroveManifest, type TreeSelector, type TreeSettings } from "../model/types.ts";
import { createIdGenerator } from "../model/ids.ts";
import { checkTreeName } from "../model/validate.ts";
import { VERSION, executablePath } from "../version.ts";

const KEYS = new Set(["kind", "schemaVersion", "_rev", "id", "name", "state", "createdAt", "defaultAgent", "defaultBase", "treeOrder", "treeSettings", "archiveSnapshot"]);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function refuse(path: string, why: string): never {
  throw new GroveError({ kind: "config", what: `${path} is not valid Grove metadata`, why, remedy: "Repair or remove the advisory metadata; Git state remains authoritative.", detail: { path } });
}
function selectorAt(path: string, raw: unknown, at: string): TreeSelector {
  if (!object(raw)) refuse(path, `${at} is not an object`);
  for (const key of Object.keys(raw)) if (key !== "repositoryId" && key !== "tree") refuse(path, `${at} has unknown key "${key}"`);
  if (typeof raw.repositoryId !== "string" || raw.repositoryId.length === 0) refuse(path, `${at}.repositoryId is missing`);
  if (typeof raw.tree !== "string" || checkTreeName(raw.tree)) refuse(path, `${at}.tree is invalid`);
  return raw as unknown as TreeSelector;
}
export function validateGroveManifest(path: string, raw: unknown): GroveManifest {
  if (!object(raw)) refuse(path, "top-level value is not an object");
  if (raw.kind !== "grove") refuse(path, "kind must be grove");
  if (raw.schemaVersion !== SCHEMA_VERSION) { const executable = executablePath(); throw new GroveError({ kind: "version-skew", what: `${path} uses Grove metadata schema version ${String(raw.schemaVersion)}`, why: `grove ${VERSION} at ${executable} supports schema version ${SCHEMA_VERSION}`, remedy: "Use a Grove build supporting this schema, or remove the advisory metadata; Git state remains authoritative.", detail: { path, found: raw.schemaVersion, supported: SCHEMA_VERSION, runningVersion: VERSION, executablePath: executable, workspaceSchema: raw.schemaVersion } }); }
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) refuse(path, `unknown key "${key}"`);
  if (!Number.isSafeInteger(raw._rev) || Number(raw._rev) < 0 || typeof raw.id !== "string" || raw.id.length === 0 || typeof raw.name !== "string" || raw.name.length === 0) refuse(path, "revision, id, or name is invalid");
  if (raw.state !== "active" && raw.state !== "archived") refuse(path, "state is invalid");
  if (typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))) refuse(path, "createdAt is invalid");
  if (raw.defaultAgent !== null && typeof raw.defaultAgent !== "string") refuse(path, "defaultAgent is invalid");
  if (raw.defaultBase !== null && typeof raw.defaultBase !== "string") refuse(path, "defaultBase is invalid");
  if (!Array.isArray(raw.treeOrder) || !Array.isArray(raw.treeSettings)) refuse(path, "treeOrder/treeSettings must be arrays");
  const treeOrder = raw.treeOrder.map((value, index) => selectorAt(path, value, `treeOrder[${index}]`));
  const treeSettings = raw.treeSettings.map((value, index): TreeSettings => {
    const at = `treeSettings[${index}]`;
    if (!object(value)) refuse(path, `${at} is not an object`);
    for (const key of Object.keys(value)) if (!new Set(["selector", "defaultAgent", "workingDir"]).has(key)) refuse(path, `${at} has unknown key "${key}"`);
    const selector = selectorAt(path, value.selector, `${at}.selector`);
    if (value.defaultAgent !== null && typeof value.defaultAgent !== "string") refuse(path, `${at}.defaultAgent is invalid`);
    if (value.workingDir !== null && typeof value.workingDir !== "string") refuse(path, `${at}.workingDir is invalid`);
    return { selector, defaultAgent: value.defaultAgent as string | null, workingDir: value.workingDir as string | null };
  });
  if (raw.archiveSnapshot !== null && !object(raw.archiveSnapshot)) refuse(path, "archiveSnapshot must be object or null");
  return { ...(raw as unknown as GroveManifest), treeOrder, treeSettings };
}

export interface LoadedGrove { name: string; path: string; state: "active" | "archived"; manifest: GroveManifest; meta: ManifestMeta }
export function loadGroveAt(path: string): LoadedGrove { const { value, meta } = readManifest<GroveManifest>(path); const manifest = validateGroveManifest(path, value); return { name: manifest.name || basename(path, ".json"), path, state: manifest.state, manifest, meta }; }
export function loadCentralGroveMetadata(root: string, name: string): LoadedGrove | null { const path = centralGroveManifest(root, name); return existsSync(path) ? loadGroveAt(path) : null; }
export function saveGroveManifest(root: string, manifest: GroveManifest, expected?: ManifestMeta): Promise<ManifestMeta> { const path = centralGroveManifest(root, manifest.name); validateGroveManifest(path, manifest); return writeManifest(path, manifest, { workspace: root, ...(expected ? { expected } : {}) }); }
export function newGroveManifest(name: string, state: "active" | "archived" = "active"): GroveManifest { return { kind: "grove", schemaVersion: 3, _rev: 0, id: createIdGenerator().ulid(), name, state, createdAt: new Date().toISOString(), defaultAgent: null, defaultBase: null, treeOrder: [], treeSettings: [], archiveSnapshot: null }; }
