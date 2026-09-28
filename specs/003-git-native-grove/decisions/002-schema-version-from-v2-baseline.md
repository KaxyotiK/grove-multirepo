# Decision 002: Ownership-free runtime uses schema version 3

**Status:** Accepted **Date:** 2026-08-22 **Supersedes:** Every corrected-v3 package statement that assigns the incompatible Git-native runtime shape to schema version 2.

## Context

The corrected package at commit `4c545a5` was written as though the live-state ownership model used schema version 1 and the Git-native model could therefore publish schema version 2. This redesign branch deliberately starts at `e6aabeb`, where workspace configuration already uses schema version 2 and persists `repositories[].trunks[]`; Grove manifests still persist `trees[]`, branch provenance, and directories.

Publishing a different ownership-free shape under the same version would make an existing v2 workspace parse as the wrong model or require heuristic shape detection. Both violate Observe/Diagnose/Never Guess.

## Decision

- The ownership-free Git-native runtime workspace and central Grove metadata use `schemaVersion: 3`.
- Normal v3 loading accepts exactly schema 3 and never shape-detects or silently rewrites schema 1 or 2.
- Schema 1 or 2 state refuses before ownership fields are interpreted or mutated. The refusal names the running Grove version, executable path, encountered schema, and accepted schema; it never coerces foreign state into schema 3 or offers an in-v3 conversion workflow.
- Result schema version 1 is independent and remains unchanged because it versions the output envelope, not workspace ownership state.

## Consequences

- Active contracts are named `config-v3.md` and `cli-surface-v3.md`.
- Tests require foreign-schema fixtures for both schema 1 and schema 2, plus a negative control proving v3 does not interpret or mutate either source.
- Normal runtime modules contain no `TreeEntry`, `TrunkEntry`, provenance, claim compatibility, or migration loaders.
