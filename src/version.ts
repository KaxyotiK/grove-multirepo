/**
 * Build identity, shared so a version-skew refusal can name the binary that produced it (ruling ⑥).
 *
 * `__GROVE_VERSION__` is replaced by esbuild (`build.mjs`) with the package version; under `tsx`
 * and the module tests it is undefined, so the literal fallback marks an unbundled run.
 */
import { realpathSync } from "node:fs";

declare const __GROVE_VERSION__: string;

export const VERSION = typeof __GROVE_VERSION__ === "string" ? __GROVE_VERSION__ : "0.0.0-dev";

/**
 * The executable actually running, resolved through symlinks. A machine with several installed
 * builds otherwise gives no way to tell which one refused: `grove --version` reports whichever is
 * first on PATH, which need not be the one that failed.
 */
export function executablePath(): string {
  const raw = process.argv[1] ?? "";
  if (raw === "") return "unknown";
  try { return realpathSync(raw); } catch { return raw; }
}
