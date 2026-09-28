import { isAbsolute, resolve, sep } from "node:path";
import { GroveError } from "../errors.ts";
import { resolveContained } from "../paths/fs.ts";
import { scanTemplateCandidates } from "./discovery.ts";
import { assertGroveName, assertRepoName, assertTreeName, checkRepoName } from "../model/validate.ts";

export interface LayoutConfig {
  repositories: string;
  trunks: string;
  groves: string;
  trees: string;
  archives: string;
}

export const DEFAULT_LAYOUT: Readonly<LayoutConfig> = Object.freeze({
  repositories: "repos/{repo}",
  trunks: "trunks/{trunk}",
  groves: "groves/{grove}",
  trees: "groves/{grove}/trees/{tree}",
  archives: "archives/{grove}",
});

const LAYOUT_KEYS = ["repositories", "trunks", "groves", "trees", "archives"] as const;
type LayoutKey = (typeof LAYOUT_KEYS)[number];
const ALLOWED: Record<LayoutKey, ReadonlySet<string>> = {
  repositories: new Set(["repo"]),
  trunks: new Set(["trunk"]),
  groves: new Set(["grove"]),
  trees: new Set(["grove", "tree", "repo"]),
  archives: new Set(["grove"]),
};
const REQUIRED: Record<LayoutKey, readonly string[]> = {
  repositories: ["repo"],
  trunks: ["trunk"],
  groves: ["grove"],
  trees: ["grove", "tree"],
  archives: ["grove"],
};
const STATIC_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function invalid(why: string): never {
  throw new GroveError({
    kind: "config",
    what: "Invalid workspace layout",
    why,
    remedy: "Use whole-segment layout tokens and keep every role inside the workspace.",
  });
}

function segmentsFor(key: LayoutKey, value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) invalid(`layout.${key} is missing or empty`);
  if (isAbsolute(value) || value.includes("\\")) invalid(`layout.${key} must be a workspace-relative POSIX path`);
  const segments = value.split("/");
  if (segments.some((part) => part.length === 0 || part === "." || part === "..")) {
    invalid(`layout.${key} contains an empty, current, or parent path segment`);
  }
  const seen = new Set<string>();
  for (const segment of segments) {
    const exact = segment.match(/^\{([A-Za-z][A-Za-z0-9]*)\}$/)?.[1];
    if (segment.includes("{") || segment.includes("}")) {
      if (!exact) invalid(`tokens in layout.${key} must occupy an entire segment`);
      if (!ALLOWED[key].has(exact)) invalid(`layout.${key} does not allow {${exact}}`);
      if (seen.has(exact)) invalid(`layout.${key} repeats {${exact}}`);
      seen.add(exact);
      continue;
    }
    if ((!STATIC_SEGMENT.test(segment) && segment !== ".bare") || segment === ".grove") {
      invalid(`layout.${key} has unsafe static segment "${segment}"`);
    }
  }
  for (const token of REQUIRED[key]) {
    if (!seen.has(token)) invalid(`layout.${key} must contain {${token}} exactly once`);
  }
  return segments;
}

