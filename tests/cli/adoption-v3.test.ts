/**
 * Ruling ③ (P4.3, ledger C-7). Membership is LAYOUT POSITION, not a name match.
 *
 * `inferMisplacedTree` exists to recognise a Tree that moved WITHIN the workspace, and it matched on
 * the derived branch name alone. So an unrelated checkout anywhere on disk that happened to sit on
 * branch `work` was claimed as a Tree of Grove `work`, offered relocation INTO the workspace, and
 * selected for mutating operations — Grove reaching outside its own workspace on the strength of a
 * name collision.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeFixture } from "../testkit/fixture.ts";
import { cleanupTempDirs, tempDir } from "../testkit/tmp.ts";

after(cleanupTempDirs);

const json = (text: string): any => JSON.parse(text.trim());

test("V3ADO-01: a name-matching worktree outside the workspace is reported but never selected", () => {
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);

  // Move the Tree's worktree OUT of the workspace with raw Git. It keeps branch `work` — the exact
  // branch name Grove derives for this Tree — so the name still matches while the position no
  // longer does. Git will not check one branch out twice, so this is how the collision actually
  // arises in practice: a user relocates their checkout somewhere else on disk.
  const outsideRoot = tempDir("outside-workspace");
  const outside = join(outsideRoot, "someone-elses-checkout");
  const anchor = join(fx.root, "repos", "alpha");
  const from = join(fx.root, "groves", "work", "trees", "work@alpha");
  execFileSync("git", ["worktree", "move", from, outside], { cwd: anchor });

  const treeLs = fx.grove(["--json", "tree", "ls", "work"]);
  const doctor = json(fx.grove(["--json", "doctor"]).stdout);
  const move = fx.grove(["--json", "fix", "--move", "--dry-run"]);

  assert.deepEqual(
    {
      // The Grove is not conjured back into existence from a worktree that left the workspace.
      groveClaimedFromOutside: treeLs.status,
      outsideUntouched: existsSync(join(outside, ".git")),
      relocationOffered: JSON.stringify(json(move.stdout)).includes(outside),
      reportedNotSilent: doctor.diagnostics.some((d: any) => d.code === "external-name-collision"),
      severityIsInfo: doctor.diagnostics.filter((d: any) => d.code === "external-name-collision").map((d: any) => d.severity),
    },
    {
      groveClaimedFromOutside: 2,
      outsideUntouched: true,
      relocationOffered: false,
      reportedNotSilent: true,
      severityIsInfo: ["info"],
    },
  );
});

test("V3ADO-01: an in-layout native worktree is STILL adopted — ③ preserves that deliberately", () => {
  // The regression guard. Ruling ③ narrows adoption to layout position; it does not disable it.
  // Ten rounds of native-Git manipulation held, and that is what made the design sound.
  const fx = makeFixture();
  assert.equal(fx.grove(["init"]).status, 0);
  assert.equal(fx.grove(["repo", "add", fx.repos[0]!.origin, "--name", "alpha"]).status, 0);
  assert.equal(fx.grove(["new", "work", "--repo", "alpha"]).status, 0);

  const from = join(fx.root, "groves", "work", "trees", "work@alpha");
  const anchor = join(fx.root, "repos", "alpha");

  // (a) Moved to another VALID Tree position: adopted under its new name, no diagnostic. Position
  //     is the name (§5.3), so this is conforming, not misplaced.
  const inLayout = join(fx.root, "groves", "work", "trees", "moved-in-layout");
  execFileSync("git", ["worktree", "move", from, inLayout], { cwd: anchor });
  const adopted = json(fx.grove(["--json", "tree", "ls", "work"]).stdout);
  const cleanDoctor = json(fx.grove(["--json", "doctor"]).stdout);

  // (b) Moved INSIDE the workspace but OUT of layout: this is what inferMisplacedTree is for, and
  //     it must still fire. It is the exact path P4.3 narrowed, so it is the regression guard.
  const strayInWorkspace = join(fx.root, "stray-but-mine");
  execFileSync("git", ["worktree", "move", inLayout, strayInWorkspace], { cwd: anchor });
  const strayDoctor = json(fx.grove(["--json", "doctor"]).stdout);

  assert.deepEqual(
    {
      adoptedAtNewPosition: adopted.detail.trees.map((tree: any) => tree.path.value ?? tree.path),
      conformingMoveIsQuiet: cleanDoctor.diagnostics.map((d: any) => d.code),
      inWorkspaceStrayStillMisplaced: strayDoctor.diagnostics.some((d: any) => d.code === "misplaced"),
      notTreatedAsExternal: strayDoctor.diagnostics.every((d: any) => d.code !== "external-name-collision"),
    },
    {
      adoptedAtNewPosition: [inLayout],
      conformingMoveIsQuiet: [],
      inWorkspaceStrayStillMisplaced: true,
      notTreatedAsExternal: true,
    },
  );
});
