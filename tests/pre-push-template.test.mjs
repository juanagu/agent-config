// templates/pre-push under sh in a throwaway repo: tag pushes skip, a branch push runs the
// scripts only when it is the checked-out HEAD, a mixed push still runs them, and a new branch
// that only touches CI-ignored paths skips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanGitEnv } from "./support/git-env.mjs";

const template = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "templates", "pre-push"), "utf8");
const ZERO = "0".repeat(40);
const IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];
const git = (dir, ...args) => execFileSync("git", [...IDENTITY, ...args], { cwd: dir, encoding: "utf8", env: cleanGitEnv() }).trim();

// A POSIX sh: on PATH, else the one Git for Windows ships beside its exec path.
function findSh() {
  const candidates = ["sh"];
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8", env: cleanGitEnv() }).trim();
  for (const up of ["../../../usr/bin/sh.exe", "../../../bin/sh.exe", "../../usr/bin/sh.exe", "../../bin/sh.exe"]) {
    candidates.push(join(execPath, up));
  }
  return candidates.find((candidate) => spawnSync(candidate, ["-c", "exit 0"], { env: cleanGitEnv() }).status === 0);
}
const sh = findSh();

function withRepo({ headFile = "src.txt", templateEdit = (text) => text }, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pre-push-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    mkdirSync(join(dir, "node_modules"));
    const touch = "node -e \"require('fs').appendFileSync('ran','x')\"";
    const scripts = Object.fromEntries(["lint", "typecheck", "test"].map((name) => [name, touch]));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts, devDependencies: { x: "1" } }));
    writeFileSync(join(dir, ".gitignore"), "ran\nnode_modules\npre-push\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(dir, dirname(headFile)), { recursive: true });
    writeFileSync(join(dir, headFile), "x");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "head");
    const head = git(dir, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--allow-empty", "-m", "other");
    const other = git(dir, "rev-parse", "HEAD");
    git(dir, "reset", "-q", "--hard", head);
    writeFileSync(join(dir, "pre-push"), templateEdit(template));
    fn({ dir, head, other, ran: () => existsSync(join(dir, "ran")) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const push = (dir, lines) =>
  spawnSync(sh, ["pre-push", "origin"], { cwd: dir, input: lines.join("\n") + "\n", encoding: "utf8", env: cleanGitEnv({ CI: "" }) });

function pushTest(name, options, body) {
  test(name, { skip: sh ? false : "sh not available" }, () => withRepo(options, body));
}

pushTest("a tag-only push exits 0 without running the scripts", {}, ({ dir, head, ran }) => {
  assert.equal(push(dir, [`refs/tags/v1 ${head} refs/tags/v1 ${ZERO}`]).status, 0);
  assert.equal(ran(), false);
});

pushTest("a branch push of HEAD runs the scripts", {}, ({ dir, head, ran }) => {
  assert.equal(push(dir, [`refs/heads/f ${head} refs/heads/f ${ZERO}`]).status, 0);
  assert.equal(ran(), true);
});

pushTest("a branch push of a sha that is not HEAD fails closed", {}, ({ dir, other, ran }) => {
  assert.equal(push(dir, [`refs/heads/f ${other} refs/heads/f ${ZERO}`]).status, 1);
  assert.equal(ran(), false);
});

pushTest("a tag mixed with HEAD's branch still runs the scripts", {}, ({ dir, head, ran }) => {
  const result = push(dir, [`refs/tags/v1 ${head} refs/tags/v1 ${ZERO}`, `refs/heads/f ${head} refs/heads/f ${ZERO}`]);
  assert.equal(result.status, 0);
  assert.equal(ran(), true);
});

const ignoreDocs = (text) => text.replace("CI_IGNORED=''", "CI_IGNORED='^docs/'");

pushTest("a new branch that only touches CI-ignored paths skips the checks", { headFile: "docs/a.md", templateEdit: ignoreDocs }, ({ dir, head, ran }) => {
  const result = push(dir, [`refs/heads/f ${head} refs/heads/f ${ZERO}`]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /only files CI ignores changed/);
  assert.equal(ran(), false);
});

pushTest("a new branch touching a path CI runs on is not skipped", { headFile: "src.txt", templateEdit: ignoreDocs }, ({ dir, head, ran }) => {
  assert.equal(push(dir, [`refs/heads/f ${head} refs/heads/f ${ZERO}`]).status, 0);
  assert.equal(ran(), true);
});
