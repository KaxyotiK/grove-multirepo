/**
 * Repository commands (§8.4): `repo add`, `repo link`, `repo ls`, `repo status`, `repo fetch`.
 * Added repositories are managed bare anchors with peer trunk worktrees; linked repositories are
 * registered by canonical common Git directory. Removal unregisters and never deletes Git data.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { GroveError } from "../errors.ts";
import { Git, assertFetchableRemote, createGitRunner } from "../git/adapter.ts";
import { porcelainStatus } from "../git/worktree.ts";
import { createIdGenerator } from "../model/ids.ts";
import { assertBranchName, assertCredentialFreeRemote, assertPathLimits, assertRepoName, caseFoldKey } from "../model/validate.ts";
import { normalisePath } from "../config/discovery.ts";
import { requireWorkspace, saveWorkspace } from "../config/workspace.ts";
import { register, type CommandContext } from "./registry.ts";
import { observeWorkspace, observedRepositoryDetail, observedTrunkAllocationNames } from "../model/observed.ts";
import { commandResultExit, completeResult, sortResultTargets, type ResultTarget } from "../model/result.ts";
import { compileLayout, expandRepositoryPath, expandTrunkPath, resolveLayoutTarget } from "../config/layout.ts";
import { assertTargetsAvailable, beginOperation, recordCompleted, recordPending, recordStepFailure, withOperationTargetLocks } from "../store/operation.ts";
import { captureAcquisitionGenesis, captureAcquisitionRemoteProof, matchesAcquisitionGenesis, type AcquisitionGenesisProof } from "../store/acquisition-anchor.ts";
import { redactRemote } from "../model/result.ts";
import type { RepositoryEntry, WorkspaceConfig } from "../model/types.ts";
import { allocateDir, refNameFromBytes } from "../model/encoding.ts";
import { parseCommand } from "./args.ts";
import { containedPath, removeContainedDirectory } from "../paths/fs.ts";

const git = () => new Git(createGitRunner());

function deriveName(remote: string): string {
  return (
    remote
      .replace(/\.git$/, "")
      .split(/[/:]/)
      .filter(Boolean)
      .pop() ?? "repo"
  );
}

function assertRepoNameFree(config: Pick<WorkspaceConfig, "repositories">, name: string): void {
  const key = caseFoldKey(name);
  if (config.repositories.some((r) => caseFoldKey(r.name) === key)) {
    throw new GroveError({
      kind: "refused-conflict",
      what: `A repository named "${name}" already exists`,
      why: "repository names are unique under case-folding and are used as directory names",
      remedy: `Remove the existing "${name}" first, or add this one with --name.`,
      detail: { name },
    });
  }
}

/**
 * V3ACQ-02. Git resolves a relative local remote against the directory it runs in, and
 * `repo add` runs Git in the workspace root and then in the new store, never where the user typed
 * the command. Resolve it once, against the invocation directory, before preflight, so the absolute
 * path is what is validated, recorded (including for `reconcile` resume) and fetched.
 *
 * Only input Git itself treats as a local path is touched (transport.c `url_is_local_not_ssh`): no
 * `<transport>::` helper, no `scheme://` URL, and no `:` unless a `/` precedes it. scp-like
 * `host:path` is therefore left verbatim. `file://` is Git's local transport; it is resolved only
 * when Git cannot use it as written: no `/` after `file://`, or a first segment of `.` or `..`.
 * Absolute paths are returned unchanged.
 */
function resolveLocalRemote(remote: string, cwd: string): string {
  let prefix = "";
  let path: string;
  if (remote.startsWith("file://")) {
    path = remote.slice("file://".length);
    // Git reads `file://<host>/<path>` as `/<path>` and ignores the host, so any form with a `/`
    // is usable as written. Only a path with no `/` at all, or whose first segment is `.` or `..`
    // (which Git would misread as a host), is the user's relative path.
    const first = path.split("/")[0];
    if (path === "" || (path.includes("/") && first !== "." && first !== "..")) return remote;
    prefix = "file://";
  } else {
    if (/^[A-Za-z][A-Za-z0-9+.-]*(?::\/\/|::)/.test(remote)) return remote;
    const colon = remote.indexOf(":");
    const slash = remote.indexOf("/");
    if (colon >= 0 && (slash < 0 || slash > colon)) return remote;
    path = remote;
  }
  if (isAbsolute(path)) return remote;
  let resolved: string;
  try {
    // The OS, not a lexical join, resolves `..` and symlinks: exactly what Git would have opened.
    resolved = realpathSync(`${cwd}/${path}`);
  } catch {
    throw new GroveError({
      kind: "invalid-input",
      what: `Cannot add ${redactRemote(remote)}: no such local path`,
      why: `a relative local path is resolved against the directory the command runs in (${cwd}), and nothing exists there`,
      remedy: "Pass the repository's absolute path, or a path relative to the current directory, or its remote URL.",
      detail: { remote: redactRemote(remote), cwd },
    });
  }
  return `${prefix}${resolved}`;
}

