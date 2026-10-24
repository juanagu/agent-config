# Claude Code

What agent-config gives a Claude Code session, how to install it, and how to check it loaded.

## Install

**In one project** (committed, shared with the team):

```sh
npx -y github:juanagu/agent-config -- --project . --tool claude
```

This writes `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`, `.claude/skills/`, and `.agents/hooks/git-guard/`. If the project already has a `CLAUDE.md`, the installer leaves it and tells you to add the line `@AGENTS.md` to it.

**For every project on this machine** (links `~/.claude` into a clone):

```sh
npx -y github:juanagu/agent-config -- --global --tool claude
```

It clones the repo to `~/Projects/agent-config` (or fast-forwards it), then: adds a one-line `@` import at the top of `~/.claude/CLAUDE.md` (the rest of the file is yours), links each agent into `~/.claude/agents/` and each skill into `~/.claude/skills/` (one entry each, so your own agents and skills stay beside them), creates `~/.claude/settings.json` from a template when it is missing (otherwise offers the git guard hook, or re-points an entry from an older install), offers the weekly dependency-audit nudge as a `SessionStart` hook (yes by default; `--no-audit-nudge` declines), and installs the third-party skills in `skills.txt`. Re-running updates everything. Flags: `--yes`, `--no-optional`, `--help`.

Then start a new session: hooks and agents are read at session start.

## What loads where

| Piece | Path | Notes |
| --- | --- | --- |
| Standards | `CLAUDE.md` → `@AGENTS.md` | Claude Code v2.1.277+ also reads `AGENTS.md` on its own when no `CLAUDE.md` exists; the import makes both cases identical. |
| Agents | `.claude/agents/*.md` | `model: opus` for judgment-tier agents, `sonnet` for implementation; `tools`, `effort` and `color` set. Run `/agents` to list them. |
| Skills | `.claude/skills/*/SKILL.md` | Generated copies of `.agents/skills/`. Type `/` to see them. |
| Git guard | `.claude/settings.json` → `hooks.PreToolUse` | Matches `Bash|PowerShell`; blocks with exit 2 and the reason on stderr. `/hooks` shows it. |
| Dependency-audit nudge | `~/.claude/settings.json` → `hooks.SessionStart` (global install only) | Matcher `startup`. Prints one line telling Claude to run `/dependency-audit` when the last run is missing or a week old, nothing otherwise; never fails or touches the network. |

## Using it

- **Dispatch an agent**: Claude does it itself when a task matches an agent's description; or say "use the `designer` agent for this".
- **Review pass**: `/code-review medium` (or `low`, `high`). The `code-reviewer` agent exists for the other tools; in Claude Code prefer the command, it has verified verdicts built in.
- **Skills**: `/open-pr`, `/merge-gate`, `/resolve-pr-comments`, `/retro`, `/dependency-audit`; the `*-architecture` skills load on their own when you work in that stack.
- **Protected checkouts**: list the checkouts that serve a dev server in `~/.config/agent-config/git-guard.json`:

  ```json
  { "protectedCheckouts": ["C:/Users/me/Projects/my-app"] }
  ```

## Library docs (optional)

The standards send an agent to current library docs before it codes against an API that may have moved. Context7 serves them as an MCP server; install it once, user-scoped, over its remote endpoint (no local `npx`):

```sh
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
```

It works without a key at a lower rate limit. With a key from context7.com, add `--header "CONTEXT7_API_KEY: <key>"`; it lands in `~/.claude.json`, never in a repo. Queries go to Upstash, so keep project details and secrets out of them. `claude mcp list` shows `context7` as connected.

## Session effort

Agents carry their own `effort` (judgment tier `high`, implementation `medium`, `technical-writer` `low`); the main session's comes from your user settings, which agent-config doesn't manage because the key names a model ID that goes stale. The standards keep the session at high, so set it once in `~/.claude/settings.json`, under the model you run:

```json
"modelSettings": { "claude-opus-5-5": { "effortLevel": "high" } }
```

Lower it in a session of quick chores, and move the key to the new ID when the model changes.

## Check it worked

- `/memory` shows `AGENTS.md` (through `CLAUDE.md`) under memory files.
- `/agents` lists `architect-engineer`, `designer`, `code-reviewer` and the rest.
- `/hooks` shows `git-guard` under `PreToolUse` and, after a global install, `audit-nudge` under `SessionStart`.
- `AGENT_CONFIG_AUDIT_STAMP=/nonexistent node ~/Projects/agent-config/.agents/hooks/audit-nudge/audit-nudge.mjs` prints the nudge; after a `dependency-audit` run it prints nothing for a week.
- In a scratch repo on `main`, ask Claude to run `git commit --allow-empty -m test`: it is blocked with the reason and the worktree recipe.

## Gotchas

- **A user-level `CLAUDE.md` hides a project `AGENTS.md`.** When any `CLAUDE.md` exists in the directory chain, Claude reads only `CLAUDE.md` files. That is why this repo ships a `CLAUDE.md` whose first line imports `AGENTS.md`; keep that line when you edit it.
- **Hooks need Node on `PATH`.** The hook fails open when `node` or `git` is missing: the command runs. It is a guard against forgetting, not a security boundary.
- **Tools that append to `~/.claude/CLAUDE.md`** (some MCP installers do) make the file load twice. Keep it to the one import line and move anything useful into your fork's `AGENTS.md`.
- **Agent frontmatter must be valid YAML.** The build quotes descriptions for you; if you hand-write an agent whose description contains `: `, quote it, or the agent silently fails to load.
