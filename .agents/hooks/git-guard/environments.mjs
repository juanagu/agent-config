// The protected-environment rule: a deploy or infrastructure CLI declared in the config may not act on an
// environment marked protected. It knows no provider; every CLI, flag and environment name comes from the
// config's `protectedEnvironments` entries. Deny by default: only the entry's `readOnly` subcommands and a
// plain help or version request run against a protected environment, or against an unnamed one (the CLI
// would use whichever the folder is linked to). Where the shell form is ambiguous, it reads as a command.
import path from "node:path";
import { CONFIG_HINT } from "./config.mjs";
import { skipPrefix, splitSegments, tokens } from "./shell-parse.mjs";

const HELP_FLAGS = new Set(["--help", "-h", "--version"]);
// Programs that run a later word as a command. Which of their flags take a value isn't known, so every
// word after one is a possible start.
const WRAPPERS = new Set(["sudo", "env", "time", "nohup", "command", "exec", "xargs", "npx", "bunx", "doas"]);
// Shells whose -c (or -Command) string is a command line of its own, read the same way.
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "pwsh", "powershell", "cmd"]);
const isShellStringFlag = (t) => /^-[a-zA-Z]*c$/.test(t) || lower(t) === "-command" || lower(t) === "/c";
// A command can also start after a background `&`, inside `( … )`, `$( … )` or backticks, or after PowerShell's `&`.
const OPENERS = /^(\$\(|\(|`|&|\{)+/;
const CLOSERS = /[)`}]+$/;
// The word a substitution opens, wherever it sits in the token (`x="$(cli`).
const SUBSTITUTION = /^.*(\$\(|`)/;
const NEXT_COMMAND = new Set(["&", "(", "$(", "{"]);

const lower = (value) => String(value).toLowerCase();
const unquote = (value) => value.replace(/^["']|["']$/g, "");
const toList = (value) => (Array.isArray(value) ? value : [value]);

// Keeps only well-formed entries, lowercased once, so a typo in the config guards nothing rather than throwing.
export function loadEnvironmentRules(config) {
  const entries = Array.isArray(config.protectedEnvironments) ? config.protectedEnvironments : [];
  return entries
    .filter((e) => isWellFormed(e))
    .map((e) => ({
      names: new Set(toList(e.command).map(lower)),
      command: lower(toList(e.command)[0]),
      flags: e.environmentFlags.map(String),
      protected: new Set(e.protected.map(lower)),
      readOnly: (Array.isArray(e.readOnly) ? e.readOnly : []).map((r) => lower(r).split(/\s+/)),
    }));
}

// `command` is a name or a list of them (the binary and the npm package that `npx` runs, say).
function isWellFormed(e) {
  const names = toList(e?.command);
  const hasNames = names.length > 0 && names.every((n) => typeof n === "string" && n);
  return hasNames && Array.isArray(e.environmentFlags) && e.environmentFlags.length > 0 && Array.isArray(e.protected);
}

// The command's own name, without a directory or Windows' .exe.
const commandName = (tok) => lower(path.basename(String(tok ?? "").replace(/\\/g, "/"))).replace(/\.exe$/, "");

// A declared name matches the word as written (`@scope/cli`) or its basename (`/usr/bin/cli`, `cli.exe`).
const ruleFor = (rules, word) => rules.find((r) => r.names.has(lower(word)) || r.names.has(commandName(word)));

// The value a token gives one of the flags: `--env x` (the next token), `--env=x`, or a short flag's attached `-ex`.
function flagValue(args, i, flag) {
  const arg = args[i];
  if (arg === flag) return { value: args[i + 1] ?? "", width: 2 };
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

// The arguments of a command starting at `start`, up to the next backgrounded command.
function argsFrom(toks, start) {
  const end = toks.findIndex((t, j) => j > start && NEXT_COMMAND.has(t));
  return toks.slice(start + 1, end === -1 ? toks.length : end).map((t) => t.replace(CLOSERS, ""));
}

// The start at `i`, and every later word when it is a wrapper (`sudo -u me cli`: `me` and `cli` both).
function startsFrom(toks, i) {
  const isWrapper = WRAPPERS.has(commandName(toks[i]?.replace(SUBSTITUTION, "").replace(OPENERS, "")));
  return isWrapper ? toks.map((_, j) => j).filter((j) => j >= i) : [i];
}

// A shell's command string: the word after its -c or -Command, past the shell's other options.
function shellString(toks, i) {
  for (let j = i + 1; j < toks.length && toks[j].startsWith("-"); j++) if (isShellStringFlag(toks[j])) return toks[j + 1] ?? "";
  return toks[i + 1] === "/c" || toks[i + 1] === "/C" ? toks[i + 2] ?? "" : null;
}

function reasonAt(toks, i, rules) {
  const word = toks[i]?.replace(SUBSTITUTION, "").replace(OPENERS, "").replace(CLOSERS, "") ?? "";
  const inner = SHELLS.has(commandName(word)) ? shellString(toks, i) : null;
  if (inner !== null) return environmentReasonIn(inner, rules);
  const rule = ruleFor(rules, word);
  if (!rule) return null;
  const { environments, rest } = readArgs(argsFrom(toks, i), rule.flags);
  const touchesProtected = environments.length === 0 || environments.some((e) => rule.protected.has(e));
  if (!touchesProtected || isReadOnly(rest, rule.readOnly)) return null;
  return refusal(rule, rest, environments);
}

// Where commands start in one segment: its first word, and the word after each `&`, `(`, `$(` or backtick.
function commandStarts(toks) {
  const starts = startsFrom(toks, skipPrefix(toks));
  toks.forEach((t, j) => {
    if (NEXT_COMMAND.has(t)) starts.push(...startsFrom(toks, j + 1));
    else if ((OPENERS.test(t) && t !== "&") || SUBSTITUTION.test(t)) starts.push(...startsFrom(toks, j));
  });
  return starts;
}

// A single `&` runs what is before it in the background: `a&b` is two commands, while `&&`, `2>&1` and `&>` are not.
const splitBackground = (toks) => toks.flatMap((t) => t.split(/(?<![&>])(&)(?![&>])/).filter(Boolean));

// Command substitutions inside a quoted word (`"$(cli up)"`), which the shell still runs.
function quotedSubstitutions(toks) {
  return toks.filter((t) => /\s/.test(t)).flatMap((t) => [...t.matchAll(/\$\(|`/g)].map((m) => t.slice(m.index + m[0].length)));
}

// The reason to refuse one shell segment, or null.
export function environmentReason(segmentTokens, rules) {
  if (!rules.length) return null;
  const toks = splitBackground(segmentTokens);
  for (const start of commandStarts(toks)) {
    const reason = reasonAt(toks, start, rules);
    if (reason) return reason;
  }
  for (const inner of quotedSubstitutions(toks)) {
    const reason = environmentReasonIn(inner, rules);
    if (reason) return reason;
  }
  return null;
}

// Whether a command line could hold a declared CLI at all: a cheap test before any parsing.
export const mentionsDeclared = (command, rules) => rules.some((r) => [...r.names].some((n) => lower(command).includes(commandName(n))));

function environmentReasonIn(commandLine, rules) {
  for (const segment of splitSegments(commandLine)) {
    const reason = environmentReason(tokens(segment), rules);
    if (reason) return reason;
  }
  return null;
}