async function addRepository(ctx: CommandContext, remote: string, name: string, trunkOverride?: string): Promise<number> {
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  assertRepoNameFree(ws.config, name);
  const g = git();
  // The typed URL already passed (addHandler); resolve the effective URL before any other Git
  // invocation. The second advertisement and the store fetch each get a fresh context check.
  assertCredentialFreeRemote(remote, await g.resolveRemoteUrl(ws.root, remote));
  await g.probeCapabilities(ws.root, ["worktree-porcelain-z", "rev-parse-end-of-options"]);
  if (trunkOverride) assertBranchName(trunkOverride);
  const requestedRef = trunkOverride ? refNameFromBytes(Buffer.from(`refs/heads/${trunkOverride}`)) : null;
  const advertisement = await g.inspectRemote(ws.root, remote, requestedRef);
  const empty = advertisement.empty;
  const trunk = trunkOverride ?? advertisement.symbolicHead?.utf8?.replace(/^refs\/heads\//, "") ?? null;
  if (!trunk) throw new GroveError({ kind: "refused-precondition", what: `Cannot choose a trunk for ${redactRemote(remote)}`, why: empty ? "the remote is empty and no --trunk was supplied" : "the remote has no symbolic HEAD", remedy: "Pass --trunk <branch>." });
  assertBranchName(trunk);
  const expectedRemoteOid = advertisement.refs.find((entry) => entry.ref.utf8 === `refs/heads/${trunk}`)?.oid ?? null;
  if (!empty && expectedRemoteOid === null) throw new GroveError({ kind: "invalid-input", what: `Remote branch "${trunk}" does not exist`, why: "a non-empty repo add trunk must already exist remotely", remedy: "Choose a branch reported by the remote." });

  const layout = compileLayout(ws.root, ws.config.layout);
  const anchor = expandRepositoryPath(layout, name);
  const snapshot = await observeWorkspace(ws, g);
  const trunkAllocation = allocateDir({
    branch: trunk,
    repo: name,
    canonicalFullRef: Buffer.from(`refs/heads/${trunk}`),
    taken: new Set(observedTrunkAllocationNames(snapshot).map(caseFoldKey)),
  });
  const trunkPath = expandTrunkPath(layout, trunkAllocation);
  resolveLayoutTarget(layout, anchor);
  resolveLayoutTarget(layout, trunkPath);
  assertPathLimits(anchor, `managed repository path for ${name}`);
  assertPathLimits(trunkPath, `initial trunk path for ${name}/${trunk}`);
  const targetLocks = [`repository-alias:${name.toLowerCase()}`, `path:${anchor}`, `path:${trunkPath}`];
  return withOperationTargetLocks(ws.root, targetLocks, "repo-add", async () => {
    assertTargetsAvailable(ws.root, targetLocks);
    resolveLayoutTarget(layout, anchor);
    resolveLayoutTarget(layout, trunkPath);
    const currentWorkspace = requireWorkspace({ cwd: ws.root, workspace: ws.root });
    assertRepoNameFree(currentWorkspace.config, name);
    if (existsSync(anchor) || existsSync(trunkPath)) throw new GroveError({ kind: "refused-conflict", what: `Cannot add repository "${name}"`, why: `${existsSync(anchor) ? anchor : trunkPath} already exists`, remedy: "Choose another alias or remove the conflicting path." });
    // Git configuration can change after the first advertised snapshot (including while its
    // ls-remote runs). Resolve again immediately before this second, in-lock network call.
    assertCredentialFreeRemote(remote, await g.resolveRemoteUrl(ws.root, remote));
    const currentAdvertisement = await g.inspectRemote(ws.root, remote, requestedRef);
    if (currentAdvertisement.advertisementGeneration !== advertisement.advertisementGeneration) throw new GroveError({ kind: "refused-conflict", what: "Remote changed after planning", why: "the advertised refs no longer match the preflight observation", remedy: "Retry from fresh remote state." });

    const id = createIdGenerator().ulid();
    const operation = beginOperation(ws.root, {
      kind: "repo-add",
      scope: { repositoryId: id, repositoryAlias: name },
      targetLocks,
      targets: [{ selector: { repositoryId: id, repositoryAlias: name }, steps: [
        { id: "initialize-bare", kind: "repository-init-bare", input: { anchor, trunk } },
        // The exact remote is recoverable only through the restrictive `secret` field below.
        // Even a credential-free public URL is still a raw remote and must not be copied into the
        // durable step plan, because completed records retain their immutable plan.
        { id: "configure-remote", kind: "remote-add", input: { remote: "<redacted-remote>", name: "origin" } },
        ...(!empty ? [{ id: "fetch", kind: "fetch", input: { expectedRemoteOid, generation: advertisement.advertisementGeneration } }] : []),
        { id: "initial-trunk", kind: "worktree-add", input: { path: trunkPath, branch: trunk, expectedRemoteOid, unborn: empty } },
        { id: "register", kind: "workspace-config-update", input: { repositoryId: id, expectedRevision: currentWorkspace.meta.rev } },
      ] }],
      secret: { remote },
    });
    const fail = (step: string, error: unknown, after: unknown, reason = "git-failed"): number => {
      // P7.1 (ledger E-1, decision B3). FR-051/constitution IV: "every non-recoverable record can be
      // explicitly closed without inferred cleanup." A failed acquisition was hardcoded to
      // `recoverable-intermediate`, which `abandon` refuses (operation.ts accepts only
      // `conflicted`) — so the alias was locked forever and the remedy named an unreachable state.
      // `new` and `archive` reach `conflicted` the same way. (A never-assigned `stale` state was
      // removed from the union,)
      recordStepFailure(operation, step, "conflicted", reason, { error: String((error as Error).message ?? error), after, anchor });
      const explained = reason === "git-failed" || !GroveError.is(error) ? {} : { detail: { why: error.why, remedy: error.remedy } };
      const result = { schemaVersion: 1 as const, command: "repo add", outcome: "partial" as const, operationId: operation.id, targets: [{ selector: { repositoryId: id, repositoryAlias: name }, before: null, action: step, after, reason, ...explained }], diagnostics: [], detail: { remote: redactRemote(remote), trunk, anchor, trunkPath } };
      return ctx.emit.result(result, commandResultExit(result));
    };

    let defaultGitTemplate = false;
    let genesisProof: AcquisitionGenesisProof | null = null;
    try {
      // An explicit user template can copy arbitrary content into a new bare repository. Its
      // files are never part of Grove's disposable acquisition shell, even if unchanged later.
      const templateBefore = await g.tryRun(ws.root, ["config", "--get", "init.templateDir"]);
      defaultGitTemplate = process.env.GIT_TEMPLATE_DIR === undefined && templateBefore.exitCode === 1;
      recordPending(operation, "initialize-bare", { targetAbsent: true });
      resolveLayoutTarget(layout, anchor);
      mkdirSync(dirname(anchor), { recursive: true });
      mkdirSync(anchor);
      const createdIdentity = lstatSync(anchor);
      await g.run(ws.root, ["init", "--bare", `--initial-branch=${trunk}`, "--", anchor], "Cannot initialize the managed bare repository");
      const anchorIdentity = lstatSync(anchor);
      if (anchorIdentity.dev !== createdIdentity.dev || anchorIdentity.ino !== createdIdentity.ino || anchorIdentity.mode !== createdIdentity.mode || anchorIdentity.uid !== createdIdentity.uid || anchorIdentity.gid !== createdIdentity.gid || anchorIdentity.birthtimeMs !== createdIdentity.birthtimeMs) throw new GroveError({ kind: "refused-conflict", what: "Repository anchor changed during initialization", why: "the directory Grove created was replaced or altered", remedy: "Inspect the occupied path and reconcile explicitly." });
      const templateAfter = await g.tryRun(anchor, ["config", "--get", "init.templateDir"]);
      defaultGitTemplate = defaultGitTemplate && templateAfter.exitCode === 1;
      if (defaultGitTemplate) {
        const reference = mkdtempSync(join(ws.root, ".grove", "anchor-reference-"));
        try {
          const initialized = await g.tryRun(ws.root, ["init", "-q", "--bare", `--initial-branch=${trunk}`, "--", reference]);
          if (initialized.exitCode === 0) genesisProof = captureAcquisitionGenesis(anchor, reference, remote);
        } finally { removeContainedDirectory(containedPath(ws.root, reference, "Cannot remove the temporary acquisition reference")); }
      }
      recordCompleted(operation, "initialize-bare", { anchor, bare: true, head: `refs/heads/${trunk}`, device: anchorIdentity.dev, inode: anchorIdentity.ino, defaultGitTemplate, genesisProof });
    } catch (error) { return fail("initialize-bare", error, existsSync(anchor) ? { anchor } : null); }

    try {
      recordPending(operation, "configure-remote", { remoteAbsent: true });
      const pristineBeforeRemote = genesisProof !== null && matchesAcquisitionGenesis(anchor, genesisProof);
      await g.run(anchor, ["remote", "add", "--", "origin", remote], "Cannot configure origin");
      recordCompleted(operation, "configure-remote", { remote: "origin", anchorContentProof: pristineBeforeRemote ? captureAcquisitionRemoteProof(anchor, genesisProof) : null });
    } catch (error) { return fail("configure-remote", error, { anchor }); }

    if (!empty) {
      // V3SEC-05: Git evaluates insteadOf rules and conditional includes against the store now, not
      // the workspace root; ask it where this fetch really goes, before any network.
      let refusal;
      try { refusal = await g.fetchDestinationRefusal(anchor, "origin"); } catch (error) { return fail("fetch", error, { anchor }); }
      if (refusal) return fail("fetch", new GroveError({
        kind: "refused-policy",
        what: "Cannot fetch the managed repository",
        why: refusal.why,
        remedy: `${refusal.remedy} Close this partial operation with \`grove reconcile --abandon ${operation.id}\` before retrying.`,
      }), { anchor }, "refused-policy");
      try {
        recordPending(operation, "fetch", { generation: advertisement.advertisementGeneration, expectedRemoteOid });
        await g.run(anchor, ["fetch", "--prune", "--", "origin", "+refs/heads/*:refs/remotes/origin/*"], "Cannot fetch the managed repository");
        const fetched = await g.refOid(anchor, refNameFromBytes(Buffer.from(`refs/remotes/origin/${trunk}`)));
        if (fetched !== expectedRemoteOid) throw new GroveError({ kind: "refused-conflict", what: "Fetched trunk differs from the plan", why: `expected ${expectedRemoteOid}, observed ${fetched ?? "missing"}`, remedy: "Inspect the retained bare repository and resume or abandon the operation." });
        await g.run(anchor, ["update-ref", `refs/heads/${trunk}`, expectedRemoteOid as string], "Cannot create the local trunk ref");
        await g.run(anchor, ["symbolic-ref", "HEAD", `refs/heads/${trunk}`], "Cannot set managed repository HEAD");
        recordCompleted(operation, "fetch", { remote: "origin", trunk, oid: fetched });
      } catch (error) { return fail("fetch", error, { anchor }); }
    }

    try {
      recordPending(operation, "initial-trunk", { pathAbsent: true, branch: trunk, oid: expectedRemoteOid, unborn: empty });
      resolveLayoutTarget(layout, trunkPath);
      mkdirSync(dirname(trunkPath), { recursive: true });
      const args = empty
        ? ["worktree", "add", "--orphan", "-b", trunk, "--", trunkPath]
        : ["worktree", "add", "--", trunkPath, trunk];
      await g.run(anchor, args, "Cannot create the initial peer trunk worktree");
      if (!empty) await g.run(trunkPath, ["branch", "--set-upstream-to", `origin/${trunk}`, trunk], "Cannot set the initial trunk upstream");
      const head = await g.currentHead(trunkPath);
      const valid = empty
        ? head.unborn && head.branch?.utf8 === `refs/heads/${trunk}`
        : head.oid === expectedRemoteOid && head.branch?.utf8 === `refs/heads/${trunk}`;
      if (!valid) throw new GroveError({ kind: "refused-conflict", what: "Initial trunk verification failed", why: "the worktree HEAD differs from the acquisition plan", remedy: "Inspect the retained worktree and operation." });
      const status = await porcelainStatus(g, trunkPath);
      if (status.problem || status.changes.length > 0) throw new GroveError({ kind: "refused-conflict", what: "Initial trunk checkout is not clean", why: status.problem ?? `${status.changes.length} path(s) changed during checkout`, remedy: "Inspect the retained worktree and checkout hooks, then reconcile explicitly." });
      recordCompleted(operation, "initial-trunk", { path: trunkPath, branch: `refs/heads/${trunk}`, oid: head.oid, unborn: head.unborn });
    } catch (error) { return fail("initial-trunk", error, { anchor, ...(existsSync(trunkPath) ? { trunkPath } : {}) }); }

    const registration: RepositoryEntry = { id, name, location: { kind: "managed" }, remote: "origin", trunk };
    try {
      recordPending(operation, "register", { revision: currentWorkspace.meta.rev, repositoryAbsent: true });
      const meta = await saveWorkspace(currentWorkspace, { ...currentWorkspace.config, repositories: [...currentWorkspace.config.repositories, registration] });
      recordCompleted(operation, "register", { revision: meta.rev, repositoryId: id });
    } catch (error) { return fail("register", error, { anchor, trunkPath }); }

    const after = { repositoryId: id, repositoryAlias: name, commonGitDir: anchor, trunkPath, preferredRemote: "origin", trunk, empty };
    const result = { ...completeResult("repo add", [{ selector: { repositoryId: id, repositoryAlias: name }, before: null, action: "initialize-bare-and-create-trunk", after, reason: null }], [], { remote: redactRemote(remote), trunk }), operationId: operation.id };
    return ctx.emit.result(result, 0);
  });
}

async function linkRepository(ctx: CommandContext, target: string, nameOverride?: string, trunkOverride?: string): Promise<number> {
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const g = git();
  await g.probeCapabilities(target, ["worktree-porcelain-z", "rev-parse-end-of-options"]);
  const identity = await g.inspectRepository(target);
  if (identity.commonGitDir.utf8 === null) throw new GroveError({ kind: "refused-precondition", what: "Cannot link the repository", why: "its common Git directory is not valid UTF-8", remedy: "Use native Git for this repository.", detail: { reason: "unsupported-native-path" } });
  const commonGitDir = identity.commonGitDir.utf8;
  const snapshot = await observeWorkspace(ws, g);
  if (snapshot.repositories.some((repository) => repository.problem === null && repository.registrationStatus === "registered" && repository.commonGitDir === commonGitDir)) throw new GroveError({ kind: "refused-conflict", what: "Repository is already registered", why: `${commonGitDir} resolves to an existing configured Git identity`, remedy: "Use the existing alias or unregister it first." });
  const name = nameOverride ?? (basename(target).replace(/\.git$/, "") || "repo");
  assertRepoName(name);
  assertRepoNameFree(ws.config, name);
  const remotesResult = await g.tryRun(target, ["remote"]);
  const remotes = remotesResult.exitCode === 0 ? remotesResult.stdout.split("\n").filter(Boolean).sort() : [];
  const preferredRemote = remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] as string : null;
  if (preferredRemote !== null) assertFetchableRemote(preferredRemote);
  let trunk = trunkOverride;
  if (!trunk) {
    const inputHead = await g.currentHead(target);
    trunk = inputHead.branch?.utf8?.replace(/^refs\/heads\//, "") ?? undefined;
  }
  if (!trunk) {
    const commonHead = await g.tryRun(commonGitDir, ["symbolic-ref", "--short", "HEAD"]);
    if (commonHead.exitCode === 0 && commonHead.stdout.trim()) trunk = commonHead.stdout.trim();
  }
  if (!trunk && preferredRemote) {
    const remoteHead = await g.tryRun(commonGitDir, ["symbolic-ref", "--short", `refs/remotes/${preferredRemote}/HEAD`]);
    if (remoteHead.exitCode === 0 && remoteHead.stdout.trim()) trunk = remoteHead.stdout.trim().replace(new RegExp(`^${preferredRemote}/`), "");
  }
  if (!trunk) throw new GroveError({ kind: "refused-precondition", what: "Cannot infer the preferred trunk", why: "the input is detached/bare without an unambiguous symbolic HEAD", remedy: "Pass --base <branch>." });
  const valid = await g.tryRun(commonGitDir, ["check-ref-format", "--branch", trunk]);
  if (valid.exitCode !== 0) throw new GroveError({ kind: "invalid-input", what: `Invalid trunk "${trunk}"`, why: valid.stderr.trim().split("\n")[0] ?? "Git rejected it", remedy: "Choose a Git-valid branch name." });
  const targetLocks = [`repository-alias:${name.toLowerCase()}`, `common-dir:${commonGitDir}`];
  return withOperationTargetLocks(ws.root, targetLocks, "repo-link", async () => {
  assertTargetsAvailable(ws.root, targetLocks);
  const currentWorkspace = requireWorkspace({ cwd: ws.root, workspace: ws.root });
  assertRepoNameFree(currentWorkspace.config, name);
  const currentSnapshot = await observeWorkspace(currentWorkspace, g);
  if (currentSnapshot.repositories.some((repository) => repository.problem === null && repository.registrationStatus === "registered" && repository.commonGitDir === commonGitDir)) throw new GroveError({ kind: "refused-conflict", what: "Repository is already registered", why: `${commonGitDir} resolves to an existing configured Git identity`, remedy: "Use the existing alias or unregister it first." });
  const id = createIdGenerator().ulid();
  // Acquisition command is the capability boundary: topology alone never grants trunk consent.
  // A bare repository remains externally managed when it is registered through `repo link`, even
  // if its common directory happens to occupy the configured managed-store path.
  const location: RepositoryEntry["location"] = { kind: "linked", commonGitDir };
  const registration: RepositoryEntry = { id, name, location, remote: preferredRemote, trunk };
  const operation = beginOperation(ws.root, { kind: "repo-link", scope: { repositoryId: id, repositoryAlias: name }, targetLocks, targets: [{ selector: { repositoryId: id, repositoryAlias: name }, steps: [{ id: "register", kind: "workspace-config-update", input: { registration, expectedRevision: currentWorkspace.meta.rev } }] }] });
  recordPending(operation, "register", { revision: currentWorkspace.meta.rev, repositoryAbsent: true, commonGitDir });
  const meta = await saveWorkspace(currentWorkspace, { ...currentWorkspace.config, repositories: [...currentWorkspace.config.repositories, registration] });
  recordCompleted(operation, "register", { revision: meta.rev, repositoryId: id });
  const after = { repositoryId: id, repositoryAlias: name, commonGitDir, preferredRemote, trunk };
  const result = { ...completeResult("repo link", [{ selector: { repositoryId: id, repositoryAlias: name }, before: null, action: "register", after, reason: null }], currentSnapshot.diagnostics, after), operationId: operation.id };
  return ctx.emit.result(result, 0);
  });
}

async function addHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const typed = parsed.positionals[0];
  if (!typed) {
    throw new GroveError({
      kind: "invalid-input",
      what: "repo add requires a remote",
      why: "no <remote> was given",
      remedy: "Pass the clone URL: `grove repo add <remote>`.",
    });
  }
  // Before anything else, including the remote preflight: a credential must not even reach Git.
  assertCredentialFreeRemote(typed);
  const remote = resolveLocalRemote(typed, ctx.cwd);
  const name = parsed.values.name ?? deriveName(remote);
  assertRepoName(name);

  return addRepository(ctx, remote, name, parsed.values.trunk);
}

