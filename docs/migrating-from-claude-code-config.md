# Migrating from claude-code-config

`juanagu/claude-code-config` was the Claude Code-only ancestor of this repo. It is deprecated and frozen; this repo is where changes land. Everything it had is here, in a different place:

| In claude-code-config | Here |
| --- | --- |
| `CLAUDE.md` (the standards) | `AGENTS.md`, tool-neutral; `CLAUDE.md` imports it |
| `agents/*.md` with `model: opus|sonnet` | `agents/*.md` with `tier: judgment|implementation`; `.claude/agents/` is generated from them |
| `skills/*/` | `.agents/skills/*/`; `.claude/skills/` is a generated copy |
| `hooks/git-guard.mjs`, `hooks/shell-parse.mjs` | `.agents/hooks/git-guard/`, now with `--tool <claude|cursor|copilot|antigravity>` |
| `settings.template.json` | `scripts/install/claude-settings.template.json` |
| `install.mjs`, `bin/bootstrap.mjs` | `scripts/install.mjs` (`--global`, `--project`), `bin/bootstrap.mjs` |
| `skills.txt`, `skills.optional.txt` | same names, same format |
| `templates/` | `templates/` |
| `~/.claude/git-guard.json` | `~/.config/agent-config/git-guard.json` (the old path is still read when the new one is absent) |

## Switching a machine

1. Run the new bootstrap. It clones to `~/Projects/agent-config` by default and offers to replace what the old install linked:

   ```sh
   npx -y github:juanagu/agent-config -- --global --tool claude
   ```

   `~/.claude/CLAUDE.md` gets the new import line in place of the old one (anything else in the file is left), the `~/.claude/agents` junction becomes a real folder with one link per agent (your own agents can live there too), `~/.claude/skills/<name>` links are re-pointed at the new clone, and the `git-guard` entry in `~/.claude/settings.json` is rewritten to the new path. Anything replaced is moved to `~/.claude/backup-<timestamp>/` first.
2. Move `~/.claude/git-guard.json` to `~/.config/agent-config/git-guard.json` (optional; the old location keeps working).
3. Start a new Claude Code session and check `/hooks` shows the new command path.
4. Delete the old clone when you are sure nothing else points into it: `~/.claude` no longer does.

## Projects with a `CLAUDE.md` of their own

Nothing changes for them: the user-level `~/.claude/CLAUDE.md` still imports the standards. If you want a project to carry the standards for teammates on other tools, run `npx -y github:juanagu/agent-config -- --project .` in it and commit the result.

## What is different on purpose

- **Tiers instead of model names** in agent sources (ADR 0004).
- **The review pass** is named neutrally in the standards; in Claude Code it is still `/code-review`.
- **`code-reviewer`** is a new agent, for tools without a built-in review command. Claude Code sessions keep using the command.
- **The git guard's block messages** cite `AGENTS.md` and the new config path.
