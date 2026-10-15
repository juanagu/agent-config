import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const envModule = pathToFileURL(fileURLToPath(new URL("../scripts/install/env.mjs", import.meta.url))).href;

// Node's DEP0190 warning (args passed to a child process with shell: true) fires on the tick
// after the spawn, so the probe runs in a child that waits a tick, with the warning fatal.
function probeInChild(name) {
  const script = `import { hasCommand } from ${JSON.stringify(envModule)};
const found = hasCommand(${JSON.stringify(name)});
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(found);`;
  return spawnSync(process.execPath, ["--throw-deprecation", "--input-type=module", "-e", script], { encoding: "utf8" });
}

test("hasCommand finds a command on PATH without spawning a shell", () => {
  const result = probeInChild("git");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "true");
});

test("hasCommand reports a command that is not on PATH as missing", () => {
  const result = probeInChild("agent-config-no-such-command");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "false");
});
