# Contract: JSON Results v1

**Normative content**: this file. _Historical input (not normative):_ the pre-ruling proposal §8.4, moved here by feature `010`.

Every registered command that reports targets emits exactly this interface; the raw-value results listed after it are the only exceptions:

```ts
interface CommandResult {
  schemaVersion: 1;
  command: string;
  outcome: "complete" | "partial" | "blocked" | "needs-user";
  operationId?: string;
  targets: Array<{
    selector: {
      repositoryId?: string;
      repositoryAlias?: string;
      grove?: string;
      tree?: string;
      path?: string;
    };
    before: unknown;
    action: string;
    after: unknown | null;
    reason: string | null;
    detail?: unknown;
  }>;
  diagnostics: Diagnostic[];
  detail?: unknown;
}
```

Raw-value results are not `CommandResult` values: their handler passes one plain value to the same emitter (see "One payload, two serializations"). They are `config get` (the workspace config object), `config set` (`{ workspace, rev }`), `agent add`, `agent remove`, and `agent ls` (plain objects), `completion` (the script, a JSON string in `--json` mode), and `--version` (the version, a JSON string). An error before a result uses the error envelope, and help uses the help document of `help-presentation-v1.md`.

There is no top-level `conflicted` outcome, per-target `status`, or unversioned `summary`. A non-sequencer structural conflict is represented by the target's stable `reason`/`detail`. `partial` means at least one selected target remains incomplete after any observable repository, ref, fetch, worktree, filesystem, or advisory side effect; this includes a single-target branch-only intermediate, partial clone/checkout, or fetched-ref result even when no target fully completed. `blocked` means no selected target caused any such side effect. For an integration strategy, if any selected target has a native Git sequencer extant before the operation or created during it, the top-level outcome is `needs-user`; the target reason is `sequencer-active` where applicable, and higher classified failures may change exit precedence but do not erase that outcome. Fetch-only performs no integration and is not blocked solely by dirty or sequencer state. Command-specific `before`, `after`, and `detail` shapes are separately versioned fixtures.

Every explicit, config-default, cwd-inferred, or compatibility-selected/planned target appears once in deterministic selector order. Unrelated configured repositories are not emitted for a narrowed command. Stable reasons are the vocabulary in the table below; versioned additions may extend it but may not replace meanings with prose. `missing-revision` means a configured creation base resolves through neither its local nor configured remote-tracking ref and is a pre-mutation target precondition (exit 5).

Native paths use this exact versioned JSON representation inside command-specific `before`, `after`, or `detail` fixtures:

```ts
type NativePathJson =
  | { encoding: "utf8"; value: string }
  | { encoding: "base64"; value: string; display: string };
```

Ref names use the same exact approved encoding arms inside command-specific `before`, `after`, or `detail` fixtures:

```ts
type RefNameJson =
  | { encoding: "utf8"; value: string }
  | { encoding: "base64"; value: string; display: string };
```

No result fixture may substitute a replacement-character string for a non-UTF-8 ref.

`selector.path` remains a UTF-8 string only for a Grove-addressable target. An observed native path that is not valid UTF-8 is never placed in `selector.path`; its lossless `NativePathJson` appears in the versioned evidence fixture, with the target selected by repository/diagnostic identity instead. A valid UTF-8 path containing a newline uses the `utf8` arm unchanged and is not `unsupported-native-path` merely because of the newline.

Exit contract:

| Exit | Meaning |
|---|---|
| 0 | complete/no-op/read diagnostics |
| 2 | invalid syntax or selector |
| 3 | strict policy or blocking diagnostics (`V3DIAG-02`) |
| 4 | stale/concurrent/ambiguous plan |
| 5 | target precondition or needs-user |
| 6 | unclassified native Git failure |
| 7 | filesystem/containment/IO failure |
| 8 | invalid schema-3 config or foreign-schema workspace/manifest |
| 9 | unsupported schema/capability |

Stable target reasons and the exit each contributes:

