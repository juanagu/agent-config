# The git guard

A hook that runs before every shell command the agent issues and refuses the git and `gh` commands that bypass a trunk-based workflow or disturb a checkout that is serving a dev server, and the deploy or infrastructure commands you declare as aimed at a protected environment. It exists because a rule in a standards file is followed most of the time, and "most of the time" is how a commit lands on `main`.

## What it refuses

The exact forms are the header comment of `.agents/hooks/git-guard/git-guard.mjs`, pinned by its tests.

- **Writing commits to trunk**: `commit`, `merge`, `rebase`, `cherry-pick`, `revert`, `am` while on `main` (or the branch `origin/HEAD` points at).
- **Pushing to trunk**: naming it, a bare `git push` while on it, a bare push from a branch whose upstream is trunk, a force-push to it, deleting it.
- **Bypassing hooks**: `--no-verify`, `commit -n`, `-c` overrides of `core.hooksPath`, `commit.gpgsign` or `gpg.*`.
- **Switching branches in a protected checkout**: `switch`, `checkout`, `gh pr checkout`, `gh co`, `git stash branch`, and a stash push, save, pop or apply there, because each rewrites the served working tree. The block message gives the worktree recipe instead.
- **A declared CLI aimed at a protected environment**: see [Protected environments](#protected-environments).
- **Unsafe stash forms anywhere**: an entry without a message, a `pop`/`apply`/`drop`/`branch` without a stash reference, `clear`. The stash stack is shared across worktrees and sessions, so only a tagged entry applied by hash is safe.

It follows `cd`, `pushd`/`popd`, `Set-Location`, `git -C`, compound commands, heredocs (a commit message is not a command; `<<-` closes on a tab-indented delimiter, and a `<<` inside quotes or a `<<<` here-string opens nothing), Git Bash paths on Windows, and `git.exe`/`gh.exe`. Any error inside the hook fails open: the command runs. It is a guard against forgetting, not a security boundary.

## Protected checkouts

```json
{ "protectedCheckouts": ["C:/Users/me/Projects/my-app", "/home/me/projects/api"] }
```

in `~/.config/agent-config/git-guard.json`. `GIT_GUARD_CONFIG` overrides the path; `~/.claude/git-guard.json` is read when the new file is absent, for people coming from claude-code-config. The file is per machine and stays out of git.

## Protected environments

A hosting or infrastructure CLI can open a shell in a running production service, where its database credentials are already set, deploy to it, or change its config. The guard refuses those for every CLI you declare, in the same file:

```json
{
  "protectedEnvironments": [
    {
      "command": ["<cli name>", "<its npm package, for npx>"],
      "environmentFlags": ["--environment", "-e"],
      "protected": ["production"],
      "readOnly": ["status", "logs", "variables list"]
    }
  ]
}
```

- **A protected environment named** (`-e production`, `--environment=production`, `-eproduction`, quoted or not, any case): refused, except the `readOnly` subcommands. A read-only entry matches only as the command's first words, before any option, so `--service logs up` is not read as `logs`; an entry of several words (`variables list`) needs all of them.
- **No environment named**, or a flag left without a value: refused outside `readOnly`, because the CLI would act on whichever environment the folder is linked to. The block message says to name a non-protected one with the first flag.
- **An environment the shell works out at run time** (`-e $ENV`, `-e "$(cat env)"`, a glob): read as a protected one, since it could be.
- **A non-protected environment named** (`-e staging`): allowed. When several are named and one is protected, refused.
- **Deny by default**: a subcommand the config doesn't list is treated as a write. Help runs only in its plain forms (`<cli> --help`, `<cli> up --help`, `<cli> help up`): many CLIs pass what follows a subcommand to the program they run, where `-h` may be a host (`run psql -h db`). An environment flag after `--` belongs to that program too, so it names nothing for the CLI.
- **`command`** is one name or a list: the binary, and the package `npx` or `bunx` runs it as (`@scope/cli`).
- No `protectedEnvironments` key, or no entry for a CLI, changes nothing. A malformed entry (no `command`, an empty `environmentFlags`, no `protected` list) is skipped.

**Fail closed.** Any unquoted word naming a declared CLI is read as a call to it, wherever it sits: as written (`@scope/cli`), by its basename (`/usr/local/bin/cli`, `cli.exe`), or without a package version (`cli@latest`). So it is caught behind any runner or wrapper (`sudo`, `timeout`, `npx`, `pnpm dlx`, `npm exec`), after a background `&`, inside `( … )`, `$( … )` or backticks, in a shell's command string (`bash -e -c '…'`, `pwsh -NoProfile -Command '…'`, `cmd /c "…"`), in a heredoc a shell receives, and across a backslash line continuation. The cost is the occasional false refusal of a word that only mentions the CLI (`grep <cli> notes.txt`, a folder named after it): run that yourself. Text that is never run stays out of it: a single-quoted string, a double-quoted one outside its `$( … )` and backticks, and a heredoc fed to anything but a shell, so a commit message or PR body can name the CLI. It is not recognised inside a script, an alias, a function, `eval`, or a variable holding the name. Like the rest of the guard, it stops a session that forgot to check, not one set on getting round it. When the agent needs one of these commands run, the message tells it to ask you to run it yourself.

### A provider's MCP connector

An MCP connector for the same provider doesn't go through the shell, so this hook never sees its calls, and it holds its own login. A tool's deny rules match tool names, not their arguments, so they can't say "only this environment". Where the connector can act on the whole account, deny every one of its tools, reads included: a read such as listing variables returns secrets. In Claude Code a deny rule on the server does it (`docs/claude-code.md`, Using it); in Cursor, Copilot and Antigravity, turn the connector off in that tool's MCP settings for any session that should not touch the account.

## One core, one adapter per tool

`check(command, cwd)` knows git and shells and nothing about any tool; the protected-environment rule is `environments.mjs` and the config file `config.mjs`. `main()` reads stdin, picks the adapter named by `--tool`, and answers in that tool's dialect:

| `--tool` | Reads the command from | Answers a block with |
| --- | --- | --- |
| `claude` (default) | `tool_input.command` when `tool_name` is `Bash` or `PowerShell` | exit 2, reason on stderr |
| `cursor` | `command` | `{"continue":true,"permission":"deny","user_message":…,"agent_message":…}` |
| `copilot` | `toolArgs.command` when `toolName` is `bash`/`powershell`, or `tool_input.command` when `tool_name` is `Bash` | `{"permissionDecision":"deny","permissionDecisionReason":…}` |
| `antigravity` | `toolCall.args.CommandLine` when `toolCall.name` is `run_command` | `{"decision":"deny","reason":…}` |

The registration files are generated by `scripts/build.mjs` from `scripts/build/targets.mjs` (`HOOK_TARGETS`), one per tool, with the command relative to the project root; the global installer writes the same entries with an absolute path into the tool's user-level hooks file. `docs/compatibility.md` links each tool's hook documentation.

## Trying it by hand

```sh
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"."}' \
  | node .agents/hooks/git-guard/git-guard.mjs --tool claude; echo "exit $?"

echo '{"command":"git commit -m x","cwd":"."}' \
  | node .agents/hooks/git-guard/git-guard.mjs --tool cursor
```

The first prints the reason on stderr and exits 2 (when run on `main`); the second prints the Cursor deny object. `npm test` runs the full suite, which builds throwaway repositories and drives the hook with every tool's payload.

## Changing it

A change is verified by every spelling a shell produces, in `git-guard.test.mjs` with each tool's own payload shape (`--tool`), never by trying one command or only the forms the issue named. Add the test first, then the rule. The spellings that have slipped before:

- a flag before the subcommand, and a flag that takes a value (`gh -R owner/repo pr checkout`);
- the `.exe` names;
- a compound command where an earlier segment changes state (`cd`, `pushd`/`popd`, a switch before a push);
- PowerShell's named-parameter and no-argument forms;
- the help forms, which must stay allowed.

A new blocked form is tested beside its allowed sibling. The suite points the hook at a temporary home (`GIT_GUARD_HOME`), so it never reads or writes your own `~/.config/agent-config/git-guard.json`; a test that edits that fixture restores it. A new tool is a new adapter and a new `describe` block, plus a row in `HOOK_TARGETS` and in `docs/compatibility.md`.
