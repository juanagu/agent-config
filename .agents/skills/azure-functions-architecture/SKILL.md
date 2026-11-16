---
name: "azure-functions-architecture"
description: "How a Python Function App is built in this setup, on top of python-architecture's layers: the v2 decorator model with function_app.py as the composition root and one Blueprint per feature built by its create_<feature> factory, every trigger (HTTP, Service Bus, queue, timer, Durable orchestration and activity) a thin inbound adapter in api/ that validates and calls a use-case, one error mapper, no anonymous endpoint (webhook signatures, Entra ID or function keys), managed identity and Key Vault instead of keys, Cosmos DB and Service Bus behind repositories with partition keys, idempotent consumers and dead-letter queues, deterministic Durable orchestrators, OpenTelemetry to Application Insights, local runs on Core Tools with Azurite and emulators, a locally built package per app, and the test layout. Invoke before writing, reviewing or planning code in a Function App (function_app.py, host.json, local.settings.json, a Blueprint), together with python-architecture. Not for Fastify (fastify-architecture), Next.js/Astro (nextjs-architecture), Flutter (flutter-architecture), native Android (android-architecture), native iOS (ios-architecture) or React Native (react-native-architecture); for Python code outside a Function App, python-architecture alone."
---

# Azure Functions architecture (Python)

Load `python-architecture` first: it owns the layers, the dependency table, the naming, the tooling and the review checklist. This skill says what a Function App adds: the shape of the entrypoint and of `api/`, the triggers, security at the edge, the Azure services behind `data/`, and how the app runs and ships. When a project has its own `docs/architecture.md`, that doc wins on specifics. Check the Functions Python developer reference for the current runtime and supported Python versions before pinning either; the v2 programming model is the only one used here.

## 1. The app and its entrypoint

```
apps/<app>/
  function_app.py             the composition root: build core/ once, then app.register_functions(create_<feature>(...)) per feature;
                              app is df.DFApp once any feature has orchestrations, func.FunctionApp otherwise
  host.json                   runtime config: extension bundle, logging levels, retry and concurrency per trigger type
  local.settings.example.json committed, keys and no values; local.settings.json is ignored
  .funcignore                 tests/, .venv/, local settings, anything not shipped
  pyproject.toml
  src/<app_pkg>/
    core/
      config/                 pydantic-settings over the app settings; read once at cold start, fails fast
      errors/
      edge/                   the one error mapper (typed error → HttpResponse envelope), request parsing helpers
      auth/                   caller identity: webhook signature validators, Entra ID token validation, the decorators routes apply
      observability/          azure-monitor-opentelemetry setup, correlation ids, the structured-log helpers
      upstream/               the httpx.AsyncClient other services are called over
      cosmos/  service_bus/  storage/   async client factories over DefaultAzureCredential, built once per process
    features/<feature>/
      create_<feature>.py     builds data/ and the use-cases, returns the feature's one Blueprint (a df.Blueprint, a func.Blueprint subclass, when it has orchestrations)
      api/
        blueprint.py          create_blueprint(use_cases) -> func.Blueprint: the decorated triggers, each two or three lines
        schemas/              Pydantic models of request, response and message payloads
        controllers/          one module per resource: parse → use-case → response, raising typed errors
        consumers/            Service Bus and queue handlers: validate the message → call a use-case
        schedules/            timer handlers: call a use-case, never scan and decide inline
        orchestrations/       Durable orchestrators and their activities
      domain/  data/  testing/  feature_readme.md    as python-architecture lays them out
  tests/
```

- `function_app.py` holds no route and no logic. It configures observability, builds the shared clients from `core/`, calls each feature's factory, and registers what comes back. The decorated functions live in each feature's `api/blueprint.py`, created **inside** `create_blueprint` so they close over the use-cases the factory hands them; that is how a trigger gets its dependencies without module-level globals. `create_blueprint` is a framework wrapper in the standards' size sense: it may pass 40 lines as long as each trigger only delegates in two or three lines; past about 300 lines, or ten triggers, split the Blueprint per resource (`create_leads_blueprint`, `create_documents_blueprint`), each registered by the feature's factory.
- A trigger function is an adapter: it takes the host's input, hands it to a controller, consumer or schedule handler with the use-cases it needs, and returns what that gives back. The handler is a plain async function, testable without the host.
- Function names are unique across the app; name them `<feature>_<action>` (`leads_create_application`), since every Blueprint lands in the same app.
- One Function App per deployable concern (the channel webhooks, the conversation runtime, the tool gateway, a back-office API), each a workspace app with its own settings, identity and scale. Two apps share code through a workspace package, never a copied folder (`python-architecture` skill, §1).