| Reason | Exit | Reason | Exit |
|---|---|---|---|
| `skipped-no-remote` | 0 (not a failure) | `sequencer-active` | 5 |
| `refused-policy` | 3 | `detached` | 5 |
| `stale-plan` | 4 | `unborn` | 5 |
| `ambiguous-intent` | 4 | `unreachable-detached` | 5 |
| `dirty` | 5 | `git-failed` | 6 |
| `diverged` | 5 | `io-failed` | 7 |
| `locked` | 5 | `invalid-config` | 8 |
| `missing-revision` | 5 | `unsupported-capability` | 9 |
| `no-upstream` | 5 | `no-remote` | 5 |
| `unsupported-step` | 4 | `agent-failed` | the agent's own exit status |

`unsupported-step` marks an operation record step whose kind this build's `reconcile` cannot execute. It contributes 4, the exit `reconcile` already reports (as `stale-plan`) on the run that first meets the step, so a later run over the same conflicted record exits the same way. `agent-failed` marks a foreground agent that exited nonzero; `agent run` exits with the agent's own status (AGENT-05), not a classified exit, so the reason has no entry in the classification.

Overall exit uses the highest classified failure, except needs-user is 5 when no higher failure exists. Once a result exists it remains on stdout even with nonzero exit; failures before a result use the existing error envelope. Every result, error envelope, help value, and progress line is delivered in full before the process exits, including through a pipe (`V3OUT-04`). Human and JSON modes carry equivalent facts.

Diagnostic IDs hash a versioned canonical byte-preserving identity containing code, canonical subject, and all remedy-changing facts. Presentation aliases, timestamps, and observation generations are excluded. Fix rescans; missing ID is stale exit 4.

Human and machine results, diagnostics, and pre-result errors remove query and fragment from parsed remote URLs. Userinfo is found as Git and curl find it: every leading `<transport>::` prefix stripped, then the scheme and two or more slashes; a non-SSH authority ends at the first `/`, `?`, or `#`. For SSH, Git percent-decodes only a `scheme://` SSH URL before it splits host and path; scp-like input is parsed raw. Git looks for the first `@[` and then, only if it is absent, a leading `[` to select a bracketed host field, skips slashes inside a bracketed host field, and takes the login through the last `@`. A value whose authority so found carries userinfo, an SSH login containing `:`, `?`, or `#`, a value containing a backslash or control character, an opaque or `<transport>::` form carrying an `@` before its path, and URL-like values that cannot be parsed render as `<redacted-remote>` whole, because WHATWG parsing disagrees with Git about where the userinfo ends. A plain SSH remote is echoed with its user name only when the URL/scp and SSH-transport readings agree; a plain scp-like echo has exactly one `@` and no brackets except an IPv6 literal host. The user name is an account, not a secret. An `ssh://` URL still loses its query and fragment; scp-like `git@host:path` is not a URL and is echoed unchanged. A resumable operation may retain the exact directly supplied credential-free remote value only inside its mode-`0600` local operation record under a mode-`0700` directory. It never retains a resolved credentialed Git-config destination or the `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS` setting. Error envelopes also redact credentialed URL arguments quoted by malformed command, option, positional, or `repo link` path failures in every human and JSON field.

A forced `archive` or `delete` whose outcome is `partial` also lists, beside the failing target, each target it completed, with `reason: null` and that step's receipt as `after`: a Tree removal's `recordedWork` and per-file `discardedWork`, and the loose removal's `recordedLoose` and per-path `discardedLoose` (cli-surface-v3 ruling ④; `V3DES-11`). Targets not yet attempted are not listed. The operation record's completed steps carry the same receipt as `postState`. `reconcile`'s `after.discarded` lists every completed `worktree-remove` and `directory-remove` step of the operation, including steps completed by an earlier interrupted run (`completedEarlier: true`), naming the Tree for a Tree removal; a step whose record carries no per-file receipt is marked `discardsUnrecorded: true` (`V3DES-12`). A receipt exists only for a step that completed: when `git worktree remove` fails partway, Git may already have deleted files, but that target is reported failed with `after: null` and no discards are claimed for it, on the direct run and on resume. When the metadata step fails after the removals, its target carries the failure's own reason (a filesystem failure is `io-failed`), the step stays resumable, and `detail.remedy` names the `reconcile` that finishes the command once the cause is corrected. A `reconcile` of that step that fails on the filesystem again, before the cause is corrected, is `io-failed` with `detail.why` and `detail.remedy` and leaves the step resumable; any other failure there is a `stale-plan` conflict whose remedy is abandonment (`V3DES-13`). A pending operation's remedy, in a refusal or in doctor's `pending-operation` diagnostic, follows its state: a conflicted operation is inspected and abandoned, any other resumes with `reconcile`, and abandonment is offered only where it is accepted (`V3OPS-08`).

