// Claude Code's settings.json (copied from the template, never linked: Claude Code rewrites
// it) and the hook registrations every tool keeps in its own JSON file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./json.mjs";
import { toPosix } from "./paths.mjs";
import { GUARD_SCRIPT } from "./targets.mjs";

export const GIT_GUARD_NEEDLE = "git-guard.mjs";
export const GIT_GUARD_MATCHER = "Bash|PowerShell";
export const RTK_NEEDLE = "rtk hook";
export const RTK_MATCHER = "Bash";
export const RTK_COMMAND = "rtk hook claude";
export const CODEGRAPH_RULE = "mcp__codegraph__*";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "claude-settings.template.json");

// A missing settings.json starts from the template, which carries no hook: the git guard is
// offered to a fresh file the same way as to an existing one, so one code path owns the decision.
export function readSettings(claudeDir) {
  const path = join(claudeDir, "settings.json");
  if (existsSync(path)) return { path, settings: readJson(path), created: false };
  return { path, settings: JSON.parse(readFileSync(TEMPLATE, "utf8")), created: true };
}

export function gitGuardCommand(repoDir, tool) {
  return `node "${toPosix(repoDir)}/${GUARD_SCRIPT}" --tool ${tool}`;
}

export function hasHook(settings, needle) {
  return (settings.hooks?.PreToolUse ?? []).some((entry) =>
    (entry.hooks ?? []).some((hook) => typeof hook.command === "string" && hook.command.includes(needle)),
  );
}

export function addHook(settings, matcher, command) {
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  settings.hooks.PreToolUse.push({ matcher, hooks: [{ type: "command", command }] });
}

export function hasAllowRule(settings, rule) {
  return (settings.permissions?.allow ?? []).includes(rule);
}

export function addAllowRule(settings, rule) {
  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  settings.permissions.allow.push(rule);
}

// A registration file written for a project names the script by a project-relative path,
// with or without a tool's project-dir variable in front; a user-level copy needs the clone's
// absolute path instead.
const RELATIVE_SCRIPT = /"?(?:\$\{?[A-Za-z_]+\}?\/|\.\/)?\.agents\/hooks\/git-guard\/git-guard\.mjs"?/g;

export function absolutizeGuard(value, repoDir) {
  const absolute = `"${toPosix(repoDir)}/${GUARD_SCRIPT}"`;
  if (typeof value === "string") return value.replace(RELATIVE_SCRIPT, absolute);
  if (Array.isArray(value)) return value.map((item) => absolutizeGuard(item, repoDir));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, absolutizeGuard(v, repoDir)]));
  return value;
}

// The keys a hook entry runs a command from, directly (Cursor, Copilot) or on each item of its
// `hooks` array (Claude Code, Antigravity).
const COMMAND_KEYS = ["command", "bash", "powershell"];

export function* commandSlots(entry) {
  if (!isObject(entry)) return;
  for (const key of COMMAND_KEYS) if (typeof entry[key] === "string") yield [entry, key];
  for (const hook of Array.isArray(entry.hooks) ? entry.hooks : []) {
    if (!isObject(hook)) continue;
    for (const key of COMMAND_KEYS) if (typeof hook[key] === "string") yield [hook, key];
  }
}

const runsGuard = (entry) => [...commandSlots(entry)].some(([object, key]) => object[key].includes(GIT_GUARD_NEEDLE));

// Where the guard lives in a registration: the paths of the hook arrays (`hooks.PreToolUse`,
// `hooks.beforeShellExecution`, `git-guard.PreToolUse`) with an entry that runs it. Only those
// arrays are ever rewritten in a user's file, so a `permissions` rule or a Stop hook that
// happens to mention the script is left alone.
function guardArrayPaths(value, path = []) {
  if (Array.isArray(value)) return value.some(runsGuard) ? [path] : [];
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => guardArrayPaths(item, [...path, key]));
}

const arrayAt = (value, path) => {
  const found = path.reduce((current, key) => (isObject(current) ? current[key] : undefined), value);
  return Array.isArray(found) ? found : [];
};

// The guard command a registration carries: the first command that runs the script.
export function guardCommandIn(registration) {
  for (const path of guardArrayPaths(registration)) {
    for (const entry of arrayAt(registration, path)) {
      for (const [object, key] of commandSlots(entry)) if (object[key].includes(GIT_GUARD_NEEDLE)) return object[key];
    }
  }
  return null;
}

// A registration file brought up to date with the clone's: a guard entry under the same hook
// event (the old ~/.claude/hooks path, a previous clone, a project-relative form) is re-pointed
// at the clone's command, a missing one is merged in. Returns the new value and whether it
// differs from `current`.
export function registerGuard(current, registration) {
  const command = guardCommandIn(registration);
  const next = structuredClone(current);
  let found = false;
  for (const path of guardArrayPaths(registration)) {
    for (const entry of arrayAt(next, path)) {
      for (const [object, key] of commandSlots(entry)) {
        if (!object[key].includes(GIT_GUARD_NEEDLE)) continue;
        object[key] = command;
        found = true;
      }
    }
  }
  const value = found ? next : mergeRegistration(current, registration);
  return { value, changed: JSON.stringify(value) !== JSON.stringify(current) };
}

// The clone's registration merged into the user's file: objects recurse, arrays append, and a
// scalar the user already has (a `version`) is kept.
export function mergeRegistration(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) return [...target, ...source];
  if (isObject(target) && isObject(source)) {
    const merged = { ...target };
    for (const [key, value] of Object.entries(source)) merged[key] = key in merged ? mergeRegistration(merged[key], value) : value;
    return merged;
  }
  return target === undefined ? source : target;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
