/**
 * Ruling ⑦ (Phase 6, ledger O-1…O-12): **JSON is a formatting option, not an information tier.**
 * The two modes must carry the same meaningful result facts.
 *
 * The human renderer was a lossy projection of a correct result model — the identity was present in
 * the result and simply not printed. The worst case is `changes`/`commits`/`against-trunk` on a
 * multi-repository Grove: the default naming convention puts every Tree on the SAME branch name, so
 * the human output was N identical lines with no way to tell which repository each described.
 *
 * One harness rather than N ad-hoc assertions, so the rule is enforced for the class.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFixture, type Fixture } from "../testkit/fixture.ts";
import { cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

/** Two repositories, one Grove — so both Trees carry the identical branch name `work`. */
function twoRepoGrove(): Fixture {
  const fx = makeFixture({ repos: { alpha: [], beta: [] } });
  assert.equal(fx.grove(["init"]).status, 0);
  for (const repo of fx.repos) assert.equal(fx.grove(["repo", "add", repo.origin, "--name", repo.name]).status, 0);
  assert.equal(fx.grove(["new", "work", "--all"]).status, 0);
  for (const repo of ["alpha", "beta"]) {
    const tree = join(fx.root, "groves", "work", "trees", `work@${repo}`);
    writeFileSync(join(tree, `${repo}-edit.txt`), "changed\n");
    execFileSync("git", ["add", "."], { cwd: tree });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", `${repo} work`], { cwd: tree });
  }
  return fx;
}

test("V3OUT-01: multi-repo review output identifies the repository for each Tree", () => {
  const fx = twoRepoGrove();
  const commands = [["changes", "work"], ["commits", "work"], ["against-trunk", "work"]];

  const findings = commands.map(([command, grove]) => {
    const human = fx.grove([command!, grove!]);
    const machine = json(fx.grove(["--json", command!, grove!]).stdout);
    const aliases: string[] = machine.targets.map((t: any) => t.selector.repositoryAlias).filter(Boolean);
    const identityLines = human.stdout.trim().split("\n").filter((line) => aliases.some((alias) => line.includes(alias)));
    return {
      command,
      status: human.status,
      // Every repository the JSON names must be findable in the human text...
      allAliasesInHuman: aliases.every((alias) => human.stdout.includes(alias)),
      // ...and each target must contribute an identity-bearing line distinct from the other
      // repositories. Structural labels may intentionally repeat in the shared renderer.
      repositoryLinesAreDistinct: new Set(identityLines).size >= new Set(aliases).size,
      repoCount: aliases.length,
    };
  });

  assert.deepEqual(
    findings,
    commands.map(([command]) => ({ command, status: 0, allAliasesInHuman: true, repositoryLinesAreDistinct: true, repoCount: 2 })),
  );
});

test("V3OUT-02: against-trunk round-trips a non-ASCII filename byte-exactly", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const tree = join(fx.root, "groves", "work", "trees", "work@alpha");

  const name = "café.txt";
  writeFileSync(join(tree, name), "unicode\n");
  execFileSync("git", ["add", "."], { cwd: tree });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "unicode"], { cwd: tree });

  const machine = json(fx.grove(["--json", "against-trunk", "work"]).stdout);
  const emitted: string[] = machine.detail.trees.flatMap((t: any) => (t.files ?? []).map((file: any) => file.path));

  // The old code ran `diff --name-status` WITHOUT -z, so git applied its own quoting and emitted
  // the literal 12 characters `"caf\303\251.txt"` — quoted, escaped, and useless for opening the
  // file. A path Grove emits must be a path the caller can open.
  assert.deepEqual(
    {
      emitted,
      noGitQuoting: emitted.every((p) => !p.startsWith('"') && !p.includes("\\3")),
      opensFromDisk: emitted.map((p) => execFileSync("cat", [join(tree, p)], { encoding: "utf8" })),
    },
    { emitted: [name], noGitQuoting: true, opensFromDisk: ["unicode\n"] },
  );
});

