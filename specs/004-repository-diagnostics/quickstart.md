# Quickstart: Shared repository diagnostics

Run after `npm run build` using a disposable fixture workspace.

## 1. Healthy baseline

Create a managed repository and run `repo status --json`, `trunk ls --json`, and `reconcile --json`. Expect empty problem lists, healthy repository/trunk values, and `clean:true`.

## 2. Problem matrix

Independently introduce the five states in §11 REPO-30. For each, run all three commands and verify:

- the contracted typed problem appears in `repo status`;
- trunk-related problems match in `trunk ls`;
- `reconcile.repositoryProblems` matches, `drift` renders it, and `clean` is false.

## 3. Repair

Restore the object store/default/trunk state and rerun the commands. Expect the problem to disappear without any diagnostic command mutating the repair.

## 4. Gates

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```
