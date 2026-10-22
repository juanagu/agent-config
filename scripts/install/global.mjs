// Global mode: one function per tool, each linking the clone into that tool's user folders and
// registering the git-guard hook and the weekly dependency-audit nudge there. Claude Code keeps
// the fuller flow (settings.json from a template, the optional rtk and CodeGraph pieces); the
// other three get links plus a merge into their hook files.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { linkRepoAgents } from "./agents.mjs";
import { hasCommand } from "./env.mjs";
import { readJson, writeJson } from "./json.mjs";
import { createLinker } from "./link.mjs";
import * as nudge from "./nudge.mjs";
import * as settings from "./settings.mjs";
import { linkRepoSkills } from "./skills.mjs";
import { globalTargets } from "./targets.mjs";

const RTK_URL = "https://github.com/rtk-ai/rtk";

const NOTES = {
  cursor: "Cursor has no user-level standards file: paste AGENTS.md into Cursor Settings → Rules → User Rules, or install per project (--project).",
  copilot: "Copilot cannot import a file into ~/.copilot/copilot-instructions.md, so it is a copy of AGENTS.md: refreshed by each run until you edit it, then left alone.",
  antigravity: "~/.gemini/AGENTS.md is a copy of AGENTS.md: refreshed by each run until you edit it, then left alone.",
};

export async function installGlobal(tool, repoDir, home, prompter, flags) {
  const target = globalTargets(tool, home);
  // Everything that must parse is read first, so a broken file leaves the folder as it was.
  const current = tool === "claude" ? settings.readSettings(target.dir) : readHookFiles(tool, target, home);
  mkdirSync(target.dir, { recursive: true });
  const linker = createLinker(target.dir, prompter.copies, prompter.imports);
  const agents = linkRepoAgents(linker, repoDir, target.agents);
  mkdirSync(target.skillsDir, { recursive: true });
  linkRepoSkills(linker, repoDir, target.skillsDir);
  const swept = linker.sweepBrokenLinks(target.skillsDir);
  if (tool === "claude") await installClaude(repoDir, target, linker, current, prompter, flags);
  else await installRegistration(tool, repoDir, target, linker, current, prompter, flags);
  console.log(`Linked ${target.dir} to ${repoDir} (${tool}${agents.copied ? "; agents copied, since file links need a privilege here" : ""}).`);
  if (agents.removed.length) console.log(`Removed agents the clone no longer has: ${agents.removed.join(", ")}`);
  if (swept.length) console.log(`Removed broken skill links: ${swept.join(", ")}`);
  if (NOTES[tool]) console.log(NOTES[tool]);
  const backup = linker.backupDir();
  if (backup) console.log(`Replaced files were moved to ${backup}`);
  return { linker, skillsDir: target.skillsDir };
}

function readRegistration(file) {
  return existsSync(file) ? readJson(file) : {};
}

async function installClaude(repoDir, target, linker, current, prompter, flags) {
  if (linker.writeImport(join(target.dir, "CLAUDE.md"), repoDir)) console.log(`Updated the import in ${join(target.dir, "CLAUDE.md")}.`);
  await configureSettings(repoDir, current, prompter, flags);
}

// The hook files a tool keeps, each read once: the guard's, and the nudge's where that is another
// file (Copilot). Cursor and Antigravity keep both in one file.
function readHookFiles(tool, target, home) {
  const files = new Map([[target.hookFile, readRegistration(target.hookFile)]]);
  const nudgeFile = nudge.nudgeFile(tool, home);
  if (!files.has(nudgeFile)) files.set(nudgeFile, readRegistration(nudgeFile));
  return { files, guardFile: target.hookFile, nudgeFile };
}

// Cursor, Copilot and Antigravity: a user-level standards copy where the tool reads one, the
// clone's hook registration merged into the tool's user-level hook file, made absolute (an entry
// from an earlier clone is re-pointed), and the nudge. Each changed file is written once.
async function installRegistration(tool, repoDir, target, linker, hooks, prompter, flags) {
  if (target.standards) reportCopy(target.standards, linker.copy(target.standards, join(repoDir, "AGENTS.md")));
  const registration = settings.absolutizeGuard(readJson(join(repoDir, target.hookSource)), repoDir);
  const guarded = settings.registerGuard(hooks.files.get(hooks.guardFile), registration);
  const next = new Map(hooks.files).set(hooks.guardFile, guarded.value);
  const changed = new Set(guarded.changed ? [hooks.guardFile] : []);
  if (await applyNudge(tool, repoDir, next.get(hooks.nudgeFile), prompter, flags)) changed.add(hooks.nudgeFile);
  for (const file of changed) writeHookFile(file, next.get(file), tool, file === hooks.nudgeFile);
}

