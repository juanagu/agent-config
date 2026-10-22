// The date of the last finished audit, which the session-start nudge reads
// (.agents/hooks/audit-nudge/audit-nudge.mjs resolves the same path; a test keeps them equal).
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
