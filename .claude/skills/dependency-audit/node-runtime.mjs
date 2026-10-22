// (b) and (c): the Node runtime a repo pins (Dockerfiles, CI `node-version`, .nvmrc, .node-version,
// `engines`) and the one installed here, against nodejs.org's release index. A pin is behind when
// the newest release it resolves to is older than the newest security release of its major line.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { compareVersions, matchesPrefix, parseVersion } from "./semver.mjs";

export const INDEX_URL = "https://nodejs.org/dist/index.json";
export const SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const FETCH_TIMEOUT_MS = 15_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const MAX_DEPTH = 3;

const FROM_NODE = /^\s*FROM\s+(?:--\S+\s+)*(?:[\w.:-]+\/)*node:([^\s@]+)/gim;
const NODE_VERSION = /node-version:\s*['"]?([^'"\s#]+)/g;
// Tags and aliases that move with every release: rebuilt or re-run, they pick up the newest.
const FLOATING = /^(lts|current|latest|node|alpine|slim|bookworm|bullseye|iron|jod|krypton)\b|^lts\//i;

export async function fetchJson(url, { attempts = 2, fetcher = fetch } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.ok) return await response.json();
      lastError = new Error(`${url} answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function walk(dir, depth = 0, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), depth + 1, out);
    else if (entry.isFile()) out.push(join(dir, entry.name));
  }
  return out;
}

const isDockerfile = (name) => /^Dockerfile/i.test(name) || /\.Dockerfile$/i.test(name);

// Every place the repo names a Node version, with the text as written.
export function findPins(dir) {
  const pins = [];
  const rel = (path) => relative(dir, path).replace(/\\/g, "/");
  for (const file of walk(dir)) {
    const name = file.split(/[\\/]/).pop();
    if (isDockerfile(name)) for (const m of readFileSync(file, "utf8").matchAll(FROM_NODE)) pins.push({ file: rel(file), kind: "docker", raw: m[1] });
    if (/[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(file)) {
      for (const m of readFileSync(file, "utf8").matchAll(NODE_VERSION)) if (!m[1].startsWith("${{")) pins.push({ file: rel(file), kind: "ci", raw: m[1] });
    }
  }
  for (const name of [".nvmrc", ".node-version"]) {
    const path = join(dir, name);
    if (existsSync(path)) pins.push({ file: name, kind: "version-file", raw: readFileSync(path, "utf8").trim() });
  }
  const engines = readEngines(dir);
  if (engines) pins.push({ file: "package.json", kind: "engines", raw: engines });
  // A multi-stage Dockerfile or a workflow with several jobs names the same version more than once.
  const seen = new Set();
  return pins.filter((pin) => !seen.has(`${pin.file}\n${pin.raw}`) && seen.add(`${pin.file}\n${pin.raw}`));
}

function readEngines(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).engines?.node ?? null;
  } catch {
    return null;
  }
}

// The newest security release of each major line, and the newest release of any kind under a prefix.
export function latestSecurity(releases, major) {
  return releases.filter((r) => r.security && parseVersion(r.version)?.major === major).map((r) => r.version).sort(compareVersions).pop() ?? null;
}

function newestUnder(releases, prefix) {
  return releases.map((r) => r.version).filter((v) => matchesPrefix(v, prefix)).sort(compareVersions).pop() ?? null;
}

function securityReleasesAfter(releases, version) {
  const major = parseVersion(version).major;
  return releases.filter((r) => r.security && parseVersion(r.version)?.major === major && compareVersions(r.version, version) > 0).length;
}

function endOfLife(schedule, major, today) {
  const end = schedule?.[`v${major}`]?.end;
  return end ? { eol: Date.parse(end) <= today.getTime(), end } : { eol: null, end: null };
}

const isRange = (pin, raw) => pin.kind === "engines" || /[<>^~|\s]/.test(raw);

// One verdict per pin: floating (moves on its own), range (engines: a floor, not a pin), behind,
// current, or unknown (no release under that prefix).
export function evaluatePin(pin, releases, schedule, today = new Date()) {
  // "22.x" in a workflow means the newest 22, as "22" does.
  const raw = pin.raw.replace(/^v/, "").replace(/(\.(x|\*))+$/i, "");
  const floor = raw.match(/\d+(?:\.\d+){0,2}/)?.[0];
  if (FLOATING.test(raw) || !floor) return { ...pin, status: "floating" };
  const major = parseVersion(floor).major;
  const security = latestSecurity(releases, major);
  const life = endOfLife(schedule, major, today);
  if (isRange(pin, raw)) {
    return { ...pin, status: "range", floor, latestSecurity: security, floorBelowSecurity: Boolean(security && compareVersions(floor, security) < 0), ...life };
  }
  const resolved = newestUnder(releases, raw);
  if (!resolved) return { ...pin, status: "unknown", latestSecurity: security, ...life };
  const behind = Boolean(security && compareVersions(resolved, security) < 0);
  return { ...pin, status: behind ? "behind" : "current", resolved, latestSecurity: security, securityReleasesBehind: behind ? securityReleasesAfter(releases, resolved) : 0, ...life };
}

export async function loadReleases(options) {
  const releases = await fetchJson(INDEX_URL, options);
  let schedule = null;
  try {
    schedule = await fetchJson(SCHEDULE_URL, options);
  } catch {
    // End-of-life dates are a bonus; the security comparison does not need them.
  }
  return { releases, schedule };
}
