# ADR 0003: Antigravity CLI is the Google target, not Gemini CLI

Date: 2026-10-15. Status: accepted.

## Context

The request was support for "Gemini". On June 18, 2026 Google replaced Gemini CLI with Antigravity CLI (`agy`) for free-tier, Google One and AI Pro/Ultra accounts; Gemini CLI stopped serving requests for them. Antigravity CLI reads `AGENTS.md`, skills from `.agents/skills/`, subagents from `.agents/agents/`, and hooks from `.agents/hooks.json` with `PreToolUse` on a `run_command` tool and a `{"decision":"deny","reason"}` answer. Gemini CLI read `GEMINI.md` (or `AGENTS.md` through a setting), skills from `.gemini/skills/` or `.agents/skills/`, subagents from `.gemini/agents/`, and hooks from `settings.json` with `BeforeTool` on `run_shell_command`. The two hook schemas are not compatible.

## Decision

Support Antigravity CLI only. No `GEMINI.md`, no `.gemini/` folder, no Gemini CLI hook adapter.

## Alternatives

- **Both, with Gemini CLI marked legacy.** Rejected by the maintainer: an adapter and a registration for a tool most accounts cannot run is surface to keep verified for no users.
- **Gemini CLI only.** Rejected: it would target a retired tool.

## Consequences

- `docs/compatibility.md` records the facts above so a reader who still runs Gemini CLI knows what already works there (the standards, via `context.fileName`; the skills) and what would need an adapter.
- If Google's docs move again (they moved once during this work, from `/docs/cli/*` to `/docs/*?tab=cli`), the compatibility matrix is where the new links go.
