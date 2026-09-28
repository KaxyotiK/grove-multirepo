# Piped output delivered in full: evidence ledger

**Authority:** constitution 6.0.0 Principle III; FR-033A; `json-results-v1.md`; V3OUT-04. **Source finding:** review-27 round 3, P2-2. **Base:** `6b21d171dcba862af933c0bb31a1744f56457fe9`.

At the base, `src/cli.ts` called `process.exit()` as soon as the command returned. On macOS, Node writes to a pipe asynchronously, so any output larger than the 64 KiB pipe buffer was cut at 65,536 bytes for a piped consumer. The command's exit code was unchanged, so a consumer saw exit 0 with invalid JSON. Redirecting to a file hid the defect because file writes are synchronous. The defect affected every command, human and `--json` output, and stderr.

| Requirement | Status | Witness |
| --- | --- | --- |
| A `--json` result past the pipe buffer arrives as one complete JSON value with exit 0 and unchanged progress events | implemented:verified-local | V3OUT-04 `file ls --json --progress=json` over 2,500 entries, read through pipes to EOF |
| A `--json` error envelope past the pipe buffer arrives complete with its nonzero exit | implemented:verified-local | V3OUT-04 unknown command with a 190 KB argument, exit 2 |
| Human stdout and human stderr past the pipe buffer arrive complete | implemented:verified-local | V3OUT-04 human `file ls`; human unknown-command refusal on stderr, exit 2 |
| A reader that hangs up early does not change the exit code or raise a stream error | implemented:verified-local | V3OUT-04 control; fails when the drain's `error` listener is removed |

**Red.** Before any source edit, all four delivery witnesses failed on the unmodified product with exactly 65,536 bytes: two JSON parse errors (`Unterminated string ... at position 65536`) and two truncated human streams (4 tests, 0 pass, 4 fail against `tests/cli/output-flush-v3.test.ts`; the red run log was kept outside the repository). The hangup control passes on both the base and the fix, because the base never waited for delivery.

**Design.** `flushOutput()` in `src/output.ts` waits on an empty write to stdout and stderr. Writable streams complete writes in order, so its callback marks the delivery of all earlier output. After the wait, the entry point exits explicitly with the command's code. A natural exit (`process.exitCode` only) was measured across the CLI and E2E suites: 2,432 invocations, none held the event loop for 1 s after returning, and the longest took 5 ms. It was still not adopted. It would turn any future leaked handle into a hang, and with no listener, a reader's hangup becomes an uncaught `EPIPE` stream error with a stack trace. The explicit exit keeps termination exactly as before. Signal handling and the exit-code semantics are untouched.

**Gate.** `npm run typecheck && npm test && npm run scan && npm run traceability` passed: 242/242 module; 429 CLI (428 pass, 0 fail, 1 todo); 20/20 E2E; PROC-07 scan passed; inherited 180/180 scenarios with 184 witnesses; current 63/63 scenarios, V3OUT 4/4. The packed 0.3.0 tarball installed into an isolated prefix reported `0.3.0`. Its `--json file ls` over 3,000 entries delivered 822,360 bytes through `| wc -c`, the same byte count as a file redirect, and `| node -e JSON.parse` parsed all 3,000 entries.
