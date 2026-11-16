#!/usr/bin/env node
// Frees Docker's disk space without touching volumes (local databases live there).
//
//   node reclaim.mjs report
//   node reclaim.mjs prune [--older-than <hours>h]
//   node reclaim.mjs compact
//
// `report` and `prune` talk to docker; `compact` only prints what the user runs, because
// compacting a Windows disk needs an elevated shell an agent cannot open. Node built-ins only.
import { existsSync, realpathSync, statSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_OLDER_THAN = "168h";
export const ENGINE_TIMEOUT_MS = 15_000;
const PRUNE_TIMEOUT_MS = 10 * 60_000;
const GB = 1024 ** 3;
const DURATION = /^\d+h$/;

// The only commands `prune` ever runs. No volume operation belongs here, and the test that reads
// this list fails if one is added.
export const pruneSteps = (olderThan = DEFAULT_OLDER_THAN) => [
  ["container", "prune", "-f"],
  ["image", "prune", "-f"],
  ["image", "prune", "-a", "-f", "--filter", `until=${olderThan}`],
  ["builder", "prune", "-f", "--filter", `until=${olderThan}`],
];

// Docker Desktop's disk images on Windows; whichever exist are what grows and what compact shrinks.
export const vhdxCandidates = (env) => {
  const base = join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Docker", "wsl");
  return [join(base, "disk", "docker_data.vhdx"), join(base, "main", "ext4.vhdx"), join(base, "data", "ext4.vhdx")];
};

export const formatGb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

export function realDeps() {
  return {
    env: process.env,
    platform: process.platform,
    home: homedir(),
    statfs: statfsSync,
    exists: existsSync,
    fileSize: (path) => statSync(path).size,
    docker(args, timeout) {
      const result = spawnSync("docker", args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
      const missing = result.error?.code === "ENOENT";
      return { ok: result.status === 0, missing, timedOut: result.error?.code === "ETIMEDOUT", stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}

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

const dfLines = (rows) => rows.map((row) => `  ${row.Type}: ${row.TotalCount} total, ${row.Active} active, ${row.Size} (reclaimable ${row.Reclaimable})`);

// Says whether the engine answers, within the timeout, so nothing below hangs on a dead one.
function engineStatus(deps) {
  const info = deps.docker(["info", "--format", "{{.ServerVersion}}"], ENGINE_TIMEOUT_MS);
  if (info.ok) return null;
  if (info.missing) return "Docker is not installed (no `docker` on PATH). Nothing to reclaim.";
  const why = info.timedOut ? `did not answer within ${ENGINE_TIMEOUT_MS / 1000}s` : "is not running";
  return `The Docker engine ${why}. Start Docker Desktop, or if it died with the disk full, free space on the drive first. Stopping here.`;
}

function systemDf(deps) {
  const result = deps.docker(["system", "df", "--format", "{{json .}}"], ENGINE_TIMEOUT_MS);
  return result.ok ? dfLines(parseDf(result.stdout)) : [`  docker system df failed: ${result.stderr.trim()}`];
}

function vhdxLines(deps) {
  if (deps.platform !== "win32") return [];
  const found = vhdxCandidates(deps.env).filter((path) => deps.exists(path));
  if (!found.length) return ["Docker Desktop disk images: none found under %LOCALAPPDATA%\\Docker\\wsl."];
  return ["Docker Desktop disk images (these only shrink after `compact`):", ...found.map((path) => `  ${formatGb(deps.fileSize(path))}  ${path}`)];
}

export function report(deps) {
  const lines = [`Free space on the home drive: ${formatGb(freeBytes(deps))}`];
  const down = engineStatus(deps);
  if (down) return { ok: false, text: [...lines, down].join("\n") };
  return { ok: true, text: [...lines, "docker system df:", ...systemDf(deps), ...vhdxLines(deps)].join("\n") };
}

export function prune(deps, olderThan = DEFAULT_OLDER_THAN) {
  const down = engineStatus(deps);
  if (down) return { ok: false, text: down };
  const before = freeBytes(deps);
  const lines = [`Free space before: ${formatGb(before)}`, "docker system df before:", ...systemDf(deps)];
  for (const args of pruneSteps(olderThan)) {
    const result = deps.docker(args, PRUNE_TIMEOUT_MS);
    const tail = (result.ok ? result.stdout : result.stderr).trim().split(/\r?\n/).pop();
    lines.push(`docker ${args.join(" ")}: ${result.ok ? "ok" : "FAILED"}${tail ? ` (${tail})` : ""}`);
  }
  const after = freeBytes(deps);
  lines.push("docker system df after:", ...systemDf(deps), `Free space after: ${formatGb(after)} (${formatGb(after - before)} gained on the drive)`);
  if (deps.platform === "win32") lines.push("Windows only gets the space back after `compact`: run it and follow its steps.");
  return { ok: true, text: lines.join("\n") };
}

function windowsSteps(deps) {
  const found = vhdxCandidates(deps.env).filter((path) => deps.exists(path));
  const targets = found.length ? found : [vhdxCandidates(deps.env)[0]];
  const lines = [
    "Compacting is yours to do: it needs an elevated shell, which an agent cannot open.",
    "1. Quit Docker Desktop (tray icon, Quit Docker Desktop).",
    "2. In any terminal: wsl --shutdown",
    "3. Open PowerShell as Administrator and run, for each disk image below, one of:",
  ];
  if (!found.length) lines.push("   (no disk image found; this is Docker Desktop's usual path, check it exists)");
  for (const path of targets) {
    lines.push(
      `   ${path}`,
      `   a) With the Hyper-V module:  Optimize-VHD -Path "${path}" -Mode Full`,
      "   b) Without it, in diskpart:",
      `        select vdisk file="${path}"`,
      "        attach vdisk readonly",
      "        compact vdisk",
      "        detach vdisk",
      "        exit",
    );
  }
  lines.push("4. Start Docker Desktop again. Free space on C: grows by what the prune freed inside the disk image.");
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
  if (!["report", "prune", "compact"].includes(command)) throw new Error("Usage: reclaim.mjs report | prune [--older-than <hours>h] | compact");
  if (!DURATION.test(olderThan ?? "")) throw new Error("--older-than takes hours, like 72h.");
  return { command, olderThan };
}

export function main(argv, deps = realDeps()) {
  const { command, olderThan } = parseCli(argv);
  if (command === "report") return report(deps);
  if (command === "prune") return prune(deps, olderThan);
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
