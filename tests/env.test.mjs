import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "./support/git-env.mjs";

const envModule = new URL("../scripts/install/env.mjs", import.meta.url).href;

// DEP0190 (args passed to a child process with shell: true) is a runtime warning from Node 24;
// --throw-deprecation turns it into a crash, so each probe runs in a child of its own.
const warnsOnShellArgs = Number(process.versions.node.split(".")[0]) >= 24;
const unlessWarns = warnsOnShellArgs ? false : "DEP0190 is not a runtime warning before Node 24";

// NODE_OPTIONS is cleared so a --no-deprecation in the environment cannot mute the warning.
const runChild = (script) => spawnSync(process.execPath, ["--throw-deprecation", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
const probe = (name) => runChild(`import { hasCommand } from ${JSON.stringify(envModule)}; console.log(hasCommand(${JSON.stringify(name)}));`);

test("hasCommand finds a command on PATH", () => {
  const result = probe("node");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "true");
});

test("hasCommand reports a command missing from PATH", () => {
  const result = probe("agent-config-no-such-command");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "false");
});

// Positive control: the two tests above only pin "no args through shell: true" if this fails.
test("a probe passing args through shell: true fails under --throw-deprecation", { skip: unlessWarns }, () => {
  const result = runChild(`import { spawnSync } from "node:child_process"; spawnSync("echo", ["x"], { stdio: "ignore", shell: true });`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DEP0190/);
});

const { offDefaultBranchWarning } = await import(envModule);

const gitIn = (dir, ...args) => {
  const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8", env: cleanGitEnv() });
  assert.equal(result.status, 0, result.stderr);
};

// An origin with one commit on main and a clone of it, so origin/HEAD is set as in a real clone.
function withClone(fn) {
  const root = mkdtempSync(join(tmpdir(), "agent-config-branch-"));
  try {
    const origin = join(root, "origin");
    const clone = join(root, "clone");
    gitIn(root, "init", "-q", "-b", "main", origin);
    writeFileSync(join(origin, "a.txt"), "x");
    gitIn(origin, "add", "a.txt");
    gitIn(origin, "commit", "-q", "-m", "base");
    gitIn(root, "clone", "-q", origin, clone);
    fn(clone);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("offDefaultBranchWarning names a clone on a branch other than origin's default, and not one on it or detached", () => {
  withClone((clone) => {
    assert.equal(offDefaultBranchWarning(clone), null);
    gitIn(clone, "switch", "-q", "-c", "feat/x");
    assert.match(offDefaultBranchWarning(clone), /on branch feat\/x, not main/);
    gitIn(clone, "switch", "-q", "--detach");
    assert.equal(offDefaultBranchWarning(clone), null);
  });
});

test("gitPull warns about the branch before a pull that then fails on a branch without an upstream", () => {
  withClone((clone) => {
    gitIn(clone, "switch", "-q", "-c", "feat/x");
    const call = "import { gitPull } from " + JSON.stringify(envModule) + ";" +
      "try { gitPull(" + JSON.stringify(clone) + "); } catch (error) { console.error(error.message); process.exit(3); }";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", call], { encoding: "utf8", env: cleanGitEnv() });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /on branch feat\/x, not main[\s\S]*git pull --ff-only failed/);
  });
});

test("gitPull acts on the clone even when a hook's GIT_DIR points elsewhere", () => {
  withClone((clone) => {
    const other = mkdtempSync(join(tmpdir(), "agent-config-other-"));
    try {
      gitIn(other, "init", "-q");
      const call = "import { gitPull } from " + JSON.stringify(envModule) + "; gitPull(" + JSON.stringify(clone) + ");";
      const env = { ...cleanGitEnv(), GIT_DIR: join(other, ".git") };
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", call], { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
