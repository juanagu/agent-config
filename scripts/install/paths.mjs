import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export function toPosix(path) {
  return path.split(sep).join("/");
}

// A shell expands a leading ~ before we see it; an answer typed at a prompt is not.
export function expandHome(path, home = homedir()) {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}

// Two spellings of one directory: a trailing slash, a `\\?\` prefix, or a case difference on
// Windows do not make a different path.
export function samePath(a, b) {
  const normalise = (path) => resolve(path.replace(/^\\\\\?\\/, "")).replace(/[\\/]+$/, "");
  const [x, y] = [normalise(a), normalise(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}
