#!/usr/bin/env node
// Installs agent-config two ways. --global: the tools' user folders link into this clone
// (one copy of the config, edited in place) and the third-party skills are installed.
// --project: the drop-in files are copied into a project for its whole team. Re-running
// either is safe; `node scripts/install.mjs --help` lists the options.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP, parseArgs } from "./install/args.mjs";
import { gitPull, hasCommand, runNode } from "./install/env.mjs";
import { installGlobal } from "./install/global.mjs";
import { createPrompter } from "./install/prompts.mjs";
import { installProject } from "./install/project.mjs";
import { installSkill, linkInstalledSkills, readSkillList } from "./install/skills.mjs";
import { globalTargets } from "./install/targets.mjs";

const self = fileURLToPath(import.meta.url);
const repoDir = dirname(dirname(self));

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  if (flags.update) return updateThenRerun();
  if (flags.project !== null) return installProject(repoDir, flags);
  return installEverywhere(flags);
}

// The pull may change this very code, so the pulled installer runs in a fresh process.
function updateThenRerun() {
  gitPull(repoDir);
  return runNode(self, process.argv.slice(2).filter((arg) => arg !== "--update"));
}

async function installEverywhere(flags) {
  const home = flags.home ?? homedir();
  const prompter = createPrompter({ file: join(home, ".config", "agent-config", "config-install.json"), ...flags });
  const installed = {};
  for (const tool of flags.tools) installed[tool] = await installGlobal(tool, repoDir, home, prompter, flags);
  const failed = flags.skipSkills ? [] : await installSkills(prompter, home, installed);
  prompter.save();
  if (failed.length) {
    console.error(`Failed to install: ${failed.join(", ")}`);
    return 1;
  }
  console.log("Start a new session in each tool to pick up the config.");
  return 0;
}

// `npx skills` installs into the real ~/.claude/skills; every other tool links to what landed
// there. An optional skill already in place is reinstalled without asking, like the ones in
// skills.txt, so a run after --yes does not ask about what it installed.
async function installSkills(prompter, home, installed) {
  if (!hasCommand("npx")) {
    console.log("npx not found: skipped the skills in skills.txt. Install npm and re-run.");
    return [];
  }
  if (home !== homedir()) {
    console.log("--home is set: skipped the third-party skills, which npx installs under the real home directory.");
    return [];
  }
  const claudeSkills = globalTargets("claude", home).skillsDir;
  const wanted = readSkillList(join(repoDir, "skills.txt"));
  for (const skill of readSkillList(join(repoDir, "skills.optional.txt"))) {
    const present = existsSync(join(claudeSkills, skill.name));
    if (present || (await prompter.confirm(`skill:${skill.name}`, `Install the ${skill.name} skill (${skill.description})?`, false))) wanted.push(skill);
  }
  const failed = wanted.filter((skill) => !installSkill(skill)).map((skill) => skill.name);
  const names = wanted.map((skill) => skill.name);
  for (const [tool, { linker, skillsDir }] of Object.entries(installed)) {
    if (tool !== "claude") linkInstalledSkills(linker, names, claudeSkills, skillsDir);
  }
  return failed;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error.message);
    process.exit(1);
  },
);
