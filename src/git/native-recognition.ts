/** Read-only native Git checks for directories carrying possible independent Git metadata. */
import { spawnSync } from "node:child_process";

function probeGit(args: string[], validOutput: RegExp): { recognized: boolean; problem: string | null } {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  if (result.error) return { recognized: false, problem: String(result.error.message ?? result.error) };
  if (result.status === 0 && validOutput.test(result.stdout)) return { recognized: true, problem: null };
  return { recognized: false, problem: result.stderr.trim().split("\n")[0] || `Git exited ${String(result.status)}` };
}

export function recognizeGitDirectory(path: string): { recognized: boolean; problem: string | null } {
  return probeGit([`--git-dir=${path}`, "rev-parse", "--is-bare-repository"], /^(true|false)\s*$/);
}

export function recognizeGitCheckout(path: string): { recognized: boolean; problem: string | null } {
  return probeGit(["-C", path, "rev-parse", "--absolute-git-dir"], /^\/[^\r\n]+\s*$/);
}
