# Quickstart: Repository default policy

Run after `npm run build`. `G` points at the built CLI and every fixture lives under a disposable temporary root.

```bash
GROVE_BIN="$PWD/dist/grove.mjs"
G() { node "$GROVE_BIN" "$@"; }
T=$(mktemp -d)
git init --bare "$T/origin.git"
git clone "$T/origin.git" "$T/source"
git -C "$T/source" config user.email test@example.com
git -C "$T/source" config user.name Test
printf 'seed\n' > "$T/source/README.md"
git -C "$T/source" add README.md
git -C "$T/source" commit -m seed
git -C "$T/source" branch -M main
git -C "$T/source" push -u origin main
git -C "$T/origin.git" symbolic-ref HEAD refs/heads/main
git -C "$T/source" remote set-head origin --auto
git -C "$T/source" switch -c feature/wip
mkdir "$T/ws"
(cd "$T/ws" && G init)
```

## 1. Linked checkout HEAD is not the repository default (REPO-20)

```bash
G --workspace "$T/ws" repo link "$T/source" --name linked
G --workspace "$T/ws" repo ls --json
```

Expected: `effectiveDefault` is `main`, source is `remote`, `defaultBranch` is null, and trunks is empty despite checkout HEAD being `feature/wip`.

## 2. Managed/linked parity (REPO-21)

```bash
G --workspace "$T/ws" repo add "$T/origin.git" --name managed
G --workspace "$T/ws" repo status --json
```

Expected: both repositories report effective default `main`; managed has one initial trunk and linked has none.

## 3. Local override and clearing (REPO-22)

```bash
git -C "$T/source" branch local-main main
G --workspace "$T/ws" repo configure linked --default-branch local-main
G --workspace "$T/ws" repo configure linked --no-default-branch --no-remote
G --workspace "$T/ws" new demo --repo linked
```

Expected: configuration commands succeed locally; `new` refuses because there is no effective default and tells the user to set an override or select a remote with cached HEAD.

## 4. Atomic validation (REPO-23/REPO-24)

```bash
G --workspace "$T/ws" repo configure linked --default-branch does-not-exist
G --workspace "$T/ws" repo configure linked --remote does-not-exist
G --workspace "$T/ws" repo ls --json
```

Expected: both attempts refuse and the repository policy is unchanged. No command contacts the network.

## 5. Linked help and explicit trunk warning (REPO-25/TRUNK-10)

```bash
G repo link --help
git -C "$T/source" branch release main
G --workspace "$T/ws" trunk add linked release
```

Expected: help recommends `repo add` for independence. Successful linked trunk additions explain that the branch can be checked out in only one worktree; JSON returns a structured warning.

## 6. Full gates

```bash
npm run typecheck
npm test
npm run scan
bash scripts/scenario-traceability.sh
```
