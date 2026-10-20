---
name: "merge-gate"
description: "The review loop and the merge gate: when a branch's review has converged, which findings get fixed in the PR and which go to a follow-up issue, when to stop and bring the user the list, and the three conditions for merging (converged review, green CI on the last push, your own re-run of the checks). Trigger before running review passes on a branch or PR, when deciding whether another review round is needed, and before merging any PR in a project that grants the agent merge rights. Not for opening a PR (open-pr), answering reviewer comments (resolve-pr-comments) or writing a review (code-review)."
---

# Merge gate

Merging is the user's call unless their standards grant it to the agent. Where they do, this is the gate. It exists because a PR merged on a hunch ("CI is probably fine", "one more pass would find nothing") is how a broken main reaches a demo.

## The review loop is bounded

- **A main path** is one a documented user flow, a smoke spec or a published contract exercises; in a repo with none of those (the agent-config repo, a hook, a library) it is the behaviour the tests and the PR description claim. Everything else is a rare path.
- **Treat a finding as unverified** unless it carries a `CONFIRMED` verdict, and verify it before acting on it.
- **A verified bug on a main path is fixed in the PR.** A new edge case on a rare path, or a finding that only re-litigates a judgment call an earlier pass settled, goes to a tracked follow-up issue instead of another round.
- **Converged** means every main-path correctness bug a high pass found is fixed (rare-path ones are in follow-up issues, as above), and a medium pass then reports no verified correctness bugs on the main paths. High passes always find nitpicks, so they never converge on their own and are never the last pass before a merge.
- **After two medium rounds that still find new main-path bugs, stop** and bring the user the remaining list with a recommendation: merge behind a flag, simplify, or keep going.

## Merge only after all three

1. **The review loop has converged**, as above.
2. **The PR's CI (the fast tier) has finished green on its last push**, if the repo has CI and the push triggered a run. No run counts as green only when every changed file is one the workflow's `paths` filter excludes; a workflow file that fails to parse also produces no run, and that is red. A pending run means keep waiting, because a wait that times out is never a reason to merge.
3. **You've re-run the checks yourself**, the e2e specs the change touches included. Where the repo vendors another service's contract, fetch the producer clone (`git -C <producer clone> fetch`), then re-run `contracts:check` right before merging: main may have moved since the last push, and drift on main blocks deploys. Order of producer and consumer changes: "Contracts aren't refactors" in the standards.

Then squash-merge and delete the branch.
