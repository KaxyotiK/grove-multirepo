/**
 * Command registration aggregator. Each phase adds its command modules here; `registerAll` is
 * called once at startup. Help and completion are generated from whatever is registered.
 */
import { registerInit } from "./init.ts";
import { registerWorkspace } from "./workspace.ts";
import { registerReconcile } from "./reconcile.ts";
import { registerRepo } from "./repo.ts";
import { registerGrove } from "./grove.ts";
import { registerTree } from "./tree.ts";
import { registerAgent } from "./agent.ts";
import { registerReview } from "./review.ts";
import { registerFiles } from "./files.ts";
import { registerLifecycle } from "./lifecycle.ts";
import { registerTrunk } from "./trunk.ts";
import { registerCompletion } from "./completion.ts";
import { registerDoctor } from "./doctor.ts";
import { registerSync } from "./sync.ts";
import { registerFix } from "./fix.ts";

export function registerAll(): void {
  // US1 — establish a workspace.
  registerInit();
  registerWorkspace();
  registerReconcile();
  registerDoctor();
  registerFix();
  registerSync();
  // US2 — create a unit of work and run an agent.
  registerRepo();
  registerGrove();
  registerTree();
  registerAgent();
  // US3 — review work across a Grove.
  registerReview();
  registerFiles();
  // US4 — archive, restore, delete, rename, tree lifecycle.
  registerLifecycle();
  // US5 — trunk maintenance, destructive repo ops, completion.
  registerTrunk();
  registerCompletion();
}
