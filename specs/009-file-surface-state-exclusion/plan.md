# Implementation Plan: Exclude Grove state from the file surface

**Branch**: `release/grove-multirepo` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

## Summary

Refuse every `file ls`/`file read` path whose resolution lands on or inside the workspace's `.grove` directory, and omit that directory from listings. The test is filesystem identity (device and inode of `.grove` compared against each existing ancestor of the resolved path), so case variants, `..` traversal, and symlinks all resolve to the same answer. Amend the v3 contract and add `V3SEC-04`.

## Technical Context

**Language/Version**: Strict TypeScript ESM, Node ≥24

**Primary Dependencies**: Existing `resolveContained` (`src/paths/fs.ts`), `GROVE_DIR` (`src/paths/layout.ts`), file command handlers (`src/commands/files.ts`)

**Storage**: None changed; `.grove/` is read-protected from one surface only

**Testing**: `node:test`; CLI integration against the built artifact

**Target Platform**: macOS (constitution 4.0.0)

**Project Type**: Bundled CLI

**Performance Goals**: Not applicable; at most one `stat` per ancestor of the requested path

**Constraints**: Refusal precedes any `stat`/open of the target; no other command changes; FILE-01/02/05 behaviour unchanged

**Scale/Scope**: Two handlers, one helper, one contract amendment, one scenario

## Constitution Check

_Pre-design gate: PASS. Post-design gate: PASS._

| Principle / gate | Design response | Result |
|---|---|---|
| I. Git Owns Live State | No Git state is read or written. | PASS |
| II. Grove Owns Convention | `.grove/` stays Grove's private state; the file surface is for workspace content. | PASS |
| III. One Command, Workspace-Local | No new state, file, or process. | PASS |
| IV. Forward, Ref-Safe | Read-only surface; no mutation path touched. | PASS |
| V. Observe, Never Guess | Classified `invalid-input` refusal naming path and remedy; nothing opened. | PASS |
| VI. No Legacy Creep | No flag, alias, or compatibility route. | PASS |
| Spec workflow | Contract amended and `V3SEC-04` witness written before the code change. | PASS |

## Phase 0: Research

[research.md](./research.md) settles identity versus path comparison, where the guard sits, listing omission, and the witness fixture.

## Phase 1: Design

- [data-model.md](./data-model.md) records that no stored entity changes.
- [contracts/file-surface-state-exclusion.md](./contracts/file-surface-state-exclusion.md) indexes authority and states the contract amendment.
- [quickstart.md](./quickstart.md) validates the refusal routes and unchanged scopes.

## Project Structure

```text
specs/009-file-surface-state-exclusion/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/file-surface-state-exclusion.md
├── checklists/requirements.md
└── tasks.md

src/commands/files.ts
specs/003-git-native-grove/contracts/cli-surface-v3.md
specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md
tests/cli/review.test.ts
```

**Structure Decision**: Keep the guard in `src/commands/files.ts`, the only consumer. `resolveContained` is shared with Tree configuration and other callers whose scopes can never contain `.grove`, so widening it would change their contract for no benefit.

## Amendment (2026-09-23, independent review)

**Summary.** `repo add` refuses a remote URL with userinfo before anything runs (`V3SEC-05`), and the file surface refuses every repository Git directory Grove knows with the same device/inode ancestor walk as `.grove` (`V3SEC-06`). See the spec's amendment section and research R6–R10.

**Touched**: `src/model/validate.ts` (`checkRemoteCredentials`, `assertCredentialFreeRemote`), `src/commands/repo.ts` (one call, first thing after argument parsing), `src/commands/files.ts` (`repositoryStores`, `storeAt`, `refuseRepositoryStore`), `cli-surface-v3.md`, `acceptance-scenarios-v3.md`, `README.md`; witnesses in `tests/cli/repository-acquisition.test.ts`, `tests/cli/review.test.ts`, and `tests/module/validate.test.ts`.

**Constitution Check (amendment)**: _PASS._

| Principle / gate | Design response | Result |
|---|---|---|
| I. Git Owns Live State | `repo link` still accepts any valid repository; Grove never rewrites a remote. `repo add` refuses input, it does not alter Git state. | PASS |
| II. Grove Owns Convention | Store paths come from the compiled layout and the observed registration, not a hardcoded `repos/`. | PASS |
| III. One Command, Workspace-Local | No new state; operation records are read, never written, by the file surface. | PASS |
| IV. Forward, Ref-Safe | The refusal precedes every mutation and every Git invocation. | PASS |
| V. Observe, Never Guess | Classified `invalid-input` refusals naming problem and remedy; the credential is never echoed. | PASS |
| VI. No Legacy Creep | No flag, alias, or compatibility route. | PASS |
| Spec workflow | `V3SEC-05`/`V3SEC-06` witnesses observed failing before the code change. | PASS |

**Structure decision**: the credential predicate lives with the other input validators in `src/model/validate.ts`; the store guard stays in `src/commands/files.ts`, the only consumer, beside the `.grove` guard, which is left as it was. `src/config/layout.ts` is not changed: the guard uses the observed store paths, which `observeRepository` already expands from the configured template.

## Complexity Tracking

No violations or exceptions.

## Credential opt-in and argv-error amendment (2026-09-23)

The direct `repo add` credential check remains unconditional. Git's locally resolved destination is checked before each managed network call using the current process environment; only exact `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` permits credentials introduced through Git configuration. The switch and resolved URL never enter workspace records. Recovery repeats resolution and the environment check. Failed command/argument and `repo link` errors redact credentialed argv values through every human and JSON field. Existing linked-repository fetch policy and ordinary plain SSH output remain unchanged.

New CLI witnesses in `credential-opt-in-v3.test.ts` and `credential-argv-v3.test.ts` were red on add1273 and on the accepted contained-path merge before product edits. They cover acquisition, later fetch and sync, interrupted-add recovery, all env values, direct URL refusal, output/record secrecy, and malformed-argv and link errors. The required full suite, scan, traceability, package, and isolated install are the completion gate.

## Recheck-between-network-calls review amendment (2026-09-24)

An accepted destination observation applies to the next managed network call only. The first `repo add` advertisement can change Git configuration before the in-lock advertisement; recovery's workspace advertisement can change it before the store fetch. Re-resolve immediately before each call in the relevant Git context, keeping the existing lock, stale-advertisement check, durable record classification, and linked-repository exemption. Two fake-sentinel built-CLI race witnesses were observed failing on `ef2df8f` before this change. Full verification, package installation, and independent review are required again.

A legacy `repo-add` operation can also retain a directly credentialed original remote. Recovery classifies the next unfinished step as `refused-policy` before `remote-add` or `fetch` can consume that URL, regardless of opt-in, and preserves the conflicted record for explicit abandon. Built-CLI tests at both step boundaries were red on the frozen head before the guard was added.
