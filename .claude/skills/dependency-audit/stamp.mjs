// The date of the last finished audit: the one definition of where it lives, written here by
// `audit.mjs --stamp` and read by the session-start nudge (.agents/hooks/audit-nudge/).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function stampPath(env = process.env, home = homedir()) {
  return env.AGENT_CONFIG_AUDIT_STAMP || join(home, ".config", "agent-config", "last-dependency-audit");
}

export function writeStamp(now = new Date(), env = process.env) {
  const path = stampPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${now.toISOString()}\n`);
  return path;
}
