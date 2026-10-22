# GitHub Copilot

What agent-config gives Copilot (VS Code agent mode, Copilot CLI and the cloud coding agent), how to install it, and how to check it loaded.

## Install

**In one project** (committed, shared with the team; this is the only mode the cloud coding agent sees):

```sh
npx -y github:juanagu/agent-config -- --project . --tool copilot
```

This writes `AGENTS.md`, `.github/hooks/git-guard.json`, `.github/agents/*.agent.md`, `.agents/skills/` and `.agents/hooks/git-guard/`.

**For every project on this machine** (VS Code and Copilot CLI):

```sh
npx -y github:juanagu/agent-config -- --global --tool copilot
```

It clones the repo to `~/Projects/agent-config` (or fast-forwards it), links each agent into `~/.copilot/agents/` and each skill into `~/.copilot/skills/`, writes `~/.copilot/hooks/git-guard.json` and `~/.copilot/hooks/audit-nudge.json` (the weekly dependency-audit nudge, `--no-audit-nudge` to decline), and writes `~/.copilot/copilot-instructions.md` as a copy of `AGENTS.md` (Copilot has no import syntax). The copy is refreshed by each run until you edit it; after that it is left alone and the installer says so.

Reload VS Code afterwards.

## What loads where

| Piece | Path | Notes |
| --- | --- | --- |
| Standards | `AGENTS.md` | Read from the repository root (`chat.useAgentsMdFile`, on by default). Path-specific files go in `.github/instructions/*.instructions.md` with `applyTo`; this repo ships none. |
| Agents | `.github/agents/*.agent.md` | `tools: [search, edit, runCommands]` for implementation agents, `[search, runCommands]` for `code-reviewer`; no `model`, so the picker's model is used. Copilot also reads `.claude/agents/`. |
| Skills | `.agents/skills/*/SKILL.md` | Read natively alongside `.github/skills/`. Each shows up as a `/` command. |
| Git guard | `.github/hooks/git-guard.json` → `preToolUse` | `version: 1`, camelCase event, `matcher: bash|powershell`, both a `bash` and a `powershell` command. The cloud agent runs only the `bash` one. |
| Dependency-audit nudge | `~/.copilot/hooks/audit-nudge.json` → `sessionStart` (global install only) | Answers `{"additionalContext": …}` when the last audit is a week old, nothing otherwise; Copilot ignores plain stdout on this event. |

## Using it

- **Dispatch an agent**: pick it in the Agent dropdown, or `@designer` in chat; agents can hand off to each other through `handoffs` if you add them in your fork.
- **Review pass**: select `code-reviewer` and ask for "a medium pass on this branch". It reports verdicts and never edits.
- **Skills**: `/open-pr`, `/merge-gate`, `/resolve-pr-comments`, `/retro`, `/dependency-audit`, or let Copilot pick one by its description.
- **Models**: set in the model picker; agents do not pin one. To pin, add `model` to the Copilot row of `AGENT_TARGETS` in `scripts/build/targets.mjs` in your fork and rebuild.
- **Protected checkouts**: `~/.config/agent-config/git-guard.json`:

  ```json
  { "protectedCheckouts": ["/home/me/projects/my-app"] }
  ```

## Check it worked

- In chat, ask "what instructions apply here?": the answer cites `AGENTS.md`.
- The Agent dropdown lists `architect-engineer`, `designer`, `code-reviewer` and the rest.
- In a scratch repo on `main`, ask it to run `git commit --allow-empty -m test`: the hook denies it with the reason.

## Gotchas

- **The command key in the hook payload.** Copilot's reference types the shell tool's arguments as `unknown`. The adapter reads `toolArgs.command` (camelCase form) and `tool_input.command` (PascalCase form). If a Copilot release sends the command under another key, the hook fails open; to see the payload, add a second entry to `.github/hooks/git-guard.json` that runs `node -e "process.stdin.pipe(require('fs').createWriteStream('/tmp/hook.json'))"` once, read the file, and open an issue with the shape.
- **Non-zero exits other than timeouts fail closed in `preToolUse`.** The hook catches its own errors and exits 0, so a crash inside it does not block every command; a missing `node` binary would, because the shell exits 127. Keep Node installed where Copilot runs.
- **Cloud coding agent** reads only `.github/hooks/*.json` and treats `ask` as `deny`; the guard never asks.
- **`.github/agents/` picks up any `.md` file**, so keep notes out of that folder.
