---
name: "python-architecture"
description: "The architecture every Python backend in this setup follows, whatever hosts it: a uv workspace of apps and shared packages; feature folders split into domain/ (frozen-dataclass entities, value objects, one *UseCase class per case, Protocol repositories), data/ (their implementations, models, mappers, messages, producers) and api/ (the host's inbound adapters); core/ for infrastructure, shared/ for cross-feature business code; Pydantic only at the boundaries, typed errors mapped in one place, ruff, pyright strict, import-linter and pytest. Invoke before writing, reviewing or planning any Python code (*.py, pyproject.toml, uv.lock) and when deciding where a file goes. Not for Fastify (fastify-architecture), Next.js/Astro (nextjs-architecture), Flutter (flutter-architecture), native Android (android-architecture), native iOS (ios-architecture) or React Native (react-native-architecture); what a Function App adds is azure-functions-architecture, loaded with this one."
---

# Python architecture

When a project has its own `docs/architecture.md`, that doc wins on specifics; this skill is the default shape and the checklist. It is the language and layering half: the host that calls the code (Azure Functions, a CLI, a container) only changes what sits in `api/` and in the entrypoint, and has its own skill when it has one (`azure-functions-architecture` for Function Apps).

## 1. Layers and the dependency rule

Clean architecture inside each feature, in three layers. `domain/` is the business: entities, value objects, use-cases and the interfaces of everything the use-cases call out to. `data/` implements those interfaces against the outside world: a database, another service, a queue, an LLM provider. `api/` is how the outside world reaches the feature: an HTTP route, a queue consumer, a timer, a CLI command. Dependencies point inwards: `api/` and `data/` import `domain/`, `domain/` imports neither, and only the feature's composition root wires `data/` into `api/`.

The rule that sorts the outer two: **inbound goes in `api/`, outbound goes in `data/`.** A route, a consumer and a scheduled job are inbound (something calls the feature). A repository, a client for another service or a model provider, and a message producer are outbound (the feature calls something).

```
pyproject.toml                  the uv workspace root: members, dev tools and their config (ruff, pyright, pytest, import-linter)
uv.lock                         committed; CI installs with --frozen
apps/<app>/                     one deployable each: a Function App, a CLI, a container
  pyproject.toml                its runtime dependencies, workspace packages included by name
  <entrypoint>                  the host's composition root (function_app.py, __main__.py): core setup, then every create_<feature>
  src/<app_pkg>/
    core/                       app infrastructure with no business meaning; imports nothing outside core/
      config/                   pydantic-settings; fails fast at startup when required config is missing
      errors/                   typed error base classes (NotFoundError, ConflictError, UpstreamError); pure, no framework
      observability/            logging and telemetry setup, the structured-log helpers
      upstream/                 the transport other services are called over (one httpx.AsyncClient, timeouts, retries)
      <driver>/                 one client factory per driver (cosmos/, service_bus/, storage/); never a repository
    shared/                     business code two or more features import, by topic: money/, phone/, tenancy/
      <topic>/                  entities, value objects, pure rules and reference data; never a repository, a use-case or infrastructure
    features/<feature>/
      __init__.py               the public surface: re-exports from domain/ only what feature_readme.md lists, in __all__
      create_<feature>.py       the feature's composition root: builds data/, the use-cases and api/ for the entrypoint
      domain/
        entities/               frozen dataclasses with the rules over them
        value_objects/          immutable, self-validating values (EmailAddress, PhoneNumber, Money)
        use_cases/              one *UseCase class per module with a single async execute()
        repositories/           typing.Protocol interfaces of every outbound call the use-cases make, with their request/response types
        reference/              static reference data (catalogues, presets), typed by the entities
      data/
        repositories/           implementations of domain/repositories over a database
        clients/                implementations of domain/repositories over another service, a third-party API or a model provider
        messages/               message definitions: name, payload schema, session key (<event>_message.py); the one data/ package api/ may import
        producers/              implementations of domain/repositories that publish a message
        models/                 storage documents and upstream response types (Pydantic models or TypedDicts)
        mappers/                document ↔ entity, upstream response ↔ entity
      api/                      the host's inbound adapters; the host's skill names the files (`azure-functions-architecture` skill, §1)
        schemas/                Pydantic models of the wire shapes, request and response
        controllers/            read validated input → call a use-case → shape the reply
      testing/                  in-memory fakes of domain/repositories; another feature imports them from its tests only
      feature_readme.md
  tests/                        unit/, integration/, api/ (§5) and architecture/ (§4)
packages/<name>/                a library two or more apps install; the same layering inside, its own feature_readme.md
```

