import { TOOLS } from "./targets.mjs";
import { expandHome } from "./paths.mjs";

export const HELP = `Usage: node scripts/install.mjs [--global | --project [dir]] [options]

Installs agent-config for Claude Code, Cursor, GitHub Copilot and Antigravity CLI.

Modes (--global is the default):
  --global              link this clone into each tool's user folders, register the
                        git-guard hook there, and install the third-party skills
  --project [dir]       copy the drop-in files (AGENTS.md, .agents/, and each tool's
                        folder) into a project; default: the current directory

Options:
  --tool <name>         one of ${TOOLS.join(", ")}; repeatable; default: all
  --force               project mode: overwrite files whose content differs
  --home <dir>          global mode: the home directory to install under (default: ~)
  --update              git pull --ff-only in this clone, then run the pulled installer
  --yes                 accept every optional piece that can work, this run only
  --no-optional         the core setup only, this run only, no questions
  --ask                 ask again about pieces answered on an earlier run
  --skip-skills         do not run npx for the third-party skills
  --rtk, --no-rtk       decide the rtk hook (Claude Code) without asking
  --codegraph, --no-codegraph
                        decide the CodeGraph allow rule (Claude Code) without asking
  --context7, --no-context7
                        decide the Context7 MCP server and its allow rule (Claude Code)
                        without asking
  --audit-nudge, --no-audit-nudge
                        decide the weekly dependency-audit reminder at session start
                        (every tool) without asking
  -h, --help

Answers given at a prompt or by --rtk, --codegraph, --context7 and --audit-nudge are kept in
~/.config/agent-config/config-install.json, so a re-run asks only what it has not asked.`;

const BOOLEAN_FLAGS = {
  "--global": "global",
  "--force": "force",
  "--update": "update",
  "--yes": "yes",
  "--no-optional": "noOptional",
  "--ask": "ask",
  "--skip-skills": "skipSkills",
  "--help": "help",
  "-h": "help",
};

const DECISIONS = { "--rtk": ["rtk", true], "--no-rtk": ["rtk", false], "--codegraph": ["codegraph", true], "--no-codegraph": ["codegraph", false], "--context7": ["context7", true], "--no-context7": ["context7", false], "--audit-nudge": ["auditNudge", true], "--no-audit-nudge": ["auditNudge", false] };

// The value after an option, which must exist and not be another option.
export function requireValue(args, i) {
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${args[i]} needs a value.`);
  return value;
}

function optionalValue(args, i) {
  const value = args[i + 1];
  return value && !value.startsWith("--") ? value : null;
}

// npx may or may not swallow the `--` separator, so it is dropped wherever it appears.
export function parseArgs(argv) {
  const flags = { global: false, project: null, tools: [], force: false, home: null, update: false, yes: false, noOptional: false, ask: false, skipSkills: false, rtk: null, codegraph: null, context7: null, auditNudge: null, help: false };
  const args = argv.filter((arg) => arg !== "--");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project") {
      const dir = optionalValue(args, i);
      flags.project = dir ? expandHome(dir) : ".";
      if (dir) i++;
    } else if (arg === "--tool") flags.tools.push(parseTool(requireValue(args, i++)));
    else if (arg === "--home") flags.home = expandHome(requireValue(args, i++));
    else if (DECISIONS[arg]) flags[DECISIONS[arg][0]] = DECISIONS[arg][1];
    else if (BOOLEAN_FLAGS[arg]) flags[BOOLEAN_FLAGS[arg]] = true;
    else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  if (flags.global && flags.project !== null) throw new Error("--global and --project cannot be combined.");
  if (flags.tools.length === 0) flags.tools = [...TOOLS];
  return flags;
}

function parseTool(name) {
  if (!TOOLS.includes(name)) throw new Error(`Unknown tool ${name}. Known: ${TOOLS.join(", ")}.`);
  return name;
}