export function validateLayoutConfig(raw: unknown): LayoutConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid("layout must be an object");
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!LAYOUT_KEYS.includes(key as LayoutKey)) invalid(`unknown layout key "${key}"`);
  const parsed = Object.fromEntries(LAYOUT_KEYS.map((key) => [key, segmentsFor(key, obj[key]).join("/")])) as unknown as LayoutConfig;
  const grove = parsed.groves.split("/");
  const trees = parsed.trees.split("/");
  if (trees.length <= grove.length || grove.some((part, i) => trees[i] !== part)) {
    invalid("layout.trees must be structurally nested under layout.groves");
  }
  const patterns = LAYOUT_KEYS.map((key) => ({ key, segments: parsed[key].split("/") }));
  for (let left = 0; left < patterns.length; left++) for (let right = left + 1; right < patterns.length; right++) {
    const a = patterns[left]!;
    const b = patterns[right]!;
    // A Grove root intentionally contains its Trees. Every other role pair must diverge before
    // either accepted path can end: a token can match any valid single-segment name, including a
    // peer's static segment. Static segments are ASCII by grammar, so this fold models the default
    // case-insensitive macOS filesystem without locale-dependent Unicode behavior.
    if ((a.key === "groves" && b.key === "trees") || (a.key === "trees" && b.key === "groves")) continue;
    const shared = Math.min(a.segments.length, b.segments.length);
    const overlaps = a.segments.slice(0, shared).every((segment, index) => {
      const peer = b.segments[index]!;
      const token = segment.match(/^\{(.+)\}$/)?.[1];
      const peerToken = peer.match(/^\{(.+)\}$/)?.[1];
      if (!token && !peerToken) return segment.toLowerCase() === peer.toLowerCase();
      return true;
    });
    if (overlaps) invalid(`layout.${a.key} and layout.${b.key} accept an overlapping path`);
  }
  return parsed;
}

export interface CompiledLayout {
  workspaceRoot: string;
  config: LayoutConfig;
}

export function compileLayout(workspaceRoot: string, layout: LayoutConfig): CompiledLayout {
  return { workspaceRoot: resolve(workspaceRoot), config: validateLayoutConfig(layout) };
}

/** Static directory prefixes whose contents are reserved for compiled layout roles. */
export function compiledLayoutRoots(layout: CompiledLayout): string[] {
  return [...new Set(LAYOUT_KEYS.map((key) => {
    const segments: string[] = [];
    for (const segment of layout.config[key].split("/")) {
      if (/^\{.+\}$/.test(segment)) break;
      segments.push(segment);
    }
    return resolve(layout.workspaceRoot, ...segments);
  }))].sort();
}

/** Concrete root below which one Grove's Tree allocations live. */
export function groveTreeRoot(layout: CompiledLayout, grove: string): string {
  assertGroveName(grove);
  const segments: string[] = [];
  for (const segment of layout.config.trees.split("/")) {
    const token = segment.match(/^\{(.+)\}$/)?.[1];
    if (!token) segments.push(segment);
    else if (token === "grove") segments.push(grove);
    else break;
  }
  return resolve(layout.workspaceRoot, ...segments);
}

function expand(compiled: CompiledLayout, key: LayoutKey, values: Record<string, string>): string {
  const relative = compiled.config[key]
    .split("/")
    .map((segment) => {
      const token = segment.match(/^\{(.+)\}$/)?.[1];
      return token ? values[token] : segment;
    })
    .join(sep);
  if (relative.includes("undefined")) invalid(`layout.${key} expansion is missing a token value`);
  return resolve(compiled.workspaceRoot, relative);
}

export function expandRepositoryPath(layout: CompiledLayout, repo: string): string {
  assertRepoName(repo);
  return expand(layout, "repositories", { repo });
}

export function expandTrunkPath(layout: CompiledLayout, trunk: string): string {
  if (trunk.length > 210 || !/^[A-Za-z0-9._@~-]+$/.test(trunk) || trunk.split("@").length !== 2) {
    invalid("invalid allocated trunk expansion value");
  }
  return expand(layout, "trunks", { trunk });
}

export function expandGrovePath(layout: CompiledLayout, grove: string): string {
  assertGroveName(grove);
  return expand(layout, "groves", { grove });
}

export function expandArchivePath(layout: CompiledLayout, grove: string): string {
  assertGroveName(grove);
  return expand(layout, "archives", { grove });
}

export function expandTreePath(layout: CompiledLayout, grove: string, tree: string, repo: string): string {
  assertGroveName(grove);
  assertTreeName(tree);
  assertRepoName(repo);
  return expand(layout, "trees", { grove, tree, repo });
}

