# Running the agent evals

Each agent in `agents/` has `agents/evals/<name>/evals.json`: behavioural evals in the same shape as the skills' (`docs/skill-evals.md`), with `agent_name` in place of `skill_name`, input `files` relative to the agent's eval folder, and a `dispatch` list that grades the agent's `description`. They answer one question before an agent file is changed: does the new wording do better than the old, or only read better?

## Before each run

1. Pick a fresh work path per run, outside any real checkout, and copy the eval's `files` into `<work>/files/`. The agent writes anything it produces (an ADR, a spec, a test) under `<work>/`; an eval that hands it a project slice says which files it may edit.
2. Put the sandbox's rules in the run's brief, as the eval's `sandbox` field states them: the work directory, that `gh`, the network, emulators and the user are unavailable, and that a question for the user ends the run in the final message. Nothing else stops a run from calling the real `gh`.
3. Dispatch the agent with its file as the system prompt, the way the tool under test loads it (Claude Code: the generated `.claude/agents/<name>.md`), and the eval's `prompt` as the brief. The agent sees nothing else, which is the point: a brief that only works with the session's history is a bad brief, not a bad agent.

## Comparing versions

Run every eval twice in the same turn, on the model the agent's tier maps to:

- **when changing an agent**: the current file (snapshot it first, e.g. `git show origin/main:agents/<name>.md`) against the edited one;
- **when judging what an agent adds**: the agent file against a general-purpose agent given the same brief and no agent file.

Save each run's final message as `outputs/report.md`, grade every expectation with quoted evidence (from the report or the files written), and aggregate as `docs/skill-evals.md` describes. An expectation that passes in both configurations does not test the agent file; replace it with a harder case before relying on that eval to judge an edit.

## Grading `dispatch`

`dispatch` grades routing: given the user's request in the main session, would the orchestrator hand it to this agent? Give a fresh session the request plus every agent's `description` (the same list the tool shows its orchestrator) and ask which agent, if any, it would dispatch, and why. A `should_dispatch: true` entry passes when it names this agent; a `false` entry passes when it names another agent or none. The false entries are near-misses on purpose (a neighbouring stack, a small single-file change, a review instead of a fix): a description that wins only the easy cases routes badly in practice.

## What a result means

`AGENTS.md` loads into every run, baseline included, so an agent's score is what its file adds on top of the standards and the skills it loads. Evals pin behaviour, not wording: a shorter file that keeps every expectation passing is an improvement. When `qa-engineer` was cut from about 2,100 words to 900, one run per eval scored 22/22 expectations with the old file and 21/22 with the new; the one miss (proposing a ticket for an unvalidated fake) is a sentence both versions carry, so read it as run-to-run variance and run more than once before trusting a one-point difference.
