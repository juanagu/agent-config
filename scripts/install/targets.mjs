// The one table of what each tool reads: which files of the clone a project needs copied in,
// and which user folders a global install links into. docs/architecture.md ("What each tool
// reads", "Installing") is the prose version; keep the two equal.
import { join } from "node:path";
import { HOOK_SCRIPT, TOOLS } from "../build/targets.mjs";

export { TOOLS };
export const SKILLS_SOURCE = ".agents/skills";
export const GUARD_SCRIPT = HOOK_SCRIPT;

// Project mode: paths relative to the clone, copied to the same path in the project.
const PROJECT_FILES = {
  common: ["AGENTS.md", SKILLS_SOURCE, ".agents/hooks/git-guard"],
  claude: ["CLAUDE.md", ".claude/settings.json", ".claude/agents", ".claude/skills"],
  cursor: [".cursor/hooks.json", ".cursor/agents"],
  copilot: [".github/hooks/git-guard.json", ".github/agents"],
  antigravity: [".agents/hooks.json", ".agents/agents"],
};

export function projectFiles(tools) {
  return [...PROJECT_FILES.common, ...tools.flatMap((tool) => PROJECT_FILES[tool])];
}

// Global mode: where each tool keeps its user-level pieces. `hookFile` is the user-level hook
// registration the clone's `hookSource` is merged into; `standards` is a user-level standards
// file the tool reads, written as a copy when missing (Claude gets an import instead).
export function globalTargets(tool, home) {
  switch (tool) {
    case "claude":
      return {
        dir: join(home, ".claude"),
        agentsLink: { path: join(home, ".claude", "agents"), source: ".claude/agents" },
        skillsDir: join(home, ".claude", "skills"),
      };
    case "cursor":
      return {
        dir: join(home, ".cursor"),
        agentsLink: { path: join(home, ".cursor", "agents"), source: ".cursor/agents" },
        skillsDir: join(home, ".cursor", "skills"),
        hookFile: join(home, ".cursor", "hooks.json"),
        hookSource: ".cursor/hooks.json",
      };
    case "copilot":
      return {
        dir: join(home, ".copilot"),
        agentsLink: { path: join(home, ".copilot", "agents"), source: ".github/agents" },
        skillsDir: join(home, ".copilot", "skills"),
        hookFile: join(home, ".copilot", "hooks", "git-guard.json"),
        hookSource: ".github/hooks/git-guard.json",
        standards: join(home, ".copilot", "copilot-instructions.md"),
      };
    case "antigravity":
      return {
        dir: join(home, ".gemini"),
        agentsLink: { path: join(home, ".gemini", "config", "agents"), source: ".agents/agents" },
        skillsDir: join(home, ".gemini", "antigravity-cli", "skills"),
        hookFile: join(home, ".gemini", "config", "hooks.json"),
        hookSource: ".agents/hooks.json",
        standards: join(home, ".gemini", "AGENTS.md"),
      };
    default:
      throw new Error(`Unknown tool ${tool}. Known: ${TOOLS.join(", ")}.`);
  }
}
