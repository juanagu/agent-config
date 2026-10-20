# PR #58 — feat(notifications): unread badge in the header

Repo: acme/web-app (Next.js). The project's standards grant the agent merge rights.

## Review history
- Round 1, high pass: 2 correctness bugs (badge count off by one after mark-all-read; badge rendered for signed-out users), 5 nits. Both bugs fixed in 4f1c2aa.
- Round 2, medium pass on 4f1c2aa: "No verified correctness bugs on the main paths."

## Local checks (re-run by the session on 4f1c2aa, 12 minutes ago)
- `npm run lint` ok, `npm run typecheck` ok, `npm test` 214 passed
- `npx playwright test tests/e2e/header*.spec.ts` 8 passed (chromium, mobile-chromium)

## `gh pr checks 58` (just now)
```
ci / fast    pending   2m10s   https://github.com/acme/web-app/actions/runs/9911
```
