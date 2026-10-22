// (b) and (c): the Node versions a repo pins (pins.mjs finds them) and the one installed here,
// against nodejs.org's release index. A pin is behind when the newest release it resolves to is
// older than the newest security release of its major line.
import { compareVersions, matchesPrefix, parseVersion } from "./semver.mjs";

export const INDEX_URL = "https://nodejs.org/dist/index.json";
export const SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const FETCH_TIMEOUT_MS = 15_000;

// LTS codenames, as Docker tags (`hydrogen-alpine3.18`) and .nvmrc aliases (`lts/gallium`) use them:
// each names the newest release of its major line, so it is judged as that major.
export const CODENAMES = { argon: 4, boron: 6, carbon: 8, dubnium: 10, erbium: 12, fermium: 14, gallium: 16, hydrogen: 18, iron: 20, jod: 22, krypton: 24 };
const CODENAME = new RegExp(`^(?:lts/)?(${Object.keys(CODENAMES).join("|")})\\b`, "i");
// Anything else that starts with a letter (`lts`, `current`, `alpine3.20`, `bookworm-slim`) is
// an alias or a bare variant: it moves to the newest release on every rebuild.
const FLOATING = /^[a-z]/i;

// The pin as a version prefix: "v22" → "22", "22.x" (the newest 22, as "22" is) → "22",
// "hydrogen-alpine3.18" → "18".
function normalise(raw) {
  const codename = raw.match(CODENAME);
  if (codename) return String(CODENAMES[codename[1].toLowerCase()]);
  return raw.replace(/^v(?=\d)/, "").replace(/(\.(x|\*))+$/i, "");
}

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

// One verdict per pin: unresolved (a variable with no default), floating (moves on its own), range
// (engines: a floor, not a pin), behind, current, or unknown (no release under that prefix).
export function evaluatePin(pin, releases, schedule, today = new Date()) {
  if (pin.raw.includes("$")) return { ...pin, status: "unresolved" };
  const raw = normalise(pin.raw.trim());
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