test("V3OUT-02: a rename record spends two paths and reports the destination", () => {
  // `-z` rename/copy records carry TWO path fields. Mis-parsing that desynchronises the whole
  // field walk, so every subsequent status/path pair would be shifted — silently, and only for
  // diffs that happen to contain a rename.
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);

  // The file must exist in the TRUNK for git to see a rename against the merge-base.
  const trunk = join(fx.root, "trunks", "main@alpha");
  writeFileSync(join(trunk, "orig-café.txt"), "y".repeat(400) + "\n");
  execFileSync("git", ["add", "."], { cwd: trunk });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "base"], { cwd: trunk });

  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);
  const tree = join(fx.root, "groves", "work", "trees", "work@alpha");
  renameSync(join(tree, "orig-café.txt"), join(tree, "renamed-naïve.txt"));
  execFileSync("git", ["add", "-A"], { cwd: tree });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-qm", "rename"], { cwd: tree });

  const machine = json(fx.grove(["--json", "against-trunk", "work"]).stdout);
  const files = machine.detail.trees.flatMap((t: any) => (t.files ?? []).map((f: any) => [f.status, f.path]));

  assert.deepEqual(
    {
      files,
      destinationOpens: files.every(([, p]: [string, string]) => existsSync(join(tree, p))),
    },
    { files: [["R100", "renamed-naïve.txt"]], destinationOpens: true },
  );
});

test("⑦ parity harness: every identity JSON carries appears in the human rendering", () => {
  const fx = twoRepoGrove();
  const cases: { argv: string[]; identities: (machine: any) => string[] }[] = [
    { argv: ["changes", "work"], identities: (m) => m.targets.map((t: any) => t.selector.repositoryAlias) },
    { argv: ["commits", "work"], identities: (m) => m.targets.map((t: any) => t.selector.repositoryAlias) },
    { argv: ["against-trunk", "work"], identities: (m) => m.targets.map((t: any) => t.selector.repositoryAlias) },
    { argv: ["sync", "--trunks", "--strategy", "fetch-only"], identities: (m) => m.targets.map((t: any) => t.selector.repositoryAlias) },
    { argv: ["ls"], identities: (m) => m.detail.groves.map((g: any) => g.name) },
    { argv: ["tree", "ls", "work"], identities: (m) => m.detail.trees.map((t: any) => t.tree ?? t.name) },
    { argv: ["repo", "ls"], identities: (m) => m.detail.repositories.map((r: any) => r.name) },
  ];

  const gaps: string[] = [];
  for (const { argv, identities } of cases) {
    const human = fx.grove(argv);
    const machine = json(fx.grove(["--json", ...argv]).stdout);
    for (const identity of identities(machine).filter(Boolean)) {
      if (!human.stdout.includes(String(identity))) gaps.push(`${argv.join(" ")}: JSON names "${identity}", human output does not`);
    }
  }
  assert.deepEqual(gaps, [], `human/JSON information gaps:\n  ${gaps.join("\n  ")}`);
});

test("V3OUT-03: repo link exposes every acquisition fact in human and JSON modes", () => {
  const humanFx = makeFixture();
  assert.equal(humanFx.grove(["init"]).status, 0);
  const human = humanFx.grove(["repo", "link", humanFx.repos[0]!.origin, "--name", "external", "--base", "main"]);
  assert.equal(human.status, 0, human.stderr || human.stdout);

  const config = json(readFileSync(join(humanFx.root, ".grove", "config.json"), "utf8"));
  const repository = config.repositories[0];
  const operation = readdirSync(join(humanFx.root, ".grove", "operations"))
    .map((name) => json(readFileSync(join(humanFx.root, ".grove", "operations", name), "utf8")))
    .find((candidate) => candidate.kind === "repo-link" && candidate.scope.repositoryId === repository.id);
  assert.ok(operation, "repo link operation was not recorded");

  for (const fact of [repository.id, operation.id, "external", humanFx.repos[0]!.origin, "main", "null"]) {
    assert.ok(human.stdout.includes(String(fact)), `human repo link omitted ${String(fact)}`);
  }

  const machineFx = makeFixture();
  assert.equal(machineFx.grove(["init"]).status, 0);
  const machineRun = machineFx.grove(["--json", "repo", "link", machineFx.repos[0]!.origin, "--name", "external", "--base", "main"]);
  assert.equal(machineRun.status, 0, machineRun.stderr || machineRun.stdout);
  const machine = json(machineRun.stdout);
  assert.deepEqual(
    {
      command: machine.command,
      repositoryId: machine.detail.repositoryId,
      operationId: machine.operationId,
      repositoryAlias: machine.detail.repositoryAlias,
      commonGitDir: machine.detail.commonGitDir,
      preferredRemote: machine.detail.preferredRemote,
      trunk: machine.detail.trunk,
    },
    {
      command: "repo link",
      repositoryId: machine.targets[0].selector.repositoryId,
      operationId: machine.operationId,
      repositoryAlias: "external",
      commonGitDir: machineFx.repos[0]!.origin,
      preferredRemote: null,
      trunk: "main",
    },
  );
});
