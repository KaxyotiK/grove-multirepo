# Quickstart — validating work-safety derivation

**Feature**: `002-work-safety-force` · **Date**: 2026-08-16

Offline, network-free validation of the feature end to end. Everything below runs against local `file://` remotes in a temporary workspace, consistent with the §11 test-layer rules.

## Prerequisites

```bash
node --version          # >= 24
npm ci
npm run typecheck && npm test && npm run scan
npm run build           # produces dist/grove.mjs
```

Use a shell function, not a variable — a variable holding a command does not word-split in zsh:

```bash
G() { node "$PWD/dist/grove.mjs" "$@"; }
```

## Part 1 — the predicate, before touching grove

This is the fixture that produced every finding in [research.md](./research.md). Run it first: if the predicate is wrong, nothing built on it can be right.

```bash
T=$(mktemp -d); cd "$T"
git init -q --bare origin.git && git clone -q origin.git work && cd work
git config user.email t@t && git config user.name t
echo base > a.txt && git add -A && git commit -qm base
git branch -M main && git push -qu origin main

git checkout -qb merged && echo m > m.txt && git add -A && git commit -qm merged
git checkout -q main && git merge -q --no-ff merged -m merge && git push -q origin main

git checkout -qb unique main && echo u > u.txt && git add -A && git commit -qm unique
git checkout -qb tagged main && echo t > t.txt && git add -A && git commit -qm tagged && git tag keep-me
git checkout -qb pushed main && echo p > p.txt && git add -A && git commit -qm pushed && git push -qu origin pushed
git checkout -q main && git fetch -q origin
```

**Scope A — `archive` / `delete` / `repo delete-branch`** (repository survives, named refs removed):

```bash
for b in merged unique tagged pushed; do
  printf '%-8s %s\n' "$b" "$(git rev-list --count $b --not --exclude=$b --branches --remotes --tags)"
done
```

Expected — **only `unique` is at risk**:

```
merged   0
unique   1
tagged   0        # the tag survives and holds the commit
pushed   0
```

**Scope B — `repo remove` on a managed repository** (whole object store deleted):

```bash
for b in merged unique tagged pushed; do
  printf '%-8s %s\n' "$b" "$(git rev-list --count $b --not --remotes)"
done
```

Expected — **`tagged` flips to at-risk**, because the tag dies with the store:

```
merged   0
unique   1
tagged   1        # <- the divergence that makes the scope a parameter
pushed   0
```

**Sibling refs (FR-001a)** — two doomed branches holding the same commit:

```bash
git branch -q pairA unique && git branch -q pairB unique
echo "individually: $(git rev-list --count pairA --not --exclude=pairA --branches --remotes --tags)"
echo "together:     $(git rev-list --count pairA --not --exclude=pairA --exclude=pairB --exclude=unique --branches --remotes --tags)"
git branch -qD pairA pairB
```

Expected `individually: 0` and `together: 1`. **`0` is the data-loss answer** — each sibling vouches for the next. If a future change makes these agree, the implementation has regressed to per-ref judgment.

**The two fail-open spellings** — both must be avoided:

```bash
echo "wrong (prefix): $(git rev-list --count unique --not --exclude=refs/heads/unique --branches --remotes --tags)"
echo "wrong (--all):  $(git rev-list --count unique --not --exclude=unique --all)"
echo "correct:        $(git rev-list --count unique --not --exclude=unique --branches --remotes --tags)"
```

Expected `0`, `0`, `1`. Both wrong spellings report a genuinely at-risk commit as safe.

## Part 2 — the false positive this feature removes

```bash
cd "$T" && mkdir ws && cd ws && G init
G repo add api "file://$T/origin.git"
G new checkout-redesign --repo api
cd groves/checkout-redesign/trees/* && echo work > w.txt && git add -A && git commit -qm work
BR=$(git rev-parse --abbrev-ref HEAD) && cd "$T/ws"

# land the branch the way a finished Grove lands: merged into the trunk, never pushed alone
cd trunks/* && git merge -q --no-ff "$BR" -m "land $BR" && git push -q origin HEAD:main && cd "$T/ws"

G archive checkout-redesign
```

