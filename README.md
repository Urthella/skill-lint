# skill-lint

[![ci](https://github.com/Urthella/skill-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/Urthella/skill-lint/actions/workflows/ci.yml)

A linter for [Agent Skills](https://agentskills.io) (`SKILL.md` folders), the format used by Claude Code, Claude, and other agents. It checks the spec's hard rules and the things the spec only recommends, which is where real skills actually break: links to files that don't exist, references that send the agent three files deep, descriptions that never say when to use the skill.

```bash
npx -y github:Urthella/skill-lint ./skills
```

```text
skills/pdf-tools/SKILL.md:2  error    name               name "PDF-Tools" must be 1-64 chars of a-z, 0-9 and single hyphens, not starting or ending with one
skills/pdf-tools/SKILL.md:3  warning  description-when   description should say when to use the skill, e.g. "Use when ..."
skills/pdf-tools/SKILL.md:15  error    broken-link        "references/forms.md" does not exist

1 skill: 2 errors, 1 warning
```

Exit code is 1 on errors (or on warnings too with `--strict`), so it drops straight into CI.

## GitHub Action

Problems show up as annotations right on the lines of the PR diff:

```yaml
- uses: actions/checkout@v4
- uses: Urthella/skill-lint@main
  with:
    path: skills        # space-separated folders, default "."
    strict: true        # fail on warnings too, default false
```

The action sets up Node 24 for its own run. Outside Actions, `--format github` prints the same annotations.

## Rules

| Rule | Severity | Checks |
|---|---|---|
| `frontmatter` | error | YAML frontmatter exists, parses, and is a mapping |
| `name` | error | 1-64 chars of `a-z 0-9 -`, no leading/trailing/double hyphens, matches the folder name |
| `description` | error | present, at most 1024 chars |
| `license`, `compatibility`, `metadata` | error | right types; `compatibility` at most 500 chars; `metadata` values are strings (`version: 1.0` is a number) |
| `allowed-tools` | error / warning | a space-separated string; a YAML list is a warning since Claude Code accepts it |
| `broken-link` | error | every relative link in the body points to a real file |
| `link-path` | error | no absolute paths, no `\` separators, nothing outside the skill folder (it won't ship with the skill) |
| `description-vague` | warning | under 40 chars says too little to be picked |
| `description-when` | warning | no trigger phrase like "Use when", "Activate for", "Triggers on" |
| `nested-reference` | warning | a referenced `.md` links on to more files; the spec asks for one level |
| `body-length`, `body-tokens` | warning | body over 500 lines or ~5000 tokens |
| `unknown-field` | warning | a top-level field outside the spec (Claude Code's `argument-hint`, `user-invocable`, `model`, ... are allowed) |

Links inside code blocks and inline code are ignored, so examples don't trip the checker.

## Tested on real skills

Run against the 26 skills from the Claude Code plugins installed on my machine: **0 errors, 46 warnings**, mostly reference files that link on to more reference files, plus a few descriptions that never say when to use the skill. That pass is also what tuned the rules: Claude Code's own frontmatter fields and list-style `allowed-tools` are accepted instead of flagged.

## Develop

```bash
npm ci        # also builds dist/
npm test      # node --test, runs the .ts sources directly
```

Requires Node 24+. `nix develop` gives you the same toolchain.

## License

[MIT](LICENSE)
