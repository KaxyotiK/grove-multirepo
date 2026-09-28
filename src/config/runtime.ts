import { GroveError } from "../errors.ts";
import { readManifest } from "../store/manifest.ts";
import { workspaceConfig } from "../paths/layout.ts";
import { discoverWorkspace, type DiscoverOptions } from "./discovery.ts";

export interface WorkspaceRuntime {
  root: string;
  schemaVersion: number;
}

/** Inspect only the schema discriminator so command modules can keep the v1 transition isolated. */
export function workspaceRuntime(options: DiscoverOptions): WorkspaceRuntime {
  const root = discoverWorkspace(options);
  const path = workspaceConfig(root);
  const { value } = readManifest<{ _rev?: number; schemaVersion?: unknown }>(path);
  if (!Number.isSafeInteger(value.schemaVersion)) {
    throw new GroveError({
      kind: "config",
      what: `${path} has no valid schema discriminator`,
      why: "schemaVersion must be an integer",
      remedy: "Repair the workspace configuration before retrying.",
    });
  }
  return { root, schemaVersion: value.schemaVersion as number };
}

