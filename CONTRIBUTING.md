# Contributing

Thanks for your interest in Grove. Bug reports, reproductions and focused pull requests are welcome.

## Before you start

- Grove supports macOS only. You need Node 24 or newer and Git.
- Open an issue before starting anything larger than a small fix, so the approach can be agreed first.
- For a bug, include the exact commands you ran, what you expected, what happened, and the output of `grove --version`. `--json` output is especially useful.

## How the project works

Grove is spec-driven. The specification is the authority, and code follows it.

- The current behaviour is specified in `specs/003-git-native-grove/`: `spec.md` and its `contracts/`.
- The project's principles are in `.specify/memory/constitution.md`.
- A change to behaviour starts with the spec: update the governing contract and add an acceptance scenario in `specs/003-git-native-grove/contracts/acceptance-scenarios-v3.md`, then implement it.
- Write the test first. A fix should come with a test that fails before the change and passes after it.
- Cite contracts rather than restating them. `specs/001-grove-cli/contracts/` is a closed citation authority: never renumber its sections.

## Checks

Run the full local gate before opening a pull request:

```bash
npm ci
npm run typecheck && npm test && npm run scan && npm run traceability
```

There is no hosted CI. Verification is local, on macOS.

## Pull requests

- Keep each pull request to one change, with a clear description of the behaviour it changes and the scenario IDs it adds or touches.
- Say which checks you ran and their results.
- Don't include unrelated formatting or refactoring.

## Security issues

Please don't report security problems in public issues. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
