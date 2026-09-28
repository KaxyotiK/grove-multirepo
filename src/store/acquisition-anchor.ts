import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Durable proofs contain only bounded metadata and digests, never Git config or hook bytes. */
interface EntryProof {
  pathBase64: string;
  kind: "directory" | "file";
  device: number;
  inode: number;
  links: number;
  owner: number;
  group: number;
  mode: number;
  modifiedAt: number;
  changedAt: number;
  bornAt: number;
  size: number;
  contentSha256?: string;
}

export interface AcquisitionGenesisProof {
  version: 2;
  entries: EntryProof[];
  expectedRemoteConfigSha256: string;
}

export interface AcquisitionAnchorProof {
  version: 2;
  sha256: string;
  genesisSha256: string;
}

const MAX_ENTRIES = 512;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

const STANDARD_SAMPLES = new Set([
  "applypatch-msg.sample", "commit-msg.sample", "fsmonitor-watchman.sample",
  "post-update.sample", "pre-applypatch.sample", "pre-commit.sample",
  "pre-merge-commit.sample", "pre-push.sample", "pre-rebase.sample",
  "pre-receive.sample", "prepare-commit-msg.sample", "push-to-checkout.sample",
  "sendemail-validate.sample", "update.sample",
]);

const STANDARD_PATHS = new Set([
  "HEAD", "config", "description", "hooks", "info", "info/exclude",
  "objects", "objects/info", "objects/pack", "refs", "refs/heads", "refs/tags", "branches",
  ...[...STANDARD_SAMPLES].map((name) => `hooks/${name}`),
]);

export function isStandardAcquisitionPath(relativePath: Buffer): boolean {
  const decoded = relativePath.toString("utf8");
  return Buffer.from(decoded).equals(relativePath) && STANDARD_PATHS.has(decoded);
}

/** Unknown or renamed template/user entries make the shell non-disposable. */
export function isStandardBareInitScaffold(anchor: string): boolean {
  const expected: Record<string, Record<string, "file" | "directory">> = {
    "": { HEAD: "file", config: "file", description: "file", hooks: "directory", info: "directory", objects: "directory", refs: "directory", branches: "directory" },
    hooks: {}, info: { exclude: "file" }, objects: { info: "directory", pack: "directory" },
    "objects/info": {}, "objects/pack": {}, refs: { heads: "directory", tags: "directory" },
    "refs/heads": {}, "refs/tags": {}, branches: {},
  };
  const visit = (relativePath: string): boolean => {
    const allowed = expected[relativePath];
    if (!allowed) return false;
    return readdirSync(join(anchor, relativePath), { withFileTypes: true }).every((entry) => {
      const kind = relativePath === "hooks" && STANDARD_SAMPLES.has(entry.name) ? "file" : allowed[entry.name];
      if (kind === "file") return entry.isFile() && !entry.isSymbolicLink();
      if (kind === "directory") return entry.isDirectory() && !entry.isSymbolicLink() && visit(relativePath ? `${relativePath}/${entry.name}` : entry.name);
      return false;
    });
  };
  try { return visit(""); } catch { return false; }
}

interface Snapshot { entries: EntryProof[]; configBytes: Buffer }

function entrySame(left: EntryProof, right: EntryProof): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function digest(entries: EntryProof[]): string { return createHash("sha256").update(JSON.stringify(entries)).digest("hex"); }
function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function genesisDigest(proof: AcquisitionGenesisProof): string { return sha256(Buffer.from(JSON.stringify(proof))); }

/** One bounded traversal is used for both the ownership comparison and its durable digest. */
function snapshot(anchor: string): Snapshot | null {
  if (!isStandardBareInitScaffold(anchor)) return null;
  const entries: EntryProof[] = [];
  let bytes = 0;
  let configBytes: Buffer | null = null;
  const root = Buffer.from(resolve(anchor));
  const child = (parent: Buffer, name: Buffer): Buffer => Buffer.concat([parent, Buffer.from("/"), name]);
  const visit = (absolute: Buffer, relative: Buffer, depth: number): void => {
    if (entries.length >= MAX_ENTRIES || depth > 16) throw new Error("acquisition proof limit");
    const before = lstatSync(absolute);
    const kind = before.isDirectory() ? "directory" : before.isFile() ? "file" : null;
    if (kind === null || before.isSymbolicLink()) throw new Error("unsupported acquisition entry");
    const entry: EntryProof = {
      pathBase64: relative.toString("base64"), kind, device: before.dev, inode: before.ino,
      links: before.nlink, owner: before.uid, group: before.gid,
      mode: before.mode, modifiedAt: before.mtimeMs, changedAt: before.ctimeMs,
      bornAt: before.birthtimeMs, size: before.size,
    };
    entries.push(entry);
    if (kind === "file") {
      if (before.size > MAX_FILE_BYTES || bytes + before.size > MAX_TOTAL_BYTES) throw new Error("acquisition proof byte limit");
      const content = readFileSync(absolute);
      bytes += content.length;
      entry.contentSha256 = sha256(content);
      if (relative.equals(Buffer.from("config"))) configBytes = content;
    } else {
      const names = readdirSync(absolute, { encoding: "buffer" }).sort(Buffer.compare);
      for (const name of names) visit(child(absolute, name), relative.length ? child(relative, name) : name, depth + 1);
    }
    const after = lstatSync(absolute);
    if (before.dev !== after.dev || before.ino !== after.ino || before.nlink !== after.nlink || before.uid !== after.uid || before.gid !== after.gid || before.mode !== after.mode || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.birthtimeMs !== after.birthtimeMs) {
      throw new Error("acquisition entry changed during proof");
    }
  };
  try {
    visit(root, Buffer.alloc(0), 0);
    if (!isStandardBareInitScaffold(anchor) || configBytes === null) return null;
    return { entries, configBytes };
  } catch { return null; }
}