async function linkHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const path = parsed.positionals[0];
  if (!path) {
    throw new GroveError({ kind: "invalid-input", what: "repo link requires a path", why: "no <path> was given", remedy: "Pass the checkout path: `grove repo link <path>`." });
  }
  const target = normalisePath(path);
  const g = git();
  const check = await g.tryRun(target, ["rev-parse", "--git-dir"]);
  if (check.exitCode !== 0) {
    // The supplied path can itself be a pasted clone URL. Its normalized filesystem spelling is
    // different from argv, so neither form nor Git's stderr belongs in an error envelope.
    const safePath = redactRemote(path) === path ? path : "<redacted-remote>";
    throw new GroveError({
      kind: "refused-precondition",
      what: `${safePath} is not a git repository`,
      why: `git rev-parse --git-dir exited ${check.exitCode}`,
      remedy: "Point at a checkout containing .git, or use `grove repo add` to clone one.",
      detail: { path: safePath === path ? target : safePath },
    });
  }
  return linkRepository(ctx, target, parsed.values.name, parsed.values.base);
}

async function lsHandler(ctx: CommandContext): Promise<number> {
  parseCommand(ctx); // reject unknown flags/positionals consistently
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const repositories = snapshot.repositories.map(observedRepositoryDetail);
  // §8.4: read-only diagnostic. Unhealthy repositories are reported at exit 0 carrying the typed
  // problem; only failure to load the workspace configuration follows §9. Reporting them as
  // `invalid-config` exited 8 and disagreed with `trunk ls`, which reports the same problem at 0.
  const result = completeResult("repo ls", snapshot.repositories.map((repository, index) => ({ selector: { repositoryId: repository.registration?.id, repositoryAlias: repository.registration?.name }, before: null, action: "observe", after: repositories[index], reason: null })), snapshot.diagnostics, { repositories });
  return ctx.emit.result(result, commandResultExit(result));
}

