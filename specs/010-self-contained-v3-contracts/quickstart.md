# Quickstart: Self-contained v3 contracts

1. `grep -n -i proposal specs/003-git-native-grove/contracts/*.md` — every hit is marked historical, void, or not normative.
2. For each grammar line in `cli-surface-v3.md`, compare with `node dist/grove.mjs <command> --help`.
3. Temporarily add `**Normative source**: proposal section 5.` to `config-v3.md`; `node --test tests/module/citations.test.ts` fails naming it. Revert.
4. The historical proposal is not in this repository; it is kept in the private development history.
5. `npm run typecheck && npm test && npm run scan && npm run traceability`; `git diff --stat -- src` is empty.
