#!/usr/bin/env bash
# PROC-07 legacy-creep exclusion scan (§13.1-§13.2). Mechanically checkable; any hit fails.
# Grep-able items only; the remaining §13 items are release-review steps on the built artifact.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
scan() { # <label> <pattern> [paths...]
  local label="$1" pat="$2"; shift 2
  local hits
  hits=$(grep -rnE "$pat" "$@" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "FAIL: $label"
    echo "$hits" | sed 's/^/    /'
    fail=1
  else
    echo "ok:   $label"
  fi
}

SRC_TESTS=(src tests)

# §13.1 Source and dependencies
scan "no Bun API"                 'Bun\.'                       "${SRC_TESTS[@]}"
scan "no bun:test import"         'from +["'\'']bun:test'       "${SRC_TESTS[@]}"
# Legacy vocabulary: the domain nouns 'trail'/'canopy' are forbidden in src/ and tests/.
# Word-boundaried (portable BSD+GNU ERE) so 'trailing' etc. do not false-positive. Cite pinned
# decision IDs (e.g. D-014) WITHOUT the legacy filename to keep this scan clean.
scan "no legacy vocab"            '(^|[^a-zA-Z])(trails?|canop(y|ies))([^a-zA-Z]|$)' "${SRC_TESTS[@]}"

# §13.2 Runtime architecture
scan "no server/socket/RPC"       '(createServer|\.listen\(|new (Server|Socket)\()' "${SRC_TESTS[@]}"
# Detached process groups are permitted only in the crash-test harness, which must kill the CLI
# and its blocking Git proxy together. The production runtime must never create one.
scan "no detached production processes" '(detached: *true|\.unref\(\))'               src

# Feature 007's deterministic crash boundary is implemented entirely by a test-only PATH proxy.
# Guard both source and the distributable so an environment hook, sentinel protocol, or proxy
# vocabulary cannot accidentally become a production backdoor.
PRODUCTION_ARTIFACTS=(src)
if [ -f dist/grove.mjs ]; then PRODUCTION_ARTIFACTS+=(dist/grove.mjs); fi
# P2.6 / ledger G-9: this rule used to name GROVE_TEST_GIT_FAULT_CONFIG literally, so it could only
# ever catch the one hook it was written for -- which is exactly how GROVE_TEST_MIGRATION_CRASH_AFTER
# reached dist/grove.mjs unnoticed. A rule that cannot catch its own class is decoration. Match the
# whole GROVE_TEST_* namespace instead.
scan "no production Git fault hook" '(GROVE_TEST_[A-Z0-9_]+|git fault proxy|sentinelTiming|exactGitArgs)' "${PRODUCTION_ARTIFACTS[@]}"

# P0.1 argv injection: a remote NAME is not a git ref and never reaches check-ref-format, so a
# repository named `--upload-pack=<command>` reaches `git fetch` as an OPTION and git executes it.
# The adapter validates every remote it spends; a hand-built fetch argv outside src/git/ bypasses
# that. Scoped to the class actually fixed — a NON-LITERAL element in a fetch argv — because the
# string "fetch" is also the durable operation step kind and the literal-only fetch argvs
# (repo.ts, reconcile.ts) already hardcode `--`. Measured: 0 sites.
fetch_argv_hits=$(grep -rnE '\[[[:space:]]*"fetch"[^]]*,[[:space:]]*[A-Za-z_$]' src --include='*.ts' 2>/dev/null | grep -v '^src/git/' || true)
if [ -n "$fetch_argv_hits" ]; then
  echo "FAIL: no hand-built fetch argv outside src/git/ (use Git#fetch / Git#tryFetch — they validate the remote)"
  echo "$fetch_argv_hits" | sed 's/^/    /'
  fail=1
else
  echo "ok:   no hand-built fetch argv outside src/git/"
fi

# Parse discipline (P0-7): every handler goes through `parseCommand`, which is what enforces each
# command's declared positional arity. A handler that calls `parseArgs` directly silently drops
# surplus arguments again, so the only permitted call site is inside `parseCommand` itself.
parseargs_hits=$(grep -rnE 'parseArgs\(' src --include='*.ts' 2>/dev/null | grep -v '^src/commands/args.ts:' || true)
if [ -n "$parseargs_hits" ]; then
  echo "FAIL: no direct parseArgs (use parseCommand — it enforces declared arity)"
  echo "$parseargs_hits" | sed 's/^/    /'
  fail=1
