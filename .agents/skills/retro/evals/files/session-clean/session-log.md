# Session log: core-api rate limit on login (core-api#52), 2026-10-13

Condensed from the transcript.

1. Main read core-api#52 and the auth feature_readme. No UI, no contract change: skipped architect and designer.
2. Dispatched backend-engineer with the issue, the fastify-architecture skill and the account-existence leak contract in the brief. It added a Redis-backed limiter in `features/auth/adapters/redis-login-limiter.ts` behind a `LoginLimiter` port, with unit and `*.redis.test.ts` tests.
3. Main re-ran lint, typecheck, unit tests and the Redis suite with REDIS_TEST_URL set: green.
4. security-engineer reviewed: no findings.
5. `/code-review high` found two nitpicks (a log field name, a test description); fixed. A medium pass found nothing.
6. Main typed `npm run tset`, got "missing script", re-typed `npm run test`.
7. PR core-api#53 merged; restart-stack.sh run; signed-in login checked on the local stack.
