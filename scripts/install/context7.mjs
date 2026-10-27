// Context7, the MCP server the standards send an agent to for current library docs. Claude Code
// keeps user-scoped servers in ~/.claude.json, a file it rewrites while running, so the server
// is added through `claude mcp add` and the file is only ever read here.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./env.mjs";
import { readJson } from "./json.mjs";

export const CONTEXT7_RULE = "mcp__context7__*";
const NAME = "context7";
const URL = "https://mcp.context7.com/mcp";
const ADD_ARGS = ["mcp", "add", "--scope", "user", "--transport", "http", NAME, URL];

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

// The exit code of `claude mcp add`, which writes the real ~/.claude.json whatever --home says.
export function register() {
  return run("claude", ADD_ARGS);
}