else
  echo "ok:   no direct parseArgs"
fi

# CMD-16: the registry is the only runtime schema owner. A second argument to parseCommand is a
# handler-local schema (or extras flag) and recreates the drift this chokepoint removes.
handler_schema_hits=$(grep -rnE 'parseCommand\(ctx[[:space:]]*,' src/commands --include='*.ts' 2>/dev/null | grep -v '^src/commands/args.ts:' || true)
if [ -n "$handler_schema_hits" ]; then
  echo "FAIL: no handler-local command schemas (declare options/positionals/extras in CommandSpec)"
  echo "$handler_schema_hits" | sed 's/^/    /'
  fail=1
else
  echo "ok:   no handler-local command schemas"
fi

# §10.4 Excluded-path provenance markers (defensive; these strings should never appear)
scan "no excluded provenance"     '(@grove/(rpc|daemon)|packages/(rpc|daemon)/|layout-migration)' "${SRC_TESTS[@]}"

# v3 ownership cutover: old runtime compatibility, claims, provenance, rollback journals, and
# ref-deleting helpers may not return. Ruling ⑥: there is no migration runtime at all -- v3
# refuses a schema-1/2 workspace and says which binary refused (src/version.ts).
for removed in src/compat src/git/claim.ts src/store/journal.ts src/migration src/commands/migrate.ts; do
  if [ -e "$removed" ]; then
    echo "FAIL: removed ownership runtime path exists: $removed"
    fail=1
  else
    echo "ok:   removed ownership runtime path absent: $removed"
  fi
done
scan "no ownership runtime symbols" '(withBranchClaim|ClaimHolder|Provenance|beginJournal|rollbackJournal|deleteRef\(|SurvivingRefs|classifyBranch\(|classifyWork\()' src
scan "no migration runtime symbols" '(registerMigrate|migrationsDir|MIGRATIONS_DIR|GROVE_TEST_MIGRATION_CRASH_AFTER)' src

# P2.7 / ledger G-16: no tracked text file may carry a byte outside tab/LF/CR and the printable
# ranges. specs/001-grove-cli/reviews/coverage-audit-20260815.md held a raw NUL and had been binary
# to git since the day it was committed -- a review record that could not itself be reviewed, with
# no diff at all. This plan hit the same defect during its own authoring.
#
# Implemented in Node, deliberately: the first version used `grep -lP`, which SILENTLY passed on a
# real staged NUL file. BSD grep on macOS has no -P at all, and where ugrep provides it the wrapper
# passes -I, which skips binary files -- i.e. precisely the files this rule exists to find. A gate
# that cannot fail is worse than no gate, and this one had already shipped once as decoration.
tracked_files=$(git ls-files -z -- '*.md' '*.txt' '*.json' '*.ts' '*.mjs' '*.sh')
if [ $? -ne 0 ]; then
  # Without this the gate FAILS OPEN: a failing `git ls-files` leaves control_hits empty and the
  # rule prints "ok:" and exits 0. The comment above says a gate that cannot fail is worse than no
  # gate; this one could not fail under any git-less invocation.
  echo "FAIL: cannot enumerate tracked files for the control-byte scan"
  fail=1
fi
control_hits=$(printf '%s' "$tracked_files" \
  | node -e '
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const fs = require("node:fs");
      const bad = Buffer.concat(chunks).toString("utf8").split("\0").filter(Boolean)
        .filter((f) => {
          let b; try { b = fs.readFileSync(f); } catch { return false; }
          return b.some((x) => x < 9 || (x > 13 && x < 32) || x === 127);
        });
      if (bad.length) process.stdout.write(bad.join("\n") + "\n");
    });
  ')
if [ -n "$control_hits" ]; then
  echo "FAIL: tracked text files contain control bytes (git treats them as binary; the diff vanishes)"
  echo "$control_hits" | sed 's/^/    /'
  fail=1
else
  echo "ok:   no control bytes in tracked text files"
fi

if [ "$fail" -ne 0 ]; then
  echo "PROC-07 scan: FAILED"
  exit 1
fi
echo "PROC-07 scan: PASSED"
