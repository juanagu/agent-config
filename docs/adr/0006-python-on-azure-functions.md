# ADR 0006: Python on Azure Functions is a supported backend stack

Date: 2026-11-16. Status: accepted.

## Context

The standards named one backend stack, Fastify with MongoDB and BullMQ. A product now runs on Azure with a Python Function App estate (WhatsApp bots, LLM calls, Cosmos DB, Storage queues) that grew without layers: entrypoints of thousands of lines, a `shared/` folder copied between apps and already diverging, anonymous tool endpoints, keys in app settings, a default tenant, timers that rescan state, and a lint step that could never fail. Rewriting it in Fastify would mean leaving the organisation's Azure platform and its Python libraries for LLM and document work; leaving it without a skill means every agent writes Python from memory, with no layout and no checklist to review against.

## Decision

Python on Azure Functions is a second backend stack, with the same rules as the first expressed in two skills. `python-architecture` holds the language half and applies to any Python host: a uv workspace of apps and shared packages, `domain/`, `data/` and `api/` per feature with the same dependency table as Fastify, frozen-dataclass entities, one `*UseCase` class per case over `typing.Protocol` repositories, Pydantic only at the boundaries, and ruff, pyright strict, import-linter and pytest as the checks. `azure-functions-architecture` holds the host half: `function_app.py` as the composition root, one Blueprint per feature built by its factory, triggers as thin adapters, no anonymous endpoint, managed identity, Cosmos DB and Service Bus behind repositories, deterministic Durable orchestrators, and one CI-built package per app.

`backend-engineer` owns both stacks and loads the skill for the repo it is in. `AGENTS.md` says when to pick which: Fastify by default, Python on Azure Functions when the platform is Azure or the work is mostly LLM, document or data processing.

## Alternatives

- **One skill for Python and Azure Functions together.** Rejected: the layering, naming and tooling hold for a Python CLI or container just as well, and a second host would otherwise copy them.
- **A separate `python-engineer` agent.** Rejected for now: the role, boundaries and done criteria are the backend engineer's; only the skill differs. Split it if the two stacks' agents start to disagree on more than the skill.
- **mypy instead of pyright.** Either enforces strict typing; pyright was chosen for speed and strict mode by configuration. A repo already on mypy strict keeps it.
- **Keep Fastify as the only backend.** Rejected: it would force a platform move the product's owners have not asked for.

## Consequences

- Every architecture skill's "Not for" clause names both new skills (`tests/skills.test.mjs` checks it).
- `templates/pre-push`, `templates/ci.yml` and the `dependency-audit` skill are still npm-only; a Python repo adapts them by hand from the commands in `python-architecture` §4 until they get Python variants.
