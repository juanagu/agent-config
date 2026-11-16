// What the session-start nudges (audit-nudge, disk-nudge) share: how each tool takes text into
// the session's context, which tool was asked for, and whether a script was run directly. The
// hooks load this file when they run, so a missing one silences them instead of crashing a session.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// How each tool takes text into the session's context at start (docs/compatibility.md).
const ANSWERS = {
  claude: (text) => text,
  cursor: (text) => JSON.stringify({ additional_context: text }),
  copilot: (text) => JSON.stringify({ additionalContext: text }),
  antigravity: (text) => JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] }),
};

export const answerFor = (tool, text) => (ANSWERS[tool] ?? ANSWERS.claude)(text);

export function toolArg(argv) {
  const at = argv.indexOf("--tool");
  return at === -1 ? "claude" : argv[at + 1];
}

// realpath on both sides: a tool's user folder may reach the script through a junction or symlink.
export function invokedDirectly(scriptUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(scriptUrl));
  } catch {
    return false;
  }
}
