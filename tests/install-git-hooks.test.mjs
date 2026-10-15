// templates/install-git-hooks.mjs against a throwaway git repo: it installs a marked shim in the
// shared hooks dir, and installs nothing when core.hooksPath is set, when a foreign hook is there,
// when the committed hook has CRLF, or in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanGitEnv } from "./support/git-env.mjs";

const installer = join(dirname(dirname(fileURLToPath(import.meta.url))), "templates", "install-git-hooks.mjs");
const MARKER = "# managed-by: install-git-hooks";
const VALID_HOOK = "#!/bin/sh\nexit 0\n";

function inRepo(committedHook, fn) {
  const dir = mkdtempSync(join(tmpdir(), "install-hooks-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, env: cleanGitEnv() });
    mkdirSync(join(dir, ".githooks"));
    writeFileSync(join(dir, ".githooks", "pre-push"), committedHook);
    fn(dir, join(dir, ".git", "hooks", "pre-push"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function install(dir, env = {}) {
  execFileSync("node", [installer], { cwd: dir, env: cleanGitEnv({ CI: "", ...env }), stdio: "ignore" });
}

test("writes the marked shim into the common hooks dir", () => {
  inRepo(VALID_HOOK, (dir, hook) => {
    install(dir);
    assert.ok(readFileSync(hook, "utf8").includes(MARKER));
  });
});

test("skips when core.hooksPath is set", () => {
  inRepo(VALID_HOOK, (dir, hook) => {
    execFileSync("git", ["config", "core.hooksPath", "elsewhere"], { cwd: dir, env: cleanGitEnv() });
    install(dir);
    assert.equal(existsSync(hook), false);
  });
});

test("leaves a foreign hook untouched", () => {
  inRepo(VALID_HOOK, (dir, hook) => {
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\necho mine\n");
    install(dir);
    assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\necho mine\n");
  });
});

test("skips when the committed hook has CRLF", () => {
  inRepo("#!/bin/sh\r\nexit 0\r\n", (dir, hook) => {
    install(dir);
    assert.equal(existsSync(hook), false);
  });
});

test("does nothing and exits 0 in CI", () => {
  inRepo(VALID_HOOK, (dir, hook) => {
    install(dir, { CI: "1" });
    assert.equal(existsSync(hook), false);
  });
});