async function statusHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const snapshot = await observeWorkspace(ws, git());
  const target = parsed.positionals[0];
  const selected = target ? snapshot.repositories.filter((repository) => repository.registration?.id === target || repository.registration?.name === target) : snapshot.repositories;
  if (target && selected.length === 0) throw new GroveError({ kind: "invalid-input", what: `No repository "${target}"`, why: "the selector matches no configured repository", remedy: "Run `grove repo ls`." });
  const repositories = selected.map(observedRepositoryDetail);
  // §8.4: read-only diagnostic. Unhealthy repositories are reported at exit 0 carrying the typed
  // problem; only failure to load the workspace configuration follows §9. Reporting them as
  // `invalid-config` exited 8 and disagreed with `trunk ls`, which reports the same problem at 0.
  const result = completeResult("repo status", selected.map((repository, index) => ({ selector: { repositoryId: repository.registration?.id, repositoryAlias: repository.registration?.name }, before: null, action: "observe", after: repositories[index], reason: null })), snapshot.diagnostics.filter((diagnostic) => { const subject = diagnostic.subject as { repositoryId?: unknown }; return selected.some((repository) => subject.repositoryId === repository.registration?.id); }), { repositories });
  return ctx.emit.result(result, commandResultExit(result));
}

async function fetchHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const g = git();
    const snapshot = await observeWorkspace(ws, g);
    const target = parsed.positionals[0];
    const repositories = target ? snapshot.repositories.filter((repository) => repository.registration?.id === target || repository.registration?.name === target) : snapshot.repositories;
    if (target && repositories.length === 0) throw new GroveError({ kind: "invalid-input", what: `No repository "${target}"`, why: "the selector matches no registration", remedy: "Run `grove repo ls`." });
    const operation = beginOperation(ws.root, { kind: "sync-attempt", scope: { command: "repo fetch" }, targetLocks: repositories.map((repository) => `fetch:${repository.registration?.id}`), targets: repositories.map((repository, index) => ({ selector: { repositoryId: repository.registration?.id ?? "", repositoryAlias: repository.registration?.name ?? "" }, steps: [{ id: `fetch-${index}`, kind: "sync-target", input: { remote: repository.registration?.remote } }] })) });
    const targets: ResultTarget[] = [];
    let anyEffect = false;
    for (let index = 0; index < repositories.length; index++) {
      const repository = repositories[index]!;
      const step = `fetch-${index}`;
      const remote = repository.registration?.remote ?? null;
      recordPending(operation, step, { commonGitDir: repository.commonGitDir, remote });
      // U-9 / V3HLP-02. `repo fetch` help: "With no <repo>, fetches every repo that has a remote
      // and SKIPS remote-less ones; naming a remote-less repo is an error." Both halves shared one
      // code path, so a bare fetch over a workspace whose repositories are all remote-less exited 5
      // — reporting as an error exactly the case the help calls a skip. Whether it is an error
      // depends on whether the user NAMED it.
      let reason: string | null = repository.problem ? "git-failed" : remote ? null : (target ? "no-remote" : "skipped-no-remote");
      let after: unknown = null;
      let explained: { why: string; remedy: string } | null = null;
      // V3SEC-05: re-check where a managed repository's fetch really goes, as Git resolves it now. A
      // linked repository is exempt: `repo link` accepts its remotes as the user configured them.
      if (!reason && remote && repository.registration?.location.kind === "managed") {
        try { explained = await g.fetchDestinationRefusal(repository.commonGitDir, remote); } catch { reason = "git-failed"; }
        if (explained) reason = "refused-policy";
      }
      if (!reason && remote) {
        const fetched = await g.tryFetch(repository.commonGitDir, remote);
        if (fetched.exitCode !== 0) reason = "git-failed";
        else { anyEffect = true; after = { status: "fetched-no-integration", remote }; }
      }
      recordCompleted(operation, step, { after, reason });
      targets.push({ selector: { repositoryId: repository.registration?.id, repositoryAlias: repository.registration?.name }, before: { remote }, action: "fetch", after, reason, ...(explained ? { detail: explained } : {}) });
    }
    // A deliberately skipped remote-less repository is not an incomplete target — the contract
    // calls it "skipped and reported", so it must not drag the outcome to partial/blocked any more
    // than it drags the exit code above 0. Only real failures classify the outcome.
    const hasReason = targets.some((entry) => entry.reason && entry.reason !== "skipped-no-remote");
    const result = { schemaVersion: 1 as const, command: "repo fetch", outcome: hasReason ? (anyEffect ? "partial" as const : "blocked" as const) : "complete" as const, operationId: operation.id, targets: sortResultTargets(targets), diagnostics: snapshot.diagnostics };
    return ctx.emit.result(result, commandResultExit(result));
  }
}

