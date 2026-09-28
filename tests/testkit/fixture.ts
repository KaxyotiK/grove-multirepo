/**
 * The fixture builder — stands up N local bare repos with known commits and branches,
 * offline, plus an isolated HOME and an empty workspace root, so every command test runs
 * against real Git with no network and never touches the developer's real home or config.
 *
 * Rewritten from the pinned source for the workspace-local model: there is NO global state
 * directory. A test either runs `grove init` in `root`, or uses `initWorkspace()` below.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./tmp.ts";
import { dirBase, slugForBranch, slugForRepo } from "../../src/model/encoding.ts";

/** The built CLI artifact under test (§11 layer 2 runs against this, not in-process). */
export const CLI = fileURLToPath(new URL("../../dist/grove.mjs", import.meta.url));

export interface FixtureRepo {
  name: string;
  /** Bare origin the workspace clones from (a local `file://`-style path). */
  origin: string;
  branches: string[];
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface Fixture {
  /** Empty workspace root (realpathed). Run `grove init` here, or use `initWorkspace`. */
  root: string;
  /** Isolated HOME — asserts that no command writes under ~ (ISO-05). */
  home: string;
  repos: FixtureRepo[];
  /** Run the built CLI with the isolated HOME; cwd defaults to the workspace root. */
  grove(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): RunResult;
  cleanup(): void;
}

const git = (cwd: string, args: string[]): void => {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
};

export interface FixtureOptions {
  /** Repo name → extra branches beyond `main`. Defaults to a single `alpha` repo. */
  repos?: Record<string, string[]>;
}

export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const base = tempDir("fx");
  const home = join(base, "home");
  const root = join(base, "grove");
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });

  const repos: FixtureRepo[] = [];
  for (const [name, extra] of Object.entries(opts.repos ?? { alpha: [] })) {
    const origin = join(base, "origins", `${name}.git`);
    const seed = join(base, "seeds", name);
    mkdirSync(join(base, "origins"), { recursive: true });
    mkdirSync(join(base, "seeds"), { recursive: true });

    git(base, ["init", "-q", "--bare", "--initial-branch=main", origin]);
    git(base, ["clone", "-q", origin, seed]);
    git(seed, ["config", "user.email", "fixture@grove.test"]);
    git(seed, ["config", "user.name", "Fixture"]);
    writeFileSync(join(seed, "README.md"), `# ${name}\n`);
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-qm", `init ${name}`]);
    git(seed, ["push", "-q", "origin", "HEAD:main"]);
    for (const b of extra) {
      git(seed, ["branch", b, "main"]);
      git(seed, ["push", "-q", "origin", b]);
    }
    repos.push({ name, origin, branches: ["main", ...extra] });
  }

  return {
    root,
    home,
    repos,
    grove(args, runOpts = {}): RunResult {
      const res = spawnGrove(args, {
        cwd: runOpts.cwd ?? root,
        home,
        env: runOpts.env,
      });
      return res;
    },
    cleanup(): void {
      // Base is registered with tempDir, so cleanupTempDirs also sweeps it if this is missed.
    },
  };
}

/** Exact managed anchor and peer-trunk paths under the default schema-3 layout. */
export const managedAnchorPath = (fx: Fixture, repositoryName: string): string => join(fx.root, "repos", repositoryName);
export const managedTrunkPath = (fx: Fixture, repositoryName: string, branch = "main"): string =>
  join(fx.root, "trunks", dirBase(slugForBranch(branch).slug, slugForRepo(repositoryName).slug));

/**
 * Materialize a schema-3 workspace through the public acquisition surface. The historical helper
 * name is retained so ported regression witnesses keep an obvious link to their v2 origin.
 */
export function initV2Workspace(fx: Fixture, repositoryNames = fx.repos.map((repo) => repo.name)): void {
  const initialized = fx.grove(["init"]);
  if (initialized.status !== 0) throw new Error(`Cannot initialize fixture: ${initialized.stderr || initialized.stdout}`);
  for (const name of repositoryNames) {
    const source = fx.repos.find((repo) => repo.name === name);
    if (!source) throw new Error(`Unknown fixture repository ${name}`);
    const added = fx.grove(["repo", "add", source.origin, "--name", name]);
    if (added.status !== 0) throw new Error(`Cannot add fixture repository ${name}: ${added.stderr || added.stdout}`);
  }
}

import { spawnSync } from "node:child_process";

function spawnGrove(
  args: string[],
  opts: { cwd: string; home: string; env?: Record<string, string> },
): RunResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: opts.home,
      // Neutralize any GROVE_* the runner inherits — §2 forbids env workspace selection.
      GROVE_ROOT: "/nonexistent-should-be-ignored",
      ...opts.env,
    },
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}
