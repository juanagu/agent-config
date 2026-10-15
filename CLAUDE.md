@AGENTS.md

## Claude Code specifics

- The review pass is `/code-review <level>` (`low|medium|high`), run from the main session; the `code-reviewer` agent is for tools without one.
- Skills load from `.claude/skills/`, generated copies of `.agents/skills/` (`npm run build`); edit the `.agents/` copy.
- Agents load from `.claude/agents/`, generated from `agents/` with `model` and `tools` in Claude's dialect; edit the source in `agents/`.
- The git guard is registered in `.claude/settings.json` as a `PreToolUse` hook on `Bash|PowerShell`; the code is `.agents/hooks/git-guard/git-guard.mjs`.

Setup, verification and gotchas for Claude Code: `docs/claude-code.md`.