**Before this feature**: refuses — "not up to date with its remote: commits exist only here". **After**: succeeds with no `--force` (002-work-safety-force-SC-001, `ARCH-17`).

Verify the branch ref survived the archive, which is _why_ it never needed to block:

```bash
git --git-dir=.bare/api show-ref --verify --quiet "refs/heads/$BR" && echo "ref retained ✓"
```

## Part 3 — refusals name what is at risk

```bash
G restore checkout-redesign
cd groves/checkout-redesign/trees/* && echo scratch > dirty.txt && cd "$T/ws"
echo notes > groves/checkout-redesign/loose-notes.md

G archive checkout-redesign            # blocks: dirty only (ARCH-03)
G delete  checkout-redesign            # blocks: dirty + loose file (ARCH-15)
G delete  checkout-redesign --json | jq '.error.detail.blockers'
```

Every blocker is itemized with its repository, branch, and file count or path; no entry names data the command would have preserved (002-work-safety-force-SC-002, 002-work-safety-force-SC-003, FR-010).

## Part 4 — `--force` reports what it destroyed

```bash
G archive checkout-redesign --force --json | jq '.discarded'
```

Expected: `nothing: false`, with the dirty Tree in `uncommitted`, and `loose: []` — archive **moves** the loose file rather than destroying it (`ARCH-04`, `ARCH-19`, FR-011).

```bash
ls groves/.archive/checkout-redesign/loose-notes.md && echo "loose file preserved ✓"
```

Nothing-at-risk case (`ARCH-22`):

```bash
G new empty-grove --repo api && G delete empty-grove --force --json | jq '.discarded.nothing'
```

Expected `true`, with human output saying nothing was discarded — no warning implying loss.

## Part 5 — adopted refs and linked repositories

```bash
# ARCH-20: an adopted Tree with local-only commits does not block delete
git --git-dir="$T/ws/.bare/api" branch mine main
G new adopt-demo --repo api --branch mine
G delete adopt-demo            # not blocked by the adopted Tree

# REPO-11: removing a linked repo with no remote destroys nothing
git init -q "$T/plain" && cd "$T/plain" && git config user.email t@t && git config user.name t
echo x > x.txt && git add -A && git commit -qm x && cd "$T/ws"
G repo link "$T/plain"
BEFORE=$(find "$T/plain" -type f | sort | xargs shasum | shasum)
G repo remove plain            # succeeds, no --force
[ "$BEFORE" = "$(find "$T/plain" -type f | sort | xargs shasum | shasum)" ] && echo "checkout untouched ✓"
```

## Part 6 — `repo add` does not delete what it found

```bash
mkdir -p .bare/ghost && echo precious > .bare/ghost/keep.txt
G repo add ghost "file:///nonexistent/nope.git" ; echo "exit=$?"
cat .bare/ghost/keep.txt      # must still print "precious"
```

Expected: refuses **before** cloning, naming the occupied path; the file survives (`REPO-14`, 002-work-safety-force-SC-005).

## Part 7 — traceability gate

```bash
cd "$PWD_REPO"   # back to the grove-cli checkout
for id in $(grep -o 'ARCH-[0-9]*' specs/001-grove-cli/contracts/acceptance-scenarios.md | sort -u); do
  grep -rq "$id" tests/ || echo "UNCITED: $id"
done
```

Expected: no output (002-work-safety-force-SC-006). Every `ARCH-*` scenario has at least one test naming it.

## Cleanup

```bash
rm -rf "$T"
```

## What "done" looks like

| Check | Criterion |
|---|---|
| Part 1 scope A/B diverge on `tagged` | R2 — the surviving set is a real parameter |
| Part 1 siblings give `0` then `1` | FR-001a — per-ref judgment is a data-loss path |
| Part 2 archives with no flag | 002-work-safety-force-SC-001 — the false positive is gone |
| Part 3 blockers itemized, nothing spurious | 002-work-safety-force-SC-002, 002-work-safety-force-SC-003 |
| Part 4 `discarded` populated, loose file preserved | 002-work-safety-force-SC-004, FR-011 |
| Part 6 pre-existing directory intact | 002-work-safety-force-SC-005 |
| Part 7 no uncited IDs | 002-work-safety-force-SC-006 |
| Whole run with networking disabled | 002-work-safety-force-SC-007 |
