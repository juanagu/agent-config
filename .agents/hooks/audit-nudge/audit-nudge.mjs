#!/usr/bin/env node
// Session-start hook: when the last dependency audit is a week old, or never ran, tells the agent
// to run the dependency-audit skill; otherwise prints nothing. It reads one local file, makes no
// network call, never reads stdin and always exits 0, so it can neither fail nor slow a session.
// The skill writes the file when it finishes (`node audit.mjs --stamp`).
//
//   node audit-nudge.mjs --tool claude|cursor|copilot|antigravity
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DUE_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const NUDGE = "The weekly dependency audit is due: tell the user, and run the dependency-audit skill unless they say not now (it records the run when it finishes).";

// The skill's helper resolves the same path (.agents/skills/dependency-audit/stamp.mjs); a test keeps them equal.
export function stampPath(env = process.env, home = homedir()) {
  return env.AGENT_CONFIG_AUDIT_STAMP || join(home, ".config", "agent-config", "last-dependency-audit");
}

// The file holds an ISO date. Anything unparseable counts as never run; a date in the future
// (a clock moved back) counts as recent.
export function isDue(stampText, now = Date.now()) {
  const last = Date.parse(String(stampText ?? "").trim());
  if (Number.isNaN(last)) return true;
  return now - last >= DUE_AFTER_DAYS * DAY_MS;
}

// How each tool takes text into the session's context at start (docs/compatibility.md).
const ANSWERS = {
  claude: (text) => text,
  cursor: (text) => JSON.stringify({ additional_context: text }),
  copilot: (text) => JSON.stringify({ additionalContext: text }),
  antigravity: (text) => JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] }),
};

export function answer(tool, due) {
  if (!due) return "";
  return (ANSWERS[tool] ?? ANSWERS.claude)(NUDGE);
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

function toolArg(argv) {
  const at = argv.indexOf("--tool");
  return at === -1 ? "claude" : argv[at + 1];
}

export function run(argv = process.argv.slice(2), env = process.env, now = Date.now()) {
  const stamp = readStamp(stampPath(env));
  if (!stamp) return "";
  return answer(toolArg(argv), isDue(stamp.text, now));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const out = run();
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // Never let the nudge get in a session's way.
  }
  process.exitCode = 0;
}
