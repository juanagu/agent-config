// Child-process environment for tests that run git: without the variables git exports to hooks, a
// run from inside a hook (pre-commit, pre-push) can never act on the real repository.
const GIT_REPO_VARS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"];

export function cleanGitEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of GIT_REPO_VARS) delete env[name];
  return { ...env, ...extra };
}
