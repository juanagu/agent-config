import { spawnSync } from "node:child_process";

export function hasCommand(name) {
  const probe =
    process.platform === "win32"
      ? spawnSync("where.exe", [name], { stdio: "ignore" })
      : spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
  return probe.status === 0;
}

// Runs a command sharing the terminal; the exit code comes back, 1 with a message when
// the command could not be started at all.
export function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`${command} could not be started: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function runNode(script, args) {
  return run(process.execPath, [script, ...args]);
}

// Fast-forwards the clone. Untracked files are fine; a modified tracked file is not,
// since a pull could not be undone cleanly over it.
export function gitPull(repoDir) {
  const status = git(repoDir, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.error) throw new Error(`git could not be started: ${status.error.message}`);
  if (status.status !== 0) throw new Error(`${repoDir} is not a git clone, so there is nothing to pull.`);
  if (status.stdout.trim()) throw new Error(`${repoDir} has uncommitted changes. Commit or stash them before updating.`);
  if (run("git", ["-C", repoDir, "pull", "--ff-only"]) !== 0) throw new Error("git pull --ff-only failed.");
}

// The tools' folders link into the clone's working tree, so they serve whatever branch is checked
// out, and a pull fast-forwards that branch, not the default one. A detached HEAD (a pinned tag)
// or a clone without origin/HEAD gets no warning.
export function offDefaultBranchWarning(repoDir) {
  const current = git(repoDir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const remoteHead = git(repoDir, ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
  if (current.status !== 0 || remoteHead.status !== 0) return null;
  const branch = current.stdout.trim();
  const defaultBranch = remoteHead.stdout.trim().replace(/^origin\//, "");
  if (!branch || !defaultBranch || branch === defaultBranch) return null;
  return `Warning: ${repoDir} is on branch ${branch}, not ${defaultBranch}, and the installed links serve the checked-out branch. Run: git -C "${repoDir}" switch ${defaultBranch}, then update again.`;
}

export function gitOriginUrl(repoDir) {
  const result = git(repoDir, ["remote", "get-url", "origin"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function git(repoDir, args) {
  return spawnSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
}
