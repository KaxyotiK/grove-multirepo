# grove-multirepo

Grove is a workspace-local CLI for coordinating Git worktrees across repositories. Git owns branches, refs, HEADs, upstreams, worktree registrations, and working state; Grove adds layout, repository acquisition policy, diagnostics, advisory metadata, and explicit multi-repository operations. There is no daemon, server, or global state.

## Install

Requires macOS, Node 24 or newer, and Git.

```bash
npm install -g grove-multirepo
grove --version
```

The npm package is `grove-multirepo`; the installed command is `grove`.

## Concepts

- A **workspace** is a directory holding `.grove/` (config, locks, forward operations, and advisory Grove records) plus the layout roots below.
- A **repository** is registered one of two ways. A **managed** repository comes from `repo add`: a bare common Git repository plus real peer **trunk** worktrees. A **linked** repository comes from `repo link`: an existing Git repository elsewhere, registered without any Git mutation.
- A **trunk** is a managed peer worktree for a long-running branch such as `main`.
- A **Grove** is a named unit of work. A **Tree** is one repository's worktree inside a Grove, so a Grove spanning three repositories has three Trees.

Git is the authority for refs, branches, HEAD, upstreams, worktree registrations, and working state. Grove's config and metadata never own a live branch or Tree; they hold conventions and advisory preferences.

| | `repo add <remote>` | `repo link <git-path>` |
|---|---|---|
| Registration | managed | linked |
| Common repository | creates a bare anchor | records the existing common directory |
| Initial trunk | creates a real peer worktree | none |
| `trunk add`/`remove`/`sync` | supported | refused before any mutation |
| Tree creation | supported | supported |
| `repo remove` | unregisters; Git data retained | unregisters; Git data retained |

Default layout (every root is a validated, configurable template):

```text
<workspace>/
  .grove/
    config.json
    locks/
    operations/
    groves/                         # advisory metadata and archive recipes
  repos/<repo>/                     # managed bare common repositories
  trunks/<branch-slug>@<repo-slug>/
  groves/<grove>/trees/<tree>/
  archives/<grove>/
```

## Golden path

```bash
grove init
grove repo add git@github.com:example/ledger.git --name ledger
grove new pricing-fix --repo ledger
grove agent add codex codex --default
grove agent run pricing-fix
grove changes pricing-fix
git -C groves/pricing-fix/trees/pricing-fix@ledger push -u origin pricing-fix
grove archive pricing-fix
```

Add repositories with an SSH URL, or an HTTPS URL plus a Git credential helper (the macOS Keychain helper or `gh auth setup-git`); `repo add` refuses a URL with embedded credentials. Managed Git operations also refuse credentials introduced only by your Git configuration by default. Set `GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1` on a single `grove` invocation to permit them, including a `reconcile` recovery run. The setting is checked again on each invocation and is never stored. A credentialed URL passed directly to `repo add` is always refused.

`archive` refuses a branch that is not pushed unless you pass `--allow-unpushed`. A retained ref is not a durability guarantee — branch deletion is an ordinary native Git action and the managed bare repository is local-only — so archiving promises restorability only for a commit that survives losing this machine.

`repo add` creates a managed bare common repository under the compiled repository layout and a real peer worktree for its initial trunk. Additional long-running branches use `trunk add` and the same peer layout. Removing a Tree or trunk retains its branch; `repo remove` unregisters only.

Use `repo link <path>` for an existing normal repository, subdirectory, linked worktree, or bare repository. Grove records its canonical Git common directory without creating refs, worktrees, or a duplicate checkout. The preferred trunk is advisory. All trunk-mutating commands refuse linked repositories before mutation, while ordinary Tree creation remains available:

```bash
grove repo link ~/projects/existing-checkout --name existing --trunk main
grove new local-work --repo existing
```

## Git-native behavior

- A Grove Tree and a trunk are ordinary Git worktrees. Native `git switch`, `git worktree`, and ref changes are visible on the next Grove invocation.
- `.grove/config.json` stores registration policy and conventions, not live trunk or Tree arrays. Central `.grove/groves/*.json` records are advisory settings and archive recipes.
- Derived branch names refuse an existing ref. `--branch` adopts an existing branch deliberately, and a new explicit branch also needs `--from`.
- `repo fetch` updates remote-tracking refs only; `repo configure` changes advisory preferences without touching Git.
- `archive`, `restore`, `delete`, and `rename` work from observed worktrees and archive recipes. `--allow-destructive-git-ignored` permits only itemized Git-ignored file loss; `--allow-destructive-all` also permits tracked edits, ordinary untracked files, and loose Grove content itemized path by path; anything added after the plan is refused. Neither deletes refs. `--allow-unpushed` is a separate archive permission.
- `agent run` starts one foreground process in a Tree; signals and exit status pass through.
- `doctor` reports stable conformance diagnostics. `fix --move` applies only an exact diagnostic after rescanning. `reconcile` resumes durable forward operations; it never rolls back by deleting refs.
- `sync` makes integration strategy explicit (`fetch-only`, `ff-only`, or `rebase`) and reports every selected target. It never resets divergence or destroys a native sequencer.
- Schema-1 and schema-2 ownership workspaces are refused with a self-identifying version-skew error. Grove v3 does not interpret or migrate their ownership state; use the matching older Grove version for those workspaces. Bare repositories and attached worktrees remain ordinary Git topology and may be registered explicitly in a schema-3 workspace.

For example, adopting an existing branch, then creating a new explicitly named branch from a base:

```bash
grove new pricing-fix --repo ledger --branch ledger=feature/pricing
grove new pricing-v2 --repo ledger \
  --branch ledger=feature/pricing-v2 --from ledger=main
```

Add `--json` for one stable result value on stdout. Machine results include all selected targets, diagnostics, partial outcomes, and classified exit codes.

## Development

Build and run from a checkout:

```bash
npm ci
npm run build                 # dist/grove.mjs, one self-contained bundle
node dist/grove.mjs --version
```

For an isolated install check, pack the package and install it under a temporary npm prefix.

Verify:

```bash
npm run typecheck
npm test
npm run scan
npm run traceability
```

### Writing help text

Command help is generated from each command's `CommandSpec` in `src/commands/registry.ts`, which is also the runtime option schema. Keep summaries and argument lines short and use the vocabulary in [Concepts](#concepts). In particular:

- Never describe config or metadata as owning a live branch or Tree; Git owns live state.
- `repo link` accepts anything Git resolves to a repository (root, subdirectory, linked worktree, or bare repository). Never present a linked checkout as a Grove trunk.
- `sync` help states the selected strategy and never implies a reset, a guessed upstream, or atomic success. `reconcile` resumes or abandons forward operations; it never "rolls back".
- Do not present an old ownership layout as the default, or advertise a migration path: v3 refuses foreign-schema workspaces and names the running version, binary, and both schemas.

Recurring phrases: "Git owns live state", "branch retained", "advisory preference", "managed peer trunk", "linked repository", "forward operation", "rescan before mutation".

## Specifications

The authoritative behavior is under `specs/003-git-native-grove/`; start with its `spec.md`, decisions, contracts, and traceability ledger. Historical v1 contracts remain under `specs/001-grove-cli/` for regression evidence only.

Some low-level primitives (typed errors, IDs, atomic files, locks, path containment) were adapted from the author's earlier `grove-ide` project.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md). Grove is released under the [MIT License](LICENSE).
