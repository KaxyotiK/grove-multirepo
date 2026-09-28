# Quickstart: Crash recovery witnesses

## 1. Build

```bash
npm run build
```

## 2. Isolated witnesses

Run the crash-recovery E2E file once. Expect both tests to reach their sentinel, kill/reap the process group, reconcile, and verify consistent disk/Git/manifest state.

## 3. Soak

Run each ARCH-07 and ARCH-11 witness ten times. A missed sentinel, leftover process, live lock, unfinished journal, or inconsistent state is a failure.

## 4. Artifact guard

Search `src/` and the built bundle for fault-boundary/sentinel environment hooks; expect none.

## 5. Gates

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```
