# Data model: Remove Grove diff

No stored entity or schema changes.

## Surface transition

```text
registered `diff` CommandSpec ──remove──> absent
diff handler/imports            ──remove──> absent when unreferenced
changes/commits/against-trunk   ──retain──> unchanged
file ls/read                    ──retain──> unchanged
```

The registry remains the sole authority for top-level help, family resolution, generated completion, and dispatch. There is no tombstone, alias, feature flag, or compatibility state.