For `reconcile`, each failed recovery target carries `detail.why` and `detail.remedy`. A recoverable native Git failure on one operation contributes `git-failed` without suppressing later operation results or the audit. Its fixed why names the Git exit and step without copying Git's stderr, and its completed list reports steps completed earlier in that resume run. For a recoverable interrupted `repo add`, its remedy gives the exact `--operation <id>` and permitted `--abandon <id>` commands. Explicit abandonment reports removed and retained acquisition anchors. For a retained anchor, `detail.survivingArtifacts` itemizes nested content as well as refs and worktrees; an `inventory-incomplete` item names the anchor if a bounded or unreadable traversal cannot finish. A retained anchor needs explicit disposition before its filesystem path can be reused. A missing planned repository store is conflicted `stale-plan`, with an operation-specific `grove reconcile --abandon <operationId>` remedy.

## Reason vocabulary addition: `skipped-no-remote` (U-9, 2026-08-23)

A versioned extension, per the rule above that additions may extend the vocabulary but may not replace meanings with prose.

- **`skipped-no-remote`** — the target was deliberately not acted on because it has no Git remote, and the command was not narrowed to it. It is **not a failure**: exit contribution `0`, and it does not make the outcome `partial` or `blocked`.
- Naming a remote-less repository explicitly is a different thing and keeps the failing reason `no-remote` (exit 5). The distinction is whether the user asked for that specific repository.

This closes a case where `repo fetch` reported as an error exactly the case its own help calls a skip, and where `REPO-09`'s witness asserted the defect under a title that stated the contract correctly.

## Human/JSON parity is a conformance requirement (ruling ⑦, 2026-08-23)

**JSON is a formatting option, not an information tier.** The two modes MUST carry the same meaningful facts, while each may use idiomatic structure, labels, ordering, spacing, and prose.

- Every identity a result carries in JSON — repository name or alias, Tree name, Grove name, path, branch, OID, diagnostic code, reason — MUST also appear in the human rendering of that same result, and vice versa.
- A human line describing a target in a multi-repository operation MUST name which repository it belongs to. "Which repo is this?" is not a question the human mode may leave unanswered.
- A path emitted in either mode MUST be usable to open the file. Quoting or escaping that makes a non-ASCII path unopenable is a conformance failure, not a cosmetic one.
- Machine-only structure is permitted where the human rendering states the same fact in prose. A meaningful identity, outcome, reason, remedy, or target fact present only in one mode is a defect; byte-for-byte, shape, label, ordering, and layout equality are not required.

Gated by `V3OUT-01` and `V3OUT-02`.

### One payload, two serializations

Every registered command result or error is passed to one emitter as one structured value. Handlers cannot supply a separate human callback or write command output directly. `--json` serializes that value as compact JSON; human mode traverses the same entire value through the shared readable renderer. No command-specific human projection exists, so a new result field cannot become machine-only.

Strings remain strings: human mode writes the raw string and JSON mode writes the JSON string encoding of the same value. This preserves generated shell-completion scripts without creating a second information tier. Help is the explicit presentation exception: one registry-derived help document is serialized directly for JSON and rendered through the terminal-oriented help contract in `help-presentation-v1.md`. The exception is presentation-only and does not permit command handlers to define result renderers or omit meaningful help facts.

The conformance gate inventories every registered handler, rejects direct stdout/stderr command writes and independent human-result callbacks, round-trips representative objects, collections, strings, and error envelopes, and runs acquisition output parity end to end. Help architecture and all three help levels are gated separately by `V3HLP-04`. Gated by `V3OUT-03`.

_Record:_ the remediation plan asserted this file already stated the rule at line 70. It did not — line 70 is about exit-code precedence. The requirement is authored here for the first time.
