# ADR 0005: Free static scanners, with the project's own rules first

Date: 2026-10-31. Status: accepted.

## Context

Security checks today are `npm audit`, Dependabot, the review passes and `security-engineer`. The rules that matter most in these projects (money as integers, no `console.log` in a backend, a schema on every Fastify route, no database filter built from request input, cookie flags) are checked only by a reader. Paid scanners are out of scope, and every app repo is private, so GitHub code scanning's SARIF upload (Advanced Security on private repos) is not available either.

## Decision

- **Semgrep Community Edition**, a pinned version, runs as steps inside the fast tier's one `checks` job (a job of its own would pay its own setup and minute) and reports only findings new since a baseline, with `--error --metrics=off`: on a PR the base branch, on a push to trunk the previous trunk head, so two merges that combine into a finding are still caught. It runs the repo's own rules in `.semgrep/`, each with a `semgrep --test` case, plus a few ERROR-level registry rules. Pre-push runs it only when the Semgrep on PATH is the pinned version, against each pushed branch's merge base with `origin/main`, and skips with a note otherwise. The full scan with registry packs runs on the weekly and tag runs in a job of its own. How the shallow checkout gets the history the baseline needs, and the edge cases (a first push, a force push, several refs in one push), are the template's to settle, with tests in `tests/ci-template.test.mjs` and `tests/pre-push-template.test.mjs`.
- **eslint-plugin-security**, a named subset in each TypeScript repo's lint, so pre-push, CI and the editor run it: `detect-eval-with-expression`, `detect-child-process`, `detect-non-literal-require`, `detect-non-literal-regexp`, `detect-unsafe-regex`, `detect-buffer-noassert`, `detect-new-buffer`, `detect-pseudoRandomBytes`, `detect-bidi-characters`. `detect-unsafe-regex` is a heuristic and stays on because a ReDoS in a request path is a real outage; a false hit follows the suppression rule below. Off: `detect-object-injection`, `detect-non-literal-fs-filename` and `detect-possible-timing-attacks`, which on typed code flag ordinary indexing, file access and comparisons far more often than a bug; `detect-disable-mustache-escape` and `detect-no-csrf-before-method-override`, which target Mustache and Express, neither used here.
- **Trivy**, on the weekly and tag runs only, in repos that ship a container image: it builds the image from that run's commit and runs `trivy image` for OS packages and secrets. Its npm vulnerability scanner stays off, since `npm audit` and Dependabot cover it. It is installed from a pinned release whose SHA-256 is committed in the workflow, never a checksum file downloaded beside the binary (a replaced release replaces both), or run by image digest; never through `aquasecurity/trivy-action` or `setup-trivy`.
- **Reporting a weekly or tag run.** The full Semgrep scan and Trivy each report a red run the way the template's `npm-audit` job does, opening an issue or commenting on the open one from their own job, so they report in a service repo too, where the template removes `report-full-tier`.
- **Pinning.** An action from outside GitHub's own `actions/` organisation is pinned to a full commit SHA; `actions/*` keep the major tags the template uses.
- **Results** are CI annotations and a JSON artifact. Agents read a digest (rule, severity, `file:line`, message, fingerprint, new or not) written by the `static-scan` skill's helper, never raw tool output. A scanner hit is a lead, `PLAUSIBLE` until traced to reachable input; `code-reviewer` receives the CI digest in its brief and never runs scanners.
- **Suppression.** A Semgrep rule that misfires is narrowed in `.semgrep/` with a test that proves it; an ESLint rule that misfires on a repo's code is turned off in that repo's config with the reason beside it. A single accepted finding gets the tool's own inline form (`nosemgrep: <rule-id>` where Semgrep documents it, `eslint-disable-next-line <rule>`) with the reason in a comment beside it. An agent never adds either to pass a check: it lists the finding under Needs the user, and the user approves each suppression in review. This is the one exception to the standards' "never add a disable comment", and only with that approval.
- The repos adopt this through their own issues, starting with one pilot that measures the added CI time. TypeScript repos first; a native Android or iOS repo adopts Semgrep (which reads Kotlin and Swift) through its own issue, with rules written for that language.

## Alternatives

- **eslint-plugin-security's `recommended` set.** Rejected: the three rules above make it noisy enough that agents would "fix" non-issues or learn to suppress.
- **eslint-plugin-sonarjs.** Rejected: mostly code quality, overlapping `unicorn` and the size rules.
- **Semgrep for Dart, or a Dart security lint.** Rejected for now: Semgrep's Dart support is experimental and there is no maintained Dart security rule set; `flutter analyze` stays.
- **Trivy on every PR, or its filesystem vulnerability scan.** Rejected: it repeats `npm audit` and Dependabot, and only repos that ship an image have anything else for it to scan. Its config checks find little without Terraform or Kubernetes; a workflow linter (zizmor) is a separate decision.
- **`trivy-action`.** Rejected: its tags were repointed to a credential stealer in March 2026 (CVE-2026-33634).
- **SARIF upload to code scanning.** Rejected: paid on private repos.
- **Opengrep** (the Semgrep CE fork). Not chosen today; the engines are interchangeable on the same rule files, so switching is a CI and skill change.
- **Scanners in the git guard.** Rejected: the guard decides git commands, makes no network call and must stay fast and fail open.
- **Copying registry rules into the templates.** Rejected: they are under the Semgrep Rules License and this repo is public. The starter rules are written here.

## Consequences

- A PR's fast tier gains about 30–60 seconds, to be measured in the pilot before the other repos adopt it.
- New `security-engineer` findings of a recurring class become a rule with a test, so the next instance fails CI instead of waiting for a reader.
- Rollout order: the `static-scan` skill, the templates and their tests, the agents, then the standards, `merge-gate` and `open-pr`, so nothing names what does not exist yet.
