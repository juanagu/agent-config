# Making it yours

The standards are one person's defaults. The mechanics (one source, a build, a hook, an installer) are the part meant to be reused as they are; the content is the part meant to be edited. Fork, change the content, keep the tests green.

## Fork first

1. Fork `juanagu/agent-config` and clone the fork.
2. Change `repository` in `package.json` to `github:<you>/agent-config`. `npx -y github:<you>/agent-config` now bootstraps your fork, and the `open-pr` skill's "push without asking" rule names your repo.
3. Search `AGENTS.md`, `.agents/skills/open-pr/SKILL.md` and `.agents/skills/retro/SKILL.md` for `juanagu/agent-config` and replace it.
4. Run `npm test`.

## What to change, in order of likelihood

| You want to | Edit | Then |
| --- | --- | --- |
| A different default stack | `AGENTS.md` → Default stack, Design; drop or replace the `*-architecture` skills you do not use | `npm test` (the skills test checks that the names you mention exist) |
| A different workflow (no trunk-based, no PR gate) | `AGENTS.md` → Workflow; the git guard's rules in `.agents/hooks/git-guard/git-guard.mjs` and its tests | `npm test` |
| Fewer agents | delete from `agents/`, remove the row in `AGENTS.md` → Agents | `npm run build && npm test` |
| An agent's behaviour | its file in `agents/` | `npm run build` (the per-tool copies are generated) |
| An agent's model on one tool | the tool's row of `AGENT_TARGETS` in `scripts/build/targets.mjs` | `npm run build` |
| A new skill | `.agents/skills/<name>/SKILL.md`, `name` equal to the folder, with an `evals/evals.json` (see `docs/skill-evals.md`) | `npm run build` copies it for Claude Code |
| A third-party skill | add `<github repo> <skill name>` to `skills.txt`, or to `skills.optional.txt` with a description | the global installer installs it on the next run |
| A new hook | a new folder under `.agents/hooks/` with tests, a row per tool in `HOOK_TARGETS` | `npm run build && npm test` |
| Support for another tool | a row in `AGENT_TARGETS` and `HOOK_TARGETS`, an adapter in the hook, a guide in `docs/`, a row in `docs/compatibility.md` | `npm run build && npm test` |

## Rules the tests enforce

- Every agent source has `name` (its file name), `description`, `tier` (`judgment` or `implementation`), `access` (`read` or `write`); `effort` and `color`, if present, use the documented values; no `model` or `tools` key (the build derives them).
- Every `§N` pointer in the prose names a section that exists; every agent-like name (`*-engineer`, `designer`, ...) and every `*-architecture` skill name points at a file that exists; every architecture skill's description names the sibling skills it is not for.
- Every skill has `evals/evals.json` in skill-creator's schema with a sandbox note.
- Every generated file is what the sources produce (`node scripts/build.mjs --check`).
- The hook refuses and allows exactly the forms its tests spell out, in every tool's payload shape.

## Adding an agent

```md
---
name: data-engineer
description: "Use for pipelines, warehouse models and dbt projects: ... Not for application code (backend-engineer)."
tier: implementation
access: write
effort: medium
color: green
---

You implement data pipelines. The standards (`AGENTS.md`) define the general code principles; ...
```

Write the body in the standards' vocabulary (agent, skill, review pass, load the skill), never a tool's command or built-in tool name, because the same body is installed in four tools. End with the four-section report the other agents use (changed, verified, deviations, needs the user). Then add it to the roster in `AGENTS.md` → Agents and run `npm run build && npm test`.

## Keeping a fork in sync

Add this repo as `upstream` and merge it when it changes; the content files you edited will conflict, the mechanics will not. The compatibility matrix and the hook adapters are the pieces worth pulling, because they track the tools' format changes.
