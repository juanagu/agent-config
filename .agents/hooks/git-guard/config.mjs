// The guard's per-machine config file. It stays out of git: it names this machine's checkouts and CLIs.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const CONFIG_HINT = "~/.config/agent-config/git-guard.json";

// GIT_GUARD_CONFIG wins; otherwise the current file, falling back to the one claude-code-config wrote.
export function configPath() {
  if (process.env.GIT_GUARD_CONFIG) return process.env.GIT_GUARD_CONFIG;
  const home = process.env.GIT_GUARD_HOME ?? homedir();
  const current = path.join(home, ".config", "agent-config", "git-guard.json");
  const legacy = path.join(home, ".claude", "git-guard.json");
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

export function readConfig() {
  const file = configPath();
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}