async function removeHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ref = parsed.positionals[0];
  if (!ref) throw new GroveError({ kind: "invalid-input", what: "repo remove requires <repo>", why: "no repository given", remedy: "Pass a repository id or name." });
  {
    const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
    const matches = ws.config.repositories.filter((repository) => repository.id === ref || repository.name === ref);
    if (matches.length !== 1) throw new GroveError({ kind: "invalid-input", what: `No unique repository "${ref}"`, why: `${matches.length} registrations match`, remedy: "Run `grove repo ls`." });
    const repository = matches[0]!;
    const operation = beginOperation(ws.root, { kind: "repo-remove", scope: { repositoryId: repository.id }, targetLocks: [`repository:${repository.id}`], targets: [{ selector: { repositoryId: repository.id, repositoryAlias: repository.name }, steps: [{ id: "unregister", kind: "workspace-config-update", input: { registration: repository, expectedRevision: ws.meta.rev } }] }] });
    recordPending(operation, "unregister", { revision: ws.meta.rev, registered: true });
    const meta = await saveWorkspace(ws, { ...ws.config, repositories: ws.config.repositories.filter((candidate) => candidate.id !== repository.id) });
    recordCompleted(operation, "unregister", { revision: meta.rev, registered: false });
    const after = {
      unregistered: true,
      // Managed acquisition owns a bare common repository at this path, never a primary checkout.
      checkoutRetained: null,
      commonGitDirRetained: repository.location.kind === "managed"
        ? expandRepositoryPath(compileLayout(ws.root, ws.config.layout), repository.name)
        : repository.location.commonGitDir,
    };
    const result = { ...completeResult("repo remove", [{ selector: { repositoryId: repository.id, repositoryAlias: repository.name }, before: { registered: true }, action: "unregister", after, reason: null }], [], after), operationId: operation.id };
    return ctx.emit.result(result, 0);
  }
}

