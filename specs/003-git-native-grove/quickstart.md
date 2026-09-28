# Quickstart Validation: Git-native Grove

This is the end-to-end validation guide for the completed feature, not an implementation guide.

## Prerequisites

- macOS, Node 24+, npm, and a Git version passing Grove's capability preflight.
- A disposable directory; foreign-schema refusal scenarios use disposable schema-1 and schema-2 fixtures.

## Build and baseline

```sh
npm ci
npm run typecheck
npm test
npm run scan
npm run build
```

## Prove raw Git interoperability

1. Initialize a v3 workspace, add one managed repository, and link one existing standard checkout.
2. Verify `repo add --trunk main --name grove-cli` creates a bare common repository under `repos/grove-cli` and a real initial worktree at exactly `trunks/main@grove-cli`; run Git from that directory, then add a second trunk and verify both are peer trunk-layout worktrees with readable collision-safe names.
3. Verify `repo link --trunk <branch>` creates no ref or worktree, records the branch only as an advisory base, and that every trunk mutation refuses the linked repository without changing it. Repeat with the preferred trunk present only at the configured remote: Tree creation must use its exact OID without creating a local trunk ref or managed trunk worktree.
4. Create a multi-repository Grove and verify every selected target appears once at `groves/<grove>/trees/<grove>@<repo>`.
5. In one Tree, run ordinary `git switch` to another branch; verify `grove tree ls`, `grove show`, and `grove status` immediately show the new branch.
6. Use ordinary `git worktree add` at a configured Tree path; verify Grove discovers it without repair.
7. Move that worktree outside convention using Git; verify `grove doctor` reports a nonblocking diagnostic.
8. Preview `grove fix --move`, apply it by current diagnostic ID, and verify a repeated stale ID refuses.
9. Create a valid UTF-8 worktree path containing a newline; verify `-z` observation and JSON preserve it exactly and Grove assigns its actual layout/conformance class.
10. Create a raw non-UTF-8 worktree path fixture; verify Grove emits base64 plus escaped display losslessly as `unsupported-native-path` and refuses Grove mutation without replacement-character canonicalization.

Expected: Git-accepted state is always reality; Grove only diagnoses convention.

## Prove sync and partial results

Create clean fast-forward, divergent, dirty, detached, no-upstream, local-upstream, and rebase-conflict targets. Run all three strategies in human and JSON modes.

Expected: no divergent reset; native sequencer preserved for needs-user; every target appears exactly once; exit agrees with `contracts/json-results-v1.md`.

## Prove lifecycle ref safety

Snapshot every pre-state `refs/*`, then exercise Tree/trunk removal, archive/restore, delete, repo unregister, failed creation, interrupted recovery, and abandon. Record any branch explicitly planned by creation as an allowed addition.

Expected: every pre-state ref retains its OID; no pre-state or allowed planned ref is deleted/reset; each planned branch-only intermediate is retained and reported; unreachable detached work blocks destructive removal; Git refusal never falls back to recursive deletion.

## Prove foreign-schema refusal

1. Invoke representative read and mutation commands against disposable schema-1 and schema-2 workspace fixtures using the built artifact.
2. Repeat with a foreign-schema Grove manifest inside an otherwise valid schema-3 workspace.
3. In human and JSON modes, verify that each refusal names the running Grove version, resolved executable path, encountered schema, and accepted schema.
4. Snapshot Git refs/worktrees and filesystem paths before each invocation and prove the refusal changed none of them.
5. Run the exclusion scan and prove there is no `migrate` command, `src/migration/`, ownership loader, claim, provenance, or mutable live-state array in the runtime.

Expected: schema 3 does not interpret or migrate foreign ownership state. Existing bare repositories and attached worktrees remain valid Git topology and can be registered separately through the supported schema-3 acquisition boundary.

## Prove structural output parity

1. Run the emitter and source-architecture witnesses:

   ```bash
   node --test tests/module/output.test.ts tests/module/output-architecture.test.ts
   ```

2. Run the CLI parity and acquisition witnesses:

   ```bash
   node --test tests/cli/output-parity.test.ts tests/cli/repository-acquisition.test.ts
   ```

3. Confirm the architecture audit inventories every registered command handler, forbids direct handler stdout/stderr writes, and rejects the removed human-callback emitter shape.
4. Confirm `repo link` reports its repository identity, operation identity, canonical common directory, preferred remote, and preferred trunk in both modes from the same result value.

Expected: structured command-result human output is a complete readable traversal of the exact value emitted as compact JSON. Adding a result field requires no separate human-renderer edit.

## Prove idiomatic help presentation

1. Build the CLI, then capture all three levels in human and JSON modes:

   ```bash
   npm run build
   node dist/grove.mjs --help
   node dist/grove.mjs repo --help
   node dist/grove.mjs new --help
   node dist/grove.mjs --json --help
   node dist/grove.mjs --json repo --help
   node dist/grove.mjs --json new --help
   ```

2. Run the help presentation, architecture, output, and completion witnesses:

   ```bash
   node --test tests/module/help.test.ts tests/module/output.test.ts tests/module/output-architecture.test.ts
   node --test tests/cli/help-formatting.test.ts tests/cli/help-behaviour-v3.test.ts tests/cli/process-scenarios.test.ts
   ```

Expected: human help uses conventional spaced sections and aligned name/description columns, notes wrap readably, examples remain copyable, and no collection leaks as standalone `-` plus `Name:` or `Desc:` fields. JSON remains one structured object containing the corresponding facts. Command results still use the complete generic renderer and `grove completion zsh` remains executable text.

## Final gates

On the local macOS development machine, run the 40-command disposition audit, exact inherited-scenario disposition/witness ledger, current v3 acceptance checks, requirement/task traceability analysis, all module/CLI/E2E tests, bundled isolated install, acquisition/link E2E, and source exclusion scans. Implementation is ready only with zero constitution conflicts, unmapped items, traceability findings, unresolved P0/P1/P2 bug or proof-gap findings, foreign-schema runtime loaders, and ref-deleting paths. CI and additional-platform verification are outside this corrective phase.

Before any mutating validation, use a fake Git runner with one required capability missing. Expected: exit 9 names the failed probe, no operation record exists, and no state changed.
