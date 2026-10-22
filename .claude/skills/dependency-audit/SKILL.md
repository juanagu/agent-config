---
name: "dependency-audit"
description: "Free, recurring vulnerability check for one repo or every sibling clone of a project: npm audit split into production and dev, the Node version pinned in Dockerfiles, CI, .nvmrc and engines against nodejs.org's security releases, the local node, and the repo's open Dependabot alerts; triaged into one table, with an issue per confirmed actionable finding. Trigger when the user asks for a dependency or vulnerability audit, when the session-start nudge says the weekly audit is due, and before pushing a release tag. Not for a code security review or threat model (security-audit, security-threat-model) or for upgrading one known package."
---

# Dependency audit

Free checks only: npm's audit endpoint, nodejs.org's release index and GitHub's Dependabot alerts, which are on for every repo. The output is a triaged table and issues; fixes go through the normal PR workflow.

## Steps

1. **Gather.** Run the helper beside this file (Node built-ins only), on the repo, or on every clone of the project:

   ```sh
   node <this skill's folder>/audit.mjs <repo-dir>
   node <this skill's folder>/audit.mjs --all <folder holding the clones> --match <prefix, e.g. cmc->
   ```

   It prints one JSON report: per repo `npm` (findings with `scope`, `fix` and `advisories`), `runtime` (each Node pin with a `status`), `dependabot` (open alerts), plus `local` for this machine's `node --version`. npm's endpoint times out under load; the helper retries with backoff and, when it stays down, reports `source: "lockfile"` with the installed versions instead. Say so in the table: npm's half is unchecked that run, and the Dependabot alerts are the only advisory source for it. `unavailable` (no `gh`, a 403) is likewise unchecked, never clean.

2. **Triage** each finding, merging an npm finding and a Dependabot alert for the same advisory into one row:
   - **Production before dev.** `scope: production` first, npm's and Dependabot's alike; dev tooling second.
   - **What the fix costs.** `patch-minor`: a semver-compatible update. `major`: a breaking upgrade. `none`: nothing upstream yet. `downgrade` (npm proposing an older major than the one installed, as with `eslint-config-next@14` for an installed 16) counts as **no fix**.
   - **Reachability.** Note when the vulnerable code never runs where it could be reached: a dev server or UI that isn't started (Vitest's `--ui`/`--api`, a bundler's dev server used only on localhost), a build-time tool, or a manifest that is never installed (eval fixtures, examples). Unreachable lowers the priority; it does not make a production finding disappear.
   - **Runtime.** `behind` is a pin whose newest release is older than its major line's newest security release (a `node:22.11-alpine` image a year of security releases back); its fix is a patch bump of the pin. `eol: true` is a major past end of life, a major upgrade. `range` (`engines`) is a floor, not a pin: report it, act only when nothing else pins the version. `floating` tags move on their own. A `behind` local node is the user's to update; say it, file nothing.

3. **Confirm before filing.** Check the advisory's affected range against the installed version and that the package really is in the dependency tree (`npm ls <package>`). Drop what doesn't hold, and say why in the table.

4. **Report one table**, production first, then by severity:

   | Repo | Package or pin | Severity | Scope | Fix | Reachable | Action |
   | --- | --- | --- | --- | --- | --- | --- |

   Under it, one line per check that didn't run (npm fallback, Dependabot unavailable, release index unreachable).

5. **File the follow-up**, one issue per confirmed actionable finding, in the repo it lives in. Search open issues first (`gh issue list --state open --search "<GHSA id or package>"`) and comment on a match instead of opening a duplicate. Add each issue to the project's board where it has one.
   - A **patch or minor** fix to a **production** dependency or a Node pin: the issue, then a normal PR that closes it (`npm update <package>` or `npm audit fix` without `--force`, or the pin bumped), through the repo's usual workflow.
   - A **major** upgrade: its own issue with the advisory, what breaks, and the reachability note; it is planned work, not a drive-by.
   - **Dev-only** patch or minor fixes: one issue per repo listing them, fixed in one PR when convenient.
   - **No fix** (`none` or `downgrade`): an issue only for production and reachable, saying what mitigates it until upstream ships; otherwise the table row is enough.
   Never run `npm audit fix --force`: it installs whatever npm picks, downgrades and majors included.

6. **Record the run**: `node <this skill's folder>/audit.mjs --stamp`, once the table is out. The session-start nudge reads that date and stays quiet for a week.

Before a release tag, run it on that repo and bring any production high or critical finding to the user before the tag is pushed.
