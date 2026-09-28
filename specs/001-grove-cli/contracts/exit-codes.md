# Contract: Exit codes

**Owns:** §9 · **Status:** closed-to-new-behaviour

> **Closed to new behaviour.** `specs/001-grove-cli/contracts/` is the stable `§` citation authority and the home of the 180 regression scenario IDs — it is never renumbered and never deleted. It is **retired** in the sense that no new behaviour is written here: the Git-native revision is specified in [`specs/003-git-native-grove/contracts/`](../../003-git-native-grove/contracts/), which supersedes this file wherever the two disagree. Sections describing subsystems v3 deleted carry their own **Superseded** note; a `§` citation into one of those fails `tests/module/citations.test.ts`.

Section numbers are stable citation keys. Code comments, tests, and specs cite `§9`-style references; this file is where they resolve. Do not renumber sections.

---

## 9. Exit codes

| Code | Meaning |
|---:|---|
| `0` | Success. |
| `1` | Unexpected/internal failure. |
| `2` | Invalid command, argument, or input schema. |
| `3` | Refused by policy. |
| `4` | Concurrent/conflicting state. |
| `5` | Failed precondition. |
| `6` | Git failure. |
| `7` | Filesystem/I/O failure. |
| `8` | Missing or invalid workspace configuration. |
| `9` | Unsupported configuration version. |

Errors always state what failed, why, and the next action. JSON errors include the same fields and exit code.

### 9.1 The `agent run` passthrough

`grove agent run` is the ONE exception to "every command returns exactly one of these codes". It runs a child in the foreground and returns the child's own status, so a code in the table above may have come from the agent rather than from Grove:

| Outcome | Grove's exit code |
|---|---:|
| The child exited normally | The child's exit code, verbatim |
| The child was killed by signal `N` | `128 + N`, the shell convention |
| The child could not be started | `127` |
| Grove refused before starting the child | The §9 code for that refusal |

This mirrors §8.8's `--json` stdout exception and has the same cause: the child owns the inherited terminal, and swallowing its status would make `grove agent run` useless as a wrapper.

A caller that must distinguish "Grove refused" from "the agent failed" reads the `--json` envelope, which reports the two separately: a Grove refusal is an `error` object, while a child failure is a success envelope carrying the child's `exitCode`.
