import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROL_RE, containsControl, visibleControl } from "../../src/model/control.ts";

// Built with fromCharCode/fromCodePoint so the source never contains a raw control byte.
const NUL = String.fromCharCode(0x00);
const ESC = String.fromCharCode(0x1b); // C0
const DEL = String.fromCharCode(0x7f);
const CSI = String.fromCharCode(0x9b); // C1
const RLO = String.fromCodePoint(0x202e); // bidi right-to-left override ("Trojan Source")
const ISOL = String.fromCodePoint(0x2066); // bidi isolate

test("CONTROL_RE covers C0, DEL, C1, and bidi overrides/isolates", () => {
  for (const c of [NUL, ESC, DEL, CSI, RLO, ISOL]) {
    assert.ok(CONTROL_RE.test(c), `should match U+${(c.codePointAt(0) ?? 0).toString(16)}`);
  }
  assert.ok(!containsControl("normal-name_123.txt"), "a clean string is not flagged");
});

test("visibleControl escapes the class — short as \\xNN, wide as \\uNNNN — and passes clean text", () => {
  assert.equal(visibleControl(`a${ESC}b`), "a\\x1bb");
  assert.equal(visibleControl(`x${DEL}`), "x\\x7f");
  assert.equal(visibleControl(`y${CSI}`), "y\\x9b");
  assert.equal(visibleControl(`t${RLO}u`), "t\\u202eu");
  assert.equal(visibleControl("clean.txt"), "clean.txt");
});
