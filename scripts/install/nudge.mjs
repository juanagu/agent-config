// The weekly dependency-audit nudge: a session-start hook registered at user level only, because
// the date it reads (~/.config/agent-config/last-dependency-audit) belongs to the machine, not to a
// project. Each tool's entry is added once, re-pointed when it names an older clone, and the
// rest of the user's file is left alone.
import { join } from "node:path";
import { toPosix } from "./paths.mjs";
import { commandSlots } from "./settings.mjs";

export const NUDGE_SCRIPT = ".agents/hooks/audit-nudge/audit-nudge.mjs";
export const NUDGE_NEEDLE = "audit-nudge.mjs";
const TIMEOUT_SECONDS = 5;

export function nudgeCommand(repoDir, tool) {
  return `node "${toPosix(repoDir)}/${NUDGE_SCRIPT}" --tool ${tool}`;
}

// Where each tool registers a session-start hook, and the entry's shape (docs/compatibility.md).
// `file` is under the home directory; `path` is the hook array inside it; `root` holds keys a new
// file needs. Claude's settings.json is read and written by global.mjs with its other pieces.
export const NUDGE_TARGETS = {
  claude: {
    file: [".claude", "settings.json"],
    path: ["hooks", "SessionStart"],
    entry: (command) => ({ matcher: "startup", hooks: [{ type: "command", command, timeout: TIMEOUT_SECONDS }] }),
  },
  cursor: {
    file: [".cursor", "hooks.json"],
    path: ["hooks", "sessionStart"],
    root: { version: 1 },
    entry: (command) => ({ command, timeout: TIMEOUT_SECONDS }),
  },
  copilot: {
    file: [".copilot", "hooks", "audit-nudge.json"],
    path: ["hooks", "sessionStart"],
    root: { version: 1 },
    entry: (command) => ({ type: "command", bash: command, powershell: command, timeoutSec: TIMEOUT_SECONDS }),
  },
  antigravity: {
    file: [".gemini", "config", "hooks.json"],
    path: ["audit-nudge", "SessionStart"],
    entry: (command) => ({ type: "command", command, timeout: TIMEOUT_SECONDS }),
  },
};

export const nudgeFile = (tool, home) => join(home, ...NUDGE_TARGETS[tool].file);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function nudgeEntries(settings, path) {
  const found = path.reduce((current, key) => (isObject(current) ? current[key] : undefined), settings);
  return Array.isArray(found) ? found : [];
}

export function hasNudge(settings, tool) {
  return nudgeEntries(settings, NUDGE_TARGETS[tool].path).some((entry) => [...commandSlots(entry)].some(([object, key]) => object[key].includes(NUDGE_NEEDLE)));
}

// The user's file with the nudge pointing at this clone: an existing entry re-pointed, or a new
// one appended. Returns the new value and whether it differs from `current`.
export function registerNudge(current, tool, repoDir) {
  const target = NUDGE_TARGETS[tool];
  const command = nudgeCommand(repoDir, tool);
  const next = structuredClone(current);
  if (hasNudge(next, tool)) {
    for (const entry of nudgeEntries(next, target.path)) {
      for (const [object, key] of commandSlots(entry)) if (object[key].includes(NUDGE_NEEDLE)) object[key] = command;
    }
  } else {
    for (const [key, value] of Object.entries(target.root ?? {})) next[key] ??= value;
    let parent = next;
    for (const key of target.path.slice(0, -1)) parent = isObject(parent[key]) ? parent[key] : (parent[key] = {});
    const last = target.path.at(-1);
    parent[last] = [...(Array.isArray(parent[last]) ? parent[last] : []), target.entry(command)];
  }
  return { value: next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}
