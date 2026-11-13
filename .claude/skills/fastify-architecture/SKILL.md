---
name: "fastify-architecture"
description: "The architecture every Fastify service in this setup follows, in its three roles (API/microservice, BFF, BullMQ worker): clean architecture inside feature folders, each feature split into domain/ (entities, value objects, use-cases, repository interfaces), data/ (repository implementations, models, mappers, clients, queues) and api/ (routes, schemas, controllers, middlewares, job processors), with core/ for app infrastructure and shared/ for cross-feature business code; schema validation on every route, typed errors mapped by one handler, MongoDB behind repositories, idempotent job processors, and the test layout. Invoke before writing, reviewing or planning any code under a Fastify project (src/, features/, tests/), and when deciding where a new file goes. Not for Next.js/Astro (nextjs-architecture), Flutter (flutter-architecture), native Android (android-architecture), native iOS (ios-architecture) or React Native (react-native-architecture)."
---

# Fastify architecture

When a project has its own `docs/architecture.md`, that doc wins on specifics; this skill is the default shape and the checklist. `architect-engineer` decides whether a piece of work is an API, a BFF or a job; this skill says how each is built.

## 1. Layers and the dependency rule

Clean architecture inside each feature, in three layers. `domain/` is the business: entities, value objects, use-cases and the interfaces of everything the use-cases call out to. `data/` implements those interfaces against the outside world: MongoDB, other services, queues. `api/` is how the outside world reaches the feature: HTTP routes and the BullMQ processors that drive its use-cases. Dependencies point inwards: `api/` and `data/` import `domain/`, `domain/` imports neither, and only the feature's composition root wires `data/` into `api/` (the one exception is a queue's definition, §5).

