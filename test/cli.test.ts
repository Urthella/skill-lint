import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGithub } from "../src/cli.ts";

test("github annotations escape properties and data as GitHub documents", () => {
  const out = formatGithub(
    [{ file: "/repo/skills/a,b/SKILL.md", line: 3, rule: "broken-link", severity: "error", message: '"x.md" 100% missing\nsee: docs' }],
    "/repo",
  );
  assert.equal(out, '::error file=skills/a%2Cb/SKILL.md,line=3,title=skill-lint broken-link::"x.md" 100%25 missing%0Asee: docs');
});
