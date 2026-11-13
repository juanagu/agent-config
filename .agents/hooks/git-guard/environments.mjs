// The protected-environment rule: a deploy or infrastructure CLI declared in the config may not act on an
// environment marked protected. It knows no provider; every CLI, flag and environment name comes from the
// config's `protectedEnvironments` entries. Deny by default: only the entry's `readOnly` subcommands and a
// plain help or version request run against a protected environment, or against an unnamed one (the CLI
// would use whichever the folder is linked to). Fail closed: any word naming a declared CLI is read as a
// call to it, wherever it sits, because the ways a shell can run a word (runners, wrappers, substitutions)
// have no end; a word that only mentions the CLI (`grep cli notes`) is the rare false refusal.
import path from "node:path";
import { CONFIG_HINT } from "./config.mjs";
import { splitSegments } from "./shell-parse.mjs";

const HELP_FLAGS = new Set(["--help", "-h", "--version"]);
const SHELLS = "bash|sh|zsh|dash|ksh|fish|pwsh|powershell";
const isShellStringFlag = (t) => /^-[a-zA-Z]*c$/.test(t) || ["-command", "/c"].includes(t.toLowerCase());
// Shell punctuation glued to a word: `(cli`, `$(cli`, `` `cli ``, `{cli`, `x="$(cli`, `cli)`.
const LEADING = /^.*(\$\(|`)|^[({&]+/;
const TRAILING = /[)`};"']+$/;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|\)|"|$)/g;
const SHELL_HEREDOC = new RegExp(`\\b(?:${SHELLS})\\b[^\\n]*<<-?\\s*(['"]?)(\\w+)\\1[^\\n]*\\n([\\s\\S]*?)\\n\\s*\\2(?=\\s|$)`, "g");

