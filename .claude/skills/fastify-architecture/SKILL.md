---
name: "fastify-architecture"
description: "The architecture every Fastify service in this setup follows, in its three roles (API/microservice, BFF, BullMQ worker): routes → thin controller → use-cases → ports → adapters, one feature plugin per bounded area, schema validation on every route, typed errors mapped by one handler, MongoDB behind repositories, idempotent job processors, and the test layout. Invoke before writing, reviewing or planning any code under a Fastify project (src/, features/, tests/), and when deciding where a new file goes. Not for Next.js/Astro (nextjs-architecture), Flutter (flutter-architecture), native Android (android-architecture), native iOS (ios-architecture) or React Native (react-native-architecture)."
---

# Fastify architecture

When a project has its own `docs/architecture.md`, that doc wins on specifics; this skill is the default shape and the checklist. `architect-engineer` decides whether a piece of work is an API, a BFF or a job; this skill says how each is built.

## 1. Layers and the dependency rule

Routes → controller (thin) → use-cases/services → ports → adapters (Mongo repositories, HTTP clients, queues). Use-cases never import Fastify types and are testable without a server. Inner layers never import outer ones.

```
src/
  app.ts                    builds the Fastify instance: plugins, error handler, feature registration (the composition root)
  config/                   env parsing; fails fast at startup when required config is missing
  shared/                   transport (HTTP client, signed caller headers, timeouts), the error envelope, logger, session codec; never imports a feature
  features/<feature>/
    routes.ts               registration + schemas only (schemas.ts once they grow); a plugin whose body only registers routes
    controller.ts           handlers: read validated input → call a use-case → shape the reply
    service/                use-cases, framework-free
    domain/                 entity types and the rules over them, when there are real ones
    ports/                  interfaces the use-cases depend on, only the operations this feature uses, with their request/response types
    adapters/               Mongo repositories, clients for other services, over the shared transport; the document types beside their repositories, and the seeds and migrations
    data/                   static reference data (catalogues, presets), importing only `domain/` types; not the `data/` layer of the Android and Flutter skills
    jobs/                   BullMQ queue, processor, worker
    feature_readme.md
```

File names are kebab-case: `adapters/http-core-api-auth.ts` exports `HttpCoreApiAuth`, `service/complete-google-sign-in.ts` exports `completeGoogleSignIn`, tests keep the dotted suffix (`bullmq-account-jobs.redis.test.ts`). ESLint enforces it with `unicorn/filename-case` (`kebabCase`).

Folders appear when they have content: no empty `domain/`, no pass-through `service/` that only forwards. A plugin's options name the feature's port type, never a client with every operation in the system.

Where the types live:

- `domain/` imports only its own `domain/` and the type-only modules of `shared/` (identity types, the typed-error base class): no driver, no Fastify, no transport, logger or session codec, no adapter, no `data/`. Where the repo runs `eslint-plugin-boundaries`, it is an element type whose rule allows only those imports.
- `data/` imports only `domain/` types. Use-cases in `service/` and the seeds in `adapters/` read it directly, as constants, never through a port; a domain rule gets the values handed to it.
- The document type (`UserDocument`) lives beside its repository and holds `_id`, timestamps the database sets, leases, claims and schema versions. One function maps a full document to the entity, whose `id` comes from `_id`; a projected read returns the port's own response type, declared in `ports/`.
- A timestamp a rule reads (a retention window, an abandonment cutoff) is an entity field; one nothing reads stays on the document.

Why: a domain folder of bare shapes that mirror the collection is a data layer under another name, and every later use-case reads the storage shape instead of the entity.

## 2. Rules that fail a review

- Every route validates input and output with a schema (JSON Schema or Zod). Never read `request.body`, `params` or `query` unvalidated.
- Controllers hold no business logic and no data access, and never catch an error to map it to a status: they throw typed errors and one central error handler maps them to the envelope. A catch that turns a failure into a deliberate non-error outcome (an always-`200` endpoint, a redirect on OAuth failure) is a use-case decision and lives in the service, named for what it does.
- Response and error-envelope shapes a client depends on are contracts: changing one is a tracked change with its own issue and the client updated together.
- A service owns one bounded context and its own database, and reaches others only through their APIs or a queue. Never read another service's database.
- Config and secrets from env vars; `.env` ignored, `.env.example` committed with keys and no values.
- Logging is structured (the Fastify logger), never `console.log`, never secrets or PII.
- Session checks make zero network calls; a stateless service verifies the request on its own.
- A domain type carries no field that no use-case reads, and a domain file never describes itself as a document, a collection or a row: storage shapes are the adapter's, wire shapes the route schema's.
- A service module exports one use-case function, with its own input and result types. A service class, where a repo already has them, exposes at most about eight public methods; past that it holds several use-cases: a new use-case goes in its own `service/<use-case>.ts` beside it, and the split is an issue, never a side effect of adding a method. One reason to change per module is the principle; the method count is what a review can check.

## 3. BFF

