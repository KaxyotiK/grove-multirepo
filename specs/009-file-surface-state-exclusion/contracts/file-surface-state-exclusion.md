# Contract traceability: Exclude Grove state from the file surface

This is a non-normative index. The owning contracts govern if it disagrees.

| Topic | Authority |
|---|---|
| File surface and containment | §8.7; `specs/003-git-native-grove/contracts/cli-surface-v3.md` (amended by this feature) |
| Scope-escape refusals | §11 FILE-01, FILE-02 |
| Bounded read refusals | §11 FILE-05 |
| Remote redaction and the retained resumable remote | `specs/003-git-native-grove/contracts/json-results-v1.md` |
| New witness | `V3SEC-04` in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md` |
| `repo add` credential refusal (amendment) | `cli-surface-v3.md` "retained repository grammar" (amended by this feature); `V3SEC-05` |
| Git-config opt-in and recovery recheck (amendment) | `cli-surface-v3.md` `repo add` paragraph; `V3SEC-05` |
| Credentialed argv error redaction (amendment) | `cli-surface-v3.md` error paragraph; `json-results-v1.md`; `V3SEC-07` |
| `repo link` of a credentialed repository (amendment) | `cli-surface-v3.md` `repo link` paragraph (amended by this feature) |
| Repository stores off the file surface (amendment) | `cli-surface-v3.md` "Behavioral guarantees" (amended by this feature); `V3SEC-06` |
| Input refusal class | `json-results-v1.md` exit contract (exit 2) |

## Amendment text (to land in `cli-surface-v3.md`)

> `file ls` and `file read` never reach the workspace's `.grove` directory. A path whose resolution is that directory or lies inside it — by any spelling, traversal, case variant, or symlink — is refused `invalid-input` (exit 2) before anything is opened, and a workspace-root listing omits it. Grove's internal state is not workspace content; this keeps the retained remote of a resumable operation out of Grove's own read surface.

## Scenario row (to land in `acceptance-scenarios-v3.md`)

| ID | Required observation | Executable witness |
|---|---|---|
| V3SEC-04 | With a pending `repo-add` retaining its remote, `file read` and `file ls` refuse every route into `.grove/` with exit 2 and the remote appears in no output; a workspace-root listing omits `.grove`. | File-surface CLI integration |

## Amendment (2026-09-23): landed text

The amendment text landed directly in the owning contracts; this index points at it rather than repeating it:

- `cli-surface-v3.md`: the paragraph after the `repo add` rules (credential refusal), the paragraph after the `repo link` rules (acceptance of a credentialed linked repository), and the second file-surface bullet under "Behavioral guarantees" (repository stores).
- `acceptance-scenarios-v3.md`: rows `V3SEC-05` and `V3SEC-06`, after `V3SEC-04`.
