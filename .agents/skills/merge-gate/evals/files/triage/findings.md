# Medium pass on PR #91 — fix(auth): refresh session on role change

Repo: acme/bff (Fastify BFF). Main paths: sign-in, sign-out, the session refresh flow in docs/features/auth.md, and the published contract.

1. CONFIRMED — `src/features/session/refresh-session.ts:37` — after a role change the refreshed cookie keeps the old `roles` array because the handler re-reads the session before the write commits. Failure: user promoted to admin still gets 403 on /admin until they sign out. Category: correctness.
2. PLAUSIBLE — `src/features/session/session-plugin.ts:22` — "the cookie might be set without SameSite when NODE_ENV is unset". Reviewer could not run the plugin. Category: security.
3. CONFIRMED — `src/features/session/refresh-session.ts:58` — a refresh request that arrives with a cookie older than 6 years overflows the `maxAge` arithmetic and sets a cookie with a past expiry. Category: correctness.
4. PLAUSIBLE — "the refresh should be a POST, not a PATCH". Round 1 settled PATCH, recorded in the PR description. Category: contract.
