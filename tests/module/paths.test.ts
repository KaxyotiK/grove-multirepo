import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { containedParentPath, containedPath, isSubpath, relPath, removeContainedDirectory, removeContainedSymbolicLink, resolveContained, unaccountedEntries } from "../../src/paths/fs.ts";
import { GroveError } from "../../src/errors.ts";
import { tempDir, cleanupTempDirs } from "../testkit/tmp.ts";

after(cleanupTempDirs);

if (false) {
  // @ts-expect-error A raw string has not proved strict, symlink-safe containment.
  removeContainedDirectory("/tmp/unproved");
}

test("isSubpath: equal and nested count as inside; siblings do not", () => {
  assert.equal(isSubpath("/a/b", "/a/b"), true);
  assert.equal(isSubpath("/a/b", "/a/b/c"), true);
  assert.equal(isSubpath("/a/b", "/a/bc"), false, "prefix but not a path boundary");
  assert.equal(isSubpath("/a/b", "/a"), false);
});

test("relPath terminates for paths with no common ancestor", () => {
  assert.equal(relPath("/a/b", "/a/b/c"), "c");
  assert.equal(relPath("/a/b/c", "/a/b"), "..");
  assert.equal(relPath("/x/y", "/a/b"), "../../a/b");
  assert.equal(relPath("/a", "/a"), ".");
});

test("resolveContained refuses absolute paths", () => {
  const root = tempDir("paths");
  assert.throws(
    () => resolveContained(root, "/etc/passwd", "read"),
    (e) => GroveError.is(e) && (e as GroveError).kind === "invalid-input",
  );
});

test("resolveContained refuses a traversal escape", () => {
  const root = tempDir("paths");
  mkdirSync(join(root, "inside"), { recursive: true });
  assert.throws(
    () => resolveContained(root, "../outside", "read"),
    (e) => GroveError.is(e),
  );
});

test("resolveContained refuses a symlink that escapes the scope", () => {
  const base = tempDir("paths");
  const root = join(base, "scope");
  const outside = join(base, "secret");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "f.txt"), "secret");
  symlinkSync(outside, join(root, "link"));
  assert.throws(
    () => resolveContained(root, "link/f.txt", "read"),
    (e) => GroveError.is(e),
    "a symlink resolving outside the scope is refused",
  );
});

test("resolveContained accepts a contained relative path", () => {
  const root = tempDir("paths");
  mkdirSync(join(root, "sub"), { recursive: true });
  writeFileSync(join(root, "sub", "f.txt"), "ok");
  const resolved = resolveContained(root, "sub/f.txt", "read");
  assert.ok(resolved.endsWith("/sub/f.txt"));
});

test("ContainedPath requires strict, symlink-safe containment", () => {
  const base = tempDir("contained-path");
  const root = join(base, "scope");
  const child = join(root, "child");
  const outside = join(base, "outside");
  mkdirSync(child, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(root, "escape"));

  assert.equal(containedPath(root, child, "test containment"), child);
  for (const candidate of [root, outside, join(root, "escape")]) {
    assert.throws(
      () => containedPath(root, candidate, "test containment"),
      (error) => GroveError.is(error) && error.kind === "invalid-input",
      `${candidate} must not produce a ContainedPath`,
    );
  }
});

test("ContainedPath refuses symlinks even when their targets stay strictly contained", () => {
  const base = tempDir("contained-path-internal-link");
  const root = join(base, "scope");
  const target = join(root, "target");
  const nested = join(target, "nested");
  const directLink = join(root, "direct-link");
  const intermediateLink = join(root, "intermediate-link");
  mkdirSync(nested, { recursive: true });
  symlinkSync(target, directLink);
  symlinkSync(target, intermediateLink);

  for (const candidate of [directLink, join(intermediateLink, "nested")]) {
    assert.throws(
      () => containedPath(root, candidate, "test lexical identity"),
      (error) => GroveError.is(error) && error.kind === "invalid-input",
      `${candidate} must not produce a ContainedPath through an internal symlink`,
    );
  }

  const rootLink = join(base, "scope-link");
  symlinkSync(root, rootLink);
  assert.equal(
    containedPath(rootLink, join(rootLink, "target", "nested"), "test symlinked root"),
    nested,
    "the root's own canonical spelling does not count as a below-root symlink",
  );
});

