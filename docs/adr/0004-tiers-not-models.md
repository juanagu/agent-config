# ADR 0004: Agents name a tier, not a model

Date: 2026-10-15. Status: accepted.

## Context

`claude-code-config` had each agent name its model as a Claude family alias (`opus`, `sonnet`), chosen by the cost of being wrong: the strongest family where only a person checks the output (scope, boundaries, placement, a threat model), a cheaper one where lint, tests and a review catch mistakes (implementation, tests, docs). A model name means nothing to Cursor, Copilot or Antigravity, and even within one vendor it goes stale.

## Decision

The source frontmatter carries `tier: judgment | implementation` and `access: read | write`. `scripts/build/targets.mjs` maps each to a tool's dialect: Claude Code `opus`/`sonnet` with the matching `tools` list; Cursor `model: inherit` with `readonly: true` for read access; Copilot a `tools` list and no `model`; Antigravity `pro`/`inherit`. The standards' Agents section explains the tiers; `tests/agents.test.mjs` refuses a source with a `model` or `tools` key.

## Alternatives

- **Model names per tool in each agent file.** Rejected: thirteen files to touch whenever one vendor renames a model, and a user who wants a different mapping edits thirteen files.
- **No model information at all.** Rejected: the cost-of-being-wrong reasoning is one of the setup's more useful rules, and Claude Code and Antigravity can act on it.

## Consequences

- Changing which model a tier runs on is one line in `targets.mjs` and a rebuild.
- On Cursor and Copilot an agent runs on whatever the user picked; the guides say how to pin one in a fork.
- `effort` and `color` stay in the source as optional keys; only Claude Code consumes them today, and the build drops them elsewhere.
