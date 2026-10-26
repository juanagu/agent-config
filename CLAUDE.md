@AGENTS.md

## Claude Code specifics

- The review pass is `/code-review <level>` (`low|medium|high`), run from the main session; the `code-reviewer` agent is for tools without one.
- Skills load from `.claude/skills/`, generated copies of `.agents/skills/` (`npm run build`); edit the `.agents/` copy.
- Agents load from `.claude/agents/`, generated from `agents/` with `model` and `tools` in Claude's dialect; edit the source in `agents/`.
- The git guard is registered in `.claude/settings.json` as a `PreToolUse` hook on `Bash|PowerShell`; the code is `.agents/hooks/git-guard/git-guard.mjs`.
- **A turn that hands control back to the user ends with a context hint** when the conversation has grown long: a finished task, or a stop for the user to test, approve or decide. The last line names the command to type, which only the user can run: `/clear` when the task is done and what matters is in the repo or its issues; `/compact keep: <branch, worktree path, what is being tested, what changed>` when the work continues after the user's step. Leave it out of a short conversation. Why: a long session re-reads its whole context on every turn, and a `/compact` without a focus can drop the details a failed test needs.

Setup, verification and gotchas for Claude Code: `docs/claude-code.md`.