async function configureHandler(ctx: CommandContext): Promise<number> {
  const parsed = parseCommand(ctx);
  const ref = parsed.positionals[0];
  if (!ref) throw new GroveError({ kind: "invalid-input", what: "repo configure requires <repo>", why: "no repository given", remedy: "Pass a repository id or alias." });
  const changes = [parsed.values.remote !== undefined, parsed.values["no-remote"], parsed.values.base !== undefined].filter(Boolean).length;
  if (changes === 0) throw new GroveError({ kind: "invalid-input", what: "repo configure requires a change", why: "no preferred remote or base option was supplied", remedy: "Pass --remote, --no-remote, or --base." });
  if (parsed.values.remote !== undefined && parsed.values["no-remote"]) throw new GroveError({ kind: "invalid-input", what: "Conflicting preferred-remote options", why: "--remote and --no-remote are mutually exclusive", remedy: "Choose one remote policy." });
  const ws = requireWorkspace({ cwd: ctx.cwd, workspace: ctx.globals.workspace });
  const matches = ws.config.repositories.filter((repository) => repository.id === ref || repository.name === ref);
  if (matches.length !== 1) throw new GroveError({ kind: "invalid-input", what: `No unique repository "${ref}"`, why: `${matches.length} registrations match`, remedy: "Run `grove repo ls`." });
  const repository = matches[0]!;
  if (parsed.values.base !== undefined) assertBranchName(parsed.values.base);
  const g = git();
  const layout = compileLayout(ws.root, ws.config.layout);
  const anchor = repository.location.kind === "managed" ? expandRepositoryPath(layout, repository.name) : repository.location.commonGitDir;
  const identity = await g.inspectRepository(anchor);
  const commonGitDir = identity.commonGitDir.canonicalUtf8;
  if (!commonGitDir) throw new GroveError({ kind: "refused-precondition", what: `Cannot configure repository ${repository.name}`, why: "its common Git directory is not strict UTF-8", remedy: "Use native Git for this repository." });
  if (parsed.values.remote !== undefined) {
    assertFetchableRemote(parsed.values.remote);
    const available = await g.tryRun(commonGitDir, ["remote", "get-url", "--", parsed.values.remote]);
    if (available.exitCode !== 0) throw new GroveError({ kind: "invalid-input", what: `No remote "${parsed.values.remote}" in ${repository.name}`, why: available.stderr.trim().split("\n")[0] || "Git cannot resolve that remote name", remedy: "Choose a name from `git remote`, or add it with native Git first." });
  }
  const updated: RepositoryEntry = {
    ...repository,
    remote: parsed.values["no-remote"] ? null : parsed.values.remote ?? repository.remote,
    trunk: parsed.values.base ?? repository.trunk,
  };
  const meta = await saveWorkspace(ws, { ...ws.config, repositories: ws.config.repositories.map((candidate) => candidate.id === repository.id ? updated : candidate) });
  const after = { repositoryId: repository.id, repositoryAlias: repository.name, preferredRemote: updated.remote, preferredTrunk: updated.trunk, commonGitDir, revision: meta.rev };
  const result = completeResult("repo configure", [{ selector: { repositoryId: repository.id, repositoryAlias: repository.name }, before: { preferredRemote: repository.remote, preferredTrunk: repository.trunk }, action: "update-advisory-policy", after, reason: null }], [], after);
  return ctx.emit.result(result, 0);
}

