// (a) `npm audit --json`, production (`--omit=dev`) and everything, triaged per package. npm's
// audit endpoint times out under load, so each run is retried with backoff; when it stays down the
// lockfile's versions are returned instead, marked as unchecked.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, parseVersion } from "./semver.mjs";

const ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const NPM_TIMEOUT_MS = 120_000;

// One command string through the shell, so npm.cmd resolves on Windows; the arguments are constants.
function spawnNpm(dir, args) {
  const result = spawnSync(["npm", ...args].join(" "), { cwd: dir, encoding: "utf8", timeout: NPM_TIMEOUT_MS, shell: true, maxBuffer: 64 * 1024 * 1024 });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut: result.error?.code === "ETIMEDOUT" };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Worth another try: a timeout, a dropped or refused connection, a DNS hiccup, a rate limit or a
// 5xx. A missing lockfile or an audit endpoint that refuses the request (ENOAUDIT, EAUDITNOLOCK)
// fails the same way every time.
const TRANSIENT = /^(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|E429|E5\d\d)$/;

// A report has `vulnerabilities`; anything else (an `error` object, no JSON, a killed process) is
// the endpoint or the tooling failing, never a finding. Output that is not JSON at all is
// treated as transient, since a dropped connection can cut it short.
export function parseAuditOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed.vulnerabilities === "object") return { report: parsed };
    const code = parsed?.error?.code ?? null;
    return { error: parsed?.error?.summary || code || "no vulnerabilities field in npm's answer", retry: Boolean(code && TRANSIENT.test(code)) };
  } catch {
    return { error: stdout.trim().slice(0, 200) || "npm audit printed no JSON", retry: true };
  }
}

export async function runNpmAudit(dir, { omitDev, exec = spawnNpm, sleep = wait, attempts = ATTEMPTS, baseDelayMs = BASE_DELAY_MS } = {}) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  let last = { error: "not run" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const out = exec(dir, args);
    last = out.timedOut ? { error: "npm audit timed out", retry: true } : parseAuditOutput(out.stdout);
    if (last.report || !last.retry) return { ...last, attempts: attempt };
    if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  return { ...last, attempts };
}

export function readLock(dir) {
  const path = join(dir, "package-lock.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const installedVersion = (lock, name) => lock?.packages?.[`node_modules/${name}`]?.version ?? null;

// What a fix costs. npm's `fixAvailable` is true (a semver-compatible update), false, or the
// top-level package to move and the version to move it to. A move to an older version than the
// one installed (npm offering an old major) is no fix at all.
export function fixKind(fixAvailable, lock) {
  if (fixAvailable === true) return "patch-minor";
  if (!fixAvailable || typeof fixAvailable !== "object") return "none";
  const current = installedVersion(lock, fixAvailable.name);
  if (current && compareVersions(fixAvailable.version, current) < 0) return "downgrade";
  if (fixAvailable.isSemVerMajor) return "major";
  return "patch-minor";
}

function advisories(vulnerability) {
  return (vulnerability.via ?? [])
    .filter((via) => typeof via === "object")
    .map((via) => ({ title: via.title, url: via.url, ghsa: via.url?.match(/GHSA-[\w-]+/)?.[0] ?? null, severity: via.severity, range: via.range }));
}

export function findingsFrom(report, lock, prodNames) {
  return Object.values(report.vulnerabilities ?? {}).map((v) => ({
    package: v.name,
    installed: installedVersion(lock, v.name),
    severity: v.severity,
    scope: prodNames.has(v.name) ? "production" : "dev",
    direct: Boolean(v.isDirect),
    fix: fixKind(v.fixAvailable, lock),
    fixTo: typeof v.fixAvailable === "object" && v.fixAvailable ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : null,
    advisories: advisories(v),
    via: (v.via ?? []).filter((via) => typeof via === "string"),
  }));
}

// The fallback: every installed package with its version and whether only dev needs it.
export function lockfileVersions(lock) {
  return Object.entries(lock?.packages ?? {})
    .filter(([path]) => path.startsWith("node_modules/"))
    .map(([path, entry]) => ({ package: path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length), version: entry.version, dev: Boolean(entry.dev) }))
    .filter((entry) => parseVersion(entry.version));
}

const plural = (n) => `${n} attempt${n === 1 ? "" : "s"}`;

export async function auditNpm(dir, options = {}) {
  if (!existsSync(join(dir, "package.json"))) return { skipped: "no package.json" };
  const lock = readLock(dir);
  if (!lock) return { skipped: "no package-lock.json (npm audit needs one)" };
  const prod = await runNpmAudit(dir, { ...options, omitDev: true });
  if (!prod.report) {
    return { source: "lockfile", error: `npm audit failed after ${plural(prod.attempts)}: ${prod.error}`, packages: lockfileVersions(lock) };
  }
  const prodNames = new Set(Object.keys(prod.report.vulnerabilities ?? {}));
  const all = await runNpmAudit(dir, { ...options, omitDev: false });
  if (!all.report) {
    return { source: "npm audit, production only", error: `the dev audit failed after ${plural(all.attempts)}: ${all.error}`, findings: findingsFrom(prod.report, lock, prodNames) };
  }
  return { source: "npm audit", findings: findingsFrom(all.report, lock, prodNames) };
}
