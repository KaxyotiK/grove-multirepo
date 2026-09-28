# Quickstart: Remove Grove diff

Run after `npm run build`.

## 1. Removed surface

```bash
node dist/grove.mjs --help
node dist/grove.mjs completion bash
node dist/grove.mjs completion zsh
node dist/grove.mjs completion fish
node dist/grove.mjs diff demo tree file.txt
node dist/grove.mjs --json diff demo tree file.txt
```

Expected: help/completion omit `diff`; both invocations exit `2`, and JSON uses the standard error envelope.

## 2. Retained aggregate surface

In a multi-repository Grove, run `changes`, `commits`, and `against-trunk`. Expect the §11 FILE-04 attribution and FILE-06 per-Tree base behavior to remain unchanged.

## 3. Standard Git

From a Tree worktree, verify `git diff -- <path>` and `git diff <base>...HEAD -- <path>` remain the documented route to patches; Grove does not intercept either.

## 4. Gates

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```
