#!/usr/bin/env node
// The dependency-audit skill's data gathering: one JSON report on stdout, triage left to the agent.
//
//   node audit.mjs [repo-dir ...]                 the repos named (default: the current directory)
//   node audit.mjs --all <parent> [--match cmc-]  every git repo directly under <parent>
//   node audit.mjs --stamp                        record that an audit finished (read by the nudge)
//
// Node built-ins only. Progress and fallbacks go to stderr, so stdout stays one JSON document.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dependabotAlerts } from "./dependabot.mjs";
import { evaluatePin, findPins, loadReleases } from "./node-runtime.mjs";
import { auditNpm } from "./npm-audit.mjs";
import { writeStamp } from "./stamp.mjs";

export function parseArgs(argv) {
  const options = { dirs: [], all: null, match: "", stamp: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stamp") options.stamp = true;
    else if (arg === "--all") options.all = argv[++i];
    else if (arg === "--match") options.match = argv[++i] ?? "";
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else options.dirs.push(arg);
  }
  if (options.all === undefined) throw new Error("--all needs a directory.");
  return options;
}

// The sibling clones: every direct child that is a git checkout, worktrees folders and the like skipped.
export function siblingRepos(parent, match = "") {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(match) && existsSync(join(parent, entry.name, ".git")))
    .map((entry) => join(parent, entry.name));
}

async function nodeReleases() {
  try {
    return await loadReleases();
  } catch (error) {
    console.error(`nodejs.org release index unavailable (${error.message}): runtime checks skipped.`);
    return null;
  }
}

async function auditRepo(dir, index) {
  console.error(`Auditing ${dir} ...`);
  const npm = await auditNpm(dir);
  if (npm.error) console.error(`  ${npm.error}; ${npm.source === "lockfile" ? "reporting lockfile versions instead" : "dev findings are missing"}.`);
  const pins = findPins(dir);
  const runtime = index ? pins.map((pin) => evaluatePin(pin, index.releases, index.schedule)) : { unavailable: "release index unreachable", pins };
  return { dir, npm, runtime, dependabot: dependabotAlerts(dir) };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.stamp) {
    console.log(`Recorded the audit in ${writeStamp()}.`);
    return;
  }
  const dirs = options.all ? siblingRepos(resolve(options.all), options.match) : (options.dirs.length ? options.dirs : ["."]).map((dir) => resolve(dir));
  const index = await nodeReleases();
  const local = index ? evaluatePin({ file: "node --version", kind: "local", raw: process.version }, index.releases, index.schedule) : { unavailable: "release index unreachable", raw: process.version };
  const repos = [];
  for (const dir of dirs) repos.push(await auditRepo(dir, index));
  console.log(JSON.stringify({ date: new Date().toISOString(), local, repos }, null, 2));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
