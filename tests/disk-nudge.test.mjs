// The session-start disk nudge (.agents/hooks/disk-nudge/): warns only when the home drive's free
// space is under the threshold, in each tool's answer shape, reads nothing else, and always exits 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answer, DEFAULT_MIN_FREE_GB, freeGbAt, minFreeGb, nudgeText, run } from "../.agents/hooks/disk-nudge/disk-nudge.mjs";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(repoDir, ".agents", "hooks", "disk-nudge", "disk-nudge.mjs");
const GB = 1024 ** 3;
const statOf = (freeGb) => () => ({ bavail: freeGb, bsize: GB });

test("the threshold is 20 GB, and AGENT_CONFIG_DISK_MIN_GB overrides it unless it is not a positive number", () => {
  assert.equal(DEFAULT_MIN_FREE_GB, 20);
  assert.equal(minFreeGb({}), 20);
  assert.equal(minFreeGb({ AGENT_CONFIG_DISK_MIN_GB: "50" }), 50);
  for (const bad of ["", "abc", "0", "-3"]) assert.equal(minFreeGb({ AGENT_CONFIG_DISK_MIN_GB: bad }), 20, bad);
});

test("free space is read from statfs in GB", () => {
  assert.equal(freeGbAt("/x", statOf(8)), 8);
});

test("below the threshold the nudge is printed; at or above it, nothing", () => {
  assert.equal(answer("claude", 8), nudgeText(8));
  assert.equal(answer("claude", 19.9), nudgeText(19.9));
  assert.equal(answer("claude", 20), "");
  assert.equal(answer("claude", 300), "");
  assert.equal(answer("claude", 30, 50), nudgeText(30));
});

test("the text names the amount, the skill, the user and the volume rule", () => {
  const text = nudgeText(8.04);
  assert.match(text, /8\.0 GB/);
  assert.match(text, /docker-reclaim/);
  assert.match(text, /tell the user/);
  assert.match(text, /Never delete volumes/);
});

test("each tool gets its own answer shape", () => {
  const text = nudgeText(5);
  assert.deepEqual(JSON.parse(answer("cursor", 5)), { additional_context: text });
  assert.deepEqual(JSON.parse(answer("copilot", 5)), { additionalContext: text });
  assert.deepEqual(JSON.parse(answer("antigravity", 5)), { injectSteps: [{ systemMessage: { systemMessage: text } }] });
});

test("run() applies the env override to the home drive's free space", () => {
  assert.equal(run(["--tool", "claude"], {}, statOf(10), "/home"), nudgeText(10));
  assert.equal(run(["--tool", "claude"], { AGENT_CONFIG_DISK_MIN_GB: "5" }, statOf(10), "/home"), "");
  assert.equal(run(["--tool", "copilot"], { AGENT_CONFIG_DISK_MIN_GB: "11" }, statOf(10), "/home"), JSON.stringify({ additionalContext: nudgeText(10) }));
});

function runHook(minGb, ...args) {
  return spawnSync(process.execPath, [HOOK, ...args], { encoding: "utf8", env: { ...process.env, AGENT_CONFIG_DISK_MIN_GB: minGb }, timeout: 10_000 });
}

test("as a script: a huge threshold prints the nudge, a tiny one prints nothing, both exit 0", () => {
  const low = runHook("100000000", "--tool", "claude");
  assert.equal(low.status, 0);
  assert.match(low.stdout, /docker-reclaim skill/);
  const cursor = runHook("100000000", "--tool", "cursor");
  assert.match(JSON.parse(cursor.stdout).additional_context, /docker-reclaim/);
  const fine = runHook("0.000001");
  assert.equal(fine.status, 0);
  assert.equal(fine.stdout, "");
});
