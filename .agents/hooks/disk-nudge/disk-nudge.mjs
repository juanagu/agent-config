#!/usr/bin/env node
// Session-start hook: when the drive holding the home directory is low on free space, tells the
// agent to say so and to look at Docker; otherwise prints nothing. It reads the drive's free
// space (statfs) and one local date, and nothing else: no docker call, no network, never stdin,
// always exit 0, so it can neither fail nor slow a session. A prune within the last day keeps it
// quiet, so a drive that stays low does not trigger a prune every session.
//
//   node disk-nudge.mjs --tool claude|cursor|copilot|antigravity
import { readFileSync, statfsSync } from "node:fs";
import { homedir } from "node:os";

export const DEFAULT_MIN_FREE_GB = 20;
export const SNOOZE_HOURS = 24;
const GB = 1024 ** 3;
const HOUR_MS = 60 * 60 * 1000;
// Loaded when the hook runs rather than imported, so a missing file cannot crash a session.
const STAMP_MODULE = "../../skills/docker-reclaim/stamp.mjs";
const stampModule = await import(STAMP_MODULE).catch(() => null);
const shared = await import("../session-answer.mjs").catch(() => null);

export const nudgeText = (freeGb, lastPrune = null) =>
  `The home drive has only ${freeGb.toFixed(1)} GB free${lastPrune ? ` (last docker prune: ${lastPrune})` : ""}: tell the user. If Docker is installed, run the docker-reclaim skill's report; prune only when Docker's images or build cache are what holds the space, and never delete volumes. If a prune already ran and the space is still low on Windows, remind the user of the skill's compact step (their elevated shell) instead of pruning again.`;

// The threshold in GB from AGENT_CONFIG_DISK_MIN_GB; anything that is not a positive number
// falls back to the default rather than silencing the nudge.
export function minFreeGb(env = process.env) {
  const value = Number(env.AGENT_CONFIG_DISK_MIN_GB);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MIN_FREE_GB;
}

// The stamp holds an ISO date. A missing or unparseable one means no prune to wait out; a date
// more than a day ahead is wrong and would otherwise silence the nudge for as long, so it
// does not snooze either (same rule as the audit nudge).
export function isSnoozed(stampText, now = Date.now()) {
  const last = Date.parse(String(stampText ?? "").trim());
  if (Number.isNaN(last) || last - now > 24 * HOUR_MS) return false;
  return now - last < SNOOZE_HOURS * HOUR_MS;
}

// The stamp's date when it parses, for the nudge text; null otherwise.
export const validStamp = (stampText) => (Number.isNaN(Date.parse(String(stampText ?? "").trim())) ? null : String(stampText).trim());

export function answer(tool, freeGb, minGb = DEFAULT_MIN_FREE_GB, snoozed = false, lastPrune = null) {
  if (!(freeGb < minGb) || snoozed || !shared) return "";
  return shared.answerFor(tool, nudgeText(freeGb, lastPrune));
}

export function freeGbAt(path, stat = statfsSync) {
  const info = stat(path);
  return (info.bavail * info.bsize) / GB;
}

function readStamp(env, home) {
  try {
    return readFileSync(stampModule.stampPath(env, home), "utf8");
  } catch {
    return null;
  }
}

export function run(argv = process.argv.slice(2), env = process.env, stat = statfsSync, home = homedir(), now = Date.now()) {
  const stamp = stampModule ? readStamp(env, home) : null;
  return answer(shared?.toolArg(argv), freeGbAt(home, stat), minFreeGb(env), isSnoozed(stamp, now), validStamp(stamp));
}

if (shared?.invokedDirectly(import.meta.url)) {
  try {
    const out = run();
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // Never let the nudge get in a session's way.
  }
  process.exitCode = 0;
}
