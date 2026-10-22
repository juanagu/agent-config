#!/usr/bin/env node
// The dependency-audit skill's data gathering: one JSON report on stdout, triage left to the agent.
//
//   node audit.mjs [repo-dir ...]                 the repos named (default: the current directory)
//   node audit.mjs --all <parent> [--match cmc-]  every git repo directly under <parent>
//   node audit.mjs --stamp                        record that an audit finished (read by the nudge)
//
// Node built-ins only. Progress and fallbacks go to stderr, so stdout stays one JSON document.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dependabotAlerts } from "./dependabot.mjs";
import { evaluatePin, loadReleases } from "./node-runtime.mjs";
import { auditNpm } from "./npm-audit.mjs";
import { findPins } from "./pins.mjs";
import { writeStamp } from "./stamp.mjs";

export function parseArgs(argv) {
  const options = { dirs: [], all: null, match: "", stamp: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stamp") options.stamp = true;
    else if (arg === "--all") options.all = optionValue(argv, ++i, "--all needs a directory.");
    else if (arg === "--match") options.match = optionValue(argv, ++i, "--match needs a prefix.");
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else options.dirs.push(arg);
  }
  if (options.all && options.dirs.length) throw new Error(`--all audits every clone under one folder; drop the directories named as well (${options.dirs.join(", ")}).`);
  return options;
}

function optionValue(argv, i, message) {
  const value = argv[i];
  if (value === undefined || value.startsWith("--")) throw new Error(message);
  return value;
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

// Every directory named must exist before any of them is audited, so a typo fails at once.
export function resolveDirs(options) {
  if (options.all) {
    const parent = resolve(options.all);
    if (!isDirectory(parent)) throw new Error(`--all: ${parent} is not a directory.`);
    return siblingRepos(parent, options.match);
  }
  const dirs = (options.dirs.length ? options.dirs : ["."]).map((dir) => resolve(dir));
  const missing = dirs.filter((dir) => !isDirectory(dir));
  if (missing.length) throw new Error(`Not a directory: ${missing.join(", ")}`);
  return dirs;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// One repo that throws is reported with its error; the others are still audited.
export async function auditRepoSafely(dir, index, audit = auditRepo) {
  try {
    return await audit(dir, index);
  } catch (error) {
    console.error(`  ${dir} failed: ${error.message}`);
    return { dir, error: error.message };
  }
}

async function auditRepo(dir, index) {
  console.error(`Auditing ${dir} ...`);
  const npm = await guarded("npm audit", () => auditNpm(dir));
  if (npm.error) console.error(`  ${npm.error}; ${npm.source === "lockfile" ? "reporting lockfile versions instead" : "that part is unchecked"}.`);
  const runtime = await guarded("Node pins", () => runtimeVerdicts(dir, index));
  const dependabot = await guarded("Dependabot", () => dependabotAlerts(dir));
  return { dir, npm, runtime, dependabot };
}

function runtimeVerdicts(dir, index) {
  const pins = findPins(dir);
  return index ? pins.map((pin) => evaluatePin(pin, index.releases, index.schedule)) : { unavailable: "release index unreachable", pins };
}

// One check that throws is reported as that check's error; the repo's other checks still count.
export async function guarded(name, check) {
  try {
    return await check();
  } catch (error) {
    console.error(`  ${name} failed: ${error.message}`);
    return { error: `${name} failed: ${error.message}` };
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.stamp) {
    console.log(`Recorded the audit in ${writeStamp()}.`);
    return;
  }
  const dirs = resolveDirs(options);
  const index = await nodeReleases();
  const local = index ? evaluatePin({ file: "node --version", kind: "local", raw: process.version }, index.releases, index.schedule) : { unavailable: "release index unreachable", raw: process.version };
  const repos = [];
  for (const dir of dirs) repos.push(await auditRepoSafely(dir, index));
  console.log(JSON.stringify({ date: new Date().toISOString(), local, repos }, null, 2));
}

// realpath on both sides: a tool's skills folder reaches this file through a junction or symlink.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
