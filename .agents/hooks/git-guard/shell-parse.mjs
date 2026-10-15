// The shell-reading half of git-guard: splitting a Bash or PowerShell command into segments and tokens,
// following directory changes, and reading flags. Nothing here knows git.
import { homedir } from "node:os";
import path from "node:path";

const CD_COMMANDS = new Set(["cd", "pushd", "Push-Location", "Set-Location", "sl", "chdir"]);
const PUSH_COMMANDS = new Set(["pushd", "Push-Location"]);
const POP_COMMANDS = new Set(["popd", "Pop-Location"]);

// Git Bash and WSL write C:\x as /c/x or /mnt/c/x; path.resolve would turn those into C:\c\x.
export function toNativePath(p) {
  const expanded = p.replace(/^~(?=\/|$)/, homedir());
  if (process.platform !== "win32") return expanded;
  const posixDrive = expanded.match(/^\/(?:mnt\/)?([A-Za-z])(\/.*)?$/);
  return posixDrive ? `${posixDrive[1].toUpperCase()}:${posixDrive[2] ?? "/"}` : expanded;
}

// Splits on shell separators outside quotes, and skips heredoc bodies (a commit message is not a command).
export function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      i++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      i++;
    } else if (ch === "\n" && /<<-?\s*['"]?(\w+)['"]?/.test(current)) {
      const delimiter = current.match(/<<-?\s*['"]?(\w+)['"]?/)[1];
      const end = command.indexOf(`\n${delimiter}`, i);
      segments.push(current);
      current = "";
      i = end === -1 ? command.length : end + delimiter.length + 1;
    } else if (ch === "\n" || ch === ";" || ch === "|" || command.startsWith("&&", i)) {
      segments.push(current);
      current = "";
      i += command.startsWith("&&", i) || command.startsWith("||", i) ? 2 : 1;
    } else {
      current += ch;
      i++;
    }
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

export function tokens(segment) {
  const matches = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((t) => t.replace(/^["']|["']$/g, ""));
}

// Index of the program after an `rtk` prefix and VAR=value assignments.
export function skipPrefix(toks) {
  let i = 0;
  while (i < toks.length && (toks[i] === "rtk" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]))) i++;
  return i;
}

// PowerShell may spell the tools git.exe and gh.exe.
export const program = (tok) => (tok ?? "").replace(/\.exe$/i, "");

export function positionals(rest) {
  return rest.filter((a) => !a.startsWith("-") || a === "-");
}

// A short flag may sit in a cluster (-am, -uf); one that takes a value may also end the cluster with it attached (-mwip).
export function hasShortFlag(rest, letter, takesValue = false) {
  const pattern = new RegExp(`^-[a-zA-Z]*${letter}${takesValue ? "" : "[a-zA-Z]*$"}`);
  return rest.some((a) => pattern.test(a));
}

export function newDirectoryState(cwd) {
  return { current: toNativePath(cwd), previous: null, stack: [] };
}

// Follows cd, pushd/popd and their PowerShell forms (`Set-Location -Path x`, `Push-Location -LiteralPath x`,
// `Pop-Location`), `cd -` and a bare `cd`, so a later git in the same command is checked where it runs.
// Returns true when the segment was a directory change.
export function moveDirectory(dirs, toks) {
  const [cmd, ...args] = toks;
  const enter = (target) => {
    dirs.previous = dirs.current;
    dirs.current = target;
    return true;
  };
  if (POP_COMMANDS.has(cmd)) return enter(dirs.stack.pop() ?? dirs.current);
  if (!CD_COMMANDS.has(cmd)) return false;
  const arg = args.find((t) => !t.startsWith("-") || t === "-");
  if (PUSH_COMMANDS.has(cmd) && arg === undefined) {
    // Bash's pushd swaps the top two; PowerShell's Push-Location pushes the current location and stays.
    if (cmd === "Push-Location") {
      dirs.stack.push(dirs.current);
      return true;
    }
    const top = dirs.stack.pop() ?? dirs.current;
    dirs.stack.push(dirs.current);
    return enter(top);
  }
  if (PUSH_COMMANDS.has(cmd)) dirs.stack.push(dirs.current);
  if (arg === "-") return enter(dirs.previous ?? dirs.current);
  return enter(arg === undefined ? homedir() : path.resolve(dirs.current, toNativePath(arg)));
}
