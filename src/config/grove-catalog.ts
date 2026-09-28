import { readdirSync } from "node:fs";
import { centralGrovesDir } from "../paths/layout.ts";
import { loadGroveAt, type LoadedGrove } from "./grove.ts";

export interface GroveCatalog { groves: LoadedGrove[]; errors: Array<{ path: string; why: string }> }
export function scanCentralGroveMetadata(root: string): GroveCatalog {
  const groves: LoadedGrove[] = [];
  const errors: Array<{ path: string; why: string }> = [];
  let names: string[] = [];
  try { names = readdirSync(centralGrovesDir(root)).filter((name) => name.endsWith(".json")).sort(); } catch { return { groves, errors }; }
  for (const name of names) {
    const path = `${centralGrovesDir(root)}/${name}`;
    try {
      const loaded = loadGroveAt(path);
      // `saveGroveManifest` ALWAYS writes to `<manifest.name>.json`, so filename and name agree for
      // every record Grove itself produces. Reading was keyed by `manifest.name` over every `*.json`
      // in sorted order, so any other file claiming the same name shadowed the real record — and an
      // ordinary `cp feat.json feat.backup.json` sorts FIRST. Observed consequence: `archive`
      // succeeds and writes `feat.json`, `ls` then reports the Grove active with 0 Trees from the
      // stale shadow, `restore` refuses "no archived restoration snapshot", and `doctor` reports
      // `orphaned-archive` — blaming a missing record that is present and correct on disk.
      //
      // Enforce the invariant the writer already maintains. `catalog.errors` is surfaced as the
      // existing `invalid-central-metadata` blocking diagnostic, so the duplicate becomes visible
      // instead of silently winning.
      if (name !== `${loaded.manifest.name}.json`) {
        errors.push({ path, why: `advisory metadata for Grove "${loaded.manifest.name}" must live at ${loaded.manifest.name}.json, not ${name}; a second file claiming one Grove silently shadows the real record` });
        continue;
      }
      groves.push(loaded);
    } catch (error) { errors.push({ path, why: String((error as Error).message ?? error) }); }
  }
  return { groves, errors };
}
