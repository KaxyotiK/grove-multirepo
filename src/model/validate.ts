/**
 * Name and ref validation (§5).
 *
 * Two independent concerns:
 *   1. Grove/repository names (§5.2/§5.3) become directory names, so unvalidated input reaches
 *      `mkdir`; and they must not be parseable as a git flag.
 *   2. Branch names must pass git's own ref-format rules AND argv safety — an agent naming a
 *      branch `--force` would otherwise pass a flag to `git` (a mined security case).
 *
 * Divergence from the pinned source: names are NOT lowercased. §5.2 permits mixed case and
 * makes uniqueness ASCII-case-folded, so casing is preserved and `caseFoldKey` is the
 * collision key.
 */
import { GroveError } from "../errors.ts";
import type { AgentDefinition } from "./types.ts";

export interface ValidationFailure {
  rule: string;
  why: string;
}

/** §5.2: the shared repository/Grove name grammar. */
export const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
/** Tree names accept the safe selector separator and legacy slug escapes for migration. */
export const TREE_NAME_RE = /^[A-Za-z0-9_~](?:[A-Za-z0-9._@~-]*[A-Za-z0-9])?$/;
export const REPO_NAME_MAX_BYTES = 48;
export const GROVE_NAME_MAX_BYTES = 64;
export const TREE_NAME_MAX_BYTES = 96 + 1 + REPO_NAME_MAX_BYTES + 1 + 26;

const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** ASCII case-fold key for uniqueness/collision comparison (§5.2). */
export const caseFoldKey = (name: string): string => name.toLowerCase();

export function checkName(name: string, label: string, maxBytes: number, pattern = NAME_RE): ValidationFailure | null {
  const rule = `${pattern.source}, at most ${maxBytes} bytes`;
  if (name.length === 0) return { rule, why: `the ${label} name is empty` };
  if (name.startsWith("."))
    return { rule, why: `a leading dot is reserved (\`.archive\`) and would hide the directory` };
  if (name.startsWith("-"))
    return { rule, why: "a leading dash could be parsed as a command flag" };
  if (name.includes("/") || name.includes("\\"))
    return { rule, why: `a ${label} name may not contain a path separator` };
  if (name.includes(":")) return { rule, why: "a colon is reserved in `repo=branch` arguments" };
  if (bytes(name) > maxBytes) return { rule, why: `the name exceeds ${maxBytes} bytes` };
  if (!pattern.test(name))
    return { rule, why: "the name contains a character that is not permitted" };
  return null;
}

function assertName(name: string, label: string, maxBytes: number, pattern = NAME_RE): void {
  const f = checkName(name, label, maxBytes, pattern);
  if (!f) return;
  throw new GroveError({
    kind: "invalid-input",
    what: `Cannot use "${name}" as a ${label} name`,
    why: f.why,
    remedy: `Choose a name matching: ${f.rule}.`,
    detail: { name, rule: f.rule },
  });
}

export const checkRepoName = (n: string) => checkName(n, "repository", REPO_NAME_MAX_BYTES);
export const checkGroveName = (n: string) => checkName(n, "Grove", GROVE_NAME_MAX_BYTES);
export const checkTreeName = (n: string) => checkName(n, "Tree", TREE_NAME_MAX_BYTES, TREE_NAME_RE);
export const assertRepoName = (n: string) => assertName(n, "repository", REPO_NAME_MAX_BYTES);
export const assertGroveName = (n: string) => assertName(n, "Grove", GROVE_NAME_MAX_BYTES);
export const assertTreeName = (n: string) => assertName(n, "Tree", TREE_NAME_MAX_BYTES, TREE_NAME_RE);

/** Branch names: git ref-format rules plus argv safety (§5.1 rule 1). */
export const BRANCH_NAME_RULE = "a valid git ref that cannot be parsed as a command-line flag";

/**
 * Names git resolves as a REVISION rather than a branch. `git worktree add <path> HEAD`
 * silently produces a DETACHED worktree (reports `branch: null`) and bypasses branch-intent
 * validation, so these are refused up front. Same for a bare SHA.
 */
const GIT_RESERVED = new Set(["HEAD", "FETCH_HEAD", "ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD"]);
const LOOKS_LIKE_SHA = /^[0-9a-f]{7,40}$/i;

