# PR #73 — feat(billing): proration on plan change

Repo: acme/billing-api (Fastify). The project's standards grant the agent merge rights. Main paths: the documented "change plan" flow and the published `responses.json` contract.

## Review history
- Round 1, high pass: 3 correctness bugs, all fixed in a81d0e2.
- Round 2, medium pass on a81d0e2: 1 CONFIRMED main-path bug — downgrade mid-cycle credits the full month instead of the unused days. Fixed in c40b9f1.
- Round 3, medium pass on c40b9f1: 1 new CONFIRMED main-path bug — an upgrade on the last day of the cycle charges a negative amount (`proration.ts:41`, `daysLeft` is 0 and the divisor becomes 0, producing -Infinity clamped to -1). Not fixed yet.

## `gh pr checks 73`
```
ci / fast    pass   3m02s
```
