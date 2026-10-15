# How agent-config is put together

One source, four tools. This page is the contract every file in the repo follows; the README says what the repo is for, this page says where each piece lives and how it reaches each tool.

## The repo root is the drop-in

The repository root is laid out exactly as a project that uses it: copy `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`, `.cursor/` and `.github/hooks/` plus `.github/agents/` into a project and every supported tool finds its files where it expects them. The repo's own sessions read the same files, so they cannot drift from what a user gets.

```
agent-config/
├── AGENTS.md                 the standards; the one file every tool reads
├── CLAUDE.md                 Claude Code: imports AGENTS.md, adds Claude-only notes
├── .agents/                  shared by Cursor, Copilot and Antigravity CLI
│   ├── skills/<name>/        skills, Agent Skills standard (canonical copy)
│   ├── hooks/git-guard/      the git guard: core + one adapter per tool
│   ├── hooks.json            Antigravity CLI hook registration    (generated)
│   └── agents/<name>.md      Antigravity CLI subagents             (generated)
├── .claude/
│   ├── settings.json         Claude Code hook registration         (generated)
│   ├── agents/<name>.md      Claude Code subagents                 (generated)
│   └── skills/<name>/        copies of .agents/skills, no evals    (generated)
├── .cursor/
│   ├── hooks.json            Cursor hook registration              (generated)
│   └── agents/<name>.md      Cursor subagents                      (generated)
├── .github/
│   ├── hooks/git-guard.json  Copilot hook registration             (generated)
│   └── agents/<name>.agent.md  Copilot custom agents               (generated)
├── agents/<name>.md          SOURCE of every agent, tool-neutral frontmatter
├── scripts/build.mjs         writes every file marked (generated)
├── scripts/install.mjs       copies into a project, or links into a tool's user folders
├── bin/bootstrap.mjs         `npx -y github:juanagu/agent-config`
├── templates/                CI workflow and pre-push hook for a new repo
├── docs/                     this page, per-tool guides, compatibility matrix, ADRs
└── tests/                    everything above is checked; `npm test`
```

`npm run build` regenerates every file marked (generated). `npm test` fails when a generated file is stale, so a change to `agents/` or to the hook registration is made in the source and built, never edited in a tool folder.

## What each tool reads

