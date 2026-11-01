# ADR 0005: Free static scanners, with the project's own rules first

Date: 2026-10-31. Status: accepted.

## Context

Security checks today are `npm audit`, Dependabot, the review passes and `security-engineer`. The rules that matter most in these projects (money as integers, no `console.log` in a backend, a schema on every Fastify route, no database filter built from request input, cookie flags) are checked only by a reader. Paid scanners are out of scope, and every app repo is private, so GitHub code scanning's SARIF upload (Advanced Security on private repos) is not available either.

## Decision

- **Semgrep Community Edition** runs in the fast CI tier on new findings only (`--baseline-commit origin/main --error --metrics=off`), with the repo's own rules in `.semgrep/`, each with a `semgrep --test` case, plus a few ERROR-level registry rules. A full scan with registry packs runs on the weekly and tag runs. Pre-push runs it on the pushed diff when it is on PATH and skips with a note otherwise.
- **eslint-plugin-security**, a named subset in each TypeScript repo's lint, so pre-push, CI and the editor run it: `detect-eval-with-expression`, `detect-child-process`, `detect-non-literal-regexp`, `detect-unsafe-regex`, `detect-buffer-noassert`, `detect-new-buffer`, `detect-pseudoRandomBytes`, `detect-bidi-characters`. `detect-object-injection`, `detect-non-literal-fs-filename` and `detect-possible-timing-attacks` stay off: on typed code they flag ordinary indexing and file access far more often than a bug.
- **Trivy**, on the weekly and tag runs only, in repos that ship a container image: `trivy image` for OS packages and secret scanning. Its npm vulnerability scanner stays off, since `npm audit` and Dependabot cover it. It is installed from a pinned release with its checksum verified, or by image digest, never through `aquasecurity/trivy-action` or `setup-trivy`, and every third-party action is pinned to a commit SHA.
- **Results** are CI annotations and a JSON artifact. Agents read a digest (rule, severity, `file:line`, message, fingerprint, new or not) written by the `static-scan` skill's helper, never raw tool output. A scanner hit is a lead, `PLAUSIBLE` until traced to reachable input; `code-reviewer` receives the CI digest in its brief and never runs scanners.
- **Suppression.** A rule that misfires is narrowed in `.semgrep/` with a test that proves it. A single accepted finding gets `// nosemgrep: <rule-id> -- <reason>`, which an agent never adds to pass a check: it lists the finding under Needs the user, and the user approves each suppression in review.
- The repos adopt this through their own issues, starting with one pilot that measures the added CI time.

## Alternatives

- **eslint-plugin-security's `recommended` set.** Rejected: the three rules above make it noisy enough that agents would "fix" non-issues or learn to suppress.
- **eslint-plugin-sonarjs.** Rejected: mostly code quality, overlapping `unicorn` and the size rules.
- **Semgrep for Dart, or a Dart security lint.** Rejected for now: Semgrep's Dart support is experimental and there is no maintained Dart security rule set; `flutter analyze` stays.
- **Trivy on every PR, or its filesystem vulnerability scan.** Rejected: it repeats `npm audit` and Dependabot, and only three repos ship an image today. Its config checks find little without Terraform or Kubernetes; a workflow linter (zizmor) is a separate decision.
- **`trivy-action`.** Rejected: its tags were repointed to a credential stealer in March 2026 (CVE-2026-33634).
- **SARIF upload to code scanning.** Rejected: paid on private repos.
- **Opengrep** (the Semgrep CE fork). Not chosen today; the engines are interchangeable on the same rule files, so switching is a CI and skill change.
- **Scanners in the git guard.** Rejected: the guard decides git commands, makes no network call and must stay fast and fail open.
- **Copying registry rules into the templates.** Rejected: they are under the Semgrep Rules License and this repo is public. The starter rules are written here.

## Consequences

- A PR's fast tier gains about 30–60 seconds, to be measured in the pilot before the other repos adopt it.
- New `security-engineer` findings of a recurring class become a rule with a test, so the next instance fails CI instead of waiting for a reader.
- Rollout order: the `static-scan` skill, the templates and their tests, the agents, then the standards, `merge-gate` and `open-pr`, so nothing names what does not exist yet.