const lower = (value) => String(value).toLowerCase();
const toList = (value) => (Array.isArray(value) ? value : [value]);
const isQuoted = (raw) => /^["']/.test(raw);
const unquote = (raw) => raw.replace(/^["']|["']$/g, "");

// `command` is a name or a list of them (the binary and the npm package `npx` runs, say).
function isWellFormed(e) {
  const names = toList(e?.command);
  const hasNames = names.length > 0 && names.every((n) => typeof n === "string" && n.trim());
  return hasNames && Array.isArray(e.environmentFlags) && e.environmentFlags.length > 0 && Array.isArray(e.protected);
}

const readOnlyEntries = (list) =>
  (Array.isArray(list) ? list : []).map((r) => lower(r).trim().split(/\s+/).filter(Boolean)).filter((words) => words.length);

// Keeps only well-formed entries, lowercased once, so a typo in the config guards nothing rather than throwing.
export function loadEnvironmentRules(config) {
  const entries = Array.isArray(config.protectedEnvironments) ? config.protectedEnvironments : [];
  return entries.filter(isWellFormed).map((e) => ({
    names: new Set(toList(e.command).map((n) => lower(n).trim())),
    command: lower(toList(e.command)[0]).trim(),
    flags: e.environmentFlags.map(String),
    protected: new Set(e.protected.map(lower)),
    readOnly: readOnlyEntries(e.readOnly),
  }));
}

// The command's own name, without a directory or Windows' .exe.
const commandName = (word) => lower(path.basename(word.replace(/\\/g, "/"))).replace(/\.exe$/, "");

// A declared name matches the word as written (`@scope/cli`), its basename (`/usr/bin/cli`, `cli.exe`), or
// either without a package version (`@scope/cli@latest`, `cli@3`).
function ruleFor(rules, raw) {
  const word = raw.replace(LEADING, "").replace(TRAILING, "");
  const unversioned = word.replace(/(?<=.)@[^/@]*$/, "");
  const candidates = [word, unversioned].flatMap((w) => [lower(w), commandName(w)]);
  return rules.find((r) => candidates.some((c) => r.names.has(c)));
}

// Whether a command line could hold a declared CLI at all: a cheap test before any parsing.
const mentionsDeclared = (command, rules) => rules.some((r) => [...r.names].some((n) => lower(command).includes(commandName(n))));

// The value a token gives one of the flags: `--env x`, `--env=x`, or a short flag's attached `-ex`. A next
// token that is itself an option is no value.
function flagValue(args, i, flag) {
  const arg = args[i];
  if (arg === flag) return args[i + 1] && !args[i + 1].startsWith("-") ? { value: args[i + 1], width: 2 } : { value: "", width: 1 };
  if (arg.startsWith(`${flag}=`)) return { value: arg.slice(flag.length + 1), width: 1 };
  const short = /^-[^-]$/.test(flag);
  return short && arg.startsWith(flag) ? { value: arg.slice(flag.length), width: 1 } : null;
}

// Every environment the arguments name, and the arguments left once those are removed. A flag left without
// a value names nothing, so the CLI would fall back to the linked environment; one after `--` belongs to the
// program the CLI runs.
function readArgs(args, flags) {
  const environments = [];
  const rest = [];
  for (let i = 0; i < args.length; ) {
    if (args[i] === "--") {
      rest.push(...args.slice(i));
      break;
    }
    const found = flags.map((f) => flagValue(args, i, f)).find(Boolean);
    if (!found) rest.push(args[i++]);
    else {
      const value = lower(unquote(found.value));
      if (value) environments.push(value);
      i += found.width;
    }
  }
  return { environments, rest };
}

// Help is a request only in its plain forms (`cli --help`, `cli up --help`, `cli help up`): many CLIs pass
// the arguments after a subcommand to the program it runs, where `-h` may be a host (`run psql -h db`).
function isHelp(rest) {
  if (lower(rest[0] ?? "") === "help") return rest.length <= 2;
  const words = rest.filter((a) => !a.startsWith("-"));
  return HELP_FLAGS.has(rest.at(-1)) && words.length <= 1 && rest.length <= 2;
}

// A read-only entry (`variables list`) must be the command's first words, before any option: an option's
// value is not a subcommand.
function isReadOnly(rest, readOnly) {
  if (isHelp(rest)) return true;
  return readOnly.some((entry) => entry.every((word, i) => lower(rest[i] ?? "") === word));
}

function refusal(rule, rest, environments) {
  const what = `${rule.command} ${rest.filter((a) => !a.startsWith("-")).slice(0, 2).join(" ")}`.trim();
  const named = environments.find((e) => rule.protected.has(e));
  const allowed = rule.readOnly.length ? ` Only ${rule.readOnly.map((w) => w.join(" ")).join(", ")} run there.` : "";
  const handOff = "If it is meant, ask the user to run it themselves.";
  if (named) return `${what} targets ${named}, a protected environment (listed in ${CONFIG_HINT}).${allowed} ${handOff}`;
  return (
    `${what} names no environment, so it would act on whichever one this folder is linked to, which may be protected. ` +
    `Name a non-protected one with ${rule.flags[0]} <environment>.${allowed} ${handOff}`
  );
}

// The arguments of the call at `start`: up to a background `&`, or through a word that closes a substitution.
function argsFrom(raws, start) {
  const args = [];
  for (const raw of raws.slice(start + 1)) {
    if (raw === "&") break;
    args.push(isQuoted(raw) ? unquote(raw) : raw.replace(TRAILING, ""));
    if (!isQuoted(raw) && /[)`]["']*$/.test(raw)) break;
  }
  return args;
}

function callReason(raws, start, rule) {
  const { environments, rest } = readArgs(argsFrom(raws, start), rule.flags);
  const touchesProtected = environments.length === 0 || environments.some((e) => rule.protected.has(e));
  return touchesProtected && !isReadOnly(rest, rule.readOnly) ? refusal(rule, rest, environments) : null;
}

// Text the shell runs from inside a quoted word: a shell's -c string whole, and the `$( … )` and backticks of
// a double-quoted one with its heredoc bodies taken out (a commit message is not a command).
function executedText(raws, j) {
  const raw = raws[j];
  if (j > 0 && isShellStringFlag(raws[j - 1])) return [unquote(raw)];
  if (!raw.startsWith('"')) return [];
  const text = unquote(raw).replace(HEREDOC, "");
  return [...text.matchAll(/\$\(|`/g)].map((m) => text.slice(m.index + m[0].length));
}

// A single `&` runs what is before it in the background: `a&b` is two calls, while `&&`, `2>&1` and `&>` are not.
const splitBackground = (raws) => raws.flatMap((t) => (isQuoted(t) ? [t] : t.split(/(?<![&>])(&)(?![&>])/).filter(Boolean)));

function segmentReason(segment, rules) {
  const raws = splitBackground(segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []);
  for (let j = 0; j < raws.length; j++) {
    const inner = isQuoted(raws[j]) ? executedText(raws, j) : [];
    for (const text of inner) {
      const reason = commandLineReason(text, rules);
      if (reason) return reason;
    }
    const rule = isQuoted(raws[j]) ? null : ruleFor(rules, raws[j]);
    const reason = rule && callReason(raws, j, rule);
    if (reason) return reason;
  }
  return null;
}

function commandLineReason(commandLine, rules) {
  for (const [, , , body] of commandLine.matchAll(SHELL_HEREDOC)) {
    const reason = commandLineReason(body, rules);
    if (reason) return reason;
  }
  for (const segment of splitSegments(commandLine)) {
    const reason = segmentReason(segment, rules);
    if (reason) return reason;
  }
  return null;
}

// The reason to refuse a whole command line, or null.
export function environmentReason(command, rules) {
  if (!rules.length || !mentionsDeclared(command, rules)) return null;
  return commandLineReason(command, rules);
}
