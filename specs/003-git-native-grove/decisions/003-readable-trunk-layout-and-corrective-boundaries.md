# Decision 003: Preserve readable trunk layout without restoring live-state ownership

**Status:** Accepted  
**Date:** 2026-08-22  
**Supersedes:** the `trunks/{repo}/{branchKey}` proposal detail only  
**Does not supersede:** Decisions 001–002 or the Git-authority boundary

## Context

The v2 behavioral contract requires every trunk worktree to use the readable `trunks/<branch-slug>@<repo-slug>` convention. The first v3 implementation replaced that public path with `trunks/<repo>/v1-<prefix>--<full-hash>`. That change was neither required by Decision 001 nor identified as an approved prior-release disposition. It also made the repository grouping directory look like the trunk while not being a Git worktree.

V3 still cannot restore v2's authoritative trunk arrays or claims. Git must remain the authority for which worktrees exist and where they are registered.

## Decision

1. The default trunk layout is `trunks/{trunk}`. `{trunk}` is one allocated readable directory component using the normative v2 slug rules: `<branch-slug>@<repo-slug>`.
2. A non-truncated, case-fold-unique allocation uses the readable base exactly. Therefore the initial `main` trunk for repository `grove-cli` is `trunks/main@grove-cli`.
3. When the readable base is truncated or collides with an existing sibling allocation, Grove hashes the canonical full local-ref bytes (`refs/heads/<branch>`) with SHA-256 and appends the shortest case-fold-unique `~<hash-prefix>` starting at eight lowercase hexadecimal characters, extending through the 64-character hash only if required. It never parses that suffix back into branch identity.
4. Git worktree registration and observed HEAD are the durable live facts. Grove does not persist a trunk path/ref array. Creation allocates against currently observed trunk paths; later observation recognizes the exact registered path as conforming only when its readable base or deterministic suffix is a prefix of that branch's full-ref hash and valid for the observed branch and repository.
5. Observation recognizes registered historical trunk paths, including the prior ULID collision suffix form, from Git worktree registration and HEAD rather than ownership metadata. Grove never rewrites an observed path merely to adopt the deterministic suffix form.
6. Layout targets whose lexical path and canonical symlink-expanded path differ are refused before mutation. This gives creation, reporting, and later observation one path identity.

## Corrective safety boundaries

The same audit that found the naming regression establishes these implementation clarifications; they narrow existing requirements rather than add product scope:

- operation recovery records layout role/selector, relative/canonical path, expected presence, and device/inode for destructive directories, then recomputes and compares them against the current workspace immediately before mutation;
- all overlapping creation/removal/restore operations share `worktree:<canonical-absolute-path>`, attached/planned `repository:<stable-id>:branch:<validated-short-branch>`, and applicable `grove:<name>` target ownership keys;
- worktree-add completion requires verified repository identity, HEAD/branch, and cleanliness;
- restore rebinds advisory recipes only through the currently registered stable repository ID;
- linked advisory trunk resolution may use its configured remote-tracking ref without creating a local trunk ref or trunk worktree;
- stable safety reasons and deterministic target ordering survive command/reconcile result modeling; and
- prior-release parity requires exact behavior witnesses, not scenario-ID presence alone.

## Consequences

- Ordinary `git branch`, `git status`, and other Git commands work from the user-visible trunk directory.
- Byte-safe ref identity remains available for collision disambiguation without making opaque hash paths the normal interface.
- Registered historical trunk paths remain recognizable and unmoved without reading legacy ownership state.
- No claims, provenance, mutable trunk arrays, or privileged primary checkout return.
