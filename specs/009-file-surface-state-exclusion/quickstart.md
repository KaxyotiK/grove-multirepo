# Quickstart: Exclude Grove state from the file surface

Run after `npm run build`, in an initialised workspace.

## 1. Refusal routes

```bash
node dist/grove.mjs --json file read .grove/config.json
node dist/grove.mjs --json file read ./.grove/config.json
node dist/grove.mjs --json file read groves/../.grove/config.json
node dist/grove.mjs --json file read .GROVE/config.json      # case-insensitive volume
node dist/grove.mjs --json file ls .grove
node dist/grove.mjs --json file read .grove/does-not-exist.json
```

Expected: each exits `2` with an `invalid-input` error whose `why` names Grove's internal state; the last is refused as excluded, not reported missing.

## 2. Listing

```bash
node dist/grove.mjs --json file ls
```

Expected: every top-level entry except `.grove`.

## 3. Unchanged scopes

`file ls`/`file read` with `--grove <g> --tree <t>` on ordinary content succeed; the FILE-01, FILE-02, and FILE-05 witnesses pass unchanged.

## 4. Credentialed remotes (amendment)

```bash
node dist/grove.mjs --json repo add https://user:TOKEN@github.com/acme/api.git
node dist/grove.mjs --json repo add https://TOKEN@github.com/acme/api.git
```

Expected: each exits `2` with `invalid-input`; neither `user` nor `TOKEN` appears in the output; no `repos/api` directory and no operation record exist afterwards.

## 5. Repository stores (amendment)

After `repo add` of a reachable remote `alpha`:

```bash
git -C repos/alpha remote set-url origin https://user:TOKEN@127.0.0.1:1/alpha.git
node dist/grove.mjs --json file read repos/alpha/config
node dist/grove.mjs --json file ls repos
node dist/grove.mjs --json file read trunks/main@alpha/README.md
```

Expected: the first read exits `2` naming the repository's Git directory, with no `TOKEN` in the output; the listing omits `alpha`; the trunk read succeeds.

## 6. Gates

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```
