// Build the single bundled CLI artifact: dist/grove.mjs (§10).
// esbuild is a build-time dev dependency only; the runtime is Node's standard library.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/grove.mjs",
  banner: { js: "#!/usr/bin/env node" },
  define: { __GROVE_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
});