### Packages and deployables

- **One deployable per app**, each a workspace member with its own runtime dependencies. Code two apps need is a workspace package under `packages/`, installed by both through the lock, **never copied**: two copies of a `shared/` folder diverge within weeks, and nobody can tell which one is right.
- A package follows the two-importers rule (`AGENTS.md`, Structure rules): it exists once a second app imports it. Until then the code lives in the app that uses it.
- A package is infrastructure (a channel adapter's transport, a logging setup) or business code with its own domain; it never reaches into an app, and the app imports it only through its `__init__.py`.

### File names and folder depth

Modules and packages are snake_case, as PEP 8 requires, with a role suffix that names the element: `accept_invite_use_case.py` (`AcceptInviteUseCase`), `invite_repository.py` (the Protocol `InviteRepository`), `cosmos_invite_repository.py`, `http_crm_client.py`, `invite_model.py` (`InviteDocument`), `invite_mapper.py`, `invites_controller.py`, `invites_schema.py`, `reminder_producer.py`, `fake_invite_repository.py`, `plans_reference.py`. Entities and value objects are named by their noun (`invite.py`, `phone_number.py`). No module or package is named after a standard-library one (`logging`, `http`, `email`, `types`): ruff's `A005` catches it, and the Functions host warns against it too. Tests are `test_<module>.py` beside the tree they mirror. The class keeps its PascalCase name. Ruff's `N` rules enforce the names.

`domain/`, `data/` and `api/` appear with the feature's first file of that layer, never as an empty scaffold. Inside a layer, a sub-package (`entities/`, `mappers/`, `controllers/`…) appears with the second file of its kind; until then the module sits flat in the layer (`domain/invite.py`, `api/invites_controller.py`). When a layer passes about 15 non-test modules, the feature splits by sub-feature, each with the layers it needs and its own readme; the parent keeps only the `domain/` every sub-feature uses and the `create_<feature>.py` that composes them. Every package has an `__init__.py`; only the feature's own re-exports anything.

### Where the types live

- An **entity** is a `@dataclass(frozen=True, slots=True)` holding what use-cases read and the rules over it, with an `id`. A change returns a new instance (`dataclasses.replace`), never mutates.
- A **value object** validates itself in `__post_init__` and raises a typed error from `core/errors`; a primitive that carries a rule (a phone number, an amount with its currency, a tenant id) becomes one.
- A **repository interface** is a `typing.Protocol` declaring only the operations this feature's use-cases call, with their request/response dataclasses beside it. It is named for what it gives the domain (`InviteRepository`, `LeadDirectory`, `ReminderQueue`), never for the technology behind it.
- A **model** is the storage or upstream shape: `InviteDocument` with the database's id, partition key, `_etag` and timestamps; `CrmLeadResponse` as the other service sends it. One mapper function turns a model into the entity.
- A **schema** in `api/schemas/` is the Pydantic model of the wire shape a client sees, written for the client, not derived from the entity or the model.
- **Pydantic lives at the boundaries only**: wire schemas, storage and upstream models, settings. `domain/` is plain dataclasses and the standard library, so it runs and tests with nothing installed beyond Python.

### The dependency rule as a table

A row imports only the ticked columns. "Own" means the same feature; another feature only through its public surface (its `__init__.py`, which re-exports what `feature_readme.md` lists).

| imports → | own entities, value objects | own `domain/reference` | own `domain/repositories` | own `domain/use_cases` | own `data/` | own `api/` | `core/errors` | rest of `core/` | `shared/` | another feature |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| entities, value objects | ✓ | | | | | | ✓ | | ✓ | public surface types |
| `domain/reference` | ✓ | ✓ | | | | | | | ✓ | |
| `domain/repositories` | ✓ | | ✓ | | | | ✓ | | ✓ | public surface types |
| `domain/use_cases` | ✓ | ✓ | ✓ | | | | ✓ | | ✓ | public surface types |
| `data/` | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | ✓ | public surface |
| `api/` | ✓ | | ✓ | ✓ | `data/messages/` only | ✓ | ✓ | `config`, `observability`, `errors`, the host's auth and error mapping | ✓ | |
| `testing/` | ✓ | ✓ | ✓ | | | | ✓ | | ✓ | public surface types |
| `create_<feature>.py` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | public surface |
| `shared/` | | | | | | | ✓ | | ✓ | |
| `core/` | | | | | | | ✓ | ✓ | | |
| the entrypoint | every `create_<feature>.py` and `core/` | | | | | | | | | |

- `domain/` imports no driver, no host SDK (`azure.functions`, `azure.cosmos`), no `httpx`, no Pydantic, nothing from `data/` or `api/`; `core/errors` is the one piece of `core/` it may use, because those classes are plain.
- A use-case never imports another use-case. Two that need the same step share an entity rule or a repository call; a use-case that only forwards to another is deleted. To call another feature, a use-case declares the call in its own `domain/repositories` and `data/` implements it over that feature's public surface.
- `api/` reaches `data/` only for a message's definition in `data/messages/` (its name and payload schema), so a consumer validates with the same schema the producer publishes with, without opening a connection by importing the producer.
- A feature's `__init__.py` re-exports from its `domain/` only (entities, value objects, use-case classes with their `Input` and `Output`, the Protocols it offers), never from `data/`, `api/` or `create_<feature>.py`, which the entrypoint imports by full path. Importing a feature's surface then loads no I/O and cannot close an import cycle through another feature's `data/`; two features whose domains import each other's types are one boundary drawn in the wrong place.
- A controller receives use-cases (or, for a pure pass-through, a repository interface) from `create_<feature>.py`; it never builds a client or a repository itself.

## 2. Rules that fail a review

- Every inbound payload is parsed into a schema before anything reads it: an HTTP body, a query string, a queue message, a webhook. Never index into a raw `dict` from outside.
- Controllers hold no business logic and no data access, and never catch an error to map it to a status: they raise typed errors from `core/errors` and the host's one error mapper turns them into the envelope. A catch that turns a failure into a deliberate non-error outcome is a use-case decision, named for what it does.
- A use-case is one case: one class per `*_use_case.py`, named with a `UseCase` suffix, taking its repository interfaces in `__init__` and exposing one public method, `async def execute(self, command: AcceptInviteInput) -> AcceptInviteOutput`. `<Case>Input` and `<Case>Output` are frozen dataclasses declared in the same module, never a schema, a model or a host request object. A use-case with nothing to return returns `None` and declares no `Output`; an expected failure is a raised typed error, never a status field. A second thing to do is a second use-case; a class named `*Service` or `*Manager` in `domain/` is several use-cases waiting to be split.
- Response and error-envelope shapes a client depends on are contracts: changing one is a tracked change with its own issue and the client updated together.
- A service owns one bounded context and its own data, and reaches others only through their APIs or messages. Never read another service's database or container.
- Config and secrets come from the environment through `core/config`, validated at startup; `.env` and the host's local settings file ignored, an example committed with keys and no values. No module reads `os.environ` outside `core/config`.
- No default for a value that selects whose data you touch (a tenant, an account, an environment): a missing one is an error at the boundary, never a silent fallback to the first customer.
- Logging goes through `logging` with structured fields, configured once in `core/observability`; never `print`, never secrets, tokens, message bodies or PII (log ids and outcomes).
- Every function and method is fully annotated, and pyright runs strict on `src/` and `tests/`. `Any`, `cast` and `# pyright: ignore` don't appear in `domain/`; elsewhere each carries the rule code and a reason.
- I/O is async end to end: async drivers in `data/`, `await` up through the use-case. A blocking call (a sync SDK, `requests`, `time.sleep`) inside an async path is a bug.
- `core/` has no business meaning and imports no feature and no `shared/`. `shared/` holds no repository, no use-case and no infrastructure. No `utils/`, `helpers/` or `common/` package anywhere: name the topic.
- No module-level state beyond what `core/` builds once per process (the clients), and no mutable default arguments.
- Files ~300 lines and functions ~40, counting no blanks or comments (`AGENTS.md`, Structure rules). An entrypoint with every route in it is the god file this layout exists to prevent.

## 3. Calling out: databases, services, queues, models

- Only `data/` imports a driver or an SDK client, plus `core/<driver>/`, which builds the client once per process and holds no repository and no query.
- A query is built from the typed arguments of the repository's interface, always parameterised; never a string assembled from input.
- An upstream call has an explicit timeout, a retry policy for idempotent operations only, and raises `UpstreamError` (with the status and a safe slice of the body) on failure; a client never returns `{"ok": False}`.
- A message consumer is idempotent: redelivery must not double-send or double-write. Dedupe on a business key or the message id where the operation is not naturally idempotent, and give every message type an explicit retry and dead-letter policy.
- A call to an LLM is outbound like any other: a `domain/repositories` interface in the domain's words (`ReplyDrafter`, `DocumentReader`), a `data/clients` implementation that pins the model version and validates the model's output into a typed result before the domain sees it. The model proposes; a use-case decides.

## 4. Tooling and checks

| Tool | What it enforces | Command |
| --- | --- | --- |
| uv | the workspace, the lock, the Python version (`.python-version`) | `uv sync --frozen` |
| ruff | lint (at least `E F W I N B UP SIM RUF A S PL C90`) and formatting | `uv run ruff check` and `uv run ruff format --check` |
| pyright | types, strict mode | `uv run pyright` |
| import-linter | the layers: per feature, a `layers` contract with `api` and `data` as independent siblings above `domain`, whose `ignore_imports` holds the one sanctioned crossing as a single wildcard entry written when the contracts are adopted (`<pkg>.features.*.api.** -> <pkg>.features.*.data.messages.**`), never an entry per message, with `unmatched_ignore_imports_alerting = "none"` on that contract because the entry matches nothing until the first consumer exists; `forbidden` contracts keeping drivers, SDKs, `httpx` and Pydantic out of `domain` | `uv run lint-imports` |
| an architecture test | what import-linter cannot say: another feature reached only through its `__init__.py` (an `independence` contract would forbid the public surface too). A pytest that walks every module's imports with `ast` and checks them against the table in §1 | `uv run pytest tests/architecture` |
| pytest | tests, with `integration` as a marker | `uv run pytest -m "not integration"` and `uv run pytest -m integration` |
| pip-audit | known vulnerabilities in the locked runtime dependencies, dev tools left out as `npm audit --omit=dev` does | `req="$(mktemp)" && uv export --frozen --no-dev --no-emit-workspace --no-hashes -o "$req" && uvx pip-audit --no-deps --disable-pip -r "$req"` (weekly and before a release tag; the pins are exact, so nothing is installed to resolve them) |

The repo's `.githooks/pre-push` runs ruff, pyright, import-linter, the architecture test and the unit tests (the fast tier's cheap checks); CI's fast tier runs the same plus the integration tests against emulators and the app's package build. A rule is never relaxed with `|| true` in CI, a per-line ignore that §2 does not allow (one in `domain/`, or one without a rule code and a reason), or a new `ignore_imports` entry to get a push through: either the code changes or the rule is changed for the whole repo in its own PR.

