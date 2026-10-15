// Claude Code's settings.json (copied from the template, never linked: Claude Code rewrites
// it) and the hook registrations every tool keeps in its own JSON file.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "./json.mjs";
import { toPosix } from "./paths.mjs";
import { GUARD_SCRIPT } from "./targets.mjs";

export const GIT_GUARD_NEEDLE = "git-guard";
export const GIT_GUARD_MATCHER = "Bash|PowerShell";
export const RTK_NEEDLE = "rtk hook";
export const RTK_MATCHER = "Bash";
export const RTK_COMMAND = "rtk hook claude";
export const CODEGRAPH_RULE = "mcp__codegraph__*";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "claude-settings.template.json");

export function readSettings(claudeDir, repoDir) {
  const path = join(claudeDir, "settings.json");
  if (existsSync(path)) return { path, settings: readJson(path), created: false };
  const template = readFileSync(TEMPLATE, "utf8").replaceAll("__REPO_DIR__", toPosix(repoDir));
  return { path, settings: JSON.parse(template), created: true };
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

export function mentionsGitGuard(value) {
  return JSON.stringify(value ?? null).includes(GIT_GUARD_NEEDLE);
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
