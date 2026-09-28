import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoNestedGitOwnership } from "../../src/paths/fs.ts";

test("V3DES-01 round8: observed worktree exemption uses native directory identity across case aliases", (t) => {
  const base = mkdtempSync(join(tmpdir(), "grove-owner-identity-"));
  try {
    const root = join(base, "Outer");
    mkdirSync(root);
    writeFileSync(join(root, ".git"), "gitdir: /unneeded-for-identity\n");
    const alias = join(base, "outer");
    if (!existsSync(alias) || statSync(root).ino !== statSync(alias).ino) { t.skip("temporary volume is case-sensitive"); return; }
    assert.doesNotThrow(() => assertNoNestedGitOwnership(root, [alias]));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("V3DES-01 round8: plain HEAD/objects/refs decoy is not asserted as a proved bare repository", () => {
  const root = mkdtempSync(join(tmpdir(), "grove-bare-decoy-"));
  try {
    const decoy = join(root, "decoy");
    mkdirSync(decoy);
    writeFileSync(join(decoy, "HEAD"), "ordinary document\n");
    mkdirSync(join(decoy, "objects"));
    mkdirSync(join(decoy, "refs"));
    assert.throws(() => execFileSync("git", [`--git-dir=${decoy}`, "rev-parse", "--is-bare-repository"], { stdio: "ignore" }));
    assert.throws(() => assertNoNestedGitOwnership(root), (error: unknown) => {
      const detail = (error as { detail?: { ambiguousGitMarkers?: Array<{ path: string }>; nestedGitOwners?: unknown[] } }).detail;
      assert.ok(detail?.ambiguousGitMarkers?.[0]?.path.endsWith("/decoy"));
      assert.ok(!detail?.nestedGitOwners?.length, "the decoy must not be asserted as a proved Git owner");
      assert.ok(/cannot verify|ambiguous|Git-like/i.test(String((error as Error).message)));
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("V3DES-01 round8: an invalid Git admin file is ambiguous, not proved ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "grove-gitfile-decoy-"));
  try {
    const decoy = join(root, "decoy");
    mkdirSync(decoy);
    writeFileSync(join(decoy, ".git"), "ordinary document\n");
    assert.throws(() => execFileSync("git", ["-C", decoy, "rev-parse", "--absolute-git-dir"], { stdio: "ignore" }));
    assert.throws(() => assertNoNestedGitOwnership(root), (error: unknown) => {
      const detail = (error as { detail?: { ambiguousGitMarkers?: Array<{ path: string }>; nestedGitOwners?: unknown[] } }).detail;
      assert.ok(detail?.ambiguousGitMarkers?.[0]?.path.endsWith("/decoy"));
      assert.ok(!detail?.nestedGitOwners?.length);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("V3DES-01 round8: uppercase Git symlink marker refuses without traversing its external target", (t) => {
  const base = mkdtempSync(join(tmpdir(), "grove-git-link-"));
  try {
    const root = join(base, "root");
    const nested = join(root, "nested");
    const external = join(base, "external.git");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "--bare", "-q", external]);
    symlinkSync(external, join(nested, ".GIT"));
    if (!existsSync(join(nested, ".git"))) { t.skip("temporary volume is case-sensitive"); return; }
    assert.throws(() => assertNoNestedGitOwnership(root), (error: unknown) => {
      const detail = (error as { detail?: { ambiguousGitMarkers?: Array<{ path: string }> } }).detail;
      assert.ok(detail?.ambiguousGitMarkers?.[0]?.path.endsWith("/nested"));
      return true;
    });
    assert.ok(existsSync(join(external, "HEAD")));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
