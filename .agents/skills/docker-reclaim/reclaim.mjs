#!/usr/bin/env node
// Frees Docker's disk space without touching volumes (local databases live there) or stopped
// containers (a stopped compose stack keeps its state).
//
//   node reclaim.mjs report
//   node reclaim.mjs prune [--older-than <hours>h]
//   node reclaim.mjs trim
//   node reclaim.mjs compact
//
// `report`, `prune` and `trim` talk to docker or wsl; `compact` only prints what the user runs,
// because compacting a Windows disk needs an elevated shell an agent cannot open. Node built-ins only.
import { existsSync, realpathSync, statSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeStamp } from "./stamp.mjs";

export const DEFAULT_OLDER_THAN = "168h";
export const ENGINE_TIMEOUT_MS = 15_000;
// `docker system df` walks every image and cache record, which takes far longer than a liveness check.
export const DF_TIMEOUT_MS = 120_000;
// `until` filters by creation time, so a shorter age would also take what was built today.
export const MIN_OLDER_THAN_HOURS = 24;
// A disk image this many times larger than what Docker uses is mostly space only compact returns.
export const OVERSIZE_FACTOR = 2;
export const TRIM_COMMAND = ["-d", "docker-desktop", "-u", "root", "-e", "fstrim", "-av"];
const PRUNE_TIMEOUT_MS = 10 * 60_000;
const TRIM_TIMEOUT_MS = 5 * 60_000;
const GB = 1024 ** 3;
const DURATION = /^\d+h$/;
const DOCKER_UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15 };

// The only commands `prune` ever runs. No volume, container or system prune belongs here, and the
// test that reads this list fails if one is added. An image a stopped container uses is kept.
export const pruneSteps = (olderThan = DEFAULT_OLDER_THAN) => [
  ["image", "prune", "-f"],
  ["image", "prune", "-a", "-f", "--filter", `until=${olderThan}`],
  ["builder", "prune", "-f", "--filter", `until=${olderThan}`],
];

// Docker Desktop's disk images on Windows; whichever exist are what grows and what compact shrinks.
export const vhdxCandidates = (env, home = homedir()) => {
  const base = join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Docker", "wsl");
  return [join(base, "disk", "docker_data.vhdx"), join(base, "main", "ext4.vhdx"), join(base, "data", "ext4.vhdx")];
};

export const formatGb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

