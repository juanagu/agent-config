// The protected-environment rule: a deploy or infrastructure CLI declared in the config may not act on an
// environment marked protected. It knows no provider; every CLI, flag and environment name comes from the
// config's `protectedEnvironments` entries. Deny by default: only the entry's `readOnly` subcommands, help
// and version run against a protected environment, or against an unnamed one (the CLI would use whichever
// the folder is linked to).
import path from "node:path";
import { CONFIG_HINT } from "./config.mjs";
import { skipPrefix, splitSegments, tokens } from "./shell-parse.mjs";

const HELP_FLAGS = new Set(["--help", "-h", "--version"]);
// Programs that run the next word as a command; their own flags are skipped to reach it.
const WRAPPERS = new Set(["sudo", "env", "time", "nohup", "command", "exec", "xargs", "npx", "bunx", "doas"]);
// Shells whose -c string is a command line of its own, read the same way.
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "pwsh", "powershell", "cmd"]);
const SHELL_STRING_FLAGS = new Set(["-c", "-lc", "-Command", "/c"]);
// A command can also start after a background `&`, inside `( … )`, `$( … )` or backticks, or after PowerShell's `&`.
const OPENERS = /^(\$\(|\(|`|&|\{)+/;
const CLOSERS = /[)`}]+$/;
const NEXT_COMMAND = new Set(["&", "(", "$(", "{"]);

const lower = (value) => String(value).toLowerCase();
const unquote = (value) => value.replace(/^["']|["']$/g, "");

// Keeps only well-formed entries, lowercased once, so a typo in the config guards nothing rather than throwing.
export function loadEnvironmentRules(config) {
  const entries = Array.isArray(config.protectedEnvironments) ? config.protectedEnvironments : [];
  return entries
    .filter((e) => typeof e?.command === "string" && Array.isArray(e.environmentFlags) && e.environmentFlags.length && Array.isArray(e.protected))
    .map((e) => ({
      command: lower(e.command),
      flags: e.environmentFlags.map(String),
      protected: new Set(e.protected.map(lower)),
      readOnly: (Array.isArray(e.readOnly) ? e.readOnly : []).map((r) => lower(r).split(/\s+/)),
    }));
}

// The command's own name, without a directory or Windows' .exe.
const commandName = (tok) => lower(path.basename(String(tok ?? "").replace(/\\/g, "/"))).replace(/\.exe$/, "");

// The value a token gives one of the flags: `--env x` (the next token), `--env=x`, or a short flag's attached `-ex`.
function flagValue(args, i, flag) {
  const arg = args[i];
  if (arg === flag) return { value: args[i + 1] ?? "", width: 2 };
  if (arg.startsWith(`${flag}=`)) return { value: arg.slice(flag.length + 1), width: 1 };
  const short = /^-[^-]$/.test(flag);
  return short && arg.startsWith(flag) ? { value: arg.slice(flag.length), width: 1 } : null;
}

// Every environment the arguments name, and the arguments left once those are removed. A flag left without
// a value names nothing, so the CLI would fall back to the linked environment.
function readArgs(args, flags) {
  const environments = [];
  const rest = [];
  for (let i = 0; i < args.length; ) {
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

// Help counts only before `--`, which hands the rest to another program. A read-only entry (`variables list`)
// must be the command's first words, before any option: an option's value is not a subcommand.
function isReadOnly(rest, readOnly) {
  const own = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest;
  if (own.some((a) => HELP_FLAGS.has(a)) || lower(own[0] ?? "") === "help") return true;
  return readOnly.some((entry) => entry.every((word, i) => lower(own[i] ?? "") === word));
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

// Past a wrapper and its flags (`sudo -u x` reads `x` as a flag value, which only ever skips too little).
function skipWrappers(toks, i) {
  while (WRAPPERS.has(commandName(toks[i]?.replace(OPENERS, "")))) {
    i++;
    while (i < toks.length && (toks[i].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]))) i++;
  }
  return i;
}

function reasonAt(toks, i, rules) {
  const name = commandName(toks[i]?.replace(OPENERS, "").replace(CLOSERS, ""));
  if (SHELLS.has(name) && SHELL_STRING_FLAGS.has(toks[i + 1])) return environmentReasonIn(toks[i + 2] ?? "", rules);
  const rule = rules.find((r) => r.command === name);
  if (!rule) return null;
  const { environments, rest } = readArgs(argsFrom(toks, i), rule.flags);
  const touchesProtected = environments.length === 0 || environments.some((e) => rule.protected.has(e));
  if (!touchesProtected || isReadOnly(rest, rule.readOnly)) return null;
  return refusal(rule, rest, environments);
}

// Where commands start in one segment: its first word, and the word after each `&`, `(`, `$(` or backtick.
function commandStarts(toks) {
  const starts = [skipWrappers(toks, skipPrefix(toks))];
  toks.forEach((t, j) => {
    if (NEXT_COMMAND.has(t)) starts.push(skipWrappers(toks, j + 1));
    else if (OPENERS.test(t) && t !== "&") starts.push(skipWrappers(toks, j));
  });
  return starts;
}

// The reason to refuse one shell segment, or null.
export function environmentReason(toks, rules) {
  if (!rules.length) return null;
  for (const start of commandStarts(toks)) {
    const reason = reasonAt(toks, start, rules);
    if (reason) return reason;
  }
  return null;
}

function environmentReasonIn(commandLine, rules) {
  for (const segment of splitSegments(commandLine)) {
    const reason = environmentReason(tokens(segment), rules);
    if (reason) return reason;
  }
  return null;
}