test("ContainedPath refuses dangling symlinks and paths beneath them", () => {
  const base = tempDir("contained-path-dangling-link");
  const root = join(base, "scope");
  const dangling = join(root, "dangling");
  mkdirSync(root, { recursive: true });
  symlinkSync(join(base, "missing-outside"), dangling);

  for (const candidate of [dangling, join(dangling, "nested")]) {
    assert.throws(
      () => containedPath(root, candidate, "test dangling symlink"),
      (error) => GroveError.is(error) && error.kind === "invalid-input",
      `${candidate} must not produce a ContainedPath through a dangling symlink`,
    );
  }
});

test("ContainedPath classifies a non-directory path component", () => {
  const root = tempDir("contained-path-not-directory");
  const file = join(root, "file");
  writeFileSync(file, "plain file\n");
  assert.throws(
    () => containedPath(root, join(file, "nested"), "test non-directory component"),
    (error) => GroveError.is(error) && error.kind === "invalid-input" && error.detail.code === "ENOTDIR",
  );
});

test("V3OPS-02: abandon can unlink a root-level failed-acquisition symlink without following it", () => {
  const base = tempDir("root-anchor-link");
  const root = join(base, "workspace");
  const target = join(base, "user-data");
  const marker = join(target, "important.txt");
  mkdirSync(root, { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(marker, "preserve target\n");
  symlinkSync(target, join(root, "alpha"));

  removeContainedSymbolicLink(containedParentPath(root, root, "abandon root-level anchor"), "alpha");

  assert.equal(existsSync(join(root, "alpha")), false);
  assert.equal(existsSync(marker), true);
});

/**
 * The reconcile `directory-remove` replay calls this with the operation's own `worktree-remove`
 * step paths, and no CLI test can reach that path (it needs a `grove delete` record planned under a
 * custom layout, which the pre-check refuses first). Witness the shared accounting directly so the
 * replay site cannot silently rot back to a hardcoded `trees` segment.
 */
test("unaccountedEntries derives structure from the accounted paths, not from a layout literal", () => {
  const root = tempDir("unaccounted");
  // `groves/{grove}/trees/{repo}/{tree}` — the accounted Tree is two levels down.
  mkdirSync(join(root, "deep", "trees", "alpha", "demo@alpha"), { recursive: true });
  writeFileSync(join(root, "deep", "trees", "alpha", "notes.txt"), "keep");
  // `groves/{grove}/{tree}` — the accounted Tree is a direct child, no `trees` segment exists.
  mkdirSync(join(root, "flat", "demo@alpha"), { recursive: true });
  writeFileSync(join(root, "flat", "stray.txt"), "keep");
  // A `trees` directory that is NOT structural: nothing accounted lives under it.
  mkdirSync(join(root, "bare", "trees", "mine"), { recursive: true });

  assert.deepEqual(
    {
      deep: unaccountedEntries(join(root, "deep"), [join(root, "deep", "trees", "alpha", "demo@alpha")]),
      flat: unaccountedEntries(join(root, "flat"), [join(root, "flat", "demo@alpha")]),
      bareUnaccounted: unaccountedEntries(join(root, "bare"), []),
      bareWithUnrelatedAccount: unaccountedEntries(join(root, "bare"), [join(root, "elsewhere", "demo@alpha")]),
    },
    {
      // The intermediate `trees/` and `trees/alpha/` are descended, not reported whole.
      deep: ["trees/alpha/notes.txt"],
      flat: ["stray.txt"],
      // No accounted path means nothing is exempt — `trees` is reported whole, never descended.
      bareUnaccounted: ["trees"],
      bareWithUnrelatedAccount: ["trees"],
    },
  );
});
