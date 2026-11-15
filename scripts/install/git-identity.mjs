// The global git identity, checked once per global run. It only warns: ~/.gitconfig is the
// user's, so the installer prints the command that fixes it and never runs it.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { hasCommand } from "./env.mjs";
import { isRealHome } from "./paths.mjs";

const GH_TIMEOUT_MS = 10_000;
// Suffixes only machines use; `.lan` or `.internal` can be a company's real mail domain.
const MACHINE_SUFFIXES = [".local", ".localdomain"];
const PLACEHOLDER_ADDRESS = "<id>+<login>@users.noreply.github.com";

export const noreplyAddress = ({ id, login }) => `${id}+${login}@users.noreply.github.com`;

// "unset", "machine" (no domain, or one only a machine makes) or null for an address that can be real.
export function identityProblem(email) {
  if (!email) return "unset";
  if (!email.includes("@")) return "machine";
  const domain = email.split("@").pop().toLowerCase();
  if (!domain.includes(".")) return "machine";
  return MACHINE_SUFFIXES.some((suffix) => domain.endsWith(suffix)) ? "machine" : null;
}

// The warning for a `problem` identityProblem found. `github` is { id, login } when gh knew them.
export function identityMessage(problem, email, github) {
  const address = github ? noreplyAddress(github) : PLACEHOLDER_ADDRESS;
  const why =
    problem === "unset"
      ? "git has no global user.email, so it may refuse to commit, or author commits as user@hostname, which GitHub cannot link to your account"
      : `git's global user.email is ${email}, a machine default GitHub cannot link to your account`;
  const lines = [`Warning: ${why}. To use your GitHub noreply address, run:`, `  git config --global user.email "${address}"`];
  if (!github) lines.push(`  (your id and login: gh api user -q '.id,.login')`);
  return lines.join("\n");
}

// Under another --home, git reads that home's .gitconfig and gh is not asked: it answers for the
// real account, over the network. A user who sets useConfigOnly keeps an identity per repository.
export function checkGitIdentity(home, { findGithubUser = defaultGithubUser } = {}) {
  const configOnly = readGlobal(home, ["--type=bool", "user.useConfigOnly"]);
  if (configOnly.error) return warnUnchecked(configOnly.error);
  if (configOnly.value === "true") return;
  const email = readGlobal(home, ["user.email"]);
  if (email.error) return warnUnchecked(email.error);
  const problem = identityProblem(email.value);
  if (problem) console.warn(identityMessage(problem, email.value, findGithubUser(home)));
}

function warnUnchecked(error) {
  console.warn(`Warning: git's global user.email could not be checked (${error}).`);
}

function gitEnv(home) {
  return isRealHome(home) ? process.env : { ...process.env, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") };
}

// { value }, "" when unset (git's exit 1), or { error } for any other exit or a failed spawn.
function readGlobal(home, keyArgs) {
  const result = spawnSync("git", ["config", "--global", "--includes", "--get", ...keyArgs], { encoding: "utf8", env: gitEnv(home) });
  if (result.error) return { error: result.error.message };
  if (result.status === 0) return { value: result.stdout.trim() };
  if (result.status === 1) return { value: "" };
  return { error: result.stderr.trim().split(/\r?\n/)[0] || `git exited with ${result.status}` };
}

const defaultGithubUser = (home) => (isRealHome(home) ? githubUser() : null);

function githubUser() {
  if (!hasCommand("gh")) return null;
  const result = spawnSync("gh", ["api", "user", "-q", ".id,.login"], { encoding: "utf8", timeout: GH_TIMEOUT_MS });
  return result.status === 0 ? parseGithubUser(result.stdout) : null;
}

// gh's `.id,.login` answer, one per line (CRLF on Windows), as { id, login } or null.
export function parseGithubUser(stdout) {
  const [id, login] = stdout.split(/\r?\n/).map((part) => part.trim());
  return id && login ? { id, login } : null;
}
