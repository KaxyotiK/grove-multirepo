# Decision 001: Repository acquisition determines trunk capability

**Status:** Accepted **Date:** 2026-08-22 **Supersedes:** The schema-v2 assumption that `repo add` creates an ordinary primary checkout and treats that checkout as the first trunk.

## Context

Grove needs a stable common Git directory and one or more independent working directories. Git already supports that topology directly: a bare repository can own the common objects, refs, and worktree administration while every trunk and Tree is an ordinary linked worktree.

The 003 Git-native proposal incorrectly treated the v1 managed bare topology as inseparable from v1 branch claims, provenance, and manifest-owned live state. Those ownership mechanisms conflict with Git-native Grove; a bare common repository does not. Replacing the bare store with a normal clone created an asymmetric "primary checkout" that was simultaneously repository storage and a special trunk. That made `repo add --trunk main` appear successful without creating a trunk under the configured trunk layout, prevented uniform trunk removal, and made additional worktrees depend on a privileged checkout.

Git permits one non-forced checkout of a branch per common repository. This creates a different constraint for an existing standard repository linked from outside the workspace: if Grove creates a `main` trunk worktree, the user's existing checkout can no longer switch to `main`. Grove must not impose that restriction on an externally managed checkout merely because it was linked.

## Decision

Repository acquisition mode is durable workspace policy, not a claim over Git state:

- `repo add` creates a **managed bare repository** at the configured repository-store path. It creates the requested/default trunk as a linked worktree under the configured trunk layout. Every later trunk and Tree is another native linked worktree of the same common repository.
- `repo link` registers an **externally managed repository** by canonical common-directory identity. It never creates a trunk worktree. Its preferred trunk is advisory: it supplies the default creation/comparison base but does not reserve or check out that branch.
- Tree creation remains available for both modes. Grove-created Tree branches intentionally remain checked out for the Tree's lifetime, and Git's existing-worktree arbitration is honored without force.
- Trunk mutation commands are enabled only for repositories acquired with `repo add`. They refuse linked repositories before mutation, regardless of whether the linked common directory happens to be bare. A future explicit opt-in for externally managed bare repositories requires its own decision; topology alone is not consent to manage external trunks.
- Trunk listing and repository status may report external worktrees as observations, but must not present an external checkout as a Grove-managed trunk.
- No primary-checkout role exists for a managed repository. All managed trunks share one creation, discovery, synchronization, movement, and removal contract.
- Managed bare storage is not authoritative for branch/worktree existence. Git remains the sole authority; Grove stores only the repository acquisition policy, stable identity, preferred remote/base, and layout convention.

## Scenario outcomes

| Acquisition and input | Repository anchor | Initial trunk outcome | Later trunk operations | Tree creation |
|---|---|---|---|---|
| `repo add <remote>` with remote symbolic HEAD | Managed bare common directory | Create that branch under trunk layout | Allowed | Allowed |
| `repo add <remote> --trunk <existing-remote-branch>` | Managed bare common directory | Create requested tracking trunk | Allowed | Allowed |
| `repo add <empty-remote> --trunk <branch>` | Managed bare common directory | Create explicit unborn trunk | Allowed | Allowed after a usable base exists |
| `repo add` with no resolvable trunk | No published registration | Refuse before creation | Not applicable | Not applicable |
| `repo link <standard-checkout>` | External canonical common directory | None; preferred trunk is advisory | Refused | Allowed |
| `repo link <linked-worktree-or-subdirectory>` | External canonical common directory | None; preferred trunk is advisory | Refused | Allowed |
| `repo link <bare-repository>` | External canonical common directory | None; preferred trunk is advisory | Refused without a future explicit opt-in | Allowed |

If managed repository creation succeeds but initial trunk creation does not, Grove reports a resumable partial operation and retains the observed repository artifact. It never compensates by deleting refs or a successfully created worktree.

## Consequences

- `layout.repositories` denotes managed bare common-directory storage, not primary checkouts.
- `layout.trunks` contains every managed trunk, including the configured default trunk.
- The repository registration model must distinguish managed-add from external-link policy without persisting live refs, trunk arrays, or worktree claims.
- `repo add`, `trunk add/remove/sync`, observation roles, help, results, and fixtures must remove the primary-checkout exception.

This decision governs acquisition inside a schema-3 workspace. Foreign ownership schemas and any cross-version conversion workflow are outside its scope.

## Rejected alternatives

### Ordinary clone as the default trunk

Rejected because repository storage becomes coupled to one privileged checkout, `main` does not occupy the trunk layout, and trunk lifecycle behavior is asymmetric.

### Detached administrative checkout plus linked trunks

Rejected because it creates an unused but indispensable working directory that can be dirtied and exists only to imitate a bare common repository.

### Standard checkout located inside the trunk layout

Rejected because one supposedly removable trunk owns the common repository used by every other worktree.

### Trunks for linked standard repositories

Rejected because checking out a long-running branch in Grove prevents the external checkout from switching to that branch. Linking grants observation and Tree orchestration, not control of the user's normal trunk branches.

## Regression provenance

- The prior implementation at `e5e958a` already created `.bare/<repo>` and an initial trunk worktree for `repo add`, while `repo link` created no trunk.
- Commit `c69c470` introduced the 003 proposal and, without a recorded alternative analysis, declared that `repo add` would create a normal clone whose checkout was the primary trunk.
- Commit `9da99e1` converted that declaration into the specification, research decisions, contracts, migration design, and constitution. It also classified the managed bare topology itself as legacy rather than separating topology from obsolete ownership metadata.
- Commit `6b20657` implemented the approved documents. The build therefore matched its v3 inputs; the regression originated in architectural specification, not in an isolated coding mistake.
- Commit `438e6cc` then closed the release audit by documenting and testing the ordinary checkout as the "primary trunk." That was the wrong remediation: it reconciled tests and documentation to the candidate implementation instead of treating the prior `repo add` topology and the reported missing trunk as the behavioral baseline. The audit is now explicitly invalidated.
- The review gates checked implementation-to-spec consistency and Git-state ownership safety, but did not include a prior-release topology parity scenario asserting that `repo add --trunk main` creates a real trunk-layout worktree. That missing before/after product scenario allowed the design regression to pass every review cycle.
