# ADR 0001: One source of truth, four tool dialects

Date: 2026-10-15. Status: accepted.

## Context

`claude-code-config` held engineering standards, an agent roster, skills and a hook, all in Claude Code's formats, installed by linking `~/.claude` into the clone. People on Cursor, GitHub Copilot and Google's CLI could read it but not use it. By October 2026 the four tools had converged on enough shared ground to make one repo serve all of them: every one reads `AGENTS.md`, every one implements the Agent Skills standard, three of them read `.agents/skills/` directly, every one has a Markdown-with-frontmatter subagent format and a pre-shell-command hook.

What did not converge: the subagent frontmatter keys (model names, tool names, `readonly`), the hook payload and decision shapes, and the review command (`/code-review` exists only in Claude Code).

## Decision

- The standards are written once, in `AGENTS.md`, in a neutral vocabulary defined at its top (agent, skill, dispatch, review pass, hook). `CLAUDE.md` is a one-line import plus Claude-only notes.
- Skills live once, in `.agents/skills/`, in the standard's format with no tool-specific keys.
- Agents are written once, in `agents/`, with neutral frontmatter (`tier`, `access`) and a body in the neutral vocabulary; `scripts/build.mjs` writes each tool's dialect from a table in `scripts/build/targets.mjs`. Generated files are committed and a test fails when they are stale.
- The hook has one core (`check(command, cwd)`) and one adapter per tool, selected by `--tool`; the registrations are generated from the same table.
- A `code-reviewer` agent is the review pass where no command exists; the standards say "review pass" and each tool's guide says what that is there.

## Alternatives

- **Four repos, or four branches.** Rejected: every rule change would be made four times, and the first one skipped is where they diverge.
- **A build that generates the standards per tool too.** Rejected: `AGENTS.md` is read by all four as it is; generating it would add a step for no reader.
- **Only `.claude/` files, relying on Cursor's and Copilot's compatibility reads.** Rejected: Antigravity reads neither, and a Claude-dialect `model: opus` in a Cursor agent is at best ignored. The per-tool folders cost a build step and buy predictable loading.

## Consequences

- Content edits happen in three places only: `AGENTS.md`, `agents/`, `.agents/skills/`. Everything under `.claude/`, `.cursor/`, `.github/agents/`, `.github/hooks/` and `.agents/agents/` is generated.
- Supporting a fifth tool is a table row, a hook adapter, a guide and a compatibility row.
- Each tool's loading rules are facts that go stale; `docs/compatibility.md` carries the verification date and the documentation links, and is the first thing to check when something stops loading.
