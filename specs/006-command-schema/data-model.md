# Data model: Central command schemas

No persistent data changes.

## CommandArgumentSchema

```text
CommandSpec
├── options: ParseOptionSchema
├── positionals
│   ├── min: non-negative integer
│   └── max: non-negative integer | unbounded
├── forwardsExtras: boolean
├── usage: display string
├── args: help entries
└── handler
```

## Invariants

- Runtime parser and global scanner read only the registered schema.
- `min <= max`; omitted options mean no command options; omitted extras forwarding means false.
- Usage-derived positionals and options equal the schema under the drift gate.
- Help option/positional names correspond to schema fields.
- A handler never carries, imports, or passes a second schema.
