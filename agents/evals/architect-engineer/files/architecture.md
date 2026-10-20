# Parcelo: current architecture

Parcelo lets small shops print shipping labels and track parcels.

## Services

- `parcelo-web` (Next.js 16, App Router). Server Components and route handlers call `parcelo-core` directly over HTTP. It is the only client today.
- `parcelo-core` (Fastify + TypeScript, MongoDB, BullMQ worker). Owns shops, parcels, labels and tracking events. Exposes a REST API under `/v1/*`.
- Auth: one iron-session cookie, issued by `parcelo-core` at login and validated by `parcelo-core` on every request. The web app forwards the cookie unchanged. There is a single session model.

## How the web app talks to core today

Each web feature has a `lib/` module of narrow functions (`features/parcels/lib/core-parcels.ts`) wrapping `fetch` to core and returning typed results. Pages never call `fetch` to core directly.

## Roadmap facts (from the product plan)

- A mobile app is "maybe in 12+ months"; nobody has started it, no design exists, no platform chosen.
- The team is two engineers. Traffic is about 300 requests per minute at peak.
- No page needs data from anything other than `parcelo-core`.

## Decision records

ADRs live in `docs/adr/`, named `NNNN-short-title.md`, with the sections Context, Decision, Consequences. The latest is `0004-use-bullmq-for-label-generation.md`, so the next number is 0005.
