# Running the skill evals

Each skill in `.agents/skills/` carries `evals/evals.json` in skill-creator's schema (prompt, expected output, `expectations`, input `files` relative to the skill root), plus a `sandbox` field this repo adds. skill-creator does not read `sandbox`; whoever runs the evals does, before spawning any run. Several prompts ("put up a PR", "go ahead with the plan", "do a retro") act on git and GitHub, so a run that skips its sandbox acts on whatever checkout it starts in.

## Before each run

1. Pick a fresh work path per run, outside any real checkout.
2. Build its inputs as the eval's `sandbox` says:
   - architecture skills: create `<work>` and copy `evals/files/*` into `<work>/files/` (the prompts say `files/review.diff`);
   - `open-pr`, `resolve-pr-comments`: run the `setup` command with a `<work>` path that does not exist yet; `setup.sh` creates it, refuses an existing one, and is never shown to the agent, since it spells out the planted answers;
   - `merge-gate`: copy the eval's files flat into `<work>/` (the prompts say `pr-state.md` or `findings.md`);
   - `dependency-audit`: copy the eval's files flat into `<work>/` (the prompts say `audit-report.json`, the helper's output, and `open-issues.json`); the agent runs neither the helper nor npm;
   - `retro`: copy the eval's files into `<work>/`, then `mkdir -p <work>/config-repo && git archive origin/main -- . ':(exclude).agents/skills/*/evals/*' | tar -x -C <work>/config-repo`. The exclude keeps every eval's expectations, this one's included, out of the agent's reach.
3. Put the sandbox's rules in the run's prompt: the work directory, that `gh` and `/code-review` are not available and stand in through `gh-fixtures/` or `open-issues.json`, and that the final message lists every command it would have run. Nothing else stops a run from calling the real `gh`.

## Comparing versions

Run every prompt twice in the same turn: with the skill (the agent reads the `SKILL.md` under test), and without (no skill and no `SKILL.md` read). When improving a skill, snapshot it first and use the snapshot as the baseline. The architecture skills ran on Sonnet, because the implementation agents that load them do; the process skills ran on the session's model.

Subagents may not write report files: save each run's final message as `outputs/report.md` (or `review.md`) yourself, then grade every expectation with quoted evidence, aggregate with skill-creator's `aggregate_benchmark` (it expects `eval-*/<config>/run-*/grading.json`), and open `eval-viewer/generate_review.py --static <file>`. On Windows set `PYTHONUTF8=1` for the viewer.

## What a result means

The standards (`AGENTS.md`) load into every run, baseline included, so a skill's score is what it adds on top of it. An expectation that passes in both configurations does not test the skill; replace it with a harder case before relying on that eval to judge an edit.
