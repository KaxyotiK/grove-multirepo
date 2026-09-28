import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHuman } from "../../src/output.ts";

test("V3OUT-03: the human renderer traverses the complete JSON value", () => {
  const value = {
    repositoryId: "01JTESTREPOSITORY",
    operationId: "01JTESTOPERATION",
    detail: {
      preferredRemote: "origin",
      trunk: "main",
      commonGitDir: "/tmp/example.git",
      flags: [true, false],
      absent: null,
    },
    empty: [],
  };

  assert.equal(
    renderHuman(value),
    [
      "Repository Id: 01JTESTREPOSITORY",
      "Operation Id: 01JTESTOPERATION",
      "Detail:",
      "  Preferred Remote: origin",
      "  Trunk: main",
      "  Common Git Dir: /tmp/example.git",
      "  Flags:",
      "    - true",
      "    - false",
      "  Absent: null",
      "Empty: []",
    ].join("\n"),
  );
});

test("V3OUT-03: top-level strings remain raw for executable completion output", () => {
  const script = "#compdef grove\n_grove \"$@\"";
  assert.equal(renderHuman(script), script);
});

test("V3OUT-03: error envelopes use the same complete renderer", () => {
  const envelope = {
    error: {
      kind: "refused-precondition",
      what: "Cannot mutate linked repository",
      why: "repo link is advisory",
      remedy: "Use repo add for managed trunks.",
      exitCode: 5,
      detail: { repositoryId: "01JLINKED" },
    },
  };
  const human = renderHuman(envelope);
  for (const fact of ["refused-precondition", "Cannot mutate linked repository", "repo link is advisory", "Use repo add for managed trunks.", "5", "01JLINKED"]) {
    assert.ok(human.includes(fact), `human error omitted ${fact}`);
  }
});
