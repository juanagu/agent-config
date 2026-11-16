// The date of the last prune: the one definition of where it lives, written here by
// `reclaim.mjs prune` and read by the session-start disk nudge (.agents/hooks/disk-nudge/), which
// stays quiet for a day after it.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function stampPath(env = process.env, home = homedir()) {
  return env.AGENT_CONFIG_DOCKER_PRUNE_STAMP || join(home, ".config", "agent-config", "last-docker-prune");
}

export function writeStamp(now = new Date(), env = process.env) {
  const path = stampPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${now.toISOString()}\n`);
  return path;
}
