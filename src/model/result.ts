import type { Diagnostic } from "./conformance.ts";
import { checkRemoteCredentials, gitScpAuthority, gitSshAuthority, gitUrlAuthority, stripTransports } from "./validate.ts";

export interface ResultSelector { repositoryId?: string; repositoryAlias?: string; grove?: string; tree?: string; path?: string }
export interface ResultTarget { selector: ResultSelector; before: unknown; action: string; after: unknown | null; reason: string | null; detail?: unknown }
export interface CommandResultV1 { schemaVersion: 1; command: string; outcome: "complete" | "partial" | "blocked" | "needs-user"; operationId?: string; targets: ResultTarget[]; diagnostics: Diagnostic[]; detail?: unknown }

export const EXIT_BY_REASON: Readonly<Record<string, number>> = {
  "refused-policy": 3,
  // `unsupported-step`: a recorded step kind this build's reconcile cannot run. `reconcile` reports it
  // as `stale-plan` on first contact, so a later run over the same record exits the same way.
  "stale-plan": 4, "ambiguous-intent": 4, "unsupported-step": 4,
  dirty: 5, diverged: 5, locked: 5, "missing-revision": 5, "no-upstream": 5, "no-remote": 5, "sequencer-active": 5, detached: 5, unborn: 5, "unreachable-detached": 5,
  "git-failed": 6, "io-failed": 7, "invalid-config": 8, "unsupported-capability": 9,
  // Not a failure: a bare `repo fetch` skips remote-less repositories by contract (U-9).
  "skipped-no-remote": 0,
  // `agent-failed` is deliberately absent: `agent run` exits with the agent's own status (AGENT-05).
};

export function commandResultExit(result: CommandResultV1): number {
  let exit = result.outcome === "needs-user" ? 5 : 0;
  for (const target of result.targets) if (target.reason) exit = Math.max(exit, EXIT_BY_REASON[target.reason] ?? 0);
  return exit;
}

const selectorKey = (selector: ResultSelector): string => JSON.stringify([selector.repositoryId ?? "", selector.repositoryAlias ?? "", selector.grove ?? "", selector.tree ?? "", selector.path ?? ""]);
export function sortResultTargets(targets: readonly ResultTarget[]): ResultTarget[] { return [...targets].sort((a, b) => selectorKey(a.selector).localeCompare(selectorKey(b.selector))); }

export function completeResult(command: string, targets: readonly ResultTarget[], diagnostics: readonly Diagnostic[] = [], detail?: unknown): CommandResultV1 {
  return {
    schemaVersion: 1,
    command,
    outcome: "complete",
    targets: sortResultTargets(targets),
    diagnostics: [...diagnostics],
    ...(detail === undefined ? {} : { detail }),
  };
}

const REDACTED = "<redacted-remote>";

/**
 * An SSH remote whose only userinfo is a bare user name: `ssh://`, `git+ssh://`, or `ssh+git://`, or
 * scp-like `user@host:path`, with no `<transport>::` prefix. FR-011: that user name is an account,
 * not a secret, and Git stores the remote as typed, so it is echoed verbatim; dropping the user would
 * name a different login.
 */
function isPlainSshRemote(value: string): boolean {
  if (stripTransports(value).transport !== null || checkRemoteCredentials(value) !== null) return false;
  // Git's bracketed login spellings are valid SSH inputs, but are deliberately not a plain-output
  // exemption. Only an IPv6 literal bracketed after the single scp-like `@` is unambiguous.
  if (/\[[^\]]*@/.test(value)) return false;
  if (/^(?:ssh|git\+ssh|ssh\+git):\/\//i.test(value)) {
    const url = gitUrlAuthority(value);
    const ssh = gitSshAuthority(value);
    return url !== null && ssh !== null && url.authority === ssh.authority && ssh.rawAuthority === ssh.authority;
  }
  const scp = gitScpAuthority(value);
  if (scp === null || scp.rawAuthority !== scp.authority) return false;
  const ats = scp.authority.match(/@/g)?.length ?? 0;
  if (ats !== 1) return false;
  const host = scp.authority.slice(scp.authority.indexOf("@") + 1);
  return !/[\[\]]/.test(scp.authority) || /^\[[^\[\]]+\]$/.test(host);
}

/**
 * Git and curl find a URL's userinfo differently from WHATWG: the authority ends only at / ? #, so
 * `http://TOKEN\@host` carries TOKEN as a user name while WHATWG parses it as the host (see
 * `checkRemoteCredentials`). So, in order:
 *
 * - a backslash, a control character, or a stray `%` masks the whole value;
 * - a plain SSH remote is echoed verbatim (`isPlainSshRemote`), less a URL's query and fragment;
 * - userinfo by Git's reading masks the whole value, as does an `@` in an opaque form's authority
 *   (`web:u:p@host/x`, which a `url.<base>.insteadOf` rule can turn into a URL) or anywhere in a
 *   `<transport>::` helper address;
 * - anything else is rewritten through WHATWG without query and fragment, or masked when URL-like
 *   but unparseable.
 */
export function redactRemote(value: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(value) || /[\\\u0000-\u001F\u007F]/.test(value)) return REDACTED;
  // Never let an `@` inside brackets reach the plain-SSH exemption. Git gives the later `@[` host
  // field precedence over a leading bracket, which can make this text a credential-shaped login.
  if (/\[[^\]]*@/.test(value)) return REDACTED;
  // A parsed ssh:// URL loses its query and fragment like any other; scp-like `user@host:path` is not
  // a URL, so a `?` or `#` there is part of the path and stays.
  if (isPlainSshRemote(value)) return value.includes("://") ? value.replace(/[?#].*$/s, "") : value;
  const { address, transport } = stripTransports(value);
  if ((gitSshAuthority(value) ?? gitScpAuthority(value))?.authority.includes("@")) return REDACTED;
  const firstColon = value.indexOf(":");
  const firstAt = value.indexOf("@");
  if ((firstAt >= 0 && (firstColon < 0 || firstAt < firstColon)) || /\[[^\]]*@[^\]]*\]/.test(value)) return REDACTED;
  if (gitUrlAuthority(value)?.authority.includes("@")) return REDACTED;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:(?!\/\/)[^/?#]*@/.test(value) || (transport !== null && address.includes("@"))) return REDACTED;
  try {
    const url = new URL(value);
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString().replace(/\/$/, value.endsWith("/") ? "/" : "");
  } catch {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || /^[^/\s]+@[^:\s]+:/.test(value)) return REDACTED;
    return value;
  }
}