## 2. Triggers

| Trigger | Lives in | Does | Never |
| --- | --- | --- | --- |
| HTTP (`@bp.route`) | `api/controllers/` via `blueprint.py` | authenticates through `core/auth`, parses body, query and `req.route_params` into a schema, calls a use-case, shapes the response | reads `req.get_json()` without a schema; catches to pick a status |
| Service Bus (`@bp.service_bus_queue_trigger`, `..._topic_trigger`) | `api/consumers/` | validates the payload with the message's definition from `data/`, calls a use-case, lets a transient failure raise so the message is redelivered, dead-letters a malformed one explicitly | swallows an exception; retries a malformed message |
| Storage queue (`@bp.queue_trigger`) | `api/consumers/` | validates and calls a use-case like a Service Bus consumer, for internal plumbing only (Service Bus is the business bus); a malformed message goes to the poison queue through an explicit output binding | carries a business event other services consume |
| Timer (`@bp.timer_trigger`) | `api/schedules/` | calls one use-case that does a bounded unit of work | rescans every record to decide what is due: schedule a message or a Durable timer at the moment it becomes due instead |
| Durable orchestrator and activity (`df.Blueprint`) | `api/orchestrations/` | the orchestrator sequences activities; each activity calls one use-case | does I/O, reads the clock or randomness inside the orchestrator |

- A malformed message is a permanent failure: the consumer logs it with its id and dead-letters it, never raises it back for another delivery and never just returns, which completes the message and loses it. Dead-lettering is explicit: on Service Bus, bind `ServiceBusMessageActions` (the SDK-type binding from `azurefunctions-extensions-bindings-servicebus`) with automatic completion off and call its dead-letter operation with a reason; on a Storage queue, write the message to the poison queue through an output binding. Check the binding's current docs for the exact names before writing it. A transient failure (an upstream `5xx`, a timeout, a throttled database) raises, and `host.json` or the Service Bus entity's max delivery count bounds the retries.
- Every message type has an explicit max delivery count, a dead-letter queue, and an alert on that queue's depth.
- Ordered work per key (one conversation, one lead) uses Service Bus sessions with the key as the session id, not a lock the code takes and releases by hand.

## 3. Security at the edge