| Piece | Claude Code | Cursor | GitHub Copilot | Antigravity CLI |
| --- | --- | --- | --- | --- |
| Standards | `AGENTS.md` natively (v2.1.277+), or through `CLAUDE.md`'s `@AGENTS.md` import | `AGENTS.md` | `AGENTS.md` | `AGENTS.md` |
| Skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` |
| Agents | `.claude/agents/*.md` | `.cursor/agents/*.md` | `.github/agents/*.agent.md` | `.agents/agents/*.md` |
| Hook registration | `.claude/settings.json` → `hooks.PreToolUse` | `.cursor/hooks.json` → `beforeShellExecution` | `.github/hooks/git-guard.json` → `preToolUse` | `.agents/hooks.json` → `PreToolUse` |
| Hook code | `.agents/hooks/git-guard/` | same | same | same |

Cursor and Copilot also read `.claude/agents/` and `.claude/skills/`; the per-tool folders exist so that each tool gets frontmatter in its own dialect (Cursor's `readonly`, Copilot's `tools` list) and so a name conflict resolves predictably: a tool's own folder wins.

`docs/compatibility.md` holds the matrix with the documentation each row was verified against and the date.

## Agents: one source, four dialects

`agents/<name>.md` is the source. Its frontmatter is tool-neutral:

```yaml
---
name: backend-engineer
description: One paragraph: what it is for, when to dispatch it, what it is not for.
tier: implementation        # judgment | implementation
access: write               # read | write   (write = may edit files and run state-changing commands)
effort: medium              # low | medium | high  (optional; Claude Code only today)
color: green                # optional; Claude Code only today
---
```

The body is the system prompt, written in the neutral vocabulary of `AGENTS.md`'s "Vocabulary" section: *standards* for `AGENTS.md`, *agent* for a subagent, *skill*, *review pass*, *load the skill*. It never names a tool-specific command, path or built-in tool.

`scripts/build.mjs` maps the frontmatter:

| Neutral | Claude Code `.claude/agents/` | Cursor `.cursor/agents/` | Copilot `.github/agents/*.agent.md` | Antigravity `.agents/agents/` |
| --- | --- | --- | --- | --- |
| `tier: judgment` | `model: opus` | `model: inherit` | *(omitted; the picker's model)* | `model: pro` |
| `tier: implementation` | `model: sonnet` | `model: inherit` | *(omitted)* | `model: inherit` |
| `access: read` | `tools: Read, Glob, Grep, Bash, Skill` | `readonly: true` | `tools: [search, runCommands]` | *(omitted; inherits)* |
| `access: write` | `tools: Read, Glob, Grep, Edit, Write, Bash, Skill` | *(omitted)* | `tools: [search, edit, runCommands]` | *(omitted; inherits)* |
| `effort`, `color` | passed through | dropped | dropped | dropped |
| `name`, `description` | passed through | passed through | passed through | passed through |

Why tiers and not model names: a model name goes stale in months and means nothing to another tool. A tier says what the call costs when it is wrong (`AGENTS.md`, Agents). `model: inherit` on Cursor and the omission on Copilot mean the agent runs on whatever the user picked; the tier stays in the source's frontmatter, so a user who wants to pin a model edits `scripts/build/targets.mjs` once rather than thirteen files.

## The git guard: one core, one adapter per tool

`.agents/hooks/git-guard/git-guard.mjs` reads the hook payload on stdin, decides, and answers in the dialect named by `--tool`:

| `--tool` | Reads the command from | Shell tool filter | Denies with |
| --- | --- | --- | --- |
| `claude` (default) | `tool_input.command` | `tool_name` ∈ Bash, PowerShell | exit 2, reason on stderr |
| `cursor` | `command` | *(event is shell-only)* | exit 0, `{"continue":true,"permission":"deny","user_message":…,"agent_message":…}` |
| `copilot` | `toolArgs.command`, or `tool_input.command` | `toolName` ∈ bash, powershell (or `tool_name` Bash) | exit 0, `{"permissionDecision":"deny","permissionDecisionReason":…}` |
| `antigravity` | `toolCall.args.CommandLine` | `toolCall.name` = run_command | exit 0, `{"decision":"deny","reason":…}` |

The working directory comes from `cwd` (Claude, Cursor, Copilot) or `toolCall.args.Cwd`, then `workspacePaths[0]` (Antigravity). The decision itself, `check(command, cwd)`, is tool-agnostic and lives with `shell-parse.mjs`; the adapters are the only place a tool's payload shape appears. Every path fails open: an unreadable payload or an error inside the hook lets the command run.

Protected checkouts (the ones serving a dev server) are listed in `~/.config/agent-config/git-guard.json`; `GIT_GUARD_CONFIG` overrides the path, and the legacy `~/.claude/git-guard.json` is read when the new file is absent.

## Installing

`scripts/install.mjs` has two modes, both table-driven from `scripts/install/targets.mjs`:

- **project** (`--project <dir>`, default the current directory): copies the drop-in files for the chosen tools (`--tool` repeatable; default all four) into the project, never overwriting a file that differs without `--force`; prints what it wrote.
- **global** (`--global`): links the clone into each tool's user folders where the tool documents one (Claude Code `~/.claude/`; Cursor `~/.cursor/`; Copilot `~/.copilot/`; Antigravity `~/.gemini/…`), and writes the hook registration into the tool's user-level hooks file. Cursor has no user-level standards file (its User Rules live in the app's settings), so the installer prints the paste-in instruction instead.

`bin/bootstrap.mjs` is the `npx` entry point: clones a permanent copy (default `~/Projects/agent-config`), or fast-forwards it, then runs that copy's installer.

## Vocabulary across tools

| In this repo | Claude Code | Cursor | GitHub Copilot | Antigravity CLI |
| --- | --- | --- | --- | --- |
| standards | `CLAUDE.md` / `AGENTS.md` | `AGENTS.md`, rules | `AGENTS.md`, instructions | `AGENTS.md`, rules |
| agent | subagent | subagent | custom agent | custom subagent |
| skill | skill | skill | skill | skill (also a `/` command) |
| dispatch an agent | Agent tool | `/name` or delegation | `@name` or handoff | `invoke_subagent` / `@name` |
| review pass | `/code-review <level>` | `code-reviewer` agent | `code-reviewer` agent | `code-reviewer` agent |
| hook | `PreToolUse` on `Bash` | `beforeShellExecution` | `preToolUse` on `bash` | `PreToolUse` on `run_command` |
