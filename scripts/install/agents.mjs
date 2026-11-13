// One entry per agent in a tool's user agents folder, so the user's own agents live beside
// ours: a file symlink where the platform allows one, else a copy refreshed on every run.
// An agent the clone no longer has is swept from the folder.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const isAgentFile = (name) => name.endsWith(".md");

// The tool's agents folder must be a real directory: an older install linked the whole folder.
function ensureDirectory(dir) {
  let stat = null;
  try {
    stat = lstatSync(dir);
  } catch {
    // missing
  }
  if (stat?.isSymbolicLink()) rmSync(dir, { recursive: false, force: true });
  mkdirSync(dir, { recursive: true });
}

// Returns { linked, copied, removed, left }: what changed this run, and the broken links left as the user's.
export function linkRepoAgents(linker, repoDir, { dir, source }) {
  const sourceDir = join(repoDir, source);
  ensureDirectory(dir);
  const names = existsSync(sourceDir) ? readdirSync(sourceDir).filter(isAgentFile) : [];
  const result = { linked: 0, copied: 0, removed: [], left: [] };
  for (const name of names) {
    const outcome = linker.linkFile(join(dir, name), join(sourceDir, name));
    if (outcome === "linked") result.linked++;
    if (outcome === "copied") result.copied++;
  }
  const swept = linker.sweepBrokenLinks(dir);
  result.removed.push(...swept.removed);
  result.left.push(...swept.left);
  for (const name of readdirSync(dir)) {
    if (!names.includes(name) && linker.forgetCopy(join(dir, name))) result.removed.push(name);
  }
  return result;
}