The rule that sorts the outer two: **inbound goes in `api/`, outbound goes in `data/`.** A controller and a job processor are inbound (something calls the feature). A repository, a client for another service (a BFF's "proxy") and a queue producer are outbound (the feature calls something).

```
src/
  app.ts                      the HTTP composition root: core plugins, then every create-<feature>.ts
  worker.ts                   the worker process's composition root: every create-<feature>-worker.ts
  core/                       app infrastructure with no business meaning; imports nothing outside core/
    config/                   env parsing; fails fast at startup when required config is missing
    errors/                   typed error base classes (NotFoundError, ConflictError, UpstreamHttpError); pure, no Fastify
    server/                   Fastify plugins: the central error handler, the error envelope, request id, CORS
    auth/                     session codec, caller identity, the auth hook features attach to their routes
    database/                 Mongo client, index helpers
    queue/                    Redis connection, BullMQ queue and worker factories
    http/                     the upstream transport other services are called over
    logger/
  shared/                     business code two or more features import, by topic: money/, time/, plans/
    <topic>/                  entities, value objects, pure rules and reference data; never a repository, a use-case or infrastructure
  features/<feature>/
    create-<feature>.ts       the feature's composition root: builds data/, the use-cases and api/ for app.ts
    create-<feature>-worker.ts  the same for its job processors, for worker.ts; only when the feature has jobs
    domain/
      entities/               entity types and the rules over them
      value-objects/          immutable, self-validating values (Email, Money, InviteToken)
      use-cases/              one use-case class per module with a single execute(), framework-free
      repositories/           interfaces of every outbound call the use-cases make, with their request/response types
      reference/              static reference data (catalogues, presets), typed by the entities
    data/
      repositories/           Mongo implementations of domain/repositories
      clients/                implementations of domain/repositories over another service or a third-party API
      queues/                 queue definitions (name, payload schema, retry options; no connection) and the producers that enqueue
      models/                 document types and upstream response types
      mappers/                document ↔ entity, upstream response ↔ entity
      seeds/  migrations/
    api/
      routes.ts               registration + hooks only; a plugin whose body only registers routes
      schemas/                request and response schemas (the wire shapes)
      controllers/            handlers: read validated input → call a use-case → shape the reply
      middlewares/            hooks only this feature's routes use
      jobs/                   BullMQ processors and workers: validate the payload → call a use-case
    testing/                  in-memory fakes of domain/repositories; another feature imports them from its tests only
    feature_readme.md
```

### File names and folder depth

File names are kebab-case with a dotted role suffix that names the element: `invite.entity.ts`, `email.value-object.ts`, `accept-invite.use-case.ts`, `invite.repository.ts` (the interface), `mongo-invite.repository.ts`, `http-billing.client.ts`, `send-invite-email.queue.ts` (the definition), `send-invite-email.producer.ts`, `invite.model.ts` (the document type and its Mongoose or JSON schema), `invite.mapper.ts`, `invites.controller.ts`, `invites.schema.ts`, `require-workspace-admin.middleware.ts`, `send-invite-email.processor.ts`, `send-invite-email.worker.ts`, `fake-invite.repository.ts`, `seed-plans.seed.ts`, `0003-invite-token-index.migration.ts`, `plans.reference.ts`. The export keeps its own name (`MongoInviteRepository`, `AcceptInviteUseCase`). Tests keep the dotted test suffix after the role (`accept-invite.use-case.test.ts`, `send-invite-email.processor.redis.test.ts`). ESLint enforces kebab-case with `unicorn/filename-case`. The boundaries config matches an element type on its layer folder plus its role suffix (`domain/**/*.repository.ts` is the interface, `data/**/*.repository.ts` the implementation, `testing/**/*.repository.ts` a fake), so a file is the same element flat or in its sub-folder; `routes.ts`, `create-<feature>.ts`, `create-<feature>-worker.ts`, `app.ts` and `worker.ts` are matched by name. `*.schema.ts` is only ever a wire shape in `api/`; storage schemas live in their `*.model.ts`.

`domain/`, `data/` and `api/` are the folders this skill names as present from the start, the exception the standards' feature-shape rule allows: each appears with the feature's first file of that layer rather than its second, and never as an empty scaffold. Inside a layer, a sub-folder (`entities/`, `mappers/`, `controllers/`…) appears with the second file of its kind; until then the file sits flat in the layer (`domain/invite.entity.ts`, `api/invites.controller.ts`). `routes.ts` and `create-<feature>.ts` are single files and never get a folder. When a layer passes about 15 non-test source files, the feature splits by sub-feature (`billing/checkout/`, `billing/subscriptions/`, `billing/webhooks/`), each with the layers it needs and its own readme; the count leaves out `testing/`, seeds, migrations and the readme. The parent holds only the `domain/` every sub-feature uses, the `data/` implementing that `domain/`'s interfaces, its readme, and the `create-<feature>.ts` that composes the sub-features' plugins for `app.ts`. For the table below a sub-feature is a feature: "own" is the sub-feature plus the parent's `domain/` (and, for a sub-feature's `create-<feature>.ts`, the parent's `data/`), and a sibling is "another feature". Which features form a bounded context is recorded in the feature map and each readme, never in a module folder over `features/`.

### Where the types live

- An **entity** holds what use-cases read and the rules over it, with an `id`. A timestamp a rule reads (a retention window, an abandonment cutoff) is an entity field; one nothing reads stays on the model.
- A **value object** validates itself on construction and is compared by value; a primitive that carries a rule (an email, an amount with its currency, a token's format) becomes one.
- A **repository interface** declares only the operations this feature's use-cases call, with their request/response types beside it. It is named for what it gives the domain (`InviteRepository`, `BillingSeats`, `InviteEmailQueue`), never for the technology behind it. Every file in `domain/repositories/` ends `.repository.ts` whatever is behind it (`invite-email-queue.repository.ts`), so the lint sees each one.
- A **model** is the storage or upstream shape: `InviteDocument` with `_id`, the timestamps the database sets, leases, claims and schema versions; `BillingSeatsResponse` as the other service sends it. One mapper function turns a full model into the entity, whose `id` comes from `_id`; a projected read returns the repository interface's own response type.
- A **schema** in `api/schemas/` is the wire shape a client sees. It is written for the client, not derived from the entity or the model.
- **Reference data** in `domain/reference/` is constants. Use-cases and seeds read it directly, never through a repository; an entity rule gets the values handed to it.

Why: a domain folder of bare shapes that mirror the collection is a data layer under another name, and every later use-case reads the storage shape instead of the entity.

### The dependency rule as a table

A row imports only the ticked columns. "Own" means the same feature; another feature only through its public surface (the exports its `feature_readme.md` lists: use-cases, entity types, repository interfaces it offers).

| imports → | own entities, value objects | own `domain/reference` | own `domain/repositories` | own `domain/use-cases` | own `data/` | own `api/` | `core/errors` | rest of `core/` | `shared/` | another feature |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| entities, value objects | ✓ | | | | | | ✓ | | ✓ | public surface types |
| `domain/reference` | ✓ | ✓ | | | | | | | ✓ | |
| `domain/repositories` | ✓ | | ✓ | | | | ✓ | | ✓ | public surface types |
| `domain/use-cases` | ✓ | ✓ | ✓ | | | | ✓ | | ✓ | public surface types |
| `data/` | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | public surface |
| `api/` | ✓ | | ✓ | ✓ | `*.queue.ts` only | ✓ | ✓ | `server`, `auth`, `config`, `logger` | ✓ | |
| `testing/` | ✓ | ✓ | ✓ | | | | ✓ | | ✓ | |
| `create-<feature>.ts`, `create-<feature>-worker.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | public surface |
| `shared/` | | | | | | | ✓ | | ✓ | |
| `core/` | | | | | | | ✓ | ✓ | | |
| `app.ts`, `worker.ts` | every `create-<feature>.ts` (`app.ts`) or `create-<feature>-worker.ts` (`worker.ts`), and `core/` | | | | | | | | | |

- `domain/` imports no driver, no Fastify, no BullMQ, nothing from `data/` or `api/`; `core/errors` is the one piece of `core/` it may use, because those classes are plain. Entities never import `domain/reference`: a rule gets the values handed to it.
- `api/` never imports `core/database` or `core/queue`: data access and enqueueing go through a use-case and `data/`.
- A use-case never imports another use-case, its own feature's or another's: two that need the same step share an entity rule or a repository call, and a use-case that only forwards to another is a pass-through and is deleted. From another feature a use-case imports only types (entities, value objects); to call that feature, it declares the call in its own `domain/repositories` and `data/` implements it over the other feature's public surface.
- `api/` reaches `data/` only for a queue's definition (`*.queue.ts`, never its producer), so a processor validates with the same payload schema the producer enqueues with, without opening a Redis connection by importing it. A controller never imports a repository implementation; it receives a use-case (or, in a BFF pass-through, a repository interface) from `create-<feature>.ts`.
- A route plugin's options name the feature's use-cases or its repository interface, never a client with every operation in the system.

## 2. Rules that fail a review

- Every route validates input and output with a schema (JSON Schema or Zod). Never read `request.body`, `params` or `query` unvalidated.
- Controllers hold no business logic and no data access, and never catch an error to map it to a status: they throw typed errors from `core/errors` and the central handler in `core/server` maps them to the envelope. A catch that turns a failure into a deliberate non-error outcome (an always-`200` endpoint, a redirect on OAuth failure) is a use-case decision and lives in the use-case, named for what it does.
- Response and error-envelope shapes a client depends on are contracts: changing one is a tracked change with its own issue and the client updated together.
- A service owns one bounded context and its own database, and reaches others only through their APIs or a queue. Never read another service's database.
- Config and secrets from env vars through `core/config`; `.env` ignored, `.env.example` committed with keys and no values.
- Logging is structured (the Fastify logger, `core/logger`), never `console.log`, never secrets or PII.
- Session checks make zero network calls; a stateless service verifies the request on its own.
- `core/` has no business meaning and imports no feature and no `shared/`. `shared/` holds no repository, no use-case and no infrastructure: code two features need that reads or writes a collection is a feature of its own with a public surface, and plumbing belongs in `core/`. No `utils/`, `helpers/` or `common/` folder anywhere: name the topic.
- A domain type carries no field that no use-case reads, and a domain file never describes itself as a document, a collection or a row: storage shapes are `data/models`, wire shapes `api/schemas`.
- A use-case is one case: one class per `*.use-case.ts`, named for the case with a `UseCase` suffix (`AcceptInviteUseCase`), taking the repository interfaces it uses in its constructor and exposing one public method, `execute(input)`, with the input and result types declared beside it. No other public method, and no state between calls beyond its dependencies. A second thing to do is a second use-case, never a second method; a class named `*Service` or `*Manager` in `domain/` is several use-cases waiting to be split.
- In a new or rewritten feature, a sub-folder appears with the second file of its kind, and a layer over about 15 files means the feature splits by sub-feature (§1).

## 3. BFF

- Same layers and validation; the use-cases shape, aggregate and translate auth/session. Domain logic stays in the services the BFF calls, so a BFF's `domain/` is mostly repository interfaces and the types its use-cases compose.
- A route that only forwards one upstream call needs no use-case: its controller calls the feature's repository interface directly. Add a use-case when there is shaping, aggregation or a deliberate outcome rule.
- Each feature owns its upstream calls: `domain/repositories` declares only the calls that feature makes with their types; `data/clients` implements them over `core/http`. One client with every upstream operation injected everywhere is the anti-pattern this replaces.
- Upstream errors are relayed by throwing (`UpstreamHttpError(status, body)`); the central handler relays through the envelope's allow-list of statuses and fields, in the route's existing envelope shape. Never return `{ ok, status }` from a client.
- No database of its own beyond an optional short-TTL cache. Source-of-truth data in a BFF means it has become a microservice: flag it.
- One BFF per client surface; its feature folders mirror the client's features, not the backend's internals.
- Account-existence leak prevention where it applies: reset and resend endpoints always return the same success shape, bad tokens get one generic `401`, login never distinguishes unknown email from wrong password.

## 4. MongoDB

- Only `data/` imports the driver or ODM (a feature's repositories, seeds and migrations) plus `core/database`'s client and index helpers, which hold no repository. Explicit schema validation (Mongoose, Zod or JSON Schema). The model and its mapper: §1.
- Projections instead of full documents; index the fields you query or sort on and say so in the repository.
- Never build queries from unsanitized user input (operator injection): the repository builds the filter from the typed arguments of its interface.
- One logical database per service.

## 5. BullMQ and Redis

- Queue names `<domain>.<action>` (`orders.send-confirmation-email`). In `data/` (its `queues/` sub-folder once it holds two files), the definition (`*.queue.ts`: name, payload schema, `attempts` and backoff, no connection) and the producer (`*.producer.ts`, implementing a `domain/repositories` interface the use-case enqueues through) are separate files. The processor (`*.processor.ts`) and worker (`*.worker.ts`) live in `api/` (its `jobs/` sub-folder once it holds two), import only the definition, and call a use-case that `create-<feature>-worker.ts` builds.
- Processors are idempotent: retries and redelivery must not double-charge or double-send; use a dedupe key where the operation is not naturally idempotent.
- Explicit `attempts` and backoff per job type, chosen for what the job does. Validate job payloads like HTTP input.
- Workers run as their own process in production (`npm run dev:worker` locally; emails don't send without it). Failed jobs need visibility (dead-letter queue, alerting or Bull Board).
- Queue it when the operation is slow, tolerates eventual completion, needs retries or must not block the response; keep it synchronous when the caller needs the result to proceed.

## 6. Tests and checks

```
tests/ (or beside the file under test)
  unit:         entities, value objects and use-cases, with the repository interfaces faked from testing/ (vitest)
  integration:  data/repositories against mongodb-memory-server or a test MongoDB; routes through fastify.inject
  bff:          the shaping and aggregation logic, and what it returns when a downstream service is slow or errors, not only the passthrough
  jobs:         processors unit-tested; *.redis.test.ts suites against a real Redis, run when REDIS_TEST_URL is set (CI sets it); cover success, the retry path (a throw keeps the job retryable) and idempotency
```

Before reporting work done: lint (boundaries included, where the repo has them), typecheck, unit and fast integration tests, a build. A change that crosses a service boundary gets a signed-in pass on the real local stack reading a record with data in it; health endpoints and fakes prove nothing about the boundary. After a merge or a dependency change, restart the stack before verifying against it.

## 7. Migrating from the earlier layout

Repos built on this skill's earlier layout (`service/`, `ports/`, `adapters/`, `controller.ts`, `shared/adapters`) keep it consistently until their own migration PR, and are written and reviewed against that layout's own table and checklist, summarised in §9, not against the checklist below. The migration PR moves every feature at once and updates the boundaries config, never feature by feature, never as a side effect of other work. Each row names the target sub-folder; a file whose kind has only one file in the feature lands flat in the layer instead (§1).

| Earlier | Now |
| --- | --- |
| `service/`, `service.ts` | `domain/use-cases/`, `*.use-case.ts` |
| `domain/` | `domain/entities/` and `domain/value-objects/` |
| `ports/`, `port.ts` | `domain/repositories/`, `*.repository.ts` |
| `adapters/mongo-*.ts` | `data/repositories/mongo-*.repository.ts`, the document type to `data/models/`, its mapping to `data/mappers/` |
| `adapters/http-*.ts` | `data/clients/http-*.client.ts` |
| `adapters/` seeds and migrations | `data/seeds/`, `data/migrations/` |
| `data/` (reference data) | `domain/reference/` |
| `routes.ts`, `schemas.ts`, `controller.ts` | `api/routes.ts`, `api/schemas/`, `api/controllers/` |
| `jobs/` | queue definition and producer to `data/queues/` as separate files, processor and worker to `api/jobs/`, their wiring to `create-<feature>-worker.ts` |
| `testing/fake-*.ts` | `testing/fake-*.repository.ts` |
| flat `domain.ts`, `port.ts`, `service.ts`, `controller.ts`, `data.ts` | the matching layer, flat, with its role suffix (`domain/<name>.entity.ts`, `domain/<name>.repository.ts`, `domain/<name>.use-case.ts`, `api/<name>.controller.ts`, `domain/<name>.reference.ts`) |
| `create-<feature>.ts` | stays at the feature root |
| `shared/domain` | `shared/<topic>/`, error base classes to `core/errors` |
| `shared/data` | `shared/<topic>/` |
| `shared/adapters`, `config/` | `core/` |

## 8. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| Handler maps an error to a status inline | Throw a typed error from `core/errors`; the central handler maps it |
| `routes.ts` holding handlers, error mapping and upstream calls | `api/routes.ts` registers; `api/controllers` handle; `data/clients` call |
| One upstream client with every operation injected into every feature | `domain/repositories` per feature with only its calls, implemented in its `data/clients` |
| Client returning `{ ok, status, body }` | Throw `UpstreamHttpError`; relay through the envelope |
| A "proxy" to another service under `api/` | It is outbound: `data/clients/`, behind a `domain/repositories` interface |
| `HttpBillingClient.ts`, `inviteService.ts`: file named after its symbol | `http-billing.client.ts`, `create-invite.use-case.ts`; the export keeps its name |
| A BFF with its own collection of source-of-truth data | It is a microservice now; flag the boundary |
| `request.body` used without a schema | A schema in `api/schemas/` on the route, input and output |
| `domain/entities/invite.entity.ts` typed as the Mongo document, `_id` and all | `Invite` with what use-cases read; `InviteDocument` in `data/models/`, mapped in `data/mappers/` |
| A use-case importing `mongodb`, `fastify` or `bullmq` | It calls a `domain/repositories` interface; `data/` implements it |
| One `InviteService` with twenty public methods | One `*.use-case.ts` per case, each a `*UseCase` class whose only public method is `execute` |
| A use-case with `execute` plus helpers like `validate` or `notify` made public | Helpers private, or an entity rule; the class exposes `execute` alone |
| `domain/entities/` holding one file | `domain/invite.entity.ts` flat until the second entity |
| One `data/` of twenty-five files across checkout, plans and webhooks | Sub-features, each with the layers it needs |
| `shared/utils/`, `shared/helpers.ts` | `shared/<topic>/` for business code, `core/<topic>/` for plumbing |
| `shared/metering` holding a calendar rule and two Mongo repositories | A `metering` feature with a public surface; `core/database` keeps only the connection |
| A processor that re-sends on retry | Dedupe key or an idempotent write |
| Logging the request body with credentials | Structured log of ids and outcomes only |

## Checklist for a review brief

1. Layering: `domain/` imports no driver, Fastify, BullMQ, `data/` or `api/` (only `core/errors` from core); entities and value objects never import use-cases or repositories; use-cases never import any use-case, and take only types from another feature; `api/` reaches `data/` only for a queue definition; no feature imports another's internals.
2. Placement: inbound in `api/`, outbound in `data/`; storage shapes in `data/models` with one mapper, wire shapes in `api/schemas`, entities holding only what use-cases read.
3. `core/` is plumbing and imports no feature or `shared/`; `shared/` is cross-feature business code with two importers and no repository, use-case, infrastructure, `utils/` or `helpers/`.
4. Every route has input and output schemas.
5. Errors thrown as typed errors and mapped centrally; envelope shapes unchanged unless the issue says so.
6. Each feature's `domain/repositories` declares only what its use-cases call; plugins receive use-cases or that narrow interface.
7. Only `data/` and `core/database` touch the driver; `core/database` holds no repository; queries never built from raw input.
8. Jobs: definition (`*.queue.ts`) and producer (`*.producer.ts`) apart in `data/`, processor and worker in `api/` importing only the definition, wired by `create-<feature>-worker.ts`; idempotent, explicit retry policy, payload validated.
9. Tests: unit with faked repositories from `testing/`, repositories against a real MongoDB, routes via `inject`, jobs against real Redis.
10. Files ~300 lines, functions ~40; one `*UseCase` class per module whose only public method is `execute`; a routes plugin that only registers is exempt.
11. File names kebab-case with the role suffix (`*.use-case.ts`, `*.repository.ts`, `*.controller.ts`…), test suffixes after it; `unicorn/filename-case` green.
12. New or rewritten features: layer folders only once they hold a file, a sub-folder only from the second file of its kind, a split by sub-feature when a layer passes ~15 files; no module folders over `features/`.

## 9. The earlier layout, for repos not yet migrated

A repo still on the earlier layout is written and reviewed against these rules until its migration PR (§7). Each feature holds `create-<feature>.ts`, `routes.ts`, `controller.ts`, `service/` (use-cases), `domain/` (entities and rules), `ports/` (the interfaces of its outbound calls), `adapters/` (Mongo repositories as `mongo-*.ts`, upstream clients as `http-*.ts`, seeds, migrations, document types), `data/` (static reference data, not a data layer), `jobs/`, `testing/`. Small features use the same names flat: `service.ts`, `port.ts`, `domain.ts`, `data.ts`. `shared/` is layered as `shared/domain` (types and pure rules), `shared/data` (reference data) and `shared/adapters` (infrastructure only, never a repository); `config/` sits beside it.

| imports → | own `domain/` | own `data/` | own `ports/` | own `service/` | own `controller.ts` | own `adapters/` | `shared/domain` | `shared/data` | `shared/adapters` | another feature |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `domain/` | ✓ | | | | | | ✓ | | | |
| `data/` | ✓ | | | | | | ✓ | ✓ | | |
| `ports/` | ✓ | | | | | | ✓ | | | |
| `service/` | ✓ | ✓ | ✓ | | | | ✓ | ✓ | | public surface |
| `controller.ts` | ✓ | | ✓ | ✓ | | | ✓ | | | |
| `routes.ts` | ✓ | | ✓ | | ✓ | | ✓ | | ✓ | |
| `adapters/` | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ | public surface |
| `jobs/` | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | public surface |
| `testing/` | ✓ | | ✓ | | | | ✓ | | | |
| `shared/domain` | | | | | | | ✓ | | | |
| `shared/data` | | | | | | | ✓ | ✓ | | |
| `shared/adapters` | | | | | | | ✓ | ✓ | ✓ | |
| `create-<feature>.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | public surface |
| `app.ts` | every `create-<feature>.ts` and `shared/adapters` | | | | | | | | | |

Its review checklist is the one above with these readings: item 1 is "no Fastify types in `service/`, no data access in `controller.ts`, `domain/` imports only itself and `shared/domain`"; items 2, 6 and 7 name `adapters/` for `data/` and `ports/` for `domain/repositories`; item 3 names `shared/adapters` for `core/`; item 10 reads a use-case as a module exporting one function, and a service class the repo already has as allowed up to about eight public methods (a new use-case goes in its own module beside it, and the split is an issue, never a side effect of adding a method); item 11's suffixes are not required, kebab-case is; item 12 applies the second-file threshold to every layer folder.