- **No anonymous endpoint.** A webhook from a provider validates the provider's signature (Twilio's `X-Twilio-Signature`, Meta's `X-Hub-Signature-256`) in `core/auth` before the body is parsed, against the public URL the provider signed. A route a person or another service calls validates an Entra ID token (App Service authentication or a JWT check in `core/auth`) and authorises by role. A function key (`AuthLevel.FUNCTION`) is the floor for service-to-service calls inside the platform, never the only check on a route that touches customer data.
- A tool the LLM calls is a route like any other: authenticated, authorised for the tenant it acts on, rate-limited and idempotent. The model reaching it is not a caller identity.
- A test-only or support-only route (seed data, force a state) does not ship to production: it lives behind a setting that is off there and that `core/config` refuses to enable in production, or it does not exist.
- **Managed identity, not keys.** Code reaches Cosmos DB, Service Bus, Storage and Key Vault with `DefaultAzureCredential` and role assignments; trigger connections use the identity form (`<Connection>__fullyQualifiedNamespace`, `<Connection>__accountEndpoint`). A secret that has no identity form (a third party's API key) is a Key Vault reference in the app settings, read through `core/config`. No key or connection string in code, in `local.settings.example.json` values, or in Terraform outputs.
- Cosmos DB, Storage and Key Vault have public network access off in production; the app reaches them over its virtual network. Infra changes go to `devops-engineer`.
- The tenant (and the bot, the account) is resolved at the edge from what the request proves (the number a webhook was sent to, the token's claims), never from an app setting per deployment and never with a default.

## 4. Cosmos DB

- Only `data/` repositories and `core/cosmos/` import `azure.cosmos`; use the `azure.cosmos.aio` client, created once per process in `core/cosmos` and closed on shutdown.
- The partition key is decided per container from how it is read, written down in the repository's docstring and the feature readme, and starts with the tenant (`/pk` = `<tenant>|<entity key>` or a hierarchical key) so one tenant's data never shares a logical partition with another's.
- Point reads (`read_item(id, partition_key)`) wherever the id and key are known; a query names its partition key, and a cross-partition query is a decision the repository's docstring justifies.
- Queries are parameterised (`parameters=[{"name": "@phone", "value": phone}]`), never an f-string.
- Writes that race use optimistic concurrency (`etag` with `match_condition`), and a conflict raises `ConflictError` for the use-case to decide.
- The document type and its mapper live in `data/models` and `data/mappers`; `_etag`, `_ts` and `pk` never reach an entity unless a rule reads them.
- Retention is a container's TTL or a scheduled purge use-case, recorded in the feature readme; personal data has one.

## 5. Service Bus and scheduled work

- Queue and topic names are `<domain>.<event>` (`leads.application-created`). A message's definition (name, payload schema, the subject and the session key it uses) lives in `data/producers/` beside its producer; the consumer in `api/consumers/` imports only the definition.
- A producer implements a `domain/repositories` Protocol (`FollowUpScheduler`) and sets `message_id` to the event's business key. That dedupes only on an entity created with duplicate detection on (it cannot be turned on later, so Terraform sets it at creation, with its window); idempotent consumers stay the guarantee either way. A message that replaces an earlier one inside the window (a follow-up cancelled and rescheduled) gets a new id, the business key plus a version, or the broker drops it as a duplicate.
- Consumers are idempotent: the effect is keyed on the business key (an upsert, a processed-message record with a TTL) so a redelivery changes nothing.
- Follow-ups and reminders are scheduled at the moment they become due (`scheduled_enqueue_time_utc`, or a Durable timer when the steps depend on each other), and cancelled by sequence number or a version check when the conversation moves on. A timer that rescans state every few minutes is the pattern this replaces.

## 6. Durable Functions

Use them when a process waits (for a reply, a person, a callback, a deadline) and its steps depend on each other; a single delayed action is a scheduled message.

- Orchestrators are generator functions with no I/O: they `yield context.call_activity(...)`, read time from `context.current_utc_datetime`, and get randomness or new ids from an activity. Each activity calls one use-case.
- Inputs and outputs of activities are small JSON-serialisable payloads (ids, not documents).
- A change to a running orchestration's steps is versioned (a new orchestrator name or an explicit version check), so in-flight instances finish on the code they started with.
- Instance ids are business keys (`followup-<tenant>-<lead>`). Starting one is check-then-start: `get_status` on the id, and `start_new` only when there is no instance or it has finished. `start_new` on a running id does not return the running instance: depending on `overridableExistingInstanceStates` in `host.json` it replaces it or raises, so set that to `NonRunningStates` and treat the raise from a lost race as "already running".

## 7. Observability

- `core/observability` configures `azure-monitor-opentelemetry` once, in `function_app.py`, before any client is built; every log carries the invocation id, the tenant, and the business key the work is for (conversation, lead), never the message body, a phone number or a document.
- Each turn of work that calls an LLM or a third party records a span with the dependency, its latency, its outcome and, for a model, the pinned version and token counts.
- Alerts exist before the first production deploy: function failures, dead-letter depth, a dependency's error rate, and one on the absence of traffic where silence means breakage (a webhook that stopped arriving).

## 8. Running, testing and shipping

- **Locally**: Core Tools (`func start` in the app's folder) with Azurite for Storage, and the Cosmos DB and Service Bus emulators in Docker, wired by a Compose file the README names. `local.settings.json` points at them; nothing local reaches a cloud resource by default.
- **Tests**, beside python-architecture's layout:
  - `api/` handlers are called directly with a built `func.HttpRequest(method=..., url=..., body=..., headers=..., route_params=...)` or a built `func.ServiceBusMessage`, with the use-cases faked: status, envelope, signature rejection, schema rejection.
  - `data/` repositories and producers run against the emulators (`@pytest.mark.integration`).
  - A smoke run starts the app with `func start` against the emulators and calls one route per feature, including a signed webhook; it runs in CI's fast tier when it fits in its minutes.
  - Orchestrators are tested by driving the generator with a fake context: the order of activities, the timer, the replay of a completed step.
- **Shipping**: CI builds each app's package once: export the app's locked runtime dependencies with `uv export --frozen --no-dev --no-editable --package <app>` (without `--no-editable` the workspace members, the app's own package included, come out as editable lines that cannot be installed into a target folder), `pip install --target .python_packages/lib/site-packages` on the runtime's Python and platform so the app's `src/` package is installed beside its dependencies, zip it with `function_app.py` and `host.json`, check the zip by importing the app package from a clean interpreter, and deploy that artifact to dev and then to production. No remote build: it cannot resolve workspace packages, and the artifact promoted to production is the one tested in dev.
- Pin the runtime the app runs on (the Functions Python worker package where the runtime supports pinning it, the extension bundle range in `host.json`) and change it in its own PR.
- Infrastructure (Function Apps, plans, identities, role assignments, Key Vault, networks, alerts) is Terraform in `infra/`, owned by `devops-engineer`; an app setting the code needs is added there in the same PR as the code.

## 9. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| `function_app.py` holding every route, helper and query | `function_app.py` registers each feature's Blueprint; the triggers live in `api/blueprint.py` |
| A Blueprint at module level reaching for a global client or repository | `create_blueprint(use_cases)` defines the triggers inside it, closing over what the factory built |
| `auth_level=ANONYMOUS` on a webhook or a tool route with nothing in `core/auth` checking the caller | Host level `ANONYMOUS` is right only when `core/auth` validates the signature or token before anything reads the body; switching to `AuthLevel.FUNCTION` without putting the key in the URL the provider calls breaks the webhook |
| A seed or force-state route deployed to production | Off in production by `core/config`, or deleted |
| `COSMOS_KEY`, `SERVICEBUS_CONNECTION_STRING` in the app settings | Managed identity with role assignments; Key Vault references for third-party secrets |
| `os.getenv("TENANT_ID", "acme")` | The tenant resolved from the inbound number or the token; missing is a `4xx` |
| A timer every five minutes scanning every lead to see who is due | A scheduled message or a Durable timer created when the follow-up becomes due |
| A consumer catching `Exception` and returning | Dead-letter a bad payload, raise a transient failure, keyed so redelivery is harmless |
| `datetime.now()` or an HTTP call inside an orchestrator | `context.current_utc_datetime`; the call in an activity |
| An f-string Cosmos query | `parameters=[...]` in the repository |
| `requirements.txt` listing a path to a sibling folder, remote build on deploy | A CI-built package from the lock, promoted from dev to production |
| A sync SDK client created per invocation | The `aio` client, built once in `core/` |

## Checklist for a review brief

Copy `python-architecture`'s checklist, then add:

1. `function_app.py` only composes: observability, `core/` clients, one `register_functions` per feature; every trigger lives in a feature's `api/blueprint.py`, created inside its factory, and delegates to a plain handler.
2. No anonymous route: webhooks validate the provider's signature, people and services present a token or, inside the platform, a function key at least; no test-only route reachable in production.
3. Managed identity for Cosmos DB, Service Bus, Storage and Key Vault; third-party secrets as Key Vault references; no key or connection string in code, examples or Terraform outputs.
4. Tenant resolved at the edge from the request; no default tenant.
5. Cosmos: the `aio` client from `core/cosmos`, a documented partition key starting with the tenant, point reads where possible, parameterised queries, etags on racing writes.
6. Messaging: definitions beside producers, `message_id` set to a business key, idempotent consumers, malformed messages dead-lettered, an explicit delivery count and an alert on each dead-letter queue; scheduled messages or Durable timers instead of scanning timers.
7. Durable orchestrators deterministic, activities one use-case each, instance ids as business keys, step changes versioned.
8. Telemetry configured once; logs carry ids and the tenant, never bodies or PII; alerts on failures, dead letters and missing traffic.
9. Tests: handlers with built requests and messages, repositories and producers against the emulators, a smoke run on Core Tools, orchestrators replayed with a fake context.
10. Shipping: one CI-built package per app from the lock, no remote build, the same artifact promoted; app settings the code reads added in Terraform in the same PR.
