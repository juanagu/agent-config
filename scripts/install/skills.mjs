import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_SOURCE } from "./targets.mjs";

// One skill per line in skills.txt and skills.optional.txt:
//   <github repo> <skill name> [description shown when asking]
export function readSkillList(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [repo, name, ...rest] = line.split(/\s+/);
      return { repo, name, description: rest.join(" ") };
    });
}

function skillDirs(source) {
  if (!existsSync(source)) return [];
  return readdirSync(source).filter((name) => statSync(join(source, name)).isDirectory());
}

// One link per skill, so a tool's skills folder can hold the user's own skills beside these.
export function linkRepoSkills(linker, repoDir, skillsDir) {
  const source = join(repoDir, SKILLS_SOURCE);
  return skillDirs(source).map((name) => linker.link(join(skillsDir, name), join(source, name)));
}

// Third-party skills land in Claude's folder (that is where `npx skills` puts them); every other
// tool gets a link to each one that is there.
export function linkInstalledSkills(linker, names, fromDir, toDir) {
  return names.filter((name) => existsSync(join(fromDir, name))).map((name) => linker.link(join(toDir, name), join(fromDir, name)));
}

export function installSkill({ repo, name }) {
  // stdin is closed: npx would otherwise read whatever follows on the terminal.
  const result = spawnSync("npx", ["-y", "skills", "add", repo, "--skill", name, "--global", "--agent", "claude-code", "--yes"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  return result.status === 0;
}
