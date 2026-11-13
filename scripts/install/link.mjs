import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { sha256 } from "./json.mjs";
import { samePath, toPosix } from "./paths.mjs";

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
// remembers the target of each link made or found in place, so a sweep removes only its own.
export function createLinker(toolDir, copies = {}, imports = {}, links = {}) {
  const backupDir = join(toolDir, `backup-${timestamp()}`);
  let backedUp = false;

  function backup(path) {
    mkdirSync(backupDir, { recursive: true });
    renameSync(path, join(backupDir, basename(path)));
    backedUp = true;
  }

  // A relative target is read from the link's own folder, as the file system reads it.
  function linksTo(path, target) {
    const stat = lstat(path);
    return Boolean(stat?.isSymbolicLink() && samePath(resolve(dirname(path), readlinkSync(path)), target));
  }

  // Our own unchanged copy, written where a file link could not be made at the time.
  function isOurCopy(path, stat) {
    const key = toPosix(path);
    return Boolean(stat?.isFile() && key in copies && sha256(readFileSync(path)) === copies[key]);
  }

  function link(path, target, type = "junction") {
    const key = toPosix(path);
    if (linksTo(path, target)) {
      links[key] = toPosix(target);
      return false;
    }
    const stat = lstat(path);
    if (stat?.isSymbolicLink() || isOurCopy(path, stat)) removeLink(path);
    else if (stat) backup(path);
    mkdirSync(dirname(path), { recursive: true });
    // "junction" makes a directory junction on Windows, which needs no admin rights,
    // and is ignored on every other platform.
    symlinkSync(target, path, type);
    links[key] = toPosix(target);
    delete copies[key];
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

  // A copy we made of a file the clone no longer has. Only a file still holding what we wrote is
  // removed: an edit, a folder or a link the user put there is theirs. True when it was removed.
  function forgetCopy(path) {
    const key = toPosix(path);
    if (!(key in copies)) return false;
    const ours = isOurCopy(path, lstat(path));
    if (ours) unlinkSync(path);
    delete copies[key];
    return ours;
  }

  // A dangling link is removed only when the record holds it with the target it still has, wherever
  // the clone that made it lived. Any other may be the user's (a drive not mounted right now): it
  // stays, and is listed so the user can remove it.
  function sweepBrokenLinks(dir) {
    const removed = [];
    const left = [];
    if (!existsSync(dir)) return { removed, left };
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!lstat(full)?.isSymbolicLink() || existsSync(full)) continue;
      const key = recordKey(full);
      if (key !== undefined && linksTo(full, links[key])) {
        removeLink(full);
        delete links[key];
        removed.push(name);
      } else left.push(name);
    }
    pruneRecords(dir);
    return { removed, left };
  }

  // The record's key for `path`, under samePath's idea of one spelling (case on Windows).
  function recordKey(path) {
    return Object.keys(links).find((key) => samePath(key, path));
  }

  // A record whose path no longer holds a link is dropped. One the user pointed elsewhere is kept,
  // since its old target is what tells that link apart from ours.
  function pruneRecords(dir) {
    for (const key of Object.keys(links)) {
      if (samePath(dirname(key), dir) && !lstat(key)?.isSymbolicLink()) delete links[key];
    }
  }

  return { link, linkFile, writeImport, copy, forgetCopy, sweepBrokenLinks, backupDir: () => (backedUp ? backupDir : null) };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
}
