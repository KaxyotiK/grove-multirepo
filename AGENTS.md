# AGENTS.md

This repo is spec-driven with [Spec Kit](https://github.com/github/spec-kit). The spec is authority; code follows it.

- **Principles & governance:** `.specify/memory/constitution.md`
- **Current behaviour spec:** `specs/003-git-native-grove/` — `spec.md` and `contracts/`. This is where the Git-native revision is specified and where new behaviour is written.
- **Stable citation authority:** `specs/001-grove-cli/contracts/` — start at its `README.md`. `§N` citations and the 180 regression scenario IDs resolve there; **never renumber sections**. It is closed to new behaviour: `003` supersedes it wherever the two disagree, and sections describing deleted subsystems carry a **Superseded** note. A citation into one fails `tests/module/citations.test.ts`.
- **Changing behaviour:** `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`. Cite the contracts, never restate them.
- **Task checkboxes in `tasks.md` are not evidence.** They drifted from reality in both `001` and `002`. What is done is recorded in the ledger `Status` column with a green witness; `/speckit-analyze` must not read them.
- **Verify:** `npm run typecheck && npm test && npm run scan && npm run traceability`
- **Out of scope until stated otherwise:** CI, GitHub Actions, and any platform but macOS. Verification is local (constitution 4.0.0). Do not raise it as a gap.
- **Requests outside the current plan** go to a GitHub issue (`gh issue create`), not into the work.
