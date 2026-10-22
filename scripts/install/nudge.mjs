// The weekly dependency-audit nudge: a session-start hook registered at user level only, because
// the date it reads (~/.config/agent-config/last-dependency-audit) belongs to the machine, not to a
// project. Each tool's entry is added once, re-pointed when it names an older clone, removed when
// the user declines it, and the rest of the user's file is left alone.
import { join } from "node:path";
import { toPosix } from "./paths.mjs";
import { arrayAt, isObject, repointCommands, runsScript } from "./settings.mjs";

export const NUDGE_SCRIPT = ".agents/hooks/audit-nudge/audit-nudge.mjs";
export const NUDGE_NEEDLE = "audit-nudge.mjs";
const TIMEOUT_SECONDS = 5;

export function nudgeCommand(repoDir, tool) {
  return `node "${toPosix(repoDir)}/${NUDGE_SCRIPT}" --tool ${tool}`;
}

// Where each tool registers a session-start hook, and the entry's shape (docs/compatibility.md).
// `file` is under the home directory; `path` is the hook array inside it; `root` holds keys a new
// file needs; `ownFile` marks a file that holds nothing else, deleted with the last entry.
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
    ownFile: true,
    entry: (command) => ({ type: "command", bash: command, powershell: command, timeoutSec: TIMEOUT_SECONDS }),
  },
  antigravity: {
    file: [".gemini", "config", "hooks.json"],
    path: ["audit-nudge", "SessionStart"],
    entry: (command) => ({ type: "command", command, timeout: TIMEOUT_SECONDS }),
  },
};

export const nudgeFile = (tool, home) => join(home, ...NUDGE_TARGETS[tool].file);

export function hasNudge(settings, tool) {
  return arrayAt(settings, NUDGE_TARGETS[tool].path).some((entry) => runsScript(entry, NUDGE_NEEDLE));
}

// Points the user's file at this clone's nudge: an existing entry re-pointed, or a new one
// appended. Mutates `settings`; returns whether it changed.
export function registerNudge(settings, tool, repoDir) {
  const target = NUDGE_TARGETS[tool];
  const before = JSON.stringify(settings);
  const command = nudgeCommand(repoDir, tool);
  if (!repointCommands(settings, NUDGE_NEEDLE, command, [target.path])) {
    for (const [key, value] of Object.entries(target.root ?? {})) settings[key] ??= value;
    const parent = containerAt(settings, target.path.slice(0, -1));
    const last = target.path.at(-1);
    parent[last] = [...(Array.isArray(parent[last]) ? parent[last] : []), target.entry(command)];
  }
  return JSON.stringify(settings) !== before;
}

// An entry without the nudge: a flat entry (Cursor, Copilot) that runs it is dropped whole; a
// group (Claude Code, Antigravity) loses only its hooks that run it, and goes only when nothing
// of the user's is left in it.
function withoutNudge(entry) {
  if (!isObject(entry) || !Array.isArray(entry.hooks)) return runsScript(entry, NUDGE_NEEDLE) ? null : entry;
  const hooks = entry.hooks.filter((hook) => !runsScript(hook, NUDGE_NEEDLE));
  if (hooks.length === entry.hooks.length) return entry;
  return hooks.length ? { ...entry, hooks } : null;
}

// Takes out every nudge hook; an array or group left empty goes too. Mutates `settings`;
// returns whether it changed.
export function removeNudge(settings, tool) {
  if (!hasNudge(settings, tool)) return false;
  const path = NUDGE_TARGETS[tool].path;
  const parents = [settings];
  for (const key of path.slice(0, -1)) parents.push(parents.at(-1)[key]);
  const last = path.at(-1);
  const kept = parents.at(-1)[last].map(withoutNudge).filter(Boolean);
  if (kept.length) parents.at(-1)[last] = kept;
  else delete parents.at(-1)[last];
  for (let i = path.length - 2; i >= 0; i--) {
    if (Object.keys(parents[i + 1]).length) break;
    delete parents[i][path[i]];
  }
  return true;
}

function containerAt(settings, path) {
  let parent = settings;
  for (const key of path) parent = isObject(parent[key]) ? parent[key] : (parent[key] = {});
  return parent;
}
