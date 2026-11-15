// The global git identity, checked once per global run: without a user.email GitHub knows, git
// authors commits as user@hostname, which links to no account. A check that warns, never a failure.
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import { hasCommand } from "./env.mjs";
import { isRealHome } from "./paths.mjs";

const GH_TIMEOUT_MS = 10_000;
const HOSTNAME_SUFFIXES = [".local", ".localdomain", ".lan", ".home", ".internal"];

export const noreplyAddress = ({ id, login }) => `${id}+${login}@users.noreply.github.com`;

// "unset", "hostname" (git's or a machine-made default) or null for an address that can be a real one.
export function identityProblem(email, host = hostname()) {
  if (!email) return "unset";
  const domain = email.split("@").pop().toLowerCase();
  const machine = host.toLowerCase();
  if (!email.includes("@") || !domain.includes(".")) return "hostname";
  if (HOSTNAME_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return "hostname";
  return domain === machine || domain === machine.split(".")[0] ? "hostname" : null;
}

// The warning for `email`, or null when it is fine. `github` is { id, login } when gh knew them.
export function identityMessage(email, github, host = hostname()) {
  const problem = identityProblem(email, host);
  if (!problem) return null;
  const address = github ? noreplyAddress(github) : "<id>+<login>@users.noreply.github.com";
  const why = problem === "unset" ? "git has no global user.email, so commits are authored as user@hostname" : `git's global user.email is ${email}, a hostname default`;
  const lines = [`Warning: ${why}, which GitHub cannot link to your account. Set your GitHub noreply address:`, `  git config --global user.email "${address}"`];
  if (!github) lines.push(`  (your id and login: gh api user -q '.id,.login')`);
  return lines.join("\n");
}

// Under another --home, git reads that home's .gitconfig and gh is not asked: it answers for the
// real account, over the network.
export async function checkGitIdentity(home, prompter) {
  const email = globalEmail(home);
  if (!identityProblem(email)) return;
  const github = isRealHome(home) ? githubUser() : null;
  console.warn(identityMessage(email, github));
  if (!github) return;
  const address = noreplyAddress(github);
  if (!(await prompter.confirm("gitIdentity", `Set git's global user.email to ${address}?`, false))) return;
  const set = spawnSync("git", ["config", "--global", "user.email", address], { encoding: "utf8", env: gitEnv(home) });
  console.log(set.status === 0 ? `Set git's global user.email to ${address}.` : `git config failed: ${set.stderr.trim()}`);
}

function gitEnv(home) {
  return isRealHome(home) ? process.env : { ...process.env, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") };
}

function globalEmail(home) {
  const result = spawnSync("git", ["config", "--global", "--get", "user.email"], { encoding: "utf8", env: gitEnv(home) });
  return result.status === 0 ? result.stdout.trim() : "";
}

function githubUser() {
  if (!hasCommand("gh")) return null;
  const result = spawnSync("gh", ["api", "user", "-q", ".id,.login"], { encoding: "utf8", timeout: GH_TIMEOUT_MS });
  const [id, login] = result.status === 0 ? result.stdout.trim().split("\n") : [];
  return id && login ? { id, login } : null;
}
