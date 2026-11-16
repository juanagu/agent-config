#!/usr/bin/env node
// Session-start hook: when the drive holding the home directory is low on free space, tells the
// agent to say so and to run the docker-reclaim skill; otherwise prints nothing. It reads the
// drive's free space (statfs) and nothing else: no docker call, no network, never stdin, always
// exit 0, so it can neither fail nor slow a session.
//
//   node disk-nudge.mjs --tool claude|cursor|copilot|antigravity
import { realpathSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MIN_FREE_GB = 20;
const GB = 1024 ** 3;

export const nudgeText = (freeGb) =>
  `The home drive has only ${freeGb.toFixed(1)} GB free: tell the user, and if Docker is installed run the docker-reclaim skill (report, then the safe prune; compacting Docker's disk on Windows is the user's step). Never delete volumes.`;

// The threshold in GB from AGENT_CONFIG_DISK_MIN_GB; anything that is not a positive number
// falls back to the default rather than silencing the nudge.
export function minFreeGb(env = process.env) {
  const value = Number(env.AGENT_CONFIG_DISK_MIN_GB);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MIN_FREE_GB;
}

// How each tool takes text into the session's context at start (docs/compatibility.md).
const ANSWERS = {
  claude: (text) => text,
  cursor: (text) => JSON.stringify({ additional_context: text }),
  copilot: (text) => JSON.stringify({ additionalContext: text }),
  antigravity: (text) => JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] }),
};

export function answer(tool, freeGb, minGb = DEFAULT_MIN_FREE_GB) {
  if (!(freeGb < minGb)) return "";
  return (ANSWERS[tool] ?? ANSWERS.claude)(nudgeText(freeGb));
}

export function freeGbAt(path, stat = statfsSync) {
  const info = stat(path);
  return (info.bavail * info.bsize) / GB;
}

function toolArg(argv) {
  const at = argv.indexOf("--tool");
  return at === -1 ? "claude" : argv[at + 1];
}

export function run(argv = process.argv.slice(2), env = process.env, stat = statfsSync, home = homedir()) {
  return answer(toolArg(argv), freeGbAt(home, stat), minFreeGb(env));
}

// realpath on both sides: a tool's user folder may reach this file through a junction or symlink.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    const out = run();
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // Never let the nudge get in a session's way.
  }
  process.exitCode = 0;
}