`uv sync` has no lifecycle hook like npm's `prepare`, so the README's setup command (`make setup` or `just setup`) runs `uv sync` and installs the hook the way `templates/install-git-hooks.mjs` does: a shim at `$(git rev-parse --git-common-dir)/hooks/pre-push`, shared by every worktree, that runs the current worktree's `.githooks/pre-push` when it exists (`hook="$(git rev-parse --show-toplevel)/.githooks/pre-push"; [ -f "$hook" ] || exit 0; exec sh "$hook" "$@"`). Never `core.hooksPath`. The hook itself copies `templates/pre-push`'s change detection and replaces its npm block with the commands above.

## 5. Tests

```
tests/
  unit/          entities, value objects and use-cases with the repository Protocols faked from testing/; no network, no emulator
  integration/   data/ repositories against the database's emulator or a test instance; clients against a local stub server checked against the upstream's published schema
  api/           controllers called with a built host request, the use-cases faked: status, envelope and validation errors
```

- Unit tests are plain pytest functions with async support (`pytest-asyncio` or `anyio`); a fake is a small class satisfying the Protocol, not a `MagicMock` with return values set per test.
- Integration tests carry `@pytest.mark.integration` and skip, with the reason, when the emulator's URL is unset; CI sets it.
- A consumer's test covers success, a malformed payload (dead-lettered, not retried) and redelivery (no second effect).

