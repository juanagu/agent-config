// The session-start nudges (the weekly dependency audit, low disk space): hooks registered at user
// level only, because what they read (a date, the home drive) belongs to the machine, not to a
// project. Each tool's entry is added once, re-pointed when it names an older clone, removed when
// the user declines it, and the rest of the user's file is left alone.
import { join } from "node:path";
import { toPosix } from "./paths.mjs";
import { arrayAt, isObject, repointCommands, runsScript } from "./settings.mjs";

const TIMEOUT_SECONDS = 5;

// `decision` is the key in config-install.json and the name of the flags (--audit-nudge); `file`
// is Copilot's own hook file and `group` Antigravity's hook group, both named after the hook.
export const NUDGES = [
  {
    id: "audit",
    decision: "auditNudge",
    script: ".agents/hooks/audit-nudge/audit-nudge.mjs",
    needle: "audit-nudge.mjs",
    file: "audit-nudge.json",
    group: "audit-nudge",
    question: "Add a weekly dependency-audit reminder at session start (it reads one local date, no network)?",
  },
  {
    id: "disk",
    decision: "diskNudge",
    script: ".agents/hooks/disk-nudge/disk-nudge.mjs",
    needle: "disk-nudge.mjs",
    file: "disk-nudge.json",
    group: "disk-nudge",
    question: "Add a low-disk-space warning at session start (it reads the free space of your home drive, no network)?",
  },
];

export function nudgeCommand(nudge, repoDir, tool) {
  return `node "${toPosix(repoDir)}/${nudge.script}" --tool ${tool}`;
}

// Where each tool registers a session-start hook, and the entry's shape (docs/compatibility.md).
// `file` is under the home directory; `path` is the hook array inside it; `root` holds keys a new
// file needs; `ownFile` marks a file the installer creates for the nudge alone, deleted when
// taking the nudge out leaves nothing of the user's in it.
export function nudgeTarget(nudge, tool) {
  switch (tool) {
    case "claude":
      return {
        file: [".claude", "settings.json"],
        path: ["hooks", "SessionStart"],
        entry: (command) => ({ matcher: "startup", hooks: [{ type: "command", command, timeout: TIMEOUT_SECONDS }] }),
      };
    case "cursor":
      return {
        file: [".cursor", "hooks.json"],
        path: ["hooks", "sessionStart"],
        root: { version: 1 },
        entry: (command) => ({ command, timeout: TIMEOUT_SECONDS }),
      };
    case "copilot":
      return {
        file: [".copilot", "hooks", nudge.file],
        path: ["hooks", "sessionStart"],
        root: { version: 1 },
        ownFile: true,
        entry: (command) => ({ type: "command", bash: command, powershell: command, timeoutSec: TIMEOUT_SECONDS }),
      };
    case "antigravity":
      return {
        file: [".gemini", "config", "hooks.json"],
        path: [nudge.group, "SessionStart"],
        entry: (command) => ({ type: "command", command, timeout: TIMEOUT_SECONDS }),
      };
    default:
      throw new Error(`Unknown tool ${tool}.`);
  }
}

export const nudgeFile = (nudge, tool, home) => join(home, ...nudgeTarget(nudge, tool).file);

// True when nothing but the keys the installer seeded (`version`) is left in a file.
export function onlySeedKeys(settings, nudge, tool) {
  const seeded = Object.keys(nudgeTarget(nudge, tool).root ?? {});
  return Object.keys(settings).every((key) => seeded.includes(key));
}

export function hasNudge(settings, nudge, tool) {
  return arrayAt(settings, nudgeTarget(nudge, tool).path).some((entry) => runsScript(entry, nudge.needle));
}

// Points the user's file at this clone's nudge: an existing entry re-pointed, or a new one
// appended. Mutates `settings`; returns whether it changed.
export function registerNudge(settings, nudge, tool, repoDir) {
  const target = nudgeTarget(nudge, tool);
  const before = JSON.stringify(settings);
  const command = nudgeCommand(nudge, repoDir, tool);
  if (!repointCommands(settings, nudge.needle, command, [target.path])) {
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
function withoutNudge(entry, needle) {
  if (!isObject(entry) || !Array.isArray(entry.hooks)) return runsScript(entry, needle) ? null : entry;
  const hooks = entry.hooks.filter((hook) => !runsScript(hook, needle));
  if (hooks.length === entry.hooks.length) return entry;
  return hooks.length ? { ...entry, hooks } : null;
}

// Takes out every hook of the nudge; an array or group left empty goes too. Mutates `settings`;
// returns whether it changed.
export function removeNudge(settings, nudge, tool) {
  if (!hasNudge(settings, nudge, tool)) return false;
  const path = nudgeTarget(nudge, tool).path;
  const parents = [settings];
  for (const key of path.slice(0, -1)) parents.push(parents.at(-1)[key]);
  const last = path.at(-1);
  const kept = parents.at(-1)[last].map((entry) => withoutNudge(entry, nudge.needle)).filter(Boolean);
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
