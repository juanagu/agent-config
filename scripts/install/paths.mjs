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
  return comparable(a) === comparable(b);
}

// One spelling per directory: no `\\?\` prefix or trailing slash, and lowercase on Windows.
function comparable(path) {
  const plain = resolve(path.replace(/^\\\\\?\\/, "")).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? plain.toLowerCase() : plain;
}

// Whether `path` is `dir` or somewhere under it, with samePath's idea of one spelling.
export function isInside(path, dir) {
  const [child, parent] = [comparable(path), comparable(dir)];
  return child === parent || child.startsWith(parent + sep);
}

// Tools that ignore --home (npx skills, claude mcp add) may run only when it names the real home.
export function isRealHome(home) {
  return samePath(home, homedir());
}
