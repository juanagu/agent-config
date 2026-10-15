# ADR 0002: The repository root is the drop-in

Date: 2026-10-15. Status: accepted.

## Context

People adopt a setup like this in two ways: committed into one project so the whole team's tools read it, or installed once per machine. `claude-code-config` only did the second. A community repo needs the first to be the obvious path, and both need to stay in step.

## Decision

The repository root is laid out exactly as a project that uses it: `AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`, `.cursor/`, `.github/hooks/` and `.github/agents/` at their final paths. Copying those into a project is the install. The repo's own sessions, in any of the four tools, read the same files.

`scripts/install.mjs` has two modes over the same files: `--project` copies them into a directory (refusing to overwrite a file that differs unless `--force`), `--global` links or copies them into each tool's user folders and writes the hook registration with an absolute path. `bin/bootstrap.mjs` is the `npx` entry for both.

## Alternatives

- **Generated `dist/<tool>/` folders.** Rejected: four committed copies of the skills, and the repo's own sessions would read the sources rather than what users get, so a broken output could go unnoticed.
- **Global install only.** Rejected: Cursor has no user-level standards file and Copilot's cloud agent reads only the repository, so for two of the four tools a per-project install is the only complete one.
- **A package on npm.** Deferred: `npx github:` needs no publishing step and a fork works the moment `repository` in `package.json` changes.

## Consequences

- Dogfooding is automatic: a stale generated file or a broken hook registration shows up in the next session in this repo.
- Claude Code's skills must be a copy (`.claude/skills/`), because it does not read `.agents/skills/`; the build keeps the copy current and the test fails when it is not.
- A project that installs for one tool still gets `.agents/hooks/git-guard/`, because every registration points at it.
