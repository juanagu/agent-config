# Antigravity CLI

What agent-config gives Antigravity CLI (`agy`, Google's successor to Gemini CLI), how to install it, and how to check it loaded.

## Install

**In one project** (committed, shared with the team):

```sh
npx -y github:juanagu/agent-config -- --project . --tool antigravity
```

This writes `AGENTS.md`, `.agents/hooks.json`, `.agents/agents/`, `.agents/skills/` and `.agents/hooks/git-guard/`. Everything Antigravity needs lives under `.agents/`.

**For every project on this machine**:

```sh
npx -y github:juanagu/agent-config -- --global --tool antigravity
```

It clones the repo to `~/Projects/agent-config` (or fast-forwards it), links each skill into `~/.gemini/antigravity-cli/skills/` and each agent into `~/.gemini/config/agents/`, merges the git guard and the weekly dependency-audit nudge (`--no-audit-nudge` to decline) into `~/.gemini/config/hooks.json`, and writes `~/.gemini/AGENTS.md` as a copy of the standards. The copy is refreshed by each run until you edit it; after that it is left alone and the installer says so.

## What loads where

| Piece | Path | Notes |
| --- | --- | --- |
| Standards | `AGENTS.md` | Read at the repository root and in any subdirectory; no `GEMINI.md` is needed. `.agents/rules/*.md` with a `trigger` frontmatter exists for path-scoped rules; this repo ships none. |
| Agents | `.agents/agents/*.md` | `model: pro` for judgment-tier agents, `inherit` for implementation. `tools` is left out so the agent inherits the session's tools (a misspelled tool name can hang an agent). |
| Skills | `.agents/skills/*/SKILL.md` | Each skill becomes a `/` command: `/open-pr`, `/retro`. |
| Git guard | `.agents/hooks.json` → `PreToolUse`, matcher `run_command` | The deny answer is `{"decision":"deny","reason":…}`. |
| Dependency-audit nudge | `~/.gemini/config/hooks.json` → `audit-nudge.SessionStart` (global install only) | Answers `{"injectSteps":[{"systemMessage":{"systemMessage":…}}]}` when the last audit is a week old, nothing otherwise. |

## Using it

- **Dispatch an agent**: `@designer` at the start of a prompt, or let the planner delegate through `invoke_subagent`; `/agents` shows what is running and lets you pick one as the primary agent.
- **Review pass**: `@code-reviewer medium pass on this branch`. It reports verdicts and never edits.
- **Skills**: `/open-pr`, `/merge-gate`, `/resolve-pr-comments`, `/retro`, `/dependency-audit`, and the architecture skills by description.
- **Protected checkouts**: `~/.config/agent-config/git-guard.json`:

  ```json
  { "protectedCheckouts": ["/home/me/projects/my-app"] }
  ```

## Check it worked

- Ask "what rules are loaded?": it should name `AGENTS.md`.
- `/agents` lists the roster; `/hooks` lists `git-guard` and, after a global install, `audit-nudge`.
- In a scratch repo on `main`, ask it to run `git commit --allow-empty -m test`: the hook denies it with the reason.

## Gotchas

- **The hook's working directory is not documented.** The adapter takes the project from the payload (`toolCall.args.Cwd`, then `workspacePaths[0]`) rather than from `process.cwd()`, and the registered command is `node .agents/hooks/git-guard/git-guard.mjs`, which assumes the hook runs from the workspace root. If your version runs hooks elsewhere, make the command absolute in `.agents/hooks.json` and open an issue with your `agy --version`.
- **Rules have a token budget.** Global and always-on rules share about 20,000 tokens; `AGENTS.md` here is around 8,000 words, so a long project `AGENTS.md` on top of a global copy can push some of it into pointers. Prefer the project copy and keep the global one short.
- **Gemini CLI is not supported.** Its hook schema (`BeforeTool`, `run_shell_command`) differs and most accounts can no longer run it; see ADR 0003. If you still run it, it reads `AGENTS.md` when `context.fileName` includes it and the skills from `.agents/skills/`; agents and the hook would need an adapter.
- **`model: pro` and `inherit` are the documented values**; `flash` exists but is not used here because an implementation agent on the smallest model is where the cost of being wrong shows up.
