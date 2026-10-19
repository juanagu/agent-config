#!/usr/bin/env node
// Pre-shell hook for Claude Code, Cursor, GitHub Copilot and Antigravity CLI (`--tool <name>`, default
// claude; docs/architecture.md has the table). Enforces the mechanical half of the trunk-based workflow in
// AGENTS.md so it never depends on the model remembering a sentence:
//   - no commit, merge, rebase, cherry-pick, revert or am while on trunk
//   - no push straight to trunk, no force-push to or deletion of it, no bare push from a branch whose
//     upstream is trunk (it lands there under push.default=upstream)
//   - no --no-verify, commit -n, or a -c override that disables hooks or signing
//   - no branch switch in a checkout listed in ~/.config/agent-config/git-guard.json (it serves a dev
//     server), `gh pr checkout` and `git stash branch` included, and no stash push (a bare `git stash`
//     included), save, pop or apply there either: stashing is the parking move before a switch, and it
//     rewrites the served working tree
//   - no stash entry without a message (bare `git stash`, `push`, `save`, `store`), no `pop`, `apply`,
//     `drop` or `branch` without a stash reference, and no `clear`: the stash stack is shared across
//     worktrees and sessions, so only a tagged entry applied by hash is safe
// The decision (`check`) is tool-agnostic; adapters.mjs holds each tool's payload and deny shape.
// Any error in the hook itself fails open.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS } from "./adapters.mjs";
import {
  hasShortFlag,
  moveDirectory,
  newDirectoryState,
  positionals,
  program,
  skipPrefix,
  splitSegments,
  toNativePath,
  tokens,
} from "./shell-parse.mjs";

const WRITES_COMMITS = new Set(["commit", "merge", "rebase", "cherry-pick", "revert", "am"]);
const STASH_ACTIONS = new Set(["push", "save", "pop", "apply", "list", "show", "drop", "clear", "branch", "create", "store"]);
const STASH_NEEDS_REF = new Set(["pop", "apply", "drop", "branch"]);
const STASH_NEEDS_MESSAGE = new Set(["push", "store"]);
const STASH_REWRITES_TREE = new Set(["push", "save", "pop", "apply"]);
const STASH_SAFE_FORM =
  "Use git stash push -u -m <tag>, then git stash apply <sha> (git stash list --format='%H %s' shows the hashes), or make a WIP commit on the branch.";
const GH_VALUE_FLAGS = new Set(["-R", "--repo", "-b", "--branch"]);
const CREATE_FLAGS = new Set(["-b", "-B", "-c", "-C", "--orphan"]);
const DISABLING_CONFIG = /^(core\.hookspath|commit\.gpgsign|gpg\.)/i;
const DEFAULT_TRUNKS = ["main", "master"];
const CONFIG_HINT = "~/.config/agent-config/git-guard.json";

