# ADR 0005: Fastify features are split into domain, data and api

Date: 2026-11-12. Status: accepted.

## Context

`fastify-architecture` already followed clean architecture (routes → controller → use-cases → ports → adapters), but each feature spread it over about eight sibling folders (`domain/`, `ports/`, `service/`, `adapters/`, `data/`, `jobs/`, `testing/`, plus `controller.ts` and `routes.ts`). The three layers were there without any folder showing them. `shared/` held two different things, infrastructure (`shared/adapters`) and cross-feature business code (`shared/domain`, `shared/data`). `data/` meant static reference data, which is not what the word means in the Flutter and Android skills.

## Decision

Each feature has three layer folders: `domain/` (entities, value objects, use-cases, repository interfaces, reference data), `data/` (repository implementations, models, mappers, clients for other services, queue definitions and producers, seeds, migrations) and `api/` (routes, schemas, controllers, middlewares, job processors and workers). Placement follows one rule: inbound goes in `api/`, outbound goes in `data/`. A BFF's calls to other services are outbound, so they go in `data/clients`. `core/` holds app infrastructure with no business meaning. `shared/` holds cross-feature business code by topic, under the existing two-importers rule, and never `utils/` or `helpers/`.

Each use-case is one class per module, `AcceptInviteUseCase` in `accept-invite.use-case.ts`, taking its repository interfaces in the constructor and exposing a single public `execute(input: AcceptInviteInput): Promise<AcceptInviteOutput>`. Input and Output are the use-case's request and response models in Clean Architecture's sense: plain data declared in its file, so `api/` maps to and from them and never hands the use-case a request or receives a storage shape. A second thing to do is a second use-case, never a second method.

A layer folder appears with its first file: the skill names `domain/`, `data/` and `api/` as present from the start, the exception the standards' feature-shape rule allows to its second-file threshold. Inside a layer, a sub-folder appears with the second file of its kind. File names carry a dotted role suffix (`*.use-case.ts`, `*.repository.ts`, `*.controller.ts`…), so the boundaries lint knows each file's element type whether it sits flat or in a sub-folder.

## Alternatives

- **`presentation/` for the outer layer**, matching Flutter. Rejected in favour of `api/`: on a backend the inbound layer is an API, and "presentation" reads as UI.
- **`infrastructure/` for the outer layer.** Rejected: in most clean-architecture codebases that word names the outbound side (database, HTTP clients), the opposite of what the folder holds.
- **The full sub-folder tree in every feature.** Rejected: a five-file feature under a dozen near-empty folders hides its code, which is what the standards' feature-shape rule exists to prevent.
- **A use-case as a plain exported function**, the earlier skill's form. Rejected: a class with one `execute` names the case, takes its dependencies visibly in the constructor, and gives every use-case the same call shape, while a function's dependencies hide in its parameters or a closure.
- **Keep the earlier layout.** Rejected: the layers were not visible, `shared/` mixed plumbing with business code, and `data/` meant something different from the mobile skills.

## Consequences

- Repos on the earlier layout keep it until their own migration PR, which moves every feature at once and updates the boundaries config. The mapping is in the skill (§7).
- `AGENTS.md` names `core/` as the backend's home for infrastructure, and `agents/backend-engineer.md` states the new non-negotiables.
- The agent evals for backend-engineer, code-reviewer (`agents/evals/code-reviewer/files/notifications/`) and technical-writer (`agents/evals/technical-writer/files/export/`) still use the earlier layout in their fixtures. That is deliberate: they stand for existing repos, which the agents match, and the rules they test (no repository in `shared/`, narrow ports) hold under both layouts.
