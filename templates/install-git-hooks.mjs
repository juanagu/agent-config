// Installs a shim in the repo's shared hooks dir (common to all worktrees) that runs the current
// worktree's committed .githooks/pre-push. Never fails an install (Docker build without .git, CI)
// and never touches core.hooksPath, which every worktree shares and which would disable other hooks.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MARKER = '# managed-by: install-git-hooks';
const SHIM = `#!/bin/sh
${MARKER}
# Runs this worktree's committed hook if its branch has one.
hook="$(git rev-parse --show-toplevel)/.githooks/pre-push"
[ -f "$hook" ] || exit 0
exec sh "$hook" "$@"
`;

const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
const gitOptional = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};
const warn = (message) => process.stderr.write(`install-git-hooks: ${message}\n`);

function installHooks() {
  if (process.env.CI) return;
  const hook = resolve(git('rev-parse', '--show-toplevel'), '.githooks/pre-push');
  if (!existsSync(hook)) return;
  const hooksPath = gitOptional('config', '--get', 'core.hooksPath');
  if (hooksPath) return warn(`core.hooksPath is set to ${hooksPath}; pre-push hook not installed`);
  if (readFileSync(hook, 'utf8').includes('\r')) return warn('.githooks/pre-push has CRLF line endings, so no hook was installed; add ".githooks/* text eol=lf" to .gitattributes, then run `git add --renormalize .` and re-checkout the file');
  const target = resolve(git('rev-parse', '--git-common-dir'), 'hooks', 'pre-push');
  if (existsSync(target) && !readFileSync(target, 'utf8').includes(MARKER)) {
    return warn(`${target} already exists and is not ours; left alone.`);
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, SHIM);
    chmodSync(target, 0o755);
  } catch (error) {
    warn(`could not write ${target}: ${error.message}`);
  }
}

function insideWorkTree() {
  try {
    return git('rev-parse', '--is-inside-work-tree') === 'true';
  } catch {
    return false; // git absent or not a repo (Docker build): nothing to install
  }
}

if (insideWorkTree()) {
  try {
    installHooks();
  } catch (error) {
    warn(`pre-push hook not installed: ${error.message}`);
  }
}
