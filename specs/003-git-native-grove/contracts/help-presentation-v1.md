# Help Presentation Contract v1

This contract refines `FR-033B`–`FR-033D` and is gated by `V3HLP-04`. It distinguishes semantic parity from identical rendering: the registry owns one help document, while human and JSON modes present that document idiomatically for their audiences.

## Shared facts

Both formats expose every meaningful fact applicable to the requested level:

- top-level title, usage, global options and descriptions, command paths and summaries, and hint;
- noun-family name, title, usage, command paths, summaries, exact command usages, and hint; and
- per-command path, summary, exact usage, positional names/descriptions, option names/descriptions, note when present, and every example.

The formats need not share field labels, ordering, whitespace, line wrapping, or object shape.

## Human presentation

Human help is a terminal document, not a generic structured-value traversal.

- The title or command summary appears first, followed by a blank line before the first section.
- Conventional `Usage`, `Global options`, `Commands`, `Arguments`, `Options`, `Notes`, `Examples`, and `Hint` sections appear only when relevant.
- Option, argument, and command names form one aligned column and their descriptions form a second aligned column. Wrapped description lines continue under the description column.
- Notes wrap as prose beneath their section. Examples remain verbatim and copyable.
- Titles and usage syntax use readable continuation indentation rather than relying on uncontrolled terminal wrapping.
- Top-level, noun-family, and per-command output MUST NOT expose collection items as standalone `-` lines or object fields as traversal labels such as `Name:`, `Desc:`, `Path:`, or `Summary:`.
- Rendering uses the terminal width when available and a deterministic readable fallback otherwise; very narrow widths retain at least 40 columns so labels and prose do not collapse together.

## JSON presentation

`--json` writes exactly one compact JSON help object to stdout. Arrays remain arrays and entries remain named objects so consumers can select commands, arguments, options, notes, examples, and hints without parsing human text. Human layout decisions MUST NOT leak into this structure. The global-options-anywhere rule remains in force: accepted placements of `--json` select JSON help before help returns, including after a command, after `--help`, and after a command boolean option.

## Architecture boundary

The CLI resolves a top-level, noun-family, or per-command help request and builds one typed, registry-derived help document. The emitter's explicit help method chooses JSON serialization or the shared human help renderer. Command handlers do not participate in help rendering, cannot supply presentation callbacks, and remain subject to `V3OUT-03`'s result/error architecture audit. Completion remains a top-level string result and is not routed through help presentation. The CLI applies the canonical two-precision global scanner before this dispatch so help never falls through to workspace discovery or a handler-owned early-exit signal. The conservative pass is used only to resolve a command schema; the definitive schema-aware pass receives the untouched original argv so option-value adjacency and repeated-global order remain authoritative.