Before reporting work done: ruff, pyright, import-linter, the unit and integration tests, and the app's build. A change that crosses a service boundary gets a pass on the real local stack, reading a record with data in it.

## 6. What goes wrong, and the correct form

| Seen in reviews | Do this instead |
| --- | --- |
| One entrypoint module of thousands of lines holding every route, query and rule | The entrypoint composes `create_<feature>` calls; each feature holds its own layers |
| A `shared/` folder copied into each app, already diverging | One workspace package in `packages/`, installed by every app that needs it |
| A use-case reading `req.get_json()["phone"]` | The controller parses into a schema, maps to `<Case>Input`, and calls `execute` |
| A domain class importing `azure.cosmos` or `pydantic` | A Protocol in `domain/repositories`; the driver and the model in `data/` |
| `LeadService` with twenty public methods | One `*_use_case.py` per case, each exposing `execute` alone |
| A constants module of a thousand lines mixing messages, URLs and rules | Rules in their entity or `domain/reference`, copy and per-customer values in configuration |
| `tenant_id = os.environ.get("TENANT_ID", "acme")` | Resolve the tenant at the boundary from the request; missing is an error |
| f-string query with a value from the request | A parameterised query built inside the repository from typed arguments |
| `except Exception: return {"ok": False}` | Raise a typed error; the host's mapper shapes the response |
| A sync SDK call inside an async handler | The SDK's async client, built once in `core/` |
| `print(payload)` while debugging, left in | A structured log of ids and outcomes |
| `ruff check . \|\| true` in CI | Fix the findings; the gate blocks |
| `shared/utils.py` | `shared/<topic>/` for business code, `core/<topic>/` for plumbing |