export function checkBranchName(branch: string): ValidationFailure | null {
  const r = BRANCH_NAME_RULE;
  if (branch.length === 0) return { rule: r, why: "the branch name is empty" };
  if (GIT_RESERVED.has(branch))
    return { rule: r, why: `"${branch}" is a git revision, not a branch — it would create a detached worktree` };
  if (LOOKS_LIKE_SHA.test(branch))
    return { rule: r, why: `"${branch}" looks like a commit id — it would create a detached worktree` };
  // argv safety — checked first, it is the security case
  if (branch.startsWith("-"))
    return { rule: r, why: `"${branch}" starts with a dash and could be parsed as a git flag` };
  // git check-ref-format
  if (/[\u0000-\u001F\u007F]/.test(branch))
    return { rule: r, why: "the name contains a control character" };
  if (/[ ~^:?*[\\]/.test(branch))
    return { rule: r, why: "the name contains one of: space ~ ^ : ? * [ \\" };
  if (branch.includes("..")) return { rule: r, why: 'the name contains "..", which git refuses' };
  if (branch.includes("@{")) return { rule: r, why: 'the name contains "@{", which git refuses' };
  if (branch === "@") return { rule: r, why: '"@" alone is not a valid ref' };
  if (branch.startsWith("/") || branch.endsWith("/"))
    return { rule: r, why: "the name may not start or end with a slash" };
  if (branch.includes("//")) return { rule: r, why: "the name contains an empty path component" };
  if (branch.endsWith(".")) return { rule: r, why: "the name may not end with a dot" };
  for (const part of branch.split("/")) {
    if (part.startsWith(".")) return { rule: r, why: "no path component may start with a dot" };
    if (part.endsWith(".lock")) return { rule: r, why: '".lock" collides with git\'s lock files' };
  }
  return null;
}

export function assertBranchName(branch: string): void {
  const f = checkBranchName(branch);
  if (!f) return;
  throw new GroveError({
    kind: "invalid-input",
    what: `Cannot use "${branch}" as a branch name`,
    why: f.why,
    remedy: `Choose a branch name that is ${f.rule}.`,
    detail: { branch, rule: f.rule },
  });
}

/**
 * Remote names: git stores them as config subsection keys and accepts almost anything, including
 * a name beginning with a dash. Grove does not — `git fetch --prune <name>` parses such a name
 * as an OPTION, so a repository whose remote is named `--upload-pack=<command>` makes git run
 * that command. This is the same argv-safety rule as §5.1 rule 1, applied to the one persisted
 * repository field that is neither a Grove name nor a git ref.
 */
export const REMOTE_NAME_RULE = "a non-empty remote name that cannot be parsed as a command-line flag";

export function checkRemoteName(remote: string): ValidationFailure | null {
  const rule = REMOTE_NAME_RULE;
  if (remote.length === 0) return { rule, why: "the remote name is empty" };
  if (remote.startsWith("-"))
    return { rule, why: `"${remote}" starts with a dash and could be parsed as a git flag` };
  if (/[\u0000-\u001F\u007F]/.test(remote))
    return { rule, why: "the name contains a control character" };
  return null;
}

/**
 * V3SEC-05. `repo add` hands its remote URL to `git remote add`, and Git keeps it verbatim in the
 * managed repository's config, where no Grove redaction reaches. So credentials in a remote URL are
 * refused outright rather than redacted.
 *
 * Userinfo (`user[:password]@` before the host) is refused in every scheme, with one exception: a
 * bare user name in an SSH URL (`ssh://git@host/…`) names an account, not a secret. `https://TOKEN@host`
 * is refused because hosts such as GitHub accept a token in the user-name slot. scp-like
 * `git@host:path` and local paths have no URL userinfo. A `<transport>::<address>` remote-helper
 * form is judged by its address.
 *
 * The principle: find the authority the way Git and curl do, not the way WHATWG does. Git's
 * `credential_from_url` ends the authority at `strcspn(cp, "/?#")`, and curl does the same, so a
 * backslash is an ordinary authority character: `http://TOKEN\@host` sends TOKEN as the user name.
 * WHATWG treats `\` as `/` in special schemes and would call TOKEN the host. So:
 *
 * - The primary parse is Git's: after the scheme, two or more forward slashes (curl accepts up to
 *   three and still sends the userinfo; Git reads a single slash, `host:/path`, as scp-like SSH and
 *   never hands it to curl), then the authority up to the first `/`, `?`, or `#`. For `file:`, three
 *   slashes mean an empty host and a path.
 * - WHATWG `URL` is only an extra refuser: a non-empty username or password it finds also refuses.
 *   It is never used to accept.
 * - Every leading `<transport>::` is stripped, not just one (`a::b::http://TOKEN@h`). A helper address
 *   that is not URL-shaped by the rule above is scheme-guessed by curl, so an `@` before its first
 *   `/`, `?`, or `#` is userinfo too (`http::TOKEN@host/x`, even with a later `://` in its path).
 * - Git percent-decodes an SSH address before it finds the host/login field, and skips path slashes
 *   inside a bracketed host field. The login is the part through the last `@`; `:`, `?`, or `#` in
 *   that decoded login makes it credential-shaped. The same bracket rule applies to scp-like SSH.
 * - Git rewrites a URL with `url.<base>.insteadOf` before choosing a transport, evaluating conditional
 *   includes against the repository it runs in. Grove never models that: it asks Git where each
 *   fetch really goes (`Git.resolveRemoteUrl`) in the context the fetch runs in, and checks the
 *   answer with the same rule, so the SSH user-name exemption holds only if the answer is still SSH.
 */
export const REMOTE_CREDENTIALS_RULE = "a remote URL without embedded credentials (userinfo), except an SSH user name";
const SSH_SCHEMES = new Set(["ssh", "git+ssh", "ssh+git"]);

/** Strip every leading `<transport>::` remote-helper prefix; `transport` is the first one, if any. */
export function stripTransports(remote: string): { address: string; transport: string | null } {
  let address = remote;
  let transport: string | null = null;
  for (let prefix = /^([A-Za-z][A-Za-z0-9+.-]*)::/.exec(address); prefix; prefix = /^([A-Za-z][A-Za-z0-9+.-]*)::/.exec(address)) {
    transport ??= prefix[1]!.toLowerCase();
    address = address.slice(prefix[0].length);
  }
  return { address, transport };
}

/**
 * The authority of a remote URL as Git and curl find it (see above): `<transport>::` stripped, then a
 * scheme, two or more forward slashes, and everything up to the first `/`, `?`, or `#`. Null when the
 * value is not URL-shaped by that rule (scp-like, local path).
 */
export function gitUrlAuthority(remote: string): { scheme: string; authority: string } | null {
  const url = /^([A-Za-z][A-Za-z0-9+.-]*):(\/{2,})([^/?#]*)/.exec(stripTransports(remote).address);
  if (!url) return null;
  const scheme = url[1]!.toLowerCase();
  return { scheme, authority: scheme === "file" && url[2]!.length !== 2 ? "" : url[3]! };
}

interface GitSshAuthority {
  scheme: string;
  /** The host/login field after Git's percent decoding. */
  authority: string;
  /** The same field before percent decoding, for conservative result redaction. */
  rawAuthority: string;
}

/** Git's `url_decode`: delimiters encoded as `%HH` take effect before connect.c parses the URL. */
const gitPercentDecode = (value: string): string => value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

/**
 * Find the end of an SSH host/login field. Git's `host_end` first looks for `@[`, then falls back to
 * a leading `[`, so a `/` inside the selected bracket pair is not the path separator.
 */
function sshFieldEnd(value: string, separator: "/" | ":"): number {
  const at = value.indexOf("@[");
  const bracket = at >= 0 ? at + 1 : value.startsWith("[") ? 0 : -1;
  if (bracket >= 0) {
    const close = value.indexOf("]", bracket + 1);
    if (close >= 0) {
      const end = value.indexOf(separator, close + 1);
      return end < 0 ? value.length : end;
    }
  }
  const end = value.indexOf(separator);
  return end < 0 ? value.length : end;
}

/** Git's SSH URL reading: percent-decode first, then take the bracket-aware field before the path. */
export function gitSshAuthority(remote: string): GitSshAuthority | null {
  const address = stripTransports(remote).address;
  const raw = /^([A-Za-z][A-Za-z0-9+.-]*):(\/{2,})(.*)$/s.exec(address);
  if (!raw || !SSH_SCHEMES.has(raw[1]!.toLowerCase())) return null;
  const decodedAddress = gitPercentDecode(address);
  const decoded = /^([A-Za-z][A-Za-z0-9+.-]*):(\/{2,})(.*)$/s.exec(decodedAddress);
  if (!decoded) return null;
  const authority = decoded[3]!.slice(0, sshFieldEnd(decoded[3]!, "/"));
  const rawAuthority = raw[3]!.slice(0, sshFieldEnd(raw[3]!, "/"));
  return { scheme: decoded[1]!.toLowerCase(), authority, rawAuthority };
}

/** Git's raw, bracket-aware scp-like SSH reading (`user@host:path` and `[user@host]:path`). */
export function gitScpAuthority(remote: string): GitSshAuthority | null {
  const { address, transport } = stripTransports(remote);
  if (transport !== null || address.includes("://")) return null;
  // connect.c calls url_decode only for values that passed is_url(); scp-like input is never decoded.
  const decoded = address;
  const end = sshFieldEnd(decoded, ":");
  const rawEnd = sshFieldEnd(address, ":");
  const bracketed = decoded.startsWith("[") || decoded.includes("@[");
  if (end <= 0 || end === decoded.length || (!bracketed && decoded.slice(0, end).includes("/"))) return null;
  return { scheme: "ssh", authority: decoded.slice(0, end), rawAuthority: address.slice(0, rawEnd) };
}

/** A `:` separates a password; `%3A` is the same separator in disguise. */
const hasPassword = (userinfo: string): boolean => userinfo.includes(":") || /%3a/i.test(userinfo);

function remoteUserinfo(address: string, allowScp = true): { scheme: string; password: boolean } | null {
  const ssh = gitSshAuthority(address) ?? (allowScp ? gitScpAuthority(address) : null);
  if (ssh) {
    const at = ssh.authority.lastIndexOf("@");
    const userinfo = at > 0 ? ssh.authority.slice(0, at) : "";
    if (userinfo.length > 0) return { scheme: ssh.scheme, password: /[:?#]/.test(userinfo) };
  }
  const git = gitUrlAuthority(address);
  if (git) {
    const { scheme, authority } = git;
    const userinfo = authority.slice(0, Math.max(authority.lastIndexOf("@"), 0));
    if (userinfo.length > 0) return { scheme, password: hasPassword(userinfo) };
  }
  try {
    const url = new URL(address);
    if (url.username || url.password) return { scheme: url.protocol.replace(/:$/, "").toLowerCase(), password: url.password.length > 0 || hasPassword(url.username) };
  } catch { /* not a WHATWG URL: scp-like or a local path */ }
  return null;
}

function remoteCredentials(remote: string): { scheme: string; password: boolean } | null {
  const { address, transport } = stripTransports(remote);
  let found = remoteUserinfo(address, transport === null);
  if (!found && transport !== null && gitUrlAuthority(address) === null) {
    const head = address.split(/[/?#]/)[0]!;
    const userinfo = head.slice(0, Math.max(head.lastIndexOf("@"), 0));
    if (userinfo.length > 0) found = { scheme: transport, password: hasPassword(userinfo) };
  }
  if (!found || (!found.password && SSH_SCHEMES.has(found.scheme))) return null;
  return found;
}

/** Name the credential's parts, never its value. */
const describe = (found: { scheme: string; password: boolean }): string =>
  `a URL that embeds credentials (scheme ${found.scheme}; ${found.password ? "a user name and password" : "a user name or token"} before the host)`;

export function checkRemoteCredentials(remote: string): ValidationFailure | null {
  const found = remoteCredentials(remote);
  if (!found) return null;
  return { rule: REMOTE_CREDENTIALS_RULE, why: `the remote is ${describe(found)}, and Git would store it verbatim in the repository's config` };
}

const HELPER = "a Git credential helper (for example the macOS Keychain helper, or `gh auth setup-git`)";

/**
 * Why Grove will not fetch from `resolved`, Git's own answer to where a fetch goes
 * (`Git.resolveRemoteUrl`), or null. The credentials may come from the remote's own URL or from a
 * `url.<base>.insteadOf` rule; Git does not store a rewritten URL, so the text claims neither.
 */
export function resolvedRemoteRefusal(resolved: string): { why: string; remedy: string } | null {
  const found = remoteCredentials(resolved);
  if (!found) return null;
  // Only Git's resolved destination reaches this check. `repo add` separately refuses the typed
  // URL before Git sees it; this per-process switch never authorizes a directly supplied secret.
  if (process.env.GROVE_ALLOW_GIT_CONFIG_CREDENTIALS === "1") return null;
  return {
    why: `Git resolves this remote, after its url.<base>.insteadOf rules, to ${describe(found)}; Grove refuses to use a remote that resolves to a credentialed URL, whether the credentials are in the remote's URL or in a rewrite rule`,
    remedy: `Remove the credentials from the remote's URL (\`git remote set-url\`) or from the matching url.<base>.insteadOf rule in your Git configuration, and let ${HELPER} supply them; or use an SSH URL that no rule rewrites.`,
  };
}

/**
 * `resolved` is Git's answer to where `remote` really goes (`Git.resolveRemoteUrl`); it is checked
 * too, and neither is echoed.
 */
export function assertCredentialFreeRemote(remote: string, resolved: string = remote): void {
  const direct = checkRemoteCredentials(remote);
  if (direct) {
    throw new GroveError({
      kind: "invalid-input",
      what: "Cannot add a remote URL that embeds credentials",
      why: direct.why,
      remedy: `Use an SSH URL (git@host:org/repo.git), or an HTTPS URL without credentials together with ${HELPER}. A clone URL a host offers with a user name in it, such as https://org@dev.azure.com/... or https://user@bitbucket.org/..., works once you drop the user name and let the helper supply it.`,
      detail: { rule: direct.rule },
    });
  }
  const refusal = resolved === remote ? null : resolvedRemoteRefusal(resolved);
  if (refusal) throw new GroveError({ kind: "invalid-input", what: "Cannot add a remote that resolves to a URL with credentials", ...refusal, detail: { rule: REMOTE_CREDENTIALS_RULE } });
}

/** Branch-derived paths must fit the filesystem. */
export const MAX_PATH_SEGMENT_BYTES = 255;
export const MAX_PATH_TOTAL_BYTES = 1024;

export function checkPathLimits(fullPath: string): ValidationFailure | null {
  const total = bytes(fullPath);
  if (total > MAX_PATH_TOTAL_BYTES)
    return {
      rule: `paths must be under ${MAX_PATH_TOTAL_BYTES} bytes`,
      why: `the resulting path is ${total} bytes`,
    };
  for (const seg of fullPath.split("/")) {
    const n = bytes(seg);
    if (n > MAX_PATH_SEGMENT_BYTES)
      return {
        rule: `each path component must be under ${MAX_PATH_SEGMENT_BYTES} bytes`,
        why: `the component "${seg.slice(0, 40)}…" is ${n} bytes`,
      };
  }
  return null;
}

export function assertPathLimits(fullPath: string, context: string): void {
  const f = checkPathLimits(fullPath);
  if (!f) return;
  throw new GroveError({
    kind: "io",
    what: `Cannot create ${context}`,
    why: f.why,
    remedy: `Use a shorter name — ${f.rule}.`,
    detail: { path: fullPath, rule: f.rule },
  });
}

/**
 * Refuse a `--default-agent` naming an agent the workspace does not define (P2-7).
 *
 * Accepting it deferred the error to `agent run`, arbitrarily far from the mistake and often in a
 * different session — the "refuse, never guess" tenet applied to a forward reference.
 */
export function assertKnownAgent(config: { agents: Record<string, AgentDefinition> }, name: string): void {
  if (Object.hasOwn(config.agents ?? {}, name)) return;
  const known = Object.keys(config.agents ?? {});
  throw new GroveError({
    kind: "invalid-input",
    what: `No agent "${name}"`,
    why: "the workspace defines no agent by that name",
    remedy: known.length
      ? `Run \`grove agent ls\` to see them (${known.join(", ")}), or add it with \`grove agent add\`.`
      : "Add one with `grove agent add <name> <command>`.",
    detail: { agent: name },
  });
}
