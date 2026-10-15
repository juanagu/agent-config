#!/usr/bin/env node
// `npx -y github:juanagu/agent-config [--dir <path>] [--repo <clone URL or path>] [install options]`
// clones a permanent copy of the repo, or fast-forwards the one it finds, then runs that
// copy's scripts/install.mjs. npx's own copy is a cache entry npm replaces at will, so no
// tool's folder must ever link into it. The clone URL comes from package.json's `repository`,
// so a fork that edits that one field bootstraps itself.
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { cloneTargetFromPackage, parseBootstrapArgs, sameRepo } from "../scripts/install/bootstrap.mjs";
import { gitOriginUrl, gitPull, run, runNode } from "../scripts/install/env.mjs";
import { readJson } from "../scripts/install/json.mjs";
import { expandHome } from "../scripts/install/paths.mjs";

const DEFAULT_DIR = join(homedir(), "Projects", "agent-config");
const INSTALLER = join("scripts", "install.mjs");
const packageJson = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

try {
  const { dir: dirArg, repo: repoArg, passthrough } = parseBootstrapArgs(process.argv.slice(2), process.env);
  const target = repoArg ? { url: repoArg, ref: null } : cloneTargetFromPackage(readJson(packageJson));
  const dir = resolve(expandHome(dirArg ?? (await chooseDir())));

  if (existsSync(join(dir, ".git"))) update(dir, target.url);
  else clone(dir, target);

  if (!existsSync(join(dir, INSTALLER))) fail(`${dir} has no ${INSTALLER}. Is it a clone of this repo?`);
  process.exit(runNode(join(dir, INSTALLER), passthrough));
} catch (error) {
  fail(error.message);
}

// The pull happens here, in the always-fresh npx copy, so an older clone is brought up to
// date before its installer is run.
function update(dir, url) {
  const origin = gitOriginUrl(dir);
  if (origin && !sameRepo(origin, url)) fail(`${dir} is a clone of ${origin}, not ${url}. Pass --dir <path> for a second clone.`);
  console.log(`Updating ${dir}${origin ? ` from ${origin}` : ""}`);
  gitPull(dir);
}

// A `#ref` in package.json is a branch or tag, honoured on this first clone. An empty
// directory is fine, as it is for git clone itself.
function clone(dir, { url, ref }) {
  if (existsSync(dir) && !statSync(dir).isDirectory()) fail(`${dir} is a file, not a directory. Pass --dir <path> to use another location.`);
  if (existsSync(dir) && readdirSync(dir).length) fail(`${dir} exists, is not empty and is not a git clone. Pass --dir <path> to use another location.`);
  console.log(`Cloning ${url}${ref ? ` (${ref})` : ""} into ${dir}`);
  const status = run("git", ["clone", ...(ref ? ["--branch", ref] : []), url, dir]);
  if (status !== 0) process.exit(status);
}

async function chooseDir() {
  if (existsSync(join(DEFAULT_DIR, ".git")) || !stdin.isTTY || !stdout.isTTY) return DEFAULT_DIR;
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`Where should the clone live? The tools' folders will point into it. [${DEFAULT_DIR}] `)).trim();
  rl.close();
  return answer || DEFAULT_DIR;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
