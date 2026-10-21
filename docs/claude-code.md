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

It clones the repo to `~/Projects/agent-config` (or fast-forwards it), then: adds a one-line `@` import at the top of `~/.claude/CLAUDE.md` (the rest of the file is yours), links each agent into `~/.claude/agents/` and each skill into `~/.claude/skills/` (one entry each, so your own agents and skills stay beside them), creates `~/.claude/settings.json` from a template when it is missing (otherwise offers the git guard hook, or re-points an entry from an older install), and installs the third-party skills in `skills.txt`. Re-running updates everything. Flags: `--yes`, `--no-optional`, `--help`.

Then start a new session: hooks and agents are read at session start.

**Keep it current.** The links serve the clone's working tree, so the clone stays on `main`; work on agent-config happens in worktrees, and the installer warns when the clone is on another branch. A pull alone is not an update: a new skill has no link and, on Windows without the symlink privilege, the agents are copies, until the installer runs again. After every merge to agent-config's `main`, run `node scripts/install.mjs --update` in the clone (or the `npx` line above).

## What loads where

| Piece | Path | Notes |
| --- | --- | --- |
| Standards | `CLAUDE.md` → `@AGENTS.md` | Claude Code v2.1.277+ also reads `AGENTS.md` on its own when no `CLAUDE.md` exists; the import makes both cases identical. |
| Agents | `.claude/agents/*.md` | `model: opus` for judgment-tier agents, `sonnet` for implementation; `tools`, `effort` and `color` set. Run `/agents` to list them. |
| Skills | `.claude/skills/*/SKILL.md` | Generated copies of `.agents/skills/`. Type `/` to see them. |
| Git guard | `.claude/settings.json` → `hooks.PreToolUse` | Matches `Bash|PowerShell`; blocks with exit 2 and the reason on stderr. `/hooks` shows it. |

## Using it

- **Dispatch an agent**: Claude does it itself when a task matches an agent's description; or say "use the `designer` agent for this".
- **Review pass**: `/code-review medium` (or `low`, `high`). The `code-reviewer` agent exists for the other tools; in Claude Code prefer the command, it has verified verdicts built in.
- **Skills**: `/open-pr`, `/merge-gate`, `/resolve-pr-comments`, `/retro`; the `*-architecture` skills load on their own when you work in that stack.
- **Protected checkouts**: list the checkouts that serve a dev server in `~/.config/agent-config/git-guard.json`:

  ```json
  { "protectedCheckouts": ["C:/Users/me/Projects/my-app"] }
  ```

## Check it worked

- `/memory` shows `AGENTS.md` (through `CLAUDE.md`) under memory files.
- `/agents` lists `architect-engineer`, `designer`, `code-reviewer` and the rest.
- `/hooks` shows `git-guard` under `PreToolUse`.
- In a scratch repo on `main`, ask Claude to run `git commit --allow-empty -m test`: it is blocked with the reason and the worktree recipe.

## Gotchas

- **A user-level `CLAUDE.md` hides a project `AGENTS.md`.** When any `CLAUDE.md` exists in the directory chain, Claude reads only `CLAUDE.md` files. That is why this repo ships a `CLAUDE.md` whose first line imports `AGENTS.md`; keep that line when you edit it.
- **Hooks need Node on `PATH`.** The hook fails open when `node` or `git` is missing: the command runs. It is a guard against forgetting, not a security boundary.
- **Tools that append to `~/.claude/CLAUDE.md`** (some MCP installers do) make the file load twice. Keep it to the one import line and move anything useful into your fork's `AGENTS.md`.
- **Agent frontmatter must be valid YAML.** The build quotes descriptions for you; if you hand-write an agent whose description contains `: `, quote it, or the agent silently fails to load.
