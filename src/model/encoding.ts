/**
 * §5 directory encoding — the readable `<branch-slug>@<repo-slug>` path shape, with exact slug
 * rules, byte limits, boundary-only truncation, and case-folded collision handling.
 *
 * Written fresh — the escape scheme has no pinned-source ancestor; §11.4 is its specification.
 * Identity always
 * lives in the manifest — these names are readable paths only and are never parsed back.
 */
import { GroveError } from "../errors.ts";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface RefName { raw: Uint8Array; utf8: string | null; display: string }
export interface NativePath { raw: Uint8Array; utf8: string | null; canonicalUtf8: string | null; identity: { kind: "canonical-utf8"; value: string } | { kind: "raw-unsupported"; value: Uint8Array }; display: string }
export type ValueBytesJson = { encoding: "utf8"; value: string } | { encoding: "base64"; value: string; display: string };

const strictDecoder = new TextDecoder("utf-8", { fatal: true });
function strictUtf8(raw: Uint8Array): string | null { try { return strictDecoder.decode(raw); } catch { return null; } }
function displayBytes(raw: Uint8Array): string { let out = ""; for (const b of raw) { if (b === 0x0a) out += "\\n"; else if (b === 0x0d) out += "\\r"; else if (b === 0x09) out += "\\t"; else if (b === 0x5c) out += "\\\\"; else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b); else out += `\\x${b.toString(16).padStart(2, "0")}`; } return out; }
export function refNameFromBytes(raw: Uint8Array): RefName { const bytes = Uint8Array.from(raw); return { raw: bytes, utf8: strictUtf8(bytes), display: displayBytes(bytes) }; }
export function nativePathFromBytes(raw: Uint8Array): NativePath { const bytes = Uint8Array.from(raw); const utf8 = strictUtf8(bytes); if (utf8 === null) return { raw: bytes, utf8: null, canonicalUtf8: null, identity: { kind: "raw-unsupported", value: bytes }, display: displayBytes(bytes) }; const canonicalUtf8 = resolve(utf8); return { raw: bytes, utf8, canonicalUtf8, identity: { kind: "canonical-utf8", value: canonicalUtf8 }, display: displayBytes(bytes) }; }
export function valueBytesJson(value: RefName | NativePath): ValueBytesJson { return value.utf8 === null ? { encoding: "base64", value: Buffer.from(value.raw).toString("base64"), display: value.display } : { encoding: "utf8", value: value.utf8 }; }

export const BRANCH_SLUG_MAX_BYTES = 96;
export const REPO_SLUG_MAX_BYTES = 48;

const KEEP = /[A-Za-z0-9._-]/;
const hex = (n: number): string => n.toString(16).padStart(2, "0"); // lowercase

/** One source character encoded to its ASCII slug unit (rules 2-6). */
function encodeChar(cp: number, ch: string): string {
  if (KEEP.test(ch)) return ch; // rule 2: preserve, including case
  if (ch === "/") return "_"; // rule 3
  if (ch === "@") return "~40"; // rule 4
  if (ch === "~") return "~7e"; // rule 5
  // rule 6: every other character as lowercase UTF-8 bytes prefixed by `~`
  const bytes = new TextEncoder().encode(String.fromCodePoint(cp));
  let out = "";
  for (const b of bytes) out += `~${hex(b)}`;
  return out;
}
export interface Slug {
  slug: string;
  truncated: boolean;
}

/**
 * Encode one component (branch or repo) to a slug of at most `maxBytes` ASCII bytes, truncating
 * only at whole-character (encoding) boundaries and rejecting non-UTF-8 refs (rule 10).
 */
