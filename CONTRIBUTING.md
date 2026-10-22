# Contributing

Fixes to the mechanics (the build, the installer, the hook, the compatibility matrix) are welcome from anyone. Changes to the content (the standards, the agents' rules, the skills) are one person's defaults; open an issue first if you think a rule is wrong for everyone, or fork if it is wrong for you ([docs/customizing.md](docs/customizing.md)).

## Setup

```sh
git clone https://github.com/juanagu/agent-config
cd agent-config
npm install   # no dependencies; it installs the pre-push hook
npm test
```

Node.js 22+ and `git` are the only requirements. The pre-push hook (`.githooks/pre-push`, the repo's own copy of `templates/pre-push`) runs `npm test` before a push, because the repo has no CI and the local run is the gate.

## Where things live

| Change | Edit | Then |
| --- | --- | --- |
| a rule | `AGENTS.md` | `npm test` |
| an agent | `agents/<name>.md` (never a file under `.claude/`, `.cursor/`, `.github/agents/` or `.agents/agents/`: those are generated) | `npm run build && npm test`; for a change to its behaviour or description, run its evals before and after ([docs/agent-evals.md](docs/agent-evals.md)) |
| a skill | `.agents/skills/<name>/` (never `.claude/skills/`) | `npm run build && npm test` |
| how a tool's agent file is written | `scripts/build/targets.mjs` → `AGENT_TARGETS` | `npm run build && npm test` |
| the hook's rules | `.agents/hooks/git-guard/git-guard.mjs`, test first in `git-guard.test.mjs`, with the spellings [docs/git-guard.md](docs/git-guard.md) lists | `npm test` |
| the dependency-audit nudge | `.agents/hooks/audit-nudge/audit-nudge.mjs` (each tool's answer), its registration in `scripts/install/nudge.mjs`; tests in `tests/audit-nudge.test.mjs` and `tests/install.test.mjs` | `npm test` |
| how a tool registers or answers the hook | `scripts/build/targets.mjs` → `HOOK_TARGETS`; the adapter in `git-guard.mjs` | `npm run build && npm test` |
| what a tool reads | `docs/compatibility.md`, with the documentation link and today's date | |
| the installer | `scripts/install.mjs`, `scripts/install/*`, tests in `tests/install.test.mjs` | `npm test` |
| the README's images | `docs/assets/*.svg`, plain SVG edited by hand. `tests/readme-assets.test.mjs` pins the tool names, the agent and skill counts and the build output they show; redraw `pipeline.svg` or `git-guard.svg` by hand when the pipeline in `AGENTS.md` or the hook's messages change | `npm test`, then view the README on your branch on GitHub, in light and dark |

## A tool changed its format

This is the most useful contribution. Tools move their folders and rename their keys every few months.

1. Find the current documentation page and read the exact shape.
2. Update the row in `docs/compatibility.md` with the link and the date.
3. Change `scripts/build/targets.mjs` (agents or hook registration) or the adapter in `git-guard.mjs` (payload or answer), with a test that pins the new shape.
4. `npm run build && npm test`.
5. In the PR, paste the payload or file you observed, so the next person can check it against theirs.

## Adding a tool

A tool is supported when all of these exist:

- a row in `AGENT_TARGETS` (where its agent file goes and what frontmatter it takes) and in `HOOK_TARGETS` (its registration file and shape);
- an adapter in `.agents/hooks/git-guard/git-guard.mjs` (where the command and `cwd` are in its payload, how it is denied) with a `describe` block in the tests;
- an entry in `scripts/install/targets.mjs` for the global installer, where the tool documents user-level folders;
- `docs/<tool>.md`, following the four existing guides (install, what loads where, using it, check it worked, gotchas);
- a row in every table of `docs/compatibility.md` and a column in the Vocabulary table of `AGENTS.md`.

## Pull requests

- Short-lived branch off `main`, one concern per PR, conventional commit messages. The git guard in this repo will stop you from committing on `main`.
- `npm test` green locally; the repo has no CI on purpose, so the local run is the gate.
- A content change to `AGENTS.md` or an agent says in the PR what slipped without it, or which rule it replaces. "It reads better" is a reason for a docs PR, not a rules PR.
- Generated files are committed; the test tells you when to run `npm run build`.

## Reporting a problem

Open an issue with: the tool and its version, the command you ran, what you expected to load and what did, and for a hook problem the payload (`docs/copilot.md` shows how to capture one). "It doesn't work" with a version number is more useful than a guess at the cause.
