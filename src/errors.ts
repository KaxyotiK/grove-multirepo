/**
 * The error taxonomy (§9). Every error names what failed, why, and the next action — enforced
 * structurally: a GroveError cannot be constructed without a remedy. Refused-by-policy is
 * distinguishable from failed by exit code.
 *
 * Adapted from the pinned source (D-016): the legacy `cursor-expired` (exit 10) kind is dropped
 * — Grove has no pagination cursors and §9 stops at 9.
 */

export const ERROR_KINDS = [
  "invalid-input",
  "refused-policy",
  "refused-conflict",
  "refused-precondition",
  "git",
  "io",
  "config",
  "version-skew",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/** §9: refused-by-policy must be distinguishable from failed, by exit code. */
export const EXIT_CODES: Record<ErrorKind, number> = {
  "invalid-input": 2,
  "refused-policy": 3,
  "refused-conflict": 4,
  "refused-precondition": 5,
  git: 6,
  io: 7,
  config: 8,
  "version-skew": 9,
};

/** Exit 0 success, 1 unexpected/internal, 2 usage. 3+ are the kinds above. */
export const EXIT_OK = 0;
export const EXIT_INTERNAL = 1;
export const EXIT_USAGE = 2;

export interface GroveErrorInit {
  kind: ErrorKind;
  /** What failed. Concrete, not "an error occurred". */
  what: string;
  /** Why it failed — the underlying cause, in the user's terms. */
  why: string;
  /** The next action. Required: §9's contract is unsatisfiable without it. */
  remedy: string;
  /** Structured detail for machine consumers (`--json`). */
  detail?: Record<string, unknown>;
  cause?: unknown;
}

export class GroveError extends Error {
  readonly kind: ErrorKind;
  readonly what: string;
  readonly why: string;
  readonly remedy: string;
  readonly detail: Record<string, unknown>;

  constructor(init: GroveErrorInit) {
    super(
      `${init.what}: ${init.why}`,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = "GroveError";
    this.kind = init.kind;
    this.what = init.what;
    this.why = init.why;
    this.remedy = init.remedy;
    this.detail = init.detail ?? {};
  }

  get exitCode(): number {
    return EXIT_CODES[this.kind];
  }

  /** True when the operation was refused by a rule, as opposed to having failed (§9). */
  get isRefusal(): boolean {
    return this.kind.startsWith("refused-");
  }

  /** Human form — what failed, why, and what to do. §9's three parts, always present. */
  format(): string {
    return `${this.what}\n  ${this.why}\n  → ${this.remedy}`;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: {
        kind: this.kind,
        what: this.what,
        why: this.why,
        remedy: this.remedy,
        exitCode: this.exitCode,
        ...(Object.keys(this.detail).length > 0 ? { detail: this.detail } : {}),
      },
    };
  }

  static is(e: unknown): e is GroveError {
    return e instanceof GroveError;
  }
}

/** Exit code for any thrown value. Non-Grove errors are internal (1), never silent. */
export function exitCodeFor(e: unknown): number {
  return GroveError.is(e) ? e.exitCode : EXIT_INTERNAL;
}
