# Data model: Crash recovery test protocol

No production schema changes.

## FaultBoundary

```text
FaultBoundary
├── operation: "archive" | "restore"
├── exactGitArgs: string[]
├── sentinelPath: absolute fixture path
├── realGitPath: absolute executable path
└── timeoutMs: bounded positive integer
```

## Protocol states

```text
armed
  → proxy matched exact Git invocation
  → real Git exited successfully
  → journal intent and mutation effect verified
  → sentinel written / proxy blocked
  → CLI process group killed and reaped
  → reconcile invoked
  → consistent lifecycle state / no journal / no live lock
```

Any missing transition is a test failure. The proxy delegates all non-targeted Git invocations unchanged.