- Same layering and validation; the service layer shapes, aggregates and translates auth/session. Domain logic stays in the services it calls.
- A route that only forwards one upstream call needs no `service/`: its controller calls the feature's port directly. Add `service/` when there is shaping, aggregation or a deliberate outcome rule.
- Each feature owns its upstream calls: `ports/` declares only the calls that feature makes with their types; `adapters/` implements them over the shared transport. One client with every upstream operation injected everywhere is the anti-pattern this replaces.
- Upstream errors are relayed by throwing (`UpstreamHttpError(status, body)`); the central handler relays through the envelope's allow-list of statuses and fields, in the route's existing envelope shape. Never return `{ ok, status }` from an adapter.
- No database of its own beyond an optional short-TTL cache. Source-of-truth data in a BFF means it has become a microservice: flag it.
- One BFF per client surface; its feature folders mirror the client's features, not the backend's internals.
- Account-existence leak prevention where it applies: reset and resend endpoints always return the same success shape, bad tokens get one generic `401`, login never distinguishes unknown email from wrong password.

## 4. MongoDB

- Only `adapters/` imports the driver or ODM: repositories, and the seeds and migrations beside them. Explicit schema validation (Mongoose, Zod or JSON Schema). The document type and its mapping: §1.
- Projections instead of full documents; index the fields you query or sort on and say so in the repository.
- Never build queries from unsanitized user input (operator injection).
- One logical database per service.

## 5. BullMQ and Redis

- Queue names `<domain>.<action>` (`orders.send-confirmation-email`); queue, processor and worker under the feature's `jobs/`.
- Processors are idempotent: retries and redelivery must not double-charge or double-send; use a dedupe key where the operation is not naturally idempotent.
- Explicit `attempts` and backoff per job type, chosen for what the job does. Validate job payloads like HTTP input.
- Workers run as their own process in production (`npm run dev:worker` locally; emails don't send without it). Failed jobs need visibility (dead-letter queue, alerting or Bull Board).
- Queue it when the operation is slow, tolerates eventual completion, needs retries or must not block the response; keep it synchronous when the caller needs the result to proceed.

## 6. Tests and checks

```
tests/ (or alongside features)
  unit:         services/use-cases with the repository mocked behind its interface (vitest)
  integration:  repositories against mongodb-memory-server or a test MongoDB; routes through fastify.inject
  jobs:         processors unit-tested; *.redis.test.ts suites against a real Redis, run when REDIS_TEST_URL is set (CI sets it); cover success, the retry path (a throw keeps the job retryable) and idempotency
```

Before reporting work done: lint, typecheck, unit and fast integration tests, a build. A change that crosses a service boundary gets a signed-in pass on the real local stack reading a record with data in it; health endpoints and fakes prove nothing about the boundary. After a merge or a dependency change, restart the stack before verifying against it.

## 7. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| Handler maps an error to a status inline | Throw a typed error; the central handler maps it |
| `routes.ts` holding handlers, error mapping and upstream calls | `routes.ts` registers; `controller.ts` handles; `adapters/` call |
| One upstream client with every operation injected into every feature | `ports/` per feature with only its calls |
| Adapter returning `{ ok, status, body }` | Throw `UpstreamHttpError`; relay through the envelope |
| `HttpCoreApiAuth.ts`, `sessionGuard.ts`: file named after its symbol | `http-core-api-auth.ts`, `session-guard.ts`; the export keeps its name |
| A BFF with its own collection of source-of-truth data | It is a microservice now; flag the boundary |
| `request.body` used without a schema | A schema on the route, input and output |
| `domain/user.ts` typed as the Mongo document, `_id` and all, or commented as "the document shape" | `User` in `domain/` with what use-cases read; `UserDocument` beside the repository, mapped in one function |
| One `PostService` with twenty public methods: reads, transitions, claims, events | One module per use-case under `service/`, each exporting one function over the ports it needs |
| A processor that re-sends on retry | Dedupe key or an idempotent write |
| Logging the request body with credentials | Structured log of ids and outcomes only |

## Checklist for a review brief

1. Layering respected: no Fastify types in services, no data access in controllers, no feature importing another feature's internals, `shared/` importing no feature; `domain/` holds entities and rules only, with storage shapes beside the repositories and wire shapes in route schemas.
2. Every route has input and output schemas.
3. Errors thrown as typed errors and mapped centrally; envelope shapes unchanged unless the issue says so.
4. Each feature's `ports/` declares only what it uses; plugins receive the narrow port type.
5. Only `adapters/` touches the driver (repositories, seeds, migrations); queries never built from raw input.
6. Jobs are idempotent with explicit retry policy and payload validation.
7. Tests: unit with mocked ports, repositories against a real MongoDB, routes via `inject`, jobs against real Redis.
8. Files ~300 lines, functions ~40; a new use-case is one function per module, an existing service class ~8 public methods; a routes plugin that only registers is exempt.
9. File names kebab-case, test suffixes dotted; `unicorn/filename-case` green.
