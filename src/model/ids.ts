/**
 * Identity (D-001). Durable ULIDs: lexicographically sortable by creation time (so "oldest
 * first" is `ORDER BY id`) with a usable short form (`shortId`) for compact display.
 *
 * The short form is the LAST 8 characters, never the first. A ULID's first 10 chars are the
 * 48-bit millisecond timestamp; randomness begins at char 11, so a prefix collides for objects
 * created close together while the suffix does not.
 *
 * Adapted from the pinned source: the legacy `adoptLegacyId` helper (a v4 migration path with
 * no equivalent here) is dropped — there is no migration, so nothing to adopt.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;
export const ULID_LEN = TIME_LEN + RAND_LEN;

/** Injected so tests are deterministic. */
export interface IdGenerator {
  ulid(): string;
}

function encodeTime(ms: number, len: number): string {
  let out = "";
  let n = ms;
  for (let i = len - 1; i >= 0; i--) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

export interface UlidOptions {
  now?: () => number;
  random?: () => number;
}

/** Monotonic within a millisecond: the random block increments rather than being redrawn. */
export function createIdGenerator(opts: UlidOptions = {}): IdGenerator {
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? (() => Math.random());
  let lastTime = -1;
  let lastRand: number[] = [];

  return {
    ulid(): string {
      const t = now();
      if (t === lastTime) {
        for (let i = lastRand.length - 1; i >= 0; i--) {
          const v = (lastRand[i] ?? 0) + 1;
          if (v < 32) {
            lastRand[i] = v;
            break;
          }
          lastRand[i] = 0;
        }
      } else {
        lastTime = t;
        lastRand = Array.from({ length: RAND_LEN }, () => Math.floor(random() * 32));
      }
      return encodeTime(t, TIME_LEN) + lastRand.map((i) => CROCKFORD[i]).join("");
    },
  };
}

const ULID_RE = new RegExp(`^[${CROCKFORD}]{${ULID_LEN}}$`);

export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}

/**
 * A short, collision-resistant form of a ULID for compact display. Last 8 chars = 40 bits of
 * randomness; `shortIdExtended` widens it when a caller needs more entropy against collision.
 */
export const SHORT_LEN = 8;

export function shortId(id: string): string {
  return id.slice(-SHORT_LEN);
}

/** The extended form used when a short form collides on disk. */
export function shortIdExtended(id: string, extraChars: number): string {
  return id.slice(-(SHORT_LEN + extraChars));
}
