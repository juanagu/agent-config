# Compatibility

What each tool reads, where this repo puts it, and the page each row was checked against. Tool formats change often; a row is only as good as its date, so when something does not load, open the linked page first and then `CONTRIBUTING.md` says how to send the fix.

Last verified: **2026-10-15**, against the pages linked below.

## Standards file

| Tool | Reads | How this repo satisfies it | Source |
| --- | --- | --- | --- |
| Claude Code | `AGENTS.md` natively from v2.1.277 when no `CLAUDE.md` is present; otherwise `CLAUDE.md`, which may `@import` it | `CLAUDE.md` holds `@AGENTS.md`, so both cases load the standards | [Memory: AGENTS.md](https://code.claude.com/docs/en/memory#agents-md) |
| Cursor | `AGENTS.md` at the project root (and nested) | `AGENTS.md` | [Rules](https://cursor.com/docs/context/rules) |
| GitHub Copilot | `AGENTS.md` at the repository root; `.github/copilot-instructions.md` | `AGENTS.md` | [Custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) |
| Antigravity CLI | `AGENTS.md` or `GEMINI.md` at the root or in any directory; `.agents/rules/*.md` | `AGENTS.md` | [Rules](https://antigravity.google/docs/rules?tab=cli) |

## Skills

All four implement the [Agent Skills](https://agentskills.io/specification) standard: a folder with a `SKILL.md` whose frontmatter has `name` (matching the folder) and `description`.

| Tool | Project directories | User directories | Source |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | [Skills](https://code.claude.com/docs/en/skills) |
| Cursor | `.agents/skills/`, `.cursor/skills/`, also `.claude/skills/` | `~/.agents/skills/`, `~/.cursor/skills/`, also `~/.claude/skills/` | [Skills](https://cursor.com/docs/context/skills) |
| GitHub Copilot | `.github/skills/`, `.agents/skills/`, `.claude/skills/` | `~/.copilot/skills/`, `~/.agents/skills/`, `~/.claude/skills/` | [Agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills) |
| Antigravity CLI | `.agents/skills/` | `~/.gemini/antigravity-cli/skills/` | [Skills](https://antigravity.google/docs/skills?tab=cli) |

The canonical copy is `.agents/skills/`, which three tools read directly. `.claude/skills/` is a generated copy without the `evals/` folders.

## Agents

| Tool | Directory | File | Frontmatter this repo writes | Source |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/agents/`, `~/.claude/agents/` | `<name>.md` | `name`, `description`, `model` (`opus`/`sonnet`), `effort`, `color`, `tools` | [Subagents](https://code.claude.com/docs/en/sub-agents) |
| Cursor | `.cursor/agents/`, `~/.cursor/agents/` (also `.claude/agents/`) | `<name>.md` | `name`, `description`, `model: inherit`, `readonly` | [Subagents](https://cursor.com/docs/context/subagents) |
| GitHub Copilot | `.github/agents/`, `~/.copilot/agents/` (also `.claude/agents/`) | `<name>.agent.md` | `name`, `description`, `tools` | [Custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents) |
| Antigravity CLI | `.agents/agents/`, `~/.gemini/config/agents/` | `<name>.md` | `name`, `description`, `model` (`pro`/`inherit`) | [Subagents](https://antigravity.google/docs/subagents?tab=cli) |

Antigravity's `tools` key is left out on purpose: its docs warn that an unmapped tool name can hang the agent, and omitting the key inherits the session's tools.

## The git guard hook

| Tool | Registration file | Event, matcher | Payload read | Deny answer | Source |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/settings.json`, `~/.claude/settings.json` | `PreToolUse`, `Bash\|PowerShell` | `tool_name`, `tool_input.command`, `cwd` | exit 2, reason on stderr | [Hooks](https://code.claude.com/docs/en/hooks) |
| Cursor | `.cursor/hooks.json`, `~/.cursor/hooks.json` | `beforeShellExecution`, regex on the command | `command`, `cwd` | `{"continue":true,"permission":"deny","user_message","agent_message"}` (the shape of Cursor's own block-git example) | [Hooks](https://cursor.com/docs/agent/hooks) |
| GitHub Copilot | `.github/hooks/*.json`, `~/.copilot/hooks/*.json` | `preToolUse`, `bash\|powershell` | `toolName`, `toolArgs.command`, `cwd` | `{"permissionDecision":"deny","permissionDecisionReason"}` | [CLI hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference) |
| Antigravity CLI | `.agents/hooks.json`, `~/.gemini/config/hooks.json` | `PreToolUse`, `run_command` | `toolCall.name`, `toolCall.args.CommandLine`, `toolCall.args.Cwd` | `{"decision":"deny","reason"}` | [Hooks](https://antigravity.google/docs/hooks?tab=cli) |

Copilot's reference types the shell tool's arguments as `unknown`; the adapter reads `toolArgs.command` and, for the PascalCase `PreToolUse` form, `tool_input.command`. If your Copilot version sends the command under another key the hook fails open, and the Copilot guide shows how to print a payload to find out.

## What does not port

- **Review pass.** Claude Code has `/code-review`. The other tools get the `code-reviewer` agent, which reports at the same levels but is a prompt, not a tool.
- **Model tiers.** Claude Code and Antigravity accept a family alias; Cursor and Copilot run the agent on the model you picked.
- **User-level standards.** Cursor keeps User Rules in the app's settings, not in a file; the global installer prints what to paste.
- **Hooks in Copilot's cloud agent** run only the `bash` command and treat `ask` as `deny`; the git guard never asks, so it behaves the same there.

## Not supported

- **Gemini CLI.** Google replaced it with Antigravity CLI in June 2026 and its hook schema differs; see ADR 0003. A `GEMINI.md` is unnecessary because Antigravity reads `AGENTS.md`.
- **Codex, Windsurf, Zed and others.** Most read `AGENTS.md` and `.agents/skills/`, so the standards and skills already work there; agents and the hook do not. A contribution needs a row in each table above, an entry in `scripts/build/targets.mjs`, an adapter in the hook, and a guide in `docs/`.
