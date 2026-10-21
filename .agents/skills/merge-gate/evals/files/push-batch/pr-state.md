# PR #73 — fix(billing): retry a failed invoice read

Repo: acme/web-app (Next.js). The project's standards grant the agent merge rights and pushing. Worktree: /work/worktrees/web-app-wt-invoice-retry, branch fix/invoice-retry, tracking origin/fix/invoice-retry. The PR is open.

## Review history
- Round 1, high pass on the PR head 1a2b3c4 (pushed): 1 main-path bug (retry fires twice on a 502), fixed in 5d6e7f8 and pushed. CI green on 5d6e7f8.
- Round 2, high pass on 5d6e7f8: 1 main-path bug (the retry timer survives unmount), fixed in 9a0b1c2, committed, not pushed.

## `git log origin/fix/invoice-retry..HEAD`
```
9a0b1c2 fix(billing): clear the retry timer on unmount
```
