#!/usr/bin/env node
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { findSkills, type Issue, lintSkill } from "./lint.ts";

const USAGE = `Usage: skill-lint [paths...] [--strict] [--format text|github]

Lints Agent Skills (SKILL.md folders) against the spec at agentskills.io.
Each path is a skill folder, a SKILL.md, or a folder to search. Default: .

  --strict           exit 1 on warnings too, not just errors
  --format github    print GitHub Actions annotations (inline on PR diffs)
  -h, --help         show this help`;

const rel = (file: string, cwd: string) => relative(cwd, file).replaceAll("\\", "/");

export function format(issues: Issue[], cwd = process.cwd()): string {
  return issues
    .map((i) => `${rel(i.file, cwd)}:${i.line}  ${i.severity.padEnd(7)}  ${i.rule.padEnd(17)}  ${i.message}`)
    .join("\n");
}

/** Workflow commands, escaped as GitHub documents: https://docs.github.com/actions/reference/workflow-commands */
export function formatGithub(issues: Issue[], cwd = process.cwd()): string {
  const data = (s: string) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  const prop = (s: string) => data(s).replaceAll(":", "%3A").replaceAll(",", "%2C");
  return issues
    .map((i) => `::${i.severity} file=${prop(rel(i.file, cwd))},line=${i.line},title=${prop(`skill-lint ${i.rule}`)}::${data(i.message)}`)
    .join("\n");
}

function main(args: string[]): number {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  let strict = false;
  let output = "text";
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--strict") strict = true;
    else if (a === "--format") output = args[++i] ?? "";
    else if (a.startsWith("-")) return fail(`unknown option ${a}`);
    else paths.push(a);
  }
  if (output !== "text" && output !== "github") return fail("--format must be text or github");
  const missing = paths.find((p) => !existsSync(p));
  if (missing) return fail(`${missing} does not exist`);

  const skills = (paths.length ? paths : ["."]).flatMap(findSkills);
  if (skills.length === 0) return fail("no SKILL.md found");
  const issues = skills.flatMap(lintSkill);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  if (issues.length) console.log((output === "github" ? formatGithub(issues) : format(issues)) + "\n");
  console.log(`${skills.length} skill${skills.length === 1 ? "" : "s"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`);
  return errors > 0 || (strict && warnings > 0) ? 1 : 0;
}

function fail(message: string): number {
  console.error(`skill-lint: ${message}\n\n${USAGE}`);
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
