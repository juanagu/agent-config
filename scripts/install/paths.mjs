import { homedir } from "node:os";
import { join, sep } from "node:path";

export function toPosix(path) {
  return path.split(sep).join("/");
}

// A shell expands a leading ~ before we see it; an answer typed at a prompt is not.
export function expandHome(path, home = homedir()) {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}
