#!/usr/bin/env bash
# Generic §11 scenario validator. The implementation is Node so title parsing and fixture-driven
# negative controls are identical on macOS and Linux; this wrapper preserves the repository command.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -gt 0 ]]; then
  exec node scripts/scenario-traceability.mjs "$@"
fi

# P2b closed the red window: both legs go green together, so the single-command form is restored
# and scripts/window-gate.sh, the pinned baseline, and the deferral file are all deleted.
node scripts/scenario-traceability.mjs \
  --ledger specs/003-git-native-grove/reviews/prior-release-scenario-ledger.json \
  --ignore-prefix V3
# P2.2 / ledger G-6: the v3 leg tolerates the 180 prior-release ids that prior-release test titles
# are required to cite -- by naming their 14 families explicitly, never with a blanket
# --ignore-unknown, which also swallowed typo'd and invented V3 ids.
node scripts/scenario-traceability.mjs \
  --contract specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md \
  --ignore-prefix AGENT --ignore-prefix ARCH  --ignore-prefix ART   --ignore-prefix CMD \
  --ignore-prefix DISC  --ignore-prefix E2E   --ignore-prefix FILE  --ignore-prefix INIT \
  --ignore-prefix ISO   --ignore-prefix PROC  --ignore-prefix RECON --ignore-prefix REPO \
  --ignore-prefix TREE  --ignore-prefix TRUNK