export function encodeComponent(input: string, maxBytes: number): Slug {
  const units: string[] = [];
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i);
    if (cp === undefined) break;
    // Lone surrogate → not valid UTF-8. Reject rather than rewrite lossily (rule 10).
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new GroveError({
        kind: "invalid-input",
        what: "Cannot encode a directory name",
        why: "the ref contains an unpaired surrogate and is not valid UTF-8",
        remedy: "Use a UTF-8 branch/repository name.",
        detail: { input },
      });
    }
    const ch = String.fromCodePoint(cp);
    units.push(encodeChar(cp, ch));
    i += ch.length; // advance past a surrogate pair when present
  }

  let slug = "";
  let truncated = false;
  for (const u of units) {
    if (slug.length + u.length > maxBytes) {
      truncated = true;
      break; // rule 9: truncate only at encoding boundaries
    }
    slug += u; // rule 7: never collapse underscores
  }
  // A component whose first unit already exceeds the budget still yields an empty slug + truncated.
  return { slug, truncated };
}

export const slugForBranch = (branch: string): Slug => encodeComponent(branch, BRANCH_SLUG_MAX_BYTES);
export const slugForRepo = (repo: string): Slug => encodeComponent(repo, REPO_SLUG_MAX_BYTES);

/** The unescaped `@` is the only branch/repository separator (rule 4 encodes any literal `@`). */
export const dirBase = (branchSlug: string, repoSlug: string): string => `${branchSlug}@${repoSlug}`;

/** ASCII case-fold key for collision comparison (§5.2). */
export const caseFoldKey = (name: string): string => name.toLowerCase();

export interface AllocateInput {
  branch: string;
  repo: string;
  /** Exact canonical local-ref bytes (`refs/heads/<branch>`). */
  canonicalFullRef: Uint8Array;
  /** Case-folded keys of directories already allocated in the same parent. */
  taken: ReadonlySet<string>;
}

/**
 * Allocate a readable trunk directory. When the base collides (case-folded) or was truncated,
 * append the shortest unique prefix of the canonical full-ref SHA-256 digest.
 */
export function allocateDir(input: AllocateInput): string {
  const canonical = Buffer.from(input.canonicalFullRef);
  const expected = Buffer.from(`refs/heads/${input.branch}`);
  if (!canonical.equals(expected)) {
    throw new GroveError({
      kind: "invalid-input",
      what: "Cannot allocate a trunk directory",
      why: "the supplied canonical full-ref bytes do not identify the branch",
      remedy: "Pass the exact refs/heads/<branch> bytes observed from Git.",
    });
  }
  const b = slugForBranch(input.branch);
  const r = slugForRepo(input.repo);
  const base = dirBase(b.slug, r.slug);
  const truncated = b.truncated || r.truncated;

  if (!truncated && !input.taken.has(caseFoldKey(base))) return base;

  const digest = createHash("sha256").update(canonical).digest("hex");
  for (let n = 8; n <= digest.length; n++) {
    const cand = `${base}~${digest.slice(0, n)}`;
    if (!input.taken.has(caseFoldKey(cand))) return cand;
  }
  throw new GroveError({
    kind: "refused-conflict",
    what: `Cannot allocate a unique trunk directory for ${input.branch}`,
    why: "every SHA-256 prefix is already occupied under case-folding",
    remedy: "Inspect the existing trunk worktrees and remove the conflicting path.",
  });
}

/** Validate an observed allocation against Git's attached branch without deriving identity from its name. */
export function isValidTrunkAllocation(
  allocation: string,
  branch: string,
  repo: string,
  canonicalFullRef: Uint8Array,
): boolean {
  const canonical = Buffer.from(canonicalFullRef);
  if (!canonical.equals(Buffer.from(`refs/heads/${branch}`))) return false;
  const b = slugForBranch(branch);
  const r = slugForRepo(repo);
  const base = dirBase(b.slug, r.slug);
  if (allocation === base) return !b.truncated && !r.truncated;
  if (!allocation.startsWith(`${base}~`)) return false;
  const suffix = allocation.slice(base.length + 1);
  if (/^[0-9a-f]{8,64}$/.test(suffix)) {
    return createHash("sha256").update(canonical).digest("hex").startsWith(suffix);
  }
  return /^[0-9A-HJKMNP-TV-Z]{8,26}$/.test(suffix);
}
