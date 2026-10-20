---
name: "open-pr"
description: "Opens a pull request following this user's trunk-based-with-PR-gate workflow: verifies the branch is short-lived and off trunk, runs local checks, pushes, runs the review passes (Claude Code: /code-review; elsewhere the code-reviewer agent), writes a structured PR description, and creates it via gh. Trigger when the user asks to open/create a PR, put up a PR, or ship a branch for review. Do not trigger for reviewing an existing PR (use code-review) or for resolving review feedback (use resolve-pr-comments)."
---

# Open PR

Create a pull request that fits this user's trunk-based development model (see `AGENTS.md`, Workflow): short-lived branches, small diffs, PR review gate before merging to trunk, incomplete work shipped behind a feature flag rather than left in a long-lived branch.

## Quick start

1. Confirm current state: `git status`, `git branch --show-current`, `git log main..HEAD --oneline` (or the actual trunk branch name if not `main`).
2. If you're on trunk itself, stop and tell the user before anything else, uncommitted work included: a PR needs a branch, and committing first would put the work on trunk.
3. If there are uncommitted changes on the branch, handle them first (stage/commit using the `conventional-commit` skill) — don't open a PR with a dirty working tree.

## Workflow

### 1. Sanity-check branch size and age
- `git log main..HEAD --oneline | wc -l` (commit count) and glance at `git diff main...HEAD --stat` for file/line count.
- If the diff looks large (many unrelated files, or clearly multiple features bundled), flag it to the user before proceeding — trunk-based dev wants small, fast-to-review PRs. Suggest splitting if it's an easy call; otherwise proceed if the user confirms it's intentionally one unit of work.
- If the branch has been open a long time relative to its size (stale, likely to conflict), mention it — don't silently let long-lived branches become the norm.

### 2. Run local checks before pushing
- Run this project's lint/type-check/test commands if they exist (check `package.json` scripts, or the project's README, `AGENTS.md` or `CLAUDE.md` for the actual commands).
- Where the project has a Playwright suite, run `test:e2e:smoke` plus the specs that cover the changed code: every spec file under the same feature folder as a changed file, and every spec whose name shares a changed file's route or feature (`tests/e2e/<feature>*.spec.ts`). The PR's CI runs only the smoke set, so this is the only time the rest runs before release.
- If checks fail, fix them or stop and tell the user — don't open a PR on a known-broken branch.
- For non-trivial changes, run the `clean-code` skill or invoke `qa-engineer`/relevant agent per this repo's pipeline before considering the branch ready, if that hasn't already happened earlier in the task.

### 3. Push the branch
- If the project's standards (`AGENTS.md` or `CLAUDE.md`) grant the agent merge rights, push without asking: a project that lets you merge has already let you push. Otherwise confirm once per branch before `git push`, not per action within it.
- `git push -u origin <branch-name>`. The `git-guard` hook refuses a push to trunk or a force-push to it; if it fires, you are on the wrong branch, so fix that rather than retrying.
- **A PR opens reviewed** (`AGENTS.md`, Workflow). After the push, `git fetch` so `origin/main` is current, then run the review loop as the `merge-gate` skill bounds it (a review pass; Claude Code: `/code-review`, elsewhere the `code-reviewer` agent) from the main session, on the branch by its absolute worktree path when one exists; after each fix, re-run step 2 before pushing again. If you are a dispatched agent, stop here and report the pushed branch: the main session reviews and opens the PR. The Testing section of step 4 records the passes.

### 4. Write the PR description
Use conventional-commit-style semantics for the title (`type(scope): summary`, matching the `conventional-commit` skill's types). Structure the body as:

```markdown
## Summary
<1-3 bullets: what changed and why>

## Changes
<bullet list of the concrete changes, grouped by area/feature if it spans more than one>

## Testing
<how this was verified: tests added/run, manual verification steps, screenshots/GIFs for UI changes; the review passes run, with their level, and the findings deferred to issues>

## Feature flag
<if this ships incomplete work behind a flag per the trunk-based model: name the flag, its default state, and the rollout/cleanup plan. Omit this section entirely if no flag is involved.>

## Related
<issue links, e.g. "Closes #123", or omit if none>
```

Pull the actual summary/changes from `git log main..HEAD` and `git diff main...HEAD`, not from memory of the conversation — the diff is the source of truth for what's actually in the PR.

### 5. Create the PR
- `gh pr create --title "<type(scope): summary>" --body "<description from step 4>"`.
- Open it ready for review, never with `--draft` unless the user asks for a draft by name (`AGENTS.md`, Workflow): a draft runs the same fast tier and spends the same minutes, it only hides the PR from review.
- If the user mentioned specific reviewers or the repo has an obvious CODEOWNERS pattern, add `--reviewer`; otherwise skip it rather than guessing.
- Report the PR URL back to the user.

### 6. After opening
- The skill ends here. What remains of the `merge-gate` skill's gate is CI on the last push and your own re-run of the checks; merging is a separate step, taken only where the agent has merge rights and that gate is met, and otherwise the user's call.

## Notes
- If the user's repo doesn't use `main` as trunk (e.g. `master`, `trunk`), detect the actual default branch via `gh repo view --json defaultBranchRef` rather than assuming.
- Never force-push over a PR branch without explicit confirmation for that specific push.