export function registerRepo(): void {
  register({
    path: "repo add",
    summary: "Create a managed bare repository and its initial peer trunk.",
    usage: "repo add <remote> [--name <name>] [--trunk <branch>]",
    args: [
      { name: "<remote>", desc: "Git remote URL to clone (anything `git clone` accepts)." },
      { name: "--name <name>", desc: "Override the derived repository name." },
      { name: "--trunk <branch>", desc: "Default trunk branch (default: the remote's HEAD)." },
    ],
    note: "Creates a bare Git anchor and peer trunk worktree. Direct credentialed URLs are refused. Set GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1 for this invocation to permit credentials supplied only by Git config; set it again for a later recovery. Use `repo link` for an existing repository.",
    examples: [
      "grove repo add git@github.com:acme/api.git                          # clone as repo \"api\", trunk = remote HEAD",
      "grove repo add git@github.com:acme/api.git --name api --trunk main  # explicit name and trunk branch",
    ],
    handler: addHandler,
    mutates: true,
  });
  register({
    path: "repo link",
    summary: "Register an existing Git common repository without mutation.",
    usage: "repo link <path> [--name <name>] [--base <branch>]",
    args: [
      { name: "<path>", desc: "Any path Git resolves to an existing repository (root, subdirectory, worktree, or bare)." },
      { name: "--name <name>", desc: "Override the derived repository name." },
      { name: "--base <branch>", desc: "Branch new Trees start from (default: the checked-out branch); creates no trunk." },
    ],
    note: "Registers the canonical Git common directory without moving, cloning, switching, or creating refs/worktrees. The base is advisory; linked repositories refuse every Grove trunk mutation. Use `repo add` when managed peer trunks are required.",
    examples: [
      "grove repo link ~/src/api                              # register existing checkout as repo \"api\"",
      "grove repo link ~/src/api --name api --base develop    # override name; new Trees start from develop",
    ],
    handler: linkHandler,
    mutates: true,
  });
  register({
    path: "repo configure",
    summary: "Update advisory repository policy without changing Git.",
    usage: "repo configure <repo> [--remote <name>] [--no-remote] [--base <branch>]",
    args: [
      { name: "<repo>", desc: "Repository id or alias to configure." },
      { name: "--remote <name>", desc: "Select an existing Git remote by name." },
      { name: "--no-remote", desc: "Clear the preferred remote without removing it from Git." },
      { name: "--base <branch>", desc: "Set the branch new Trees start from; creates no trunk." },
    ],
    note: "Changes workspace preferences only. It never creates, moves, switches, fetches, or deletes refs or worktrees.",
    examples: ["grove repo configure api --remote upstream --base develop", "grove repo configure local --no-remote"],
    handler: configureHandler,
    mutates: true,
  });
  register({
    path: "repo ls",
    summary: "List repositories.",
    usage: "repo ls",
    examples: ["grove repo ls"],
    handler: lsHandler,
  });
  register({
    path: "repo status",
    summary: "Report repository health.",
    usage: "repo status [<repo>]",
    args: [{ name: "<repo>", desc: "Repository to report (default: all)." }],
    note: "Reports canonical Git identity and every observed worktree role; linked repositories have no Grove-managed trunks.",
    examples: [
      "grove repo status       # health of every repo",
      "grove repo status api   # just repo \"api\"",
    ],
    handler: statusHandler,
  });
  register({
    path: "repo fetch",
    summary: "Fetch one or all repositories.",
    usage: "repo fetch [<repo>]",
    args: [{ name: "<repo>", desc: "Repository to fetch (default: all)." }],
    note: "With no <repo>, fetches every repo that has a remote and skips remote-less ones; naming a remote-less repo is an error. Managed fetches refuse Git-config credentials unless GROVE_ALLOW_GIT_CONFIG_CREDENTIALS=1 for this invocation.",
    examples: [
      "grove repo fetch       # fetch every repo that has a remote",
      "grove repo fetch api   # fetch just repo \"api\"",
    ],
    handler: fetchHandler,
    mutates: true,
  });
  register({
    path: "repo remove",
    summary: "Unregister a repository (work-safe).",
    usage: "repo remove <repo>",
    args: [{ name: "<repo>", desc: "Repository to unregister." }],
    note: "Unregisters metadata only. Every checkout, common Git directory, worktree, and ref is retained.",
    examples: [
      "grove repo remove api   # unregister only; all Git state remains",
    ],
    handler: removeHandler,
    mutates: true,
  });
}