// The nudge's own file (Copilot's) is deleted once taking the nudge out leaves nothing else in it;
// hooks the user added there keep it.
function writeHookFile(file, value, tool, isNudgeFile) {
  const existed = existsSync(file);
  if (isNudgeFile && nudge.NUDGE_TARGETS[tool].ownFile && nudge.onlySeedKeys(value, tool)) {
    if (existed) rmSync(file);
    if (existed) console.log(`Removed ${file}.`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, value);
  console.log(`${existed ? "Updated" : "Wrote"} ${file}.`);
}

function reportCopy(path, outcome) {
  if (outcome === "wrote" || outcome === "updated") console.log(`${outcome === "wrote" ? "Wrote" : "Updated"} ${path}.`);
  if (outcome === "kept") console.log(`${path} was edited by you and is left alone.`);
}

// A missing settings.json is written from the hook-less template plus whatever is accepted
// below. An existing file is the user's: each addition is offered, and only the ones
// accepted are merged in.
async function configureSettings(repoDir, { path, settings: current, created }, prompter, flags) {
  const added = [
    await offerGitGuard(repoDir, current, prompter),
    await offerRtk(current, prompter, flags),
    await offerCodegraph(current, prompter, flags),
    await applyNudge("claude", repoDir, current, prompter, flags),
  ];
  if (!created && !added.includes(true)) return;
  writeJson(path, current);
  console.log(`${created ? "Wrote" : "Updated"} ${path}.`);
}

// A guard entry from an earlier install (the old ~/.claude/hooks path, a previous clone) is
// re-pointed at this clone; a missing one is offered.
async function offerGitGuard(repoDir, current, prompter) {
  const command = settings.gitGuardCommand(repoDir, "claude");
  if (settings.hasHook(current, settings.GIT_GUARD_NEEDLE)) {
    const { value, changed } = settings.registerGuard(current, { hooks: { PreToolUse: [{ hooks: [{ command }] }] } });
    if (changed) Object.assign(current, value);
    return changed;
  }
  if (!(await prompter.confirm("gitGuard", "settings.json has no git-guard hook. Add it?", true, { essential: true }))) return false;
  settings.addHook(current, settings.GIT_GUARD_MATCHER, command);
  return true;
}

// A hook for a binary that is missing fails on every shell call, so --yes adds it only
// when rtk is there, and an explicit yes gets a warning.
async function offerRtk(current, prompter, flags) {
  if (settings.hasHook(current, settings.RTK_NEEDLE)) return false;
  const installed = hasCommand("rtk");
  let add;
  if (flags.rtk !== null) add = prompter.decide("rtk", flags.rtk);
  else if (flags.yes) add = installed;
  else add = await prompter.confirm("rtk", `Add the rtk hook, which compresses shell output (rtk is ${installed ? "" : "not "}on PATH, ${RTK_URL})?`, installed);
  if (!add) return false;
  if (!installed) console.log(`rtk is not on PATH: its hook fails on every shell call until it is installed (${RTK_URL}).`);
  settings.addHook(current, settings.RTK_MATCHER, settings.RTK_COMMAND);
  return true;
}

async function offerCodegraph(current, prompter, flags) {
  if (settings.hasAllowRule(current, settings.CODEGRAPH_RULE)) return false;
  const installed = hasCommand("codegraph");
  const note = installed ? "codegraph is on PATH" : "codegraph is not on PATH; the rule is harmless until it is";
  const add = flags.codegraph !== null ? prompter.decide("codegraph", flags.codegraph) : await prompter.confirm("codegraph", `Allow the CodeGraph MCP tools without a prompt (${note})?`, installed);
  if (!add) return false;
  settings.addAllowRule(current, settings.CODEGRAPH_RULE);
  return true;
}

// The weekly dependency-audit nudge, for every tool: --no-audit-nudge takes it out and records the
// no; an entry from an earlier clone is re-pointed without asking; a missing one is offered (yes
// by default, off under --no-optional). Mutates `current`; returns whether it changed.
async function applyNudge(tool, repoDir, current, prompter, flags) {
  if (flags.auditNudge === false) {
    prompter.decide("auditNudge", false);
    return nudge.removeNudge(current, tool);
  }
  if (!nudge.hasNudge(current, tool) && !(await wantsNudge(prompter, flags))) return false;
  return nudge.registerNudge(current, tool, repoDir);
}

function wantsNudge(prompter, flags) {
  if (flags.auditNudge === true) return prompter.decide("auditNudge", true);
  return prompter.confirm("auditNudge", "Add a weekly dependency-audit reminder at session start (it reads one local date, no network)?", true);
}
