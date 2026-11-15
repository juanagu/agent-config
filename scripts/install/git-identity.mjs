// The global git identity, checked once per global run: without a user.email GitHub knows, git
// authors commits as user@hostname, which links to no account. A check that warns, never a failure.
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import { hasCommand } from "./env.mjs";
import { isRealHome } from "./paths.mjs";

const GH_TIMEOUT_MS = 10_000;
// Suffixes only machines use; `.lan` or `.internal` can be a company's real mail domain.
const HOSTNAME_SUFFIXES = [".local", ".localdomain"];
const PLACEHOLDER_ADDRESS = "<id>+<login>@users.noreply.github.com";

export const noreplyAddress = ({ id, login }) => `${id}+${login}@users.noreply.github.com`;

// "unset", "hostname" (git's or a machine-made default) or null for an address that can be a real one.
export function identityProblem(email, host = hostname()) {
  if (!email) return "unset";
  if (!email.includes("@")) return "hostname";
  const domain = email.split("@").pop().toLowerCase();
  if (!domain.includes(".")) return "hostname";
  if (HOSTNAME_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return "hostname";
  const short = host.toLowerCase().split(".")[0];
  return short && (domain === short || domain.startsWith(`${short}.`)) ? "hostname" : null;
}

// The warning for a `problem` identityProblem found. `github` is { id, login } when gh knew them.
export function identityMessage(problem, email, github) {
  const address = github ? noreplyAddress(github) : PLACEHOLDER_ADDRESS;
  const why = problem === "unset" ? "git has no global user.email, so commits are authored as user@hostname" : `git's global user.email is ${email}, a hostname default`;
  const lines = [`Warning: ${why}, which GitHub cannot link to your account. Set your GitHub noreply address:`, `  git config --global user.email "${address}"`];
  if (!github) lines.push(`  (your id and login: gh api user -q '.id,.login')`);
  return lines.join("\n");
}

// Under another --home, git reads that home's .gitconfig and gh is not asked: it answers for the
// real account, over the network. ~/.gitconfig is not an installer piece, so --yes never changes
// it: the offer is made only at a prompt, or from an answer saved there.
export async function checkGitIdentity(home, prompter, { yes = false, findGithubUser = defaultGithubUser } = {}) {
  const email = globalEmail(home);
  if (email === null) {
    console.warn("Warning: git could not be run, so its global user.email was not checked.");
    return;
  }
  const problem = identityProblem(email);
  if (!problem) return;
  const github = findGithubUser(home);
  console.warn(identityMessage(problem, email, github));
  if (!github || yes) return;
  const address = noreplyAddress(github);
  if (!(await prompter.confirm("gitIdentity", `Set git's global user.email to ${address}?`, false))) return;
  const set = spawnSync("git", ["config", "--global", "user.email", address], { encoding: "utf8", env: gitEnv(home) });
  console.log(set.status === 0 ? `Set git's global user.email to ${address}.` : `git config failed: ${(set.stderr ?? set.error?.message ?? "").trim()}`);
}

function gitEnv(home) {
  return isRealHome(home) ? process.env : { ...process.env, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") };
}

// The address, "" when none is set, or null when git cannot be run at all.
function globalEmail(home) {
  const result = spawnSync("git", ["config", "--global", "--get", "user.email"], { encoding: "utf8", env: gitEnv(home) });
  if (result.error) return null;
  return result.status === 0 ? result.stdout.trim() : "";
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
