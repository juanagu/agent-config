// Context7, the MCP server the standards send an agent to for current library docs. Claude Code
// keeps user-scoped servers in ~/.claude.json, a file it rewrites while running, so the server
// is added through `claude mcp add` and the file is only ever read here.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./json.mjs";

export const CONTEXT7_RULE = "mcp__context7__*";
const NAME = "context7";
const URL = "https://mcp.context7.com/mcp";
const ADD_ARGS = ["mcp", "add", "--scope", "user", "--transport", "http", NAME, URL];
// What Context7's own `npx ctx7 setup` writes: an "always query Context7" rule the standards
// contradict, and a skill repeating the instructions the server already sends.
const SETUP_LEFTOVERS = [join(".claude", "rules", "context7.md"), join(".claude", "skills", "context7-mcp")];

export const ADD_COMMAND = `claude ${ADD_ARGS.join(" ")}`;

export function isRegistered(home) {
  const file = join(home, ".claude.json");
  if (!existsSync(file)) return false;
  try {
    return Boolean(readJson(file).mcpServers?.[NAME]);
  } catch {
    return false;
  }
}

// Writes the real ~/.claude.json whatever --home says. On Windows an npm-installed claude is a
// .cmd that only a shell starts, and Node deprecates an args array with a shell (DEP0190), so
// it gets the command as one string.
export function register() {
  const stdio = ["ignore", "inherit", "inherit"];
  const result = process.platform === "win32" ? spawnSync(ADD_COMMAND, { stdio, shell: true }) : spawnSync("claude", ADD_ARGS, { stdio });
  return result.status === 0;
}

export function setupLeftovers(home) {
  return SETUP_LEFTOVERS.map((path) => join(home, path)).filter((path) => existsSync(path));
}