/** Compare against Git's separately initialized default-template scaffold, not a later anchor snapshot. */
export function captureAcquisitionGenesis(anchor: string, pristineReference: string, remote: string): AcquisitionGenesisProof | null {
  const current = snapshot(anchor);
  const pristine = snapshot(pristineReference);
  if (!current || !pristine || current.entries.length !== pristine.entries.length) return null;
  for (let index = 0; index < current.entries.length; index++) {
    const actual = current.entries[index]!;
    const expected = pristine.entries[index]!;
    if (actual.pathBase64 !== expected.pathBase64 || actual.kind !== expected.kind ||
      (actual.pathBase64 !== "" && ((actual.mode & 0o7777) !== (expected.mode & 0o7777) || actual.links !== expected.links || actual.owner !== expected.owner || actual.group !== expected.group)) ||
      (actual.kind === "file" && (actual.size !== expected.size || actual.contentSha256 !== expected.contentSha256))) return null;
  }
  if (!current.configBytes.equals(pristine.configBytes) || !current.configBytes.toString("utf8").endsWith("\n") || /[\r\n\0]/.test(remote)) return null;
  const appended = Buffer.from(`[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  return {
    version: 2, entries: current.entries,
    expectedRemoteConfigSha256: sha256(Buffer.concat([current.configBytes, appended])),
  };
}

function validGenesis(value: unknown): value is AcquisitionGenesisProof {
  if (typeof value !== "object" || value === null) return false;
  const proof = value as Record<string, unknown>;
  return proof.version === 2 && Array.isArray(proof.entries) && proof.entries.length > 0 && proof.entries.length <= MAX_ENTRIES &&
    typeof proof.expectedRemoteConfigSha256 === "string" && /^[0-9a-f]{64}$/.test(proof.expectedRemoteConfigSha256) &&
    proof.entries.every((candidate: unknown) => {
      if (typeof candidate !== "object" || candidate === null) return false;
      const entry = candidate as Record<string, unknown>;
      return typeof entry.pathBase64 === "string" && entry.pathBase64.length <= 1024 && /^[A-Za-z0-9+/]*={0,2}$/.test(entry.pathBase64) &&
        (entry.kind === "file" || entry.kind === "directory") &&
        ["device", "inode", "links", "owner", "group", "mode", "modifiedAt", "changedAt", "bornAt", "size"].every((key) => typeof entry[key] === "number" && Number.isFinite(entry[key])) &&
        (entry.kind === "directory" ? entry.contentSha256 === undefined : typeof entry.contentSha256 === "string" && /^[0-9a-f]{64}$/.test(entry.contentSha256));
    });
}

export function matchesAcquisitionGenesis(anchor: string, value: unknown): boolean {
  if (!validGenesis(value)) return false;
  const current = snapshot(anchor);
  return current !== null && digest(current.entries) === digest(value.entries);
}

/** The only authorized transition is Git's exact remote stanza; other bytes/entries stay fixed. */
export function captureAcquisitionRemoteProof(anchor: string, value: unknown): AcquisitionAnchorProof | null {
  if (!validGenesis(value)) return null;
  const current = snapshot(anchor);
  if (!current || current.entries.length !== value.entries.length) return null;
  for (let index = 0; index < current.entries.length; index++) {
    const actual = current.entries[index]!;
    const original = value.entries[index]!;
    if (actual.pathBase64 !== original.pathBase64 || actual.kind !== original.kind) return null;
    if (actual.pathBase64 === Buffer.from("config").toString("base64")) {
      if (actual.kind !== "file" || actual.contentSha256 !== value.expectedRemoteConfigSha256) return null;
    } else if (actual.pathBase64 === "") {
      if (actual.device !== original.device || actual.inode !== original.inode || actual.mode !== original.mode || actual.bornAt !== original.bornAt) return null;
    } else if (!entrySame(actual, original)) return null;
  }
  return { version: 2, sha256: digest(current.entries), genesisSha256: genesisDigest(value) };
}

export function matchesAcquisitionAnchorProof(anchor: string, value: unknown, genesis: unknown): boolean {
  if (typeof value !== "object" || value === null || !validGenesis(genesis)) return false;
  const proof = value as Record<string, unknown>;
  if (proof.version !== 2 || typeof proof.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(proof.sha256) || proof.genesisSha256 !== genesisDigest(genesis)) return false;
  const current = snapshot(anchor);
  return current !== null && digest(current.entries) === proof.sha256;
}
