# AGENTS.md

Grove is spec-driven with [Spec Kit](https://github.com/github/spec-kit): the specification is the authority, and code follows it. The principles that govern every change are in the constitution (`.specify/memory/constitution.md`).

## To find out how Grove should behave

Read the current contracts in `specs/003-git-native-grove/contracts/`. Where they are silent, the original contracts in `specs/001-grove-cli/contracts/` still apply; where the two disagree, the current contracts win. `specs/README.md` explains the directory numbering and history if you need it.

## To change behaviour

1. Run `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`.
2. Write the new rule into the current contracts and add an acceptance scenario with a new ID. Never add behaviour to the original contracts.
3. Write a test whose title cites the scenario ID, and see it fail before you change the code.
4. Cite contract sections (`§N`) and scenario IDs instead of restating rules. Never renumber a section or reuse an ID: tests, help text, and the traceability ledger refer to them, and `npm run traceability` and the citation test fail on a broken reference.
5. Count work as done only when a passing test witnesses it in the ledger. A checked box in a `tasks.md` is not evidence, and `/speckit-analyze` must not read the boxes.

## To verify a change

Run `npm run typecheck && npm test && npm run scan && npm run traceability`. Verification is local and on macOS only: there is no CI, no GitHub Actions, and no other platform until stated otherwise, so do not raise their absence as a gap.
