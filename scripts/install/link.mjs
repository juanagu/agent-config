import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { toPosix } from "./paths.mjs";

export function samePath(a, b) {
  const normalise = (path) => resolve(path.replace(/^\\\\\?\\/, "")).replace(/[\\/]+$/, "");
  const [x, y] = [normalise(a), normalise(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

function lstat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function removeLink(path) {
  try {
    unlinkSync(path);
  } catch {
    rmdirSync(path);
  }
}

// Links entries of a tool's user directory into the clone. A real file or directory in the
// way is moved to <toolDir>/backup-<timestamp>/ first; a link in the way holds no data and
// is removed.
export function createLinker(toolDir) {
  const backupDir = join(toolDir, `backup-${timestamp()}`);
  let backedUp = false;

  function backup(path) {
    mkdirSync(backupDir, { recursive: true });
    renameSync(path, join(backupDir, basename(path)));
    backedUp = true;
  }

  function linksTo(path, target) {
    const stat = lstat(path);
    return Boolean(stat?.isSymbolicLink() && samePath(readlinkSync(path), target));
  }

  function link(path, target) {
    if (linksTo(path, target)) return false;
    const stat = lstat(path);
    if (stat?.isSymbolicLink()) removeLink(path);
    else if (stat) backup(path);
    mkdirSync(dirname(path), { recursive: true });
    // "junction" makes a directory junction on Windows, which needs no admin rights,
    // and is ignored on every other platform.
    symlinkSync(target, path, "junction");
    return true;
  }

  function writeImport(path, repoDir) {
    const line = `@${toPosix(repoDir)}/CLAUDE.md`;
    if (existsSync(path) && readFileSync(path, "utf8").trim() === line) return false;
    if (lstat(path)) backup(path);
    writeFileSync(path, `${line}\n`);
    return true;
  }

  // A file the tool reads but cannot import: written once, then it is the user's.
  function copyIfMissing(path, source) {
    if (lstat(path)) return false;
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(source, path);
    return true;
  }

  function sweepBrokenLinks(dir) {
    const removed = [];
    if (!existsSync(dir)) return removed;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (lstat(full)?.isSymbolicLink() && !existsSync(full)) {
        removeLink(full);
        removed.push(name);
      }
    }
    return removed;
  }

  return { link, writeImport, copyIfMissing, sweepBrokenLinks, backupDir: () => (backedUp ? backupDir : null) };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
}