## Checklist for a review brief

1. Layering: `domain/` imports no driver, SDK, `httpx`, Pydantic, `data/` or `api/` (only `core/errors` from core); use-cases never import a use-case and take only types from another feature; `api/` reaches `data/` only for a message definition; no feature imports another's internals, only its `__init__.py`.
2. Placement: inbound in `api/`, outbound in `data/`; storage and upstream shapes in `data/models` with one mapper; wire shapes in `api/schemas`; entities are frozen dataclasses holding only what use-cases read.
3. import-linter and the architecture test green with no new `ignore_imports`; `core/` is plumbing and imports no feature or `shared/`; `shared/` is cross-feature business code with two importers and no repository, use-case, infrastructure, `utils` or `helpers`; code two apps share is a workspace package, never a copy.
4. Every inbound payload parsed into a schema; every outbound call behind a narrow Protocol the feature owns.
5. Errors raised typed and mapped in one place; envelope shapes unchanged unless the issue says so.
6. Only `data/` and `core/<driver>/` touch a driver; queries parameterised; upstream calls with timeouts; consumers idempotent with a dead-letter policy.
7. Config only through `core/config`; no default tenant or account; no secret, token or PII in a log.
8. One `*UseCase` class per module exposing `async execute(command: <Case>Input) -> <Case>Output`, both frozen dataclasses in that module.
9. Types: fully annotated, pyright strict green, no `Any`/`cast`/ignore in `domain/`; async end to end.
10. Tests: unit with fakes from `testing/`, repositories against an emulator, controllers with a built request, consumers on redelivery and a bad payload.
11. Files ~300 lines, functions ~40; snake_case modules with the role suffix; ruff, pyright and import-linter green with no new ignores beyond the coded, reasoned ones §2 allows outside `domain/`.
12. New or rewritten features: layer folders only once they hold a file, a sub-package only from the second module of its kind, a split by sub-feature when a layer passes ~15 modules.
