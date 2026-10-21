import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

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

test("offDefaultBranchWarning names a clone left on a branch other than origin's default, and not one on it", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { cleanGitEnv } = await import("./support/git-env.mjs");
  const root = mkdtempSync(join(tmpdir(), "agent-config-branch-"));
  const git = (dir, ...args) => {
    const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8", env: cleanGitEnv() });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    const origin = join(root, "origin");
    const clone = join(root, "clone");
    spawnSync("git", ["init", "-q", "-b", "main", origin], { env: cleanGitEnv() });
    writeFileSync(join(origin, "a.txt"), "x");
    git(origin, "add", "a.txt");
    git(origin, "commit", "-q", "-m", "base");
    git(root, "clone", "-q", origin, clone);
    assert.equal(offDefaultBranchWarning(clone), null);
    git(clone, "switch", "-q", "-c", "feat/x");
    assert.match(offDefaultBranchWarning(clone), /on branch feat\/x, not main/);
    git(clone, "switch", "-q", "--detach");
    assert.equal(offDefaultBranchWarning(clone), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