function runCommand(program, args, timeout) {
  const result = spawnSync(program, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  const missing = result.error?.code === "ENOENT";
  const timedOut = result.error?.code === "ETIMEDOUT" || (result.status === null && result.signal === "SIGTERM");
  return { ok: result.status === 0, missing, timedOut, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function realDeps() {
  return {
    env: process.env,
    platform: process.platform,
    home: homedir(),
    statfs: statfsSync,
    exists: existsSync,
    fileSize: (path) => statSync(path).size,
    docker: (args, timeout) => runCommand("docker", args, timeout),
    wsl: (args, timeout) => runCommand("wsl", args, timeout),
    stamp: () => writeStamp(),
  };
}

// Why a call failed: a timeout says so (stderr is empty then), otherwise stderr's first line.
const failureReason = (result, timeoutMs) =>
  result.timedOut ? `timed out after ${timeoutMs / 1000}s` : result.stderr.trim().split(/\r?\n/)[0] || "no error output";

export function freeBytes(deps) {
  const info = deps.statfs(deps.home);
  return info.bavail * info.bsize;
}

// `docker system df --format json` prints one object per line (older versions, a JSON array).
export function parseDf(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

// Docker prints sizes like "120GB" or "1.5kB" in decimal units; NaN when it is not one.
export function parseSize(text) {
  const match = /^([\d.]+)\s*([a-z]+)$/i.exec(String(text ?? "").trim());
  const unit = match ? DOCKER_UNITS[match[2].toLowerCase()] : undefined;
  return unit ? Number(match[1]) * unit : NaN;
}

const dfLines = (rows) => rows.map((row) => `  ${row.Type}: ${row.TotalCount} total, ${row.Active} active, ${row.Size} (reclaimable ${row.Reclaimable})`);

// Says whether the engine answers, within the timeout, so nothing below hangs on a dead one.
function engineStatus(deps) {
  const info = deps.docker(["info", "--format", "{{.ServerVersion}}"], ENGINE_TIMEOUT_MS);
  if (info.ok) return null;
  if (info.missing) return "Docker is not installed (no `docker` on PATH). Nothing to reclaim.";
  const why = info.timedOut ? `did not answer within ${ENGINE_TIMEOUT_MS / 1000}s` : "is not running";
  const detail = info.timedOut ? "" : info.stderr.trim().split(/\r?\n/)[0];
  return `The Docker engine ${why}${detail ? ` (${detail})` : ""}. Start Docker Desktop, or if it died with the disk full, free space on the drive first. Stopping here.`;
}

function dfRows(deps) {
  const result = deps.docker(["system", "df", "--format", "{{json .}}"], DF_TIMEOUT_MS);
  if (!result.ok) return { error: `  docker system df failed: ${failureReason(result, DF_TIMEOUT_MS)}` };
  return { rows: parseDf(result.stdout) };
}

const systemDf = (deps, df = dfRows(deps)) => (df.error ? [df.error] : dfLines(df.rows));

const existingDisks = (deps) => vhdxCandidates(deps.env, deps.home).filter((path) => deps.exists(path));

function vhdxLines(deps, df) {
  if (deps.platform !== "win32") return [];
  const found = existingDisks(deps);
  if (!found.length) return ["Docker Desktop disk images: none found under %LOCALAPPDATA%\\Docker\\wsl."];
  const sizes = found.map((path) => [path, deps.fileSize(path)]);
  const lines = ["Docker Desktop disk images (these only shrink after `compact`):", ...sizes.map(([path, size]) => `  ${formatGb(size)}  ${path}`)];
  const used = (df.rows ?? []).reduce((sum, row) => sum + (parseSize(row.Size) || 0), 0);
  const largest = Math.max(...sizes.map(([, size]) => size));
  if (used > 0 && largest > OVERSIZE_FACTOR * used) {
    lines.push(`The largest disk image is ${formatGb(largest)} but Docker uses ${formatGb(used)}: pruning will not shrink the file, compacting it (\`compact\`, after \`trim\`) is what frees that space.`);
  }
  return lines;
}

export function report(deps) {
  const lines = [`Free space on the home drive: ${formatGb(freeBytes(deps))}`];
  const down = engineStatus(deps);
  if (down) return { ok: false, text: [...lines, down].join("\n") };
  const df = dfRows(deps);
  return { ok: true, text: [...lines, "docker system df:", ...systemDf(deps, df), ...vhdxLines(deps, df)].join("\n") };
}

// Hands the blocks the engine freed back to the disk image, while Docker still runs; compact can
// only return blocks the filesystem inside has discarded. A failure is a warning, not an error.
export function trim(deps) {
  if (deps.platform !== "win32") return { ok: true, text: "No trim step is needed outside Windows: the engine's disk is not a separate disk image." };
  const result = deps.wsl(TRIM_COMMAND, TRIM_TIMEOUT_MS);
  if (!result.ok) return { ok: true, text: `Warning: wsl fstrim did not run (${failureReason(result, TRIM_TIMEOUT_MS)}); compact may free less.` };
  return { ok: true, text: `wsl fstrim -av: ok\n${result.stdout.trim()}` };
}

// The disk nudge stays quiet for a day after this. A stamp that cannot be written is no reason to fail.
function recordPrune(deps) {
  try {
    deps.stamp();
  } catch {
    // The nudge may fire again; nothing was lost.
  }
}

export function prune(deps, olderThan = DEFAULT_OLDER_THAN) {
  const down = engineStatus(deps);
  if (down) return { ok: false, text: down };
  const before = freeBytes(deps);
  const lines = [`Free space before: ${formatGb(before)}`, "docker system df before:", ...systemDf(deps)];
  for (const args of pruneSteps(olderThan)) {
    const result = deps.docker(args, PRUNE_TIMEOUT_MS);
    const tail = result.ok ? result.stdout.trim().split(/\r?\n/).pop() : failureReason(result, PRUNE_TIMEOUT_MS);
    lines.push(`docker ${args.join(" ")}: ${result.ok ? "ok" : "FAILED"}${tail ? ` (${tail})` : ""}`);
  }
  recordPrune(deps);
  if (deps.platform === "win32") lines.push(trim(deps).text);
  const after = freeBytes(deps);
  lines.push("docker system df after:", ...systemDf(deps), `Free space after: ${formatGb(after)} (${formatGb(after - before)} gained on the drive)`);
  if (deps.platform === "win32") lines.push("Windows only gets the space back after `compact`: run it and follow its steps.");
  return { ok: true, text: lines.join("\n") };
}

function windowsSteps(deps) {
  const found = existingDisks(deps);
  const targets = found.length ? found : [vhdxCandidates(deps.env, deps.home)[0]];
  const lines = [
    "Compacting is yours to do: it needs an elevated shell, which an agent cannot open.",
    "1. Trim first, while Docker still runs: `node reclaim.mjs trim` (a prune already ran it; skip this if it printed ok).",
    "2. Quit Docker Desktop (tray icon, Quit Docker Desktop).",
    "3. In any terminal: wsl --shutdown",
    "4. Open PowerShell as Administrator and run, for each disk image below, one of:",
  ];
  if (!found.length) lines.push("   (no disk image found; this is Docker Desktop's usual path, check it exists)");
  for (const path of targets) {
    lines.push(
      `   ${path}`,
      `   a) With the Hyper-V module:  Optimize-VHD -Path "${path}" -Mode Full`,
      "   b) Without it, in diskpart (the sequence must end with detach vdisk):",
      `        select vdisk file="${path}"`,
      "        attach vdisk readonly",
      "        compact vdisk",
      "        detach vdisk",
      "        exit",
      `   Then check it let go:  (Get-DiskImage -ImagePath "${path}").Attached   (must print False)`,
    );
  }
  lines.push(
    "5. Start Docker Desktop only once every check printed False: a disk image left attached to Windows makes Docker fail to start with ERROR_SHARING_VIOLATION.",
    "   Free space on C: grows by what the prune freed inside the disk image.",
  );
  return lines;
}

export function compact(deps) {
  if (deps.platform === "win32") return { ok: true, text: windowsSteps(deps).join("\n") };
  if (deps.platform === "darwin") {
    return { ok: true, text: "No compaction step is needed on macOS: Docker Desktop keeps its disk image sparse and returns freed space to the drive after a prune. If free space does not come back, restart Docker Desktop." };
  }
  return { ok: true, text: "No compaction step is needed on Linux: the engine writes to the host's own disk, so a prune frees space directly." };
}

export function parseCli(argv) {
  const [command, ...rest] = argv;
  const at = rest.indexOf("--older-than");
  const olderThan = at === -1 ? DEFAULT_OLDER_THAN : rest[at + 1];
  if (!["report", "prune", "trim", "compact"].includes(command)) throw new Error("Usage: reclaim.mjs report | prune [--older-than <hours>h] | trim | compact");
  if (!DURATION.test(olderThan ?? "")) throw new Error("--older-than takes hours, like 72h.");
  if (parseInt(olderThan, 10) < MIN_OLDER_THAN_HOURS) {
    throw new Error(`--older-than must be at least ${MIN_OLDER_THAN_HOURS}h: the filter goes by creation time, so less would also remove what was built today.`);
  }
  return { command, olderThan };
}

export function main(argv, deps = realDeps()) {
  const { command, olderThan } = parseCli(argv);
  if (command === "report") return report(deps);
  if (command === "prune") return prune(deps, olderThan);
  if (command === "trim") return trim(deps);
  return compact(deps);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    const { ok, text } = main(process.argv.slice(2));
    console.log(text);
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
