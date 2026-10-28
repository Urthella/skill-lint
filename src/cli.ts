#!/usr/bin/env node
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { findSkills, type Issue, lintSkill } from "./lint.ts";

const USAGE = `Usage: skill-lint [paths...] [--strict]

Lints Agent Skills (SKILL.md folders) against the spec at agentskills.io.
Each path is a skill folder, a SKILL.md, or a folder to search. Default: .

  --strict   exit 1 on warnings too, not just errors
  -h, --help show this help`;

export function format(issues: Issue[], cwd = process.cwd()): string {
  return issues
    .map((i) => `${relative(cwd, i.file).replaceAll("\\", "/")}:${i.line}  ${i.severity.padEnd(7)}  ${i.rule.padEnd(17)}  ${i.message}`)
    .join("\n");
}

function main(args: string[]): number {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const strict = args.includes("--strict");
  const unknown = args.find((a) => a.startsWith("-") && a !== "--strict");
  if (unknown) {
    console.error(`skill-lint: unknown option ${unknown}\n\n${USAGE}`);
    return 2;
  }
  const paths = args.filter((a) => !a.startsWith("-"));
  const missing = paths.find((p) => !existsSync(p));
  if (missing) {
    console.error(`skill-lint: ${missing} does not exist`);
    return 2;
  }

  const skills = (paths.length ? paths : ["."]).flatMap(findSkills);
  if (skills.length === 0) {
    console.error("skill-lint: no SKILL.md found");
    return 2;
  }
  const issues = skills.flatMap(lintSkill);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  if (issues.length) console.log(format(issues) + "\n");
  console.log(`${skills.length} skill${skills.length === 1 ? "" : "s"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`);
  return errors > 0 || (strict && warnings > 0) ? 1 : 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
