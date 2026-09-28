import { after, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGitGate, waitForGitGate } from "../testkit/git-gate.ts";
import { createFsFaultBoundary, waitForFsFault } from "../testkit/fs-fault.ts";
import { createGitFaultBoundary, killAndReapFaultProcess, processGroupAlive, spawnFaultProcess, waitForGitFault, type FaultProcess } from "../testkit/git-fault.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

interface ReadinessBoundary {
  env: Record<string, string>;
  nodeArgs: string[];
  action: string;
  wait(child: FaultProcess): Promise<unknown>;
  dispose(): void;
}

const gitAction = 'require("node:child_process").spawnSync("git", ["--version"], { stdio: "inherit" });';
const boundaries: Array<{ name: string; create(cwd: string): ReadinessBoundary }> = [
  {
    name: "Git gate",
    create() {
      const gate = createGitGate(["--version"]);
      return { env: gate.env, nodeArgs: [], action: gitAction, wait: (child) => waitForGitGate(gate, child), dispose: gate.dispose };
    },
  },
  {
    name: "Git fault",
    create() {
      const boundary = createGitFaultBoundary({ exactGitArgs: ["--version"] });
      return { env: boundary.env, nodeArgs: [], action: gitAction, wait: (child) => waitForGitFault(boundary, child), dispose: () => boundary.dispose() };
    },
  },
  {
    name: "filesystem fault",
    create(cwd) {
      const target = join(cwd, "record.json");
      const temporary = join(cwd, ".record.json.tmp.test");
      writeFileSync(temporary, "{}\n");
      const boundary = createFsFaultBoundary(target);
      return {
        env: boundary.env,
        nodeArgs: ["--import", boundary.preloadPath],
        action: `require("node:fs").renameSync(${JSON.stringify(temporary)}, ${JSON.stringify(target)});`,
        wait: (child) => waitForFsFault(boundary, child),
        dispose: boundary.dispose,
      };
    },
  },
];

for (const { name, create } of boundaries) {
  test(`${name} tolerates slow preflight before the exact boundary`, { timeout: 90_000 }, async () => {
    const cwd = tempDir("slow-boundary");
    const boundary = create(cwd);
    // Model process scheduling/preflight that exceeds the old five-second readiness window.
    const child = spawnFaultProcess(process.execPath, [...boundary.nodeArgs, "-e", `setTimeout(() => { ${boundary.action} }, 6_000);`], {
      cwd, env: { ...process.env, ...boundary.env },
    });
    try {
      assert.ok(await boundary.wait(child));
      assert.equal(child.child.exitCode, null, "the child is still held at the boundary");
      assert.equal(processGroupAlive(child.child.pid!), true);
    } finally {
      try { await killAndReapFaultProcess(child); }
      finally { boundary.dispose(); }
    }
  });

  test(`${name} reports an exited process instead of waiting for readiness`, async () => {
    const cwd = tempDir("exited-boundary");
    const boundary = create(cwd);
    const child = spawnFaultProcess(process.execPath, [...boundary.nodeArgs, "-e", 'process.stderr.write("boundary setup failed\\n"); process.exit(7);'], {
      cwd, env: { ...process.env, ...boundary.env },
    });
    try {
      await child.closed;
      await assert.rejects(() => boundary.wait(child), /Process exited before.*code=7[\s\S]*boundary setup failed/);
    } finally {
      try { if (processGroupAlive(child.child.pid!)) await killAndReapFaultProcess(child); }
      finally { boundary.dispose(); }
    }
  });
}
