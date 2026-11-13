import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { sha256 } from "./json.mjs";
import { isInside, samePath, toPosix } from "./paths.mjs";

export { samePath };

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

// An `@` import of a CLAUDE.md in a clone named after this repo or its predecessor; a clone
// elsewhere is recognised by the line the installer wrote last time (`imports`).
const NAMED_IMPORT = /^@.*(?:agent-config|claude-code-config).*\/CLAUDE\.md$/;

// Links entries of a tool's user directory into the clone. A real file or directory in the
// way is moved to <toolDir>/backup-<timestamp>/ first; a link in the way holds no data and
// is removed. `copies` remembers the hash of each file written as a copy, so a later run can
// tell our copy (refresh it) from the user's edit (leave it); `imports` remembers the import
// line written into each CLAUDE.md, so a re-run replaces it wherever the clone lives; `links`
// remembers the target of each link made or found in place, so a later run sweeps only its own.
export function createLinker(toolDir, copies = {}, imports = {}, links = {}) {
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

  function link(path, target, type = "junction") {
    links[toPosix(path)] = toPosix(target);
    if (linksTo(path, target)) return false;
    const stat = lstat(path);
    if (stat?.isSymbolicLink()) removeLink(path);
    else if (stat) backup(path);
    mkdirSync(dirname(path), { recursive: true });
    // "junction" makes a directory junction on Windows, which needs no admin rights,
    // and is ignored on every other platform.
    symlinkSync(target, path, type);
    return true;
  }

  // Whether this platform lets us make a file symlink (Windows needs a privilege for it),
  // found out once with a probe link next to the real ones.
  let fileLinks = null;
  function canLinkFiles() {
    if (fileLinks !== null) return fileLinks;
    const probe = join(toolDir, `.agent-config-probe-${process.pid}`);
    try {
      symlinkSync(toolDir, probe, "file");
      unlinkSync(probe);
      fileLinks = true;
    } catch {
      fileLinks = false;
    }
    return fileLinks;
  }

  // A file symlink where the platform allows one, else a copy kept current by `copy`.
  // Returns "linked", "copied" or false when nothing changed.
  function linkFile(path, target) {
    if (!canLinkFiles()) return copy(path, target, { onForeign: "backup" }) ? "copied" : false;
    return link(path, target, "file") ? "linked" : false;
  }

  // The user's CLAUDE.md keeps everything but the import line, which is replaced in place or
  // added at the top.
  function writeImport(path, repoDir) {
    const line = `@${toPosix(repoDir)}/CLAUDE.md`;
    const key = toPosix(path);
    const previous = imports[key];
    const isOurs = (entry) => entry.trim() === line || entry.trim() === previous || NAMED_IMPORT.test(entry.trim());
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    const kept = current.split(/\r?\n/).filter((entry) => !isOurs(entry));
    const next = [line, ...kept].join("\n").replace(/\n*$/, "\n");
    imports[key] = line;
    if (current === next) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    return true;
  }

  // A file the tool reads but cannot import. Written when missing; refreshed while its content
  // is still what we last wrote; left alone once the user edited it ("keep") or, for a file that
  // is ours by name, moved to the backup first ("backup"). Returns "wrote", "updated", "kept" or false.
  function copy(path, source, { onForeign = "keep" } = {}) {
    const content = readFileSync(source);
    const hash = sha256(content);
    const key = toPosix(path);
    const stat = lstat(path);
    delete links[key];
    if (stat?.isSymbolicLink()) removeLink(path);
    else if (stat) {
      const currentHash = sha256(readFileSync(path));
      if (currentHash === hash) {
        copies[key] = hash;
        return false;
      }
      if (copies[key] !== currentHash) {
        if (onForeign === "keep") return "kept";
        backup(path);
      }
    }
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(source, path);
    const outcome = stat && !stat.isSymbolicLink() ? "updated" : "wrote";
    copies[key] = hash;
    return outcome;
  }

  // A copy we made of a file the clone no longer has.
  function forgetCopy(path) {
    const key = toPosix(path);
    if (!(key in copies)) return false;
    const stat = lstat(path);
    // A link the user put where our copy was is theirs, whether or not its target is there.
    if (stat && !stat.isSymbolicLink() && sha256(readFileSync(path)) === copies[key]) unlinkSync(path);
    delete copies[key];
    return true;
  }

  // A link an install made: recorded with the target it still has (wherever the clone lived, a
  // worktree included), or, made before links were recorded, one into this clone. Any other
  // dangling link is the user's (a drive not mounted right now) and stays.
  function isOurLink(path, repoDir) {
    const target = readlinkSync(path);
    const recorded = links[toPosix(path)];
    if (recorded !== undefined) return samePath(target, recorded);
    return isInside(resolve(dirname(path), target), repoDir);
  }

  function sweepBrokenLinks(dir, repoDir) {
    const removed = [];
    if (!existsSync(dir)) return removed;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (lstat(full)?.isSymbolicLink() && !existsSync(full) && isOurLink(full, repoDir)) {
        removeLink(full);
        delete links[toPosix(full)];
        removed.push(name);
      }
    }
    return removed;
  }

  return { link, linkFile, writeImport, copy, forgetCopy, sweepBrokenLinks, backupDir: () => (backedUp ? backupDir : null) };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
}
