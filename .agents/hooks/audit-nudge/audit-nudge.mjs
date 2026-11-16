#!/usr/bin/env node
// Session-start hook: when the last dependency audit is a week old, or never ran, tells the agent
// to run the dependency-audit skill; otherwise prints nothing. It reads one local file, makes no
// network call, never reads stdin and always exits 0, so it can neither fail nor slow a session.
// The skill writes the file when it finishes (`node audit.mjs --stamp`); both take its path from
// the skill's stamp.mjs.
//
//   node audit-nudge.mjs --tool claude|cursor|copilot|antigravity
import { readFileSync } from "node:fs";

export const DUE_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// Loaded when the hook runs rather than imported, so a missing skill folder cannot crash a session.
const STAMP_MODULE = "../../skills/dependency-audit/stamp.mjs";
// Same reason: without the shared file the hook has nothing to say, and says it silently.
const shared = await import("../session-answer.mjs").catch(() => null);

export const NUDGE = "The weekly dependency audit is due: tell the user, and run the dependency-audit skill unless they say not now (it records the run when it finishes).";

// The file holds an ISO date. Anything unparseable counts as never run. A date up to a day ahead
// (time zones, a clock a little off) counts as recent; one further ahead is wrong and would
// otherwise silence the nudge for as long, so it counts as due.
export function isDue(stampText, now = Date.now()) {
  const last = Date.parse(String(stampText ?? "").trim());
  if (Number.isNaN(last) || last - now > DAY_MS) return true;
  return now - last >= DUE_AFTER_DAYS * DAY_MS;
}

export function answer(tool, due) {
  if (!due || !shared) return "";
  return shared.answerFor(tool, NUDGE);
}

// A missing file means the audit never ran here. Any other read error stays silent: a nudge the
// user cannot act on is noise.
function readStamp(path) {
  try {
    return { text: readFileSync(path, "utf8") };
  } catch (error) {
    return error?.code === "ENOENT" ? { text: null } : null;
  }
}

export async function run(argv = process.argv.slice(2), env = process.env, now = Date.now()) {
  const { stampPath } = await import(STAMP_MODULE);
  const stamp = readStamp(stampPath(env));
  if (!stamp) return "";
  return answer(shared?.toolArg(argv), isDue(stamp.text, now));
}

if (shared?.invokedDirectly(import.meta.url)) {
  try {
    const out = await run();
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // Never let the nudge get in a session's way.
  }
  process.exitCode = 0;
}