/** Existing empty ancestors of Tree allocations that carry layout structure, not loose content. */
export function structuralTreeSlotPaths(layout: CompiledLayout, grove: string, repositoryNames: readonly string[]): string[] {
  assertGroveName(grove);
  const segments = layout.config.trees.split("/");
  const treeIndex = segments.indexOf("{tree}");
  const prefix = segments.slice(0, treeIndex);
  const repositories = prefix.includes("{repo}") ? repositoryNames : [""];
  const registered = repositories.map((repo) => resolve(layout.workspaceRoot, ...prefix.map((segment) => segment === "{grove}" ? grove : segment === "{repo}" ? repo : segment)));
  const repoIndex = prefix.indexOf("{repo}");
  const existing = scanTemplateCandidates(layout.workspaceRoot, prefix.join("/"))
    .filter((path) => path === expandGrovePath(layout, grove) || path.startsWith(`${expandGrovePath(layout, grove)}${sep}`))
    .filter((path) => repoIndex < 0 || checkRepoName(path.slice(layout.workspaceRoot.length + 1).split(sep)[repoIndex] ?? "") === null);
  return [...new Set([...registered, ...existing])].sort();
}

export function resolveLayoutTarget(layout: CompiledLayout, expandedPath: string): string {
  const relative = expandedPath.slice(layout.workspaceRoot.length + 1);
  const lexical = resolve(expandedPath);
  const canonical = resolveContained(layout.workspaceRoot, relative, "Cannot use the expanded layout target");
  if (lexical !== canonical) {
    throw new GroveError({
      kind: "invalid-input",
      what: "Cannot use the expanded layout target",
      why: "its lexical and canonical symlink-expanded path identities differ",
      remedy: "Remove the symlink from the layout path or choose a layout with one canonical path identity.",
      detail: { lexical, canonical },
    });
  }
  return lexical;
}

export function assertNoLayoutCollisions(paths: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const key = resolve(path).toLowerCase();
    const prior = seen.get(key);
    if (prior !== undefined) invalid(`expanded layout targets collide under case-folding: ${prior} and ${path}`);
    seen.set(key, path);
  }
}

export const centralGroveManifest = (workspaceRoot: string, grove: string): string => {
  assertGroveName(grove);
  return resolve(workspaceRoot, ".grove", "groves", `${grove}.json`);
};

export interface LayoutMatch { role: "repository" | "trunk" | "grove" | "tree" | "archive"; repo?: string; trunk?: string; grove?: string; tree?: string }
function matchRole(layout: CompiledLayout, key: LayoutKey, absolutePath: string): Record<string, string> | null {
  const root = `${layout.workspaceRoot}${sep}`;
  const resolved = resolve(absolutePath);
  if (!resolved.startsWith(root)) return null;
  const actual = resolved.slice(root.length).split(sep);
  const pattern = layout.config[key].split("/");
  if (actual.length !== pattern.length) return null;
  const values: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const token = pattern[i]?.match(/^\{(.+)\}$/)?.[1];
    if (token) values[token] = actual[i] as string;
    else if (pattern[i] !== actual[i]) return null;
  }
  try { if (values.repo) assertRepoName(values.repo); if (values.grove) assertGroveName(values.grove); if (values.tree) assertTreeName(values.tree); } catch { return null; }
  return values;
}
export function matchLayoutPath(layout: CompiledLayout, path: string): LayoutMatch | null {
  const order: Array<[LayoutKey, LayoutMatch["role"]]> = [["repositories", "repository"], ["trunks", "trunk"], ["trees", "tree"], ["groves", "grove"], ["archives", "archive"]];
  for (const [key, role] of order) { const values = matchRole(layout, key, path); if (values) return { role, ...values }; }
  return null;
}
export function matchGroveAndTree(layout: CompiledLayout, _existingGroveDirs: readonly string[], path: string): LayoutMatch | null { const match = matchLayoutPath(layout, path); return match?.role === "tree" ? match : null; }
