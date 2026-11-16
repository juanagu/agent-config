// Global mode: one function per tool, each linking the clone into that tool's user folders and
// registering the git-guard hook and the session-start nudges there. Claude Code keeps
// the fuller flow (settings.json from a template, the optional rtk, CodeGraph and Context7
// pieces); the other three get links plus a merge into their hook files.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { linkRepoAgents } from "./agents.mjs";
import * as context7 from "./context7.mjs";
import { hasCommand } from "./env.mjs";
import { readJson, writeJson } from "./json.mjs";
import { createLinker } from "./link.mjs";
import * as nudge from "./nudge.mjs";
import { isRealHome } from "./paths.mjs";
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
  const linker = createLinker(target.dir, prompter.copies, prompter.imports, prompter.links);
  const agents = linkRepoAgents(linker, repoDir, target.agents);
  mkdirSync(target.skillsDir, { recursive: true });
  linkRepoSkills(linker, repoDir, target.skillsDir);
  const swept = linker.sweepBrokenLinks(target.skillsDir);
  if (tool === "claude") await installClaude(repoDir, home, target, linker, current, prompter, flags);
  else await installRegistration(tool, repoDir, target, linker, current, prompter, flags);
  console.log(`Linked ${target.dir} to ${repoDir} (${tool}${agents.copied ? "; agents copied, since file links need a privilege here" : ""}).`);
  if (agents.removed.length) console.log(`Removed agents the clone no longer has: ${agents.removed.join(", ")}`);
  if (swept.removed.length) console.log(`Removed broken skill links: ${swept.removed.join(", ")}`);
  for (const [dir, names] of [[target.skillsDir, swept.left], [target.agents.dir, agents.left]]) {
    if (names.length) console.log(`Left broken links the installer has no record of, in ${dir}: ${names.join(", ")}. Remove them if you no longer need them.`);
  }
  if (NOTES[tool]) console.log(NOTES[tool]);
  const backup = linker.backupDir();
  if (backup) console.log(`Replaced files were moved to ${backup}`);
  return { linker, skillsDir: target.skillsDir };
}

function readRegistration(file) {
  return existsSync(file) ? readJson(file) : {};
}

async function installClaude(repoDir, home, target, linker, current, prompter, flags) {
  if (linker.writeImport(join(target.dir, "CLAUDE.md"), repoDir)) console.log(`Updated the import in ${join(target.dir, "CLAUDE.md")}.`);
  await configureSettings(repoDir, home, current, prompter, flags);
}

// The hook files a tool keeps, each read once: the guard's, and each nudge's where that is another
// file (Copilot). Cursor and Antigravity keep them all in one file.
function readHookFiles(tool, target, home) {
  const files = new Map([[target.hookFile, readRegistration(target.hookFile)]]);
  const nudgeFiles = new Map(nudge.NUDGES.map((item) => [item.id, nudge.nudgeFile(item, tool, home)]));
  for (const file of nudgeFiles.values()) if (!files.has(file)) files.set(file, readRegistration(file));
  return { files, guardFile: target.hookFile, nudgeFiles };
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
  const ownedBy = new Map();
  for (const item of nudge.NUDGES) {
    const file = hooks.nudgeFiles.get(item.id);
    if (await applyNudge(item, tool, repoDir, next.get(file), prompter, flags)) changed.add(file);
    ownedBy.set(file, item);
  }
  for (const file of changed) writeHookFile(file, next.get(file), tool, ownedBy.get(file));
}

// A nudge's own file (Copilot's) is deleted once taking the nudge out leaves nothing else in it;
// hooks the user added there keep it. `item` is the nudge a file belongs to, if any.
function writeHookFile(file, value, tool, item) {
  const existed = existsSync(file);
  if (item && nudge.nudgeTarget(item, tool).ownFile && nudge.onlySeedKeys(value, item, tool)) {
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
async function configureSettings(repoDir, home, { path, settings: current, created }, prompter, flags) {
  const added = [
    await offerGitGuard(repoDir, current, prompter),
    await offerAttribution(current, prompter),
    await offerRtk(current, prompter, flags),
    await offerCodegraph(current, prompter, flags),
    await offerContext7(current, prompter, flags, home),
  ];
  for (const item of nudge.NUDGES) added.push(await applyNudge(item, "claude", repoDir, current, prompter, flags));
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

// Only the keys the user has not set are added, so a trailer they chose stays.
async function offerAttribution(current, prompter) {
  const missing = settings.missingAttribution(current);
  if (!missing.length) return false;
  const question = `settings.json lets Claude Code credit itself in commits and PRs (no ${missing.join(", ")} under attribution). Turn that off?`;
  if (!(await prompter.confirm("attribution", question, true, { essential: true }))) return false;
  settings.addAttribution(current, missing);
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

// Context7 serves the library docs the standards send an agent to. One answer covers the server
// and the rule that lets its tools run without a prompt; with the server already there, the
// question is about the rule alone. Adding the server sends queries to a third party, so it takes
// a yes (typed, --context7 or --yes): a run without a terminal adds only the rule, for a server
// already there.
async function offerContext7(current, prompter, flags, home) {
  warnContext7Leftovers(home);
  const registered = context7.isRegistered(home);
  const allowed = settings.hasAllowRule(current, context7.CONTEXT7_RULE);
  if (registered && allowed) return false;
  const question = registered
    ? "Allow the Context7 MCP tools without a prompt?"
    : "Add Context7, an MCP server for current library docs (no key needed), and allow its tools without a prompt?";
  const add = flags.context7 !== null ? prompter.decide("context7", flags.context7) : await prompter.confirm("context7", question, registered);
  if (!add) return false;
  if (!registered) registerContext7(home);
  if (allowed) return false;
  settings.addAllowRule(current, context7.CONTEXT7_RULE);
  return true;
}

// `claude mcp add` writes the real ~/.claude.json, so a run with another --home only says how.
function registerContext7(home) {
  const manual = `Add it with: ${context7.ADD_COMMAND}`;
  if (!isRealHome(home)) console.log(`--home is not your home directory: Context7 was not added to the real ~/.claude.json. ${manual}`);
  else if (!hasCommand("claude")) console.log(`The claude CLI is not on PATH: Context7 was not added. ${manual}`);
  else if (!context7.register()) console.log(`claude mcp add failed: Context7 was not added. ${manual}`);
}

// The files are the user's, so they are named, never deleted.
function warnContext7Leftovers(home) {
  const found = context7.setupLeftovers(home);
  if (found.length) console.log(`Context7's own setup left ${found.join(" and ")}: they tell the agent to always query Context7, against the standards' order. Delete them (docs/claude-code.md, Library docs).`);
}

// A session-start nudge, for every tool: --no-<name>-nudge takes it out and records the no; an
// entry from an earlier clone is re-pointed without asking; a missing one is offered (yes by
// default, off under --no-optional). Mutates `current`; returns whether it changed.
async function applyNudge(item, tool, repoDir, current, prompter, flags) {
  if (flags[item.decision] === false) {
    prompter.decide(item.decision, false);
    return nudge.removeNudge(current, item, tool);
  }
  if (!nudge.hasNudge(current, item, tool) && !(await wantsNudge(item, prompter, flags))) return false;
  return nudge.registerNudge(current, item, tool, repoDir);
}

function wantsNudge(item, prompter, flags) {
  if (flags[item.decision] === true) return prompter.decide(item.decision, true);
  return prompter.confirm(item.decision, item.question, true);
}
