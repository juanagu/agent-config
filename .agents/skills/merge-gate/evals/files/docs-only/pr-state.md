# PR #12 — docs(readme): fix the install command for Windows

Repo: acme/cli-tool. The project's standards grant the agent merge rights.

## Diff
```
 README.md | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

## Review history
- Round 1, high pass: 1 bug (the PowerShell line used `&&`, which Windows PowerShell 5.1 rejects), 2 nits. Fixed in 77e0b13.
- Round 2, medium pass on 77e0b13: "No verified correctness bugs on the main paths."

## Local checks (re-run by the session on 77e0b13)
- `npm test` 96 passed; the README's two commands run as written in PowerShell 5.1 and bash.

## `gh pr checks 12`
```
no checks reported on the 'docs/windows-install' branch
```

## .github/workflows/ci.yml (excerpt)
```yaml
on:
  pull_request:
    paths-ignore: ["**/*.md", "docs/**"]
  push:
    branches: [main]
```
