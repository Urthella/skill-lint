import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { findSkills, lintSkill } from "../src/lint.ts";

const GOOD_DESC = "Reviews SQL migrations for locking and data-loss risks. Use when a PR adds or edits a migration.";

/** Writes a skill folder and returns its path. `files` maps relative paths to contents. */
function skill(name: string, frontmatter: string, body = "# Steps\n", files: Record<string, string> = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), "skill-lint-")), name);
  for (const [path, content] of Object.entries({ "SKILL.md": `---\n${frontmatter}\n---\n${body}`, ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const rules = (dir: string) => lintSkill(dir).map((i) => `${i.line}:${i.rule}`);

test("a spec-conformant skill has no issues", () => {
  const dir = skill("migration-review", `name: migration-review\ndescription: ${GOOD_DESC}\nlicense: MIT\nmetadata:\n  version: "1.0"`, "See [checklist](references/checklist.md).\n", {
    "references/checklist.md": "# Checklist\n",
  });
  assert.deepEqual(lintSkill(dir), []);
});

test("missing frontmatter", () => {
  const dir = skill("x", "", "");
  writeFileSync(join(dir, "SKILL.md"), "# No frontmatter\n");
  assert.deepEqual(rules(dir), ["1:frontmatter"]);
});

test("name rules from the spec, reported on the name line", () => {
  for (const bad of ["PDF-Tools", "-pdf", "pdf--tools", "pdf-", "a".repeat(65)]) {
    const dir = skill(bad.toLowerCase().replace(/^-|-$|--/g, "x").slice(0, 60) || "x", `description: ${GOOD_DESC}\nname: ${bad}`);
    assert.deepEqual(rules(dir), ["3:name"], bad);
  }
  assert.match(lintSkill(skill("folder-name", `name: other-name\ndescription: ${GOOD_DESC}`))[0].message, /must match its directory "folder-name"/);
  assert.deepEqual(rules(skill("x", `description: ${GOOD_DESC}`)), ["1:name"]);
});

test("description: required, max 1024, and should say when to use it", () => {
  assert.deepEqual(rules(skill("s", "name: s")), ["1:description"]);
  assert.deepEqual(rules(skill("s", `name: s\ndescription: ${"x ".repeat(600)}`)), ["3:description"]);
  assert.deepEqual(rules(skill("s", "name: s\ndescription: Helps with PDFs.")), ["3:description-vague", "3:description-when"]);
});

test("optional field types", () => {
  const dir = skill("s", `name: s\ndescription: ${GOOD_DESC}\nmetadata:\n  version: 1.0\nallowed-tools:\n  - Read\ncompatibility: ""\nauthor: me`);
  assert.deepEqual(rules(dir), ["4:metadata", "6:allowed-tools", "8:compatibility", "9:unknown-field"]);
  assert.match(lintSkill(dir)[0].message, /quote it: version: "1"/);
  assert.equal(lintSkill(dir)[1].severity, "warning", "a list of tools works in Claude Code");
  assert.equal(lintSkill(skill("s", `name: s\ndescription: ${GOOD_DESC}\nallowed-tools: 42`))[0].severity, "error");
});

test("Claude Code's frontmatter extensions are not unknown fields", () => {
  const dir = skill("s", `name: s\ndescription: ${GOOD_DESC}\nargument-hint: "[file]"\nuser-invocable: true\ndisable-model-invocation: false\nmodel: opus`);
  assert.deepEqual(rules(dir), []);
});

test("trigger phrases other than 'use when' count", () => {
  const dir = skill("s", "name: s\ndescription: Brand voice and messaging frameworks. Activate for branded content and style guides.");
  assert.deepEqual(rules(dir), []);
});

test("invalid YAML is reported, not thrown", () => {
  assert.deepEqual(rules(skill("s", "name: s\ndescription: [unclosed")), ["3:frontmatter"]);
});

test("links: broken, absolute, backslash and outside the skill are errors", () => {
  const body = [
    "Run [the script](scripts/run.py).", // line 5
    "Read [missing](references/nope.md).",
    "Bad [abs](/etc/passwd) and [win](scripts\\run.py).",
    "Escaping [parent](../other/SKILL.md).",
  ].join("\n");
  const dir = skill("s", `name: s\ndescription: ${GOOD_DESC}`, body, { "scripts/run.py": "print(1)\n" });
  assert.deepEqual(rules(dir), ["6:broken-link", "7:link-path", "7:link-path", "8:link-path"]);
});

test("links in code, URLs and anchors are skipped", () => {
  const body = "```md\n[x](not/real.md)\n```\nInline `[y](nope.md)`, [web](https://example.com), [mail](mailto:a@b.c), [top](#steps).\n";
  assert.deepEqual(rules(skill("s", `name: s\ndescription: ${GOOD_DESC}`, body)), []);
});

test("a reference that links further is a nested-reference warning", () => {
  const dir = skill("s", `name: s\ndescription: ${GOOD_DESC}`, "See [guide](references/guide.md).\n", {
    "references/guide.md": "Read [deep](deep.md), [a](a.md), [b](b.md), [c](c.md) and [deep](deep.md) again.\n",
    "references/deep.md": "deep\n",
  });
  assert.deepEqual(rules(dir), ["5:nested-reference"], "one warning per reference file");
  assert.match(lintSkill(dir)[0].message, /links on to deep\.md, a\.md, b\.md and 1 more;/);
});

test("a body over 500 lines is a warning", () => {
  assert.deepEqual(rules(skill("s", `name: s\ndescription: ${GOOD_DESC}`, "line\n".repeat(500))), ["5:body-length"]);
});

test("CRLF files and a BOM are handled", () => {
  const dir = skill("s", "");
  writeFileSync(join(dir, "SKILL.md"), `﻿---\r\nname: s\r\ndescription: ${GOOD_DESC}\r\n---\r\n# Steps\r\n`);
  assert.deepEqual(lintSkill(dir), []);
});

test("findSkills walks folders but skips node_modules and dot folders", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-root-"));
  for (const p of ["a/SKILL.md", "group/b/SKILL.md", "node_modules/c/SKILL.md", ".git/d/SKILL.md"]) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), "");
  }
  assert.deepEqual(findSkills(root).map((d) => d.slice(root.length + 1).replaceAll("\\", "/")).sort(), ["a", "group/b"]);
});
