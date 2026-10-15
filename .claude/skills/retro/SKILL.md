---
name: "retro"
description: "Retrospective on how the setup (AGENTS.md, agents, skills, hooks, a repo's checks) let something slip, ending in proposed fixes filed as issues. Trigger at the end of a feature pipeline when something slipped: a review or CI found what an earlier stage should have caught, the user corrected an approach, a gate was skipped, an agent's claim didn't hold, or time went into finding something the docs should have pointed at. Also when the user asks for a retro. Not for reviewing code (use code-review) or a product post-mortem."
---

# Retro

Improve the environment so the next session doesn't repeat this one's slip. The output is proposals the user approves, never direct edits to the setup: `AGENTS.md` and the agent files load into every session, and rules added in the moment bloat them.

Run it in the main session. The evidence is the conversation (the corrections, the review findings, the red CI after green local runs), and an agent would only see a retelling of it.

## Steps

1. **List the slips.** For each one write: what happened, which pipeline stage should have caught it, and which of these let it through:
   - **no rule**: nothing in the setup covers it;
   - **rule not reached**: it exists, but in a file the agent that needed it never loaded (wrong agent, a skill that wasn't invoked, a brief that didn't carry it);
   - **rule ignored**: it was in context and not followed;
   - **check not run**: a lint, test or hook exists but is unwired, broken, or was skipped;
   - **missing access**: the information needed (logs, a schema, a running service) wasn't reachable;
   - **navigation**: the answer existed but took a long search to find.
   Skip one-off slips that were noticed and fixed in seconds and are unlikely to recur.

2. **Look for the existing mechanism first.** Read the repo's `package.json` scripts, CI workflow, lint config and hooks, and the agent-config repo's `AGENTS.md`, agents and skills. A check that exists but isn't wired, or a rule in the wrong file, is the finding. Don't add a second copy.

3. **Pick the strongest fix that works**, in this order:
   1. A **hook, lint rule or test**, for anything mechanical: a banned API, an import shape, a file location, a command that must or must not run. Build the check instead of writing the rule.
   2. A line in the **skill or agent file** where the work happens: a stack skill's checklist, an agent's non-negotiables, a review brief.
   3. A **navigation pointer**: one line in a project's `AGENTS.md` or a doc saying where something lives.
   4. A sentence in the global **`AGENTS.md`**, only for judgement calls that apply across projects. Say what it replaces or why nothing smaller works.
   Also propose a **removal** when a rule was in context and didn't change anything, or when the new check makes a sentence redundant.

4. **File each fix as an issue** where the change lands: the agent-config repo (`juanagu/agent-config`) for `AGENTS.md`, agents, skills and hooks; the project's repo for its lint, tests, CI or docs (and add it to that project's board where it has one). Each issue has a title naming the fix, not the incident, plus:
   - **What slipped**: two or three lines, with the PR, issue or commit that shows it;
   - **Why it got through**: the category from step 1;
   - **Proposed fix**: the file and the literal change, or the check and what it fails on;
   - **What it replaces**, if anything.
   Search open issues first and comment on an existing one rather than opening a duplicate.

5. **Report** the issues, most severe first, one line each with its link. Implement one only when the user approves it, on its own branch.
