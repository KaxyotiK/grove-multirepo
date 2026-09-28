# Quickstart: Central command schemas

## 1. Schema audit

Run module tests that enumerate every `CommandSpec`. Expect each to declare valid positional bounds, schema-matching usage options, help entries, examples, and extras policy.

## 2. Deliberate drift

Temporarily change one usage positional, option spelling, and handler schema. Each mismatch must fail CMD-16 before any CLI scenario runs.

## 3. Behavior parity

Run the existing matrices for trailing globals, option-looking values, repeated flags, surplus positionals, `--workspace`, JSON/progress, and `agent run --` forwarded extras. Outputs and exit codes must remain unchanged.

## 4. Gates

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```
