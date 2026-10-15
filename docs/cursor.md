# Cursor

What agent-config gives Cursor's Agent, how to install it, and how to check it loaded.

## Install

**In one project** (committed, shared with the team):

```sh
npx -y github:juanagu/agent-config -- --project . --tool cursor
```

This writes `AGENTS.md`, `.cursor/hooks.json`, `.cursor/agents/`, `.agents/skills/` and `.agents/hooks/git-guard/`.

**For every project on this machine**:

```sh
npx -y github:juanagu/agent-config -- --global --tool cursor
```

It clones the repo to `~/Projects/agent-config` (or fast-forwards it), links `~/.cursor/agents` and `~/.cursor/skills/<name>` into the clone, and merges a `beforeShellExecution` entry into `~/.cursor/hooks.json`. Cursor keeps User Rules in the app rather than in a file, so the installer prints the step you do by hand: open **Cursor Settings → Rules → User Rules** and paste the contents of `AGENTS.md` (or the sections you want everywhere; the stack sections are the ones most people change).

Restart Cursor or reload the window afterwards: hooks are read on start.

## What loads where

| Piece | Path | Notes |
| --- | --- | --- |
| Standards | `AGENTS.md` | Read from the project root, no frontmatter needed. For path-scoped rules, add `.cursor/rules/*.mdc` in your project; this repo ships none. |
| Agents | `.cursor/agents/*.md` | `model: inherit`; `readonly: true` on `code-reviewer`. Cursor also reads `.claude/agents/` when both are present; `.cursor/` wins on a name conflict. |
| Skills | `.agents/skills/*/SKILL.md` | Read natively. Type `/` in Agent chat to pick one for a message, or Alt+Enter to apply it as a mode. |
| Git guard | `.cursor/hooks.json` → `beforeShellExecution` | Project hooks run from the project root. The matcher is `\b(git|gh)\b`, so the hook only spawns for git and gh commands. |

## Using it

- **Dispatch an agent**: `/designer where should the export button live` or "use the `qa-engineer` subagent to verify this". The Agent also delegates on its own when a description matches.
- **Review pass**: `/code-reviewer review this branch at medium`. It reports findings with `CONFIRMED` or `PLAUSIBLE` verdicts and never edits; you apply the fixes.
- **Skills**: `/open-pr`, `/resolve-pr-comments`, `/retro`; the architecture skills are picked up when the Agent judges them relevant.
- **Models**: `inherit` means an agent runs on the model you selected. To pin one, change the Cursor row of `AGENT_TARGETS` in `scripts/build/targets.mjs` in your fork and rebuild.
- **Protected checkouts**: `~/.config/agent-config/git-guard.json`, the same file for every tool:

  ```json
  { "protectedCheckouts": ["/Users/me/Projects/my-app"] }
  ```

## Check it worked

- Ask the Agent "which rules are you following?": it should quote `AGENTS.md`.
- Type `/` in Agent chat: the skills and the agents are listed.
- In a scratch repo on `main`, ask it to run `git commit --allow-empty -m test`: the hook denies it and the agent sees the reason and the worktree recipe.

## Gotchas

- **Invalid JSON from a permission hook blocks the command.** The hook prints exactly one JSON object; if you edit it, keep stdout clean (debug to stderr).
- **Node must be on the `PATH` Cursor sees.** On macOS, apps launched from the Dock do not get your shell's `PATH`; start Cursor from a terminal or install Node where the system finds it. When Node is missing the hook fails open.
- **Cloud Agents** do not copy `~/.agents/skills`; project-level `.agents/skills/` goes with the repo and works there.
- **Background agents** inherit all tools; `readonly: true` is what keeps `code-reviewer` from editing.
