import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { isMap, isScalar, LineCounter, parseDocument } from "yaml";

export type Severity = "error" | "warning";

export interface Issue {
  file: string;
  line: number;
  rule: string;
  severity: Severity;
  message: string;
}

// Limits and fields from https://agentskills.io/specification
const FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
// Claude Code's own frontmatter extensions: not in the spec, but not mistakes either.
const CLIENT_FIELDS = new Set(["argument-hint", "user-invocable", "disable-model-invocation", "model", "context", "agent", "hooks"]);
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BODY_LINES = 500;
const MAX_BODY_TOKENS = 5000;
const LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;

/** Every directory under `root` (or `root` itself) that contains a SKILL.md. */
export function findSkills(root: string): string[] {
  if (statSync(root).isFile()) return basename(root) === "SKILL.md" ? [resolve(root, "..")] : [];
  if (existsSync(join(root, "SKILL.md"))) return [root];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .flatMap((e) => findSkills(join(root, e.name)));
}

export function lintSkill(dir: string): Issue[] {
  const file = join(dir, "SKILL.md");
  const issues: Issue[] = [];
  const report = (line: number, rule: string, severity: Severity, message: string, at = file) =>
    issues.push({ file: at, line, rule, severity, message });

  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!fm) {
    report(1, "frontmatter", "error", "SKILL.md must start with YAML frontmatter between --- lines");
    return issues;
  }

  const lines = new LineCounter();
  const doc = parseDocument(fm[1], { lineCounter: lines });
  const lineAt = (offset: number) => lines.linePos(offset).line + 1; // +1 for the opening ---
  if (doc.errors.length > 0) {
    for (const e of doc.errors) report(lineAt(e.pos[0]), "frontmatter", "error", `invalid YAML: ${e.message.split("\n")[0]}`);
    return issues;
  }
  if (!isMap(doc.contents)) {
    report(1, "frontmatter", "error", "frontmatter must be a YAML mapping (key: value)");
    return issues;
  }

  const keyLine = new Map<string, number>();
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && pair.key.range) keyLine.set(String(pair.key.value), lineAt(pair.key.range[0]));
  }
  const at = (key: string) => keyLine.get(key) ?? 1;
  const data = doc.toJS() as Record<string, unknown>;

  const name = data.name;
  if (typeof name !== "string" || name === "") {
    report(at("name"), "name", "error", "name is required");
  } else if (name.length > 64 || !NAME.test(name)) {
    report(at("name"), "name", "error", `name "${name}" must be 1-64 chars of a-z, 0-9 and single hyphens, not starting or ending with one`);
  } else if (name !== basename(resolve(dir))) {
    report(at("name"), "name", "error", `name "${name}" must match its directory "${basename(resolve(dir))}"`);
  }

  const description = data.description;
  if (typeof description !== "string" || description.trim() === "") {
    report(at("description"), "description", "error", "description is required");
  } else if (description.length > 1024) {
    report(at("description"), "description", "error", `description is ${description.length} chars, the limit is 1024`);
  } else {
    if (description.trim().length < 40) {
      report(at("description"), "description-vague", "warning", "description is too short for an agent to know when to pick this skill");
    }
    if (!/\b(use|when|whenever|if|activate|invoke|triggers?)\b/i.test(description)) {
      report(at("description"), "description-when", "warning", 'description should say when to use the skill, e.g. "Use when ..."');
    }
  }

  if ("license" in data && (typeof data.license !== "string" || data.license.trim() === "")) {
    report(at("license"), "license", "error", "license must be a non-empty string");
  }
  if ("compatibility" in data) {
    const c = data.compatibility;
    if (typeof c !== "string" || c.length < 1 || c.length > 500) {
      report(at("compatibility"), "compatibility", "error", "compatibility must be a string of 1-500 chars");
    }
  }
  if ("metadata" in data) {
    const m = data.metadata;
    if (typeof m !== "object" || m === null || Array.isArray(m)) {
      report(at("metadata"), "metadata", "error", "metadata must be a map of string keys to string values");
    } else {
      for (const [k, v] of Object.entries(m)) {
        if (typeof v !== "string") {
          report(at("metadata"), "metadata", "error", `metadata.${k} must be a string (quote it: ${k}: "${String(v)}")`);
        }
      }
    }
  }
  if ("allowed-tools" in data && typeof data["allowed-tools"] !== "string") {
    const tools = data["allowed-tools"];
    const list = Array.isArray(tools) && tools.every((t) => typeof t === "string");
    report(
      at("allowed-tools"),
      "allowed-tools",
      list ? "warning" : "error",
      list
        ? `the spec wants one space-separated string ("${(tools as string[]).join(" ")}"); a list works in Claude Code but may not elsewhere`
        : 'allowed-tools must be one space-separated string, e.g. "Bash(git:*) Read"',
    );
  }
  for (const key of keyLine.keys()) {
    if (!FIELDS.has(key) && !CLIENT_FIELDS.has(key)) {
      report(at(key), "unknown-field", "warning", `"${key}" is not a spec field; custom data belongs under metadata`);
    }
  }

  const body = text.slice(fm[0].length);
  const bodyStart = text.slice(0, fm[0].length).split("\n").length;
  const bodyLines = body.split("\n").length;
  if (bodyLines > MAX_BODY_LINES) {
    report(bodyStart, "body-length", "warning", `body is ${bodyLines} lines; keep SKILL.md under ${MAX_BODY_LINES} and move detail to references/`);
  }
  const tokens = Math.ceil(Buffer.byteLength(body) / 4);
  if (tokens > MAX_BODY_TOKENS) {
    report(bodyStart, "body-tokens", "warning", `body is ~${tokens} tokens; the spec recommends under ${MAX_BODY_TOKENS}`);
  }

  const seen = new Set<string>();
  for (const link of localLinks(body)) {
    const line = bodyStart + link.line - 1;
    const target = checkTarget(dir, link.target, (rule, msg) => report(line, rule, "error", msg));
    if (!target || extname(target) !== ".md" || seen.has(target)) continue;
    seen.add(target);
    // The spec asks for references one level deep: a reference file shouldn't send the agent further.
    const onward = [...new Set(localLinks(readFileSync(target, "utf8")).map((l) => l.target))];
    if (onward.length > 0) {
      const rel = relative(dir, target).replaceAll("\\", "/");
      const list = onward.slice(0, 3).join(", ") + (onward.length > 3 ? ` and ${onward.length - 3} more` : "");
      report(line, "nested-reference", "warning", `${rel} links on to ${list}; keep references one level deep from SKILL.md`);
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

/** Relative link targets outside code, with their 1-based line in `markdown`. */
function localLinks(markdown: string): { target: string; line: number }[] {
  // Blank out code so example links in fences and `inline code` are not checked (keep newlines for line numbers).
  const prose = markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  const out: { target: string; line: number }[] = [];
  for (const m of prose.matchAll(LINK)) {
    const target = m[1].replace(/[#?].*$/, "");
    if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
    out.push({ target, line: prose.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Reports a link that won't resolve inside the skill folder; returns the resolved path if it does. */
function checkTarget(dir: string, target: string, fail: (rule: string, msg: string) => void): string | undefined {
  if (target.includes("\\")) return void fail("link-path", `"${target}" uses backslashes; use forward slashes so it works on every OS`);
  if (target.startsWith("/") || /^[a-z]:/i.test(target)) return void fail("link-path", `"${target}" is absolute; link relative to the skill folder`);
  const path = resolve(dir, decodeURI(target));
  const rel = relative(resolve(dir), path);
  if (rel.startsWith("..")) return void fail("link-path", `"${target}" points outside the skill folder, which won't ship with the skill`);
  if (!existsSync(path)) return void fail("broken-link", `"${target}" does not exist`);
  return statSync(path).isFile() ? path : undefined;
}