// GIT_GUARD_CONFIG wins; otherwise the current file, falling back to the one claude-code-config wrote.
export function configPath() {
  if (process.env.GIT_GUARD_CONFIG) return process.env.GIT_GUARD_CONFIG;
  const home = process.env.GIT_GUARD_HOME ?? homedir();
  const current = path.join(home, ".config", "agent-config", "git-guard.json");
  const legacy = path.join(home, ".claude", "git-guard.json");
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function normalize(p) {
  return path.resolve(toNativePath(p)).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function loadProtectedCheckouts() {
  const file = configPath();
  if (!existsSync(file)) return [];
  const config = JSON.parse(readFileSync(file, "utf8"));
  return (config.protectedCheckouts ?? []).map(normalize);
}

function isRef(dir, name) {
  try {
    git(dir, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function trunkOf(dir, branch) {
  try {
    return git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).replace(/^origin\//, "");
  } catch {
    return DEFAULT_TRUNKS.find((t) => t === branch || isRef(dir, t)) ?? DEFAULT_TRUNKS[0];
  }
}

// The branch `branch` tracks, without its remote (`origin/main` → `main`), or null.
function upstreamOf(dir, branch) {
  try {
    return git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`]).replace(/^[^/]+\//, "");
  } catch {
    return null;
  }
}

// `gh pr checkout <n>` (and `gh co`) switches the current checkout to the PR's branch. It is read as
// a checkout of `pr/<n>`, a name git cannot resolve yet, so the switch rules apply to it as to any branch.
function parseGh(toks) {
  const i = skipPrefix(toks);
  if (program(toks[i]) !== "gh") return null;
  const args = [];
  for (let j = i + 1; j < toks.length; j++) {
    if (GH_VALUE_FLAGS.has(toks[j])) j++;
    else if (!toks[j].startsWith("-")) args.push(toks[j]);
  }
  const isCheckout = (args[0] === "pr" && args[1] === "checkout") || args[0] === "co";
  if (!isCheckout) return null;
  const pr = args[args[0] === "co" ? 1 : 2] ?? "current";
  return { sub: "checkout", rest: [`pr/${pr}`], dirOverride: null, configs: [] };
}

function parseGit(toks) {
  let i = skipPrefix(toks);
  if (program(toks[i]) !== "git") return null;
  i++;
  let dirOverride = null;
  const configs = [];
  while (i < toks.length && toks[i].startsWith("-")) {
    if (toks[i] === "-C") dirOverride = toks[i + 1];
    if (toks[i] === "-c") configs.push(toks[i + 1] ?? "");
    i += toks[i] === "-C" || toks[i] === "-c" ? 2 : 1;
  }
  return { sub: toks[i], rest: toks.slice(i + 1), dirOverride, configs };
}

function skipsHooks(sub, rest, configs) {
  if (rest.includes("--no-verify")) return true;
  if (configs.some((c) => DISABLING_CONFIG.test(c))) return true;
  return sub === "commit" && hasShortFlag(rest, "n");
}

function isForce(rest) {
  return rest.some((a) => a === "--force" || a.startsWith("--force-with-lease")) || hasShortFlag(rest, "f");
}

// `+main`, `refs/heads/main`, `HEAD:main` and `feat:refs/heads/main` all land on main.
function destinationOf(refspec) {
  const dst = refspec.includes(":") ? refspec.slice(refspec.indexOf(":") + 1) : refspec;
  return dst.replace(/^\+/, "").replace(/^refs\/heads\//, "");
}

function isHead(ref) {
  return ref === "HEAD" || ref === "@" || /^(HEAD|@)[~^]/.test(ref);
}

function pushReason(rest, onTrunk, trunk, upstream) {
  const refs = positionals(rest);
  const named = refs.some((a) => destinationOf(a) === trunk || (isHead(a) && onTrunk));
  if (rest.includes("--delete") || rest.includes("-d")) {
    return named ? `Deleting the remote ${trunk} isn't allowed.` : null;
  }
  const everything = rest.includes("--all") || rest.includes("--mirror");
  const bare = refs.length <= 1 && !rest.includes("--tags");
  if (bare && !onTrunk && upstream === trunk) {
    return `This branch tracks ${trunk}, so a bare git push lands on it under push.default=upstream (and refuses under simple). Push with git push -u origin <branch>.`;
  }
  if (!named && !(bare && onTrunk) && !everything) return null;
  return isForce(rest) || refs.some((a) => a.startsWith("+"))
    ? `Force-pushing ${trunk} rewrites shared history. Not allowed.`
    : `Pushing straight to ${trunk} bypasses the PR gate. Push a branch and open a PR.`;
}

// The one worktree recipe. AGENTS.md's Workflow section quotes it; keep the two equal.
export function worktreeRecipe(trunk) {
  return `git worktree add ../worktrees/<repo>-wt-<name> --no-track -b <type>/<name> origin/${trunk}`;
}

const servedPreamble = (toplevel) => `${toplevel} serves a running dev server (it is listed in ${CONFIG_HINT}); `;

function switchReason(toplevel, trunk) {
  return (
    servedPreamble(toplevel) +
    "switching its branch hot-reloads other code under whoever is using the app. " +
    `Use a worktree instead: ${worktreeRecipe(trunk)}, then copy the env files and run npm ci there (AGENTS.md, Workflow).`
  );
}

// Stashing is the parking move before a switch, and it rewrites the served working tree the same way.
// `stash create` + `stash store` record the change without touching the tree.
function stashInServedReason(toplevel, trunk) {
  return (
    servedPreamble(toplevel) +
    "a stash push, save, pop or apply rewrites its working tree under whoever is using the app. " +
    "Record the change without a second rewrite: git stash create, then git stash store -m <tag> <sha> " +
    `(tracked changes only; copy untracked files by hand), and git stash apply <sha> in a worktree (${worktreeRecipe(trunk)}). ` +
    "The served tree keeps its uncommitted edits; tell the user, since cleaning it is their call."
  );
}

// The branch a `switch`/`checkout` lands on, or null when it only touches files.
// "-" (the previous branch) and a branch that exists only on origin both count as a switch.
function switchTarget(dir, sub, rest) {
  if (rest.includes("--") || rest.includes("-p") || rest.includes("--patch")) return null;
  const create = rest.findIndex((a) => CREATE_FLAGS.has(a));
  if (create !== -1) return rest[create + 1] ?? "-";
  const args = positionals(rest);
  if (sub === "switch") return args[0] ?? null;
  if (args.length !== 1) return null;
  const [arg] = args;
  const looksLikeBranch = arg === "-" || isRef(dir, arg) || isRef(dir, `origin/${arg}`) || !existsSync(path.resolve(dir, arg));
  return looksLikeBranch ? arg : null;
}

// A stash message is a value, not a positional or a flag: `git stash -u -m pop` is a push whose message
// is "pop", and `-m -h` is not a request for help.
function stashArgs(rest) {
  const args = [];
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--message" || /^-[a-zA-Z]*m$/.test(a)) {
      flags.push(a);
      i++;
    } else if (a.startsWith("-")) flags.push(a);
    else args.push(a);
  }
  return { args, flags };
}

const stashPositionals = (rest) => stashArgs(rest).args;

const stashAction = (args) => (STASH_ACTIONS.has(args[0]) ? args[0] : "push");

// The stash stack is shared by every worktree and session of the repo: an entry without a message is
// anonymous, and an action without a stash reference takes whichever entry is on top.
function stashReason(rest, args) {
  const action = stashAction(args);
  const more = args.slice(1);
  const shared = "a stash stack shared across worktrees and sessions";
  if (action === "clear") return `git stash clear deletes every entry on ${shared}. ${STASH_SAFE_FORM}`;
  if (STASH_NEEDS_REF.has(action)) {
    const hasRef = more.length >= (action === "branch" ? 2 : 1);
    return hasRef ? null : `git stash ${action} without a stash reference takes whatever is on top of ${shared}. ${STASH_SAFE_FORM}`;
  }
  if (action === "save") return more.length ? null : `git stash save without a message leaves an anonymous entry on ${shared}. ${STASH_SAFE_FORM}`;
  if (!STASH_NEEDS_MESSAGE.has(action)) return null;
  const hasMessage = rest.some((a) => a === "--message" || a.startsWith("--message=")) || hasShortFlag(rest, "m", true);
  return hasMessage ? null : `A git stash ${action} without a message leaves an anonymous entry on ${shared}. ${STASH_SAFE_FORM}`;
}

// `git stash branch <name> <stash>` creates and switches to <name>, so the switch rules apply to it.
function asSwitch(parsed) {
  const [action, name] = stashPositionals(parsed.rest);
  return parsed.sub === "stash" && action === "branch" ? { ...parsed, sub: "switch", rest: ["-c", name] } : parsed;
}

// Where the segment runs: the checkout's top level, and its branch as of this point in the command
// (a switch earlier in the same command moved HEAD, so from then on only the recorded branch is known).
function locate(dir, state) {
  try {
    const toplevel = git(dir, ["rev-parse", "--show-toplevel"]);
    const key = normalize(toplevel);
    const switched = state.branches.has(key);
    const branch = switched ? state.branches.get(key) : git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return { toplevel, key, branch };
  } catch {
    return null;
  }
}

// The shared-stack rule is syntactic and holds even where the repo cannot be located. The served rule
// needs the repo and comes first where it applies, so a bare `git stash` in a served checkout is sent to
// the recording recipe rather than to a tagged push the next check would refuse.
function stashReasons(rest, dir, state) {
  const { args, flags } = stashArgs(rest);
  if (flags.includes("--help") || flags.includes("-h")) return null;
  if (STASH_REWRITES_TREE.has(stashAction(args))) {
    const where = locate(dir, state);
    if (where && state.protectedCheckouts.includes(where.key)) return stashInServedReason(where.toplevel, trunkOf(dir, where.branch));
  }
  return stashReason(rest, args);
}

function checkGit(parsedGit, dir, state) {
  if (parsedGit.sub === "stash") {
    const reason = stashReasons(parsedGit.rest, dir, state);
    if (reason) return reason;
  }
  const { sub, rest, configs } = asSwitch(parsedGit);
  if (skipsHooks(sub, rest, configs)) return "--no-verify (or a config override of hooks/signing) is not allowed. Fix what the hook reports instead.";
  const where = locate(dir, state);
  if (!where) return null;
  const { toplevel, key, branch } = where;
  const trunk = trunkOf(dir, branch);
  const onTrunk = branch === trunk;
  const served = state.protectedCheckouts.includes(key);

  if (WRITES_COMMITS.has(sub) && onTrunk) {
    return `You are on ${branch}. Writing commits to trunk locally (${sub}) bypasses the PR gate: git switch -c <type>/<name> first, then open a PR.`;
  }
  if (sub === "push") return pushReason(rest, onTrunk, trunk, upstreamOf(dir, branch));
  if (sub === "switch" || sub === "checkout") {
    const target = switchTarget(dir, sub, rest);
    if (!target) return null;
    if (served) return switchReason(toplevel, trunk);
    if (target !== "-") state.branches.set(key, target);
  }
  return null;
}

export function check(command, cwd) {
  const state = { protectedCheckouts: loadProtectedCheckouts(), branches: new Map() };
  const dirs = newDirectoryState(cwd);
  for (const segment of splitSegments(command)) {
    const toks = tokens(segment);
    if (moveDirectory(dirs, toks)) continue;
    const parsed = parseGit(toks) ?? parseGh(toks);
    if (!parsed) continue;
    const repoDir = parsed.dirOverride ? path.resolve(dirs.current, toNativePath(parsed.dirOverride)) : dirs.current;
    const reason = checkGit(parsed, repoDir, state);
    if (reason) return reason;
  }
  return null;
}

function toolFlag(argv) {
  const i = argv.indexOf("--tool");
  return i === -1 ? "claude" : argv[i + 1];
}

// Reads the payload in the tool's shape, decides, and answers in the tool's dialect. Anything unexpected
// (an unknown tool, a payload that does not parse, an error in the check) lets the command run.
function main() {
  const adapter = ADAPTERS[toolFlag(process.argv.slice(2))];
  let reason = null;
  try {
    if (!adapter) return 0;
    const call = adapter.read(JSON.parse(readFileSync(0, "utf8")));
    if (!call || !/\b(git|gh)\b/.test(call.command)) return 0;
    reason = check(call.command, call.cwd ?? process.cwd());
  } catch {
    return 0;
  }
  if (!reason) return 0;
  return adapter.deny(`git-guard: ${reason}`);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    // realpath: a tool's user folder may be a junction or symlink into the config clone.
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exit(main());
}
