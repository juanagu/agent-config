// Global mode: one function per tool, each linking the clone into that tool's user folders
// and registering the git-guard hook there. Claude Code keeps the fuller flow (settings.json
// from a template, the optional rtk and CodeGraph pieces); the other three get links plus a
// merge into their hook file.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { hasCommand } from "./env.mjs";
import { readJson, writeJson } from "./json.mjs";
import { createLinker } from "./link.mjs";
import * as settings from "./settings.mjs";
import { linkRepoSkills } from "./skills.mjs";
import { globalTargets } from "./targets.mjs";

const RTK_URL = "https://github.com/rtk-ai/rtk";

const NOTES = {
  cursor: "Cursor has no user-level standards file: paste AGENTS.md into Cursor Settings → Rules → User Rules, or install per project (--project).",
  copilot: "Copilot cannot import a file into ~/.copilot/copilot-instructions.md, so it is a copy of AGENTS.md; re-run after a change, or install per project (--project).",
  antigravity: "~/.gemini/AGENTS.md is a copy of AGENTS.md; re-run after a change, or install per project (--project).",
};

export async function installGlobal(tool, repoDir, home, prompter, flags) {
  const target = globalTargets(tool, home);
  // Everything that must parse is read first, so a broken file leaves the folder as it was.
  const current = tool === "claude" ? settings.readSettings(target.dir, repoDir) : readRegistration(target.hookFile);
  mkdirSync(target.dir, { recursive: true });
  const linker = createLinker(target.dir);
  linker.link(target.agentsLink.path, join(repoDir, target.agentsLink.source));
  mkdirSync(target.skillsDir, { recursive: true });
  linkRepoSkills(linker, repoDir, target.skillsDir);
  const swept = linker.sweepBrokenLinks(target.skillsDir);
  if (tool === "claude") await installClaude(repoDir, target, linker, current, prompter, flags);
  else installRegistration(repoDir, target, linker, current);
  console.log(`Linked ${target.dir} to ${repoDir} (${tool}).`);
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
  linker.writeImport(join(target.dir, "CLAUDE.md"), repoDir);
  await configureSettings(repoDir, current, prompter, flags);
}

// Cursor, Copilot and Antigravity: a user-level standards copy where the tool reads one, and
// the clone's hook registration merged into the tool's user-level hook file, made absolute.
function installRegistration(repoDir, target, linker, current) {
  if (target.standards && linker.copyIfMissing(target.standards, join(repoDir, "AGENTS.md"))) console.log(`Wrote ${target.standards}.`);
  if (settings.mentionsGitGuard(current)) return;
  const existed = existsSync(target.hookFile);
  const registration = settings.absolutizeGuard(readJson(join(repoDir, target.hookSource)), repoDir);
  mkdirSync(dirname(target.hookFile), { recursive: true });
  writeJson(target.hookFile, settings.mergeRegistration(current, registration));
  console.log(`${existed ? "Updated" : "Wrote"} ${target.hookFile}.`);
}

// The template is written whole when settings.json is missing. An existing file is the
// user's: each addition is offered, and only the ones accepted are merged in.
async function configureSettings(repoDir, { path, settings: current, created }, prompter, flags) {
  const added = [await offerGitGuard(repoDir, current, prompter), await offerRtk(current, prompter, flags), await offerCodegraph(current, prompter, flags)];
  if (!created && !added.includes(true)) return;
  writeJson(path, current);
  console.log(`${created ? "Wrote" : "Updated"} ${path}.`);
}

async function offerGitGuard(repoDir, current, prompter) {
  if (settings.hasHook(current, settings.GIT_GUARD_NEEDLE)) return false;
  if (!(await prompter.confirm("gitGuard", "settings.json has no git-guard hook. Add it?", true, { essential: true }))) return false;
  settings.addHook(current, settings.GIT_GUARD_MATCHER, settings.gitGuardCommand(repoDir, "claude"));
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
