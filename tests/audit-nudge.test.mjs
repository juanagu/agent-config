// The session-start nudge (.agents/hooks/audit-nudge/): due when the dependency-audit skill's date
// file is missing or a week old, silent otherwise, in each tool's answer shape, and always exit 0.
// The path comes from the skill's stamp.mjs, which both import; both scripts also run when reached
// through a junction or symlink, which is how a global install links the skill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answer, isDue, NUDGE, run } from "../.agents/hooks/audit-nudge/audit-nudge.mjs";
import { stampPath, writeStamp } from "../.agents/skills/dependency-audit/stamp.mjs";
import { freshDir } from "./support/fixture-clone.mjs";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(repoDir, ".agents", "hooks", "audit-nudge", "audit-nudge.mjs");
const DAY = 24 * 60 * 60 * 1000;

const SKILL = join(repoDir, ".agents", "skills", "dependency-audit");

function runHook(stamp, ...args) {
  return runScript(HOOK, stamp, ...args);
}

function runScript(script, stamp, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, AGENT_CONFIG_AUDIT_STAMP: stamp }, timeout: 10_000 });
}

test("isDue: a missing or unreadable date is due, a week-old one is due, a recent or future one is not", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  assert.equal(isDue(null, now), true);
  assert.equal(isDue("not a date", now), true);
  assert.equal(isDue(new Date(now - 7 * DAY).toISOString(), now), true);
  assert.equal(isDue(new Date(now - 6 * DAY).toISOString(), now), false);
  assert.equal(isDue(`${new Date(now + DAY).toISOString()}\n`, now), false);
});

test("a missing date file prints the nudge and exits 0", (t) => {
  const result = runHook(join(freshDir(t), "never-written"));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${NUDGE}\n`);
  assert.match(NUDGE, /dependency-audit skill/);
});

test("a date older than a week prints the nudge; a recent one prints nothing", (t) => {
  const stamp = join(freshDir(t), "last-dependency-audit");
  writeFileSync(stamp, `${new Date(Date.now() - 8 * DAY).toISOString()}\n`);
  const due = runHook(stamp, "--tool", "claude");
  assert.equal(due.status, 0);
  assert.equal(due.stdout.trim(), NUDGE);

  writeFileSync(stamp, `${new Date(Date.now() - DAY).toISOString()}\n`);
  const quiet = runHook(stamp, "--tool", "claude");
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, "");
});

test("an unreadable date file (a directory) prints nothing and still exits 0", (t) => {
  const stamp = join(freshDir(t), "a-directory");
  mkdirSync(stamp);
  const result = runHook(stamp);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("each tool gets its own answer shape, and nothing when not due", (t) => {
  assert.equal(answer("claude", true), NUDGE);
  assert.deepEqual(JSON.parse(answer("cursor", true)), { additional_context: NUDGE });
  assert.deepEqual(JSON.parse(answer("copilot", true)), { additionalContext: NUDGE });
  assert.deepEqual(JSON.parse(answer("antigravity", true)), { injectSteps: [{ systemMessage: { systemMessage: NUDGE } }] });
  for (const tool of ["claude", "cursor", "copilot", "antigravity"]) assert.equal(answer(tool, false), "", tool);
  const cursor = runHook(join(freshDir(t), "missing"), "--tool", "cursor");
  assert.deepEqual(JSON.parse(cursor.stdout), { additional_context: NUDGE });
});

test("the date file defaults to ~/.config/agent-config/last-dependency-audit, and run() reads it from there", async (t) => {
  const home = freshDir(t);
  assert.equal(stampPath({}, home), join(home, ".config", "agent-config", "last-dependency-audit"));
  assert.equal(await run(["--tool", "copilot"], { AGENT_CONFIG_AUDIT_STAMP: join(home, "missing") }), JSON.stringify({ additionalContext: NUDGE }));
});

// A junction on Windows (no privilege needed), a directory symlink elsewhere; skipped where neither can be made.
function linkTo(t, target) {
  const link = join(freshDir(t), "linked");
  try {
    symlinkSync(target, link, "junction");
    return link;
  } catch {
    return null;
  }
}

test("both scripts run when reached through a junction or symlink, as a global install links them", (t) => {
  const skill = linkTo(t, SKILL);
  const hooks = linkTo(t, dirname(HOOK));
  if (!skill || !hooks) return t.skip("this OS cannot make a directory link here");
  const stamp = join(freshDir(t), "last-dependency-audit");
  assert.equal(runScript(join(hooks, "audit-nudge.mjs"), stamp).stdout, `${NUDGE}
`, "the linked hook prints the nudge");
  const stamped = runScript(join(skill, "audit.mjs"), stamp, "--stamp");
  assert.equal(stamped.status, 0, stamped.stderr);
  assert.match(stamped.stdout, /Recorded the audit/);
  assert.ok(!Number.isNaN(Date.parse(readFileSync(stamp, "utf8").trim())), "the linked helper wrote the date");
  assert.equal(runScript(join(hooks, "audit-nudge.mjs"), stamp).stdout, "", "and the hook is quiet after it");
});

test("a run recorded by the skill silences the hook for a week", (t) => {
  const stamp = join(freshDir(t), "nested", "last-dependency-audit");
  writeStamp(new Date(), { AGENT_CONFIG_AUDIT_STAMP: stamp });
  assert.ok(!Number.isNaN(Date.parse(readFileSync(stamp, "utf8").trim())));
  assert.equal(runHook(stamp).stdout, "");
});
