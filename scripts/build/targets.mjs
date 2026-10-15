// How each tool's dialect is derived from the neutral source (docs/architecture.md, "Agents: one
// source, four dialects" and "The git guard"). Everything tool-specific about generation is here.

export const TOOLS = ["claude", "cursor", "copilot", "antigravity"];

export const HOOK_SCRIPT = ".agents/hooks/git-guard/git-guard.mjs";

const CLAUDE_TOOLS = {
  read: "Read, Glob, Grep, Bash, Skill",
  write: "Read, Glob, Grep, Edit, Write, Bash, Skill",
};
const COPILOT_TOOLS = {
  read: ["search", "runCommands"],
  write: ["search", "edit", "runCommands"],
};
const CLAUDE_MODEL = { judgment: "opus", implementation: "sonnet" };
const ANTIGRAVITY_MODEL = { judgment: "pro", implementation: "inherit" };

// Where a tool's agent file goes and what its frontmatter holds, from a parsed source agent.
export const AGENT_TARGETS = {
  claude: {
    path: (name) => `.claude/agents/${name}.md`,
    frontmatter: (a) => ({
      name: a.name,
      description: a.description,
      model: CLAUDE_MODEL[a.tier],
      effort: a.effort,
      color: a.color,
      tools: CLAUDE_TOOLS[a.access],
    }),
  },
  cursor: {
    path: (name) => `.cursor/agents/${name}.md`,
    frontmatter: (a) => ({
      name: a.name,
      description: a.description,
      model: "inherit",
      readonly: a.access === "read" ? true : undefined,
    }),
  },
  copilot: {
    path: (name) => `.github/agents/${name}.agent.md`,
    frontmatter: (a) => ({
      name: a.name,
      description: a.description,
      tools: COPILOT_TOOLS[a.access],
    }),
  },
  antigravity: {
    path: (name) => `.agents/agents/${name}.md`,
    frontmatter: (a) => ({
      name: a.name,
      description: a.description,
      model: ANTIGRAVITY_MODEL[a.tier],
    }),
  },
};

// Hook registration per tool, with the command relative to the project root (the installer's
// global mode rewrites it to an absolute path). Shapes are each tool's documented ones; the links
// are in docs/compatibility.md.
export const HOOK_TARGETS = {
  claude: {
    path: ".claude/settings.json",
    content: (command) => ({
      hooks: {
        PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT}" --tool claude` }] }],
      },
    }),
  },
  cursor: {
    path: ".cursor/hooks.json",
    content: (command) => ({
      version: 1,
      hooks: { beforeShellExecution: [{ command: `${command} --tool cursor`, matcher: "\\b(git|gh)\\b", timeout: 15 }] },
    }),
  },
  copilot: {
    path: ".github/hooks/git-guard.json",
    content: (command) => ({
      version: 1,
      hooks: {
        preToolUse: [{ type: "command", matcher: "bash|powershell", bash: `${command} --tool copilot`, powershell: `${command} --tool copilot`, timeoutSec: 15 }],
      },
    }),
  },
  antigravity: {
    path: ".agents/hooks.json",
    content: (command) => ({
      "git-guard": {
        PreToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: `${command} --tool antigravity`, timeout: 15 }] }],
      },
    }),
  },
};

export const PROJECT_HOOK_COMMAND = `node ${HOOK_SCRIPT}`;
