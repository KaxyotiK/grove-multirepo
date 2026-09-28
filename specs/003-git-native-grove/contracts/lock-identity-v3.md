# Contract: Stable machine identity for workspace locks

**Owns:** §6 same-machine identification · **Scope:** `V3LCK-01`–`V3LCK-03` · **Status:** current v3 amendment

New workspace lock records include the Mac's `IOPlatformUUID`, obtained from `/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice`. Grove parses the UUID strictly and reads it at most once per process. The hostname remains in the record as a human-readable label. When both the holder record and this process have valid hardware UUIDs, same-machine classification compares those UUIDs and never uses the hostname as the deciding identity. A changed hostname therefore does not prevent reclaim of a dead same-machine holder; a different UUID remains foreign even with an equal hostname.

For a 0.1.0 lock record without a UUID, or when the local UUID probe fails, same-machine classification falls back to the existing hostname comparison. The existing PID plus process-start check, heartbeat window, steal-intent arbitration, unreadable-record handling, timeout, and doctor diagnostics remain governed by §6 and the existing v3 contracts. This amendment changes identity selection only.
