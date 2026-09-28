import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdGenerator,
  isUlid,
  shortId,
  shortIdExtended,
  ULID_LEN,
  SHORT_LEN,
} from "../../src/model/ids.ts";

test("generates well-formed ULIDs", () => {
  const ids = createIdGenerator();
  const id = ids.ulid();
  assert.equal(id.length, ULID_LEN);
  assert.ok(isUlid(id));
});

test("ULIDs are monotonic within a millisecond and strictly increasing", () => {
  let now = 1_786_000_000_000;
  const ids = createIdGenerator({ now: () => now, random: () => 0 });
  const a = ids.ulid();
  const b = ids.ulid(); // same ms → random block increments
  const c = ids.ulid();
  assert.ok(a < b, `${a} < ${b}`);
  assert.ok(b < c, `${b} < ${c}`);
  now += 1;
  const d = ids.ulid();
  assert.ok(c < d, "advances with time");
});

test("time ordering: later timestamp sorts after earlier", () => {
  const early = createIdGenerator({ now: () => 1000, random: () => 0.5 }).ulid();
  const late = createIdGenerator({ now: () => 2000, random: () => 0.5 }).ulid();
  assert.ok(early < late);
});

test("short id is the LAST 8 chars (randomness), not the timestamp prefix", () => {
  const ids = createIdGenerator({ now: () => 1_786_000_000_000, random: () => 0 });
  const id = ids.ulid();
  assert.equal(shortId(id), id.slice(-SHORT_LEN));
  assert.equal(shortId(id).length, SHORT_LEN);
  // Two ids created the same ms differ in their short form (random block incremented).
  const ids2 = createIdGenerator({ now: () => 1_786_000_000_000, random: () => 0 });
  const a = ids2.ulid();
  const b = ids2.ulid();
  assert.notEqual(shortId(a), shortId(b));
});

test("extended short id lengthens on demand", () => {
  const id = createIdGenerator().ulid();
  assert.equal(shortIdExtended(id, 2).length, SHORT_LEN + 2);
});

test("isUlid rejects malformed input", () => {
  assert.equal(isUlid("too-short"), false);
  assert.equal(isUlid("i".repeat(ULID_LEN)), false); // 'i' is not in Crockford alphabet
});
