// The protected-environment rule: a deploy or infrastructure CLI declared in the config may not act on an
// environment marked protected. It knows no provider; every CLI, flag and environment name comes from the
// config's `protectedEnvironments` entries. Deny by default: only the entry's `readOnly` subcommands, help
// and version run against a protected environment, or against an unnamed one (the CLI would use whichever
// the folder is linked to).
import path from "node:path";
import { CONFIG_HINT } from "./config.mjs";
import { skipPrefix } from "./shell-parse.mjs";

const HELP_FLAGS = new Set(["--help", "-h", "--version"]);

const lower = (value) => String(value).toLowerCase();

// Keeps only well-formed entries, lowercased once, so a typo in the config guards nothing rather than throwing.
export function loadEnvironmentRules(config) {
  const entries = Array.isArray(config.protectedEnvironments) ? config.protectedEnvironments : [];
  return entries
    .filter((e) => typeof e?.command === "string" && Array.isArray(e.environmentFlags) && Array.isArray(e.protected))
    .map((e) => ({
      command: lower(e.command),
      flags: e.environmentFlags.map(String),
      protected: new Set(e.protected.map(lower)),
      readOnly: (Array.isArray(e.readOnly) ? e.readOnly : []).map((r) => lower(r).split(/\s+/)),
    }));
}

// The command's own name, without a directory or Windows' .exe.
const commandName = (tok) => lower(path.basename(String(tok ?? "").replace(/\\/g, "/"))).replace(/\.exe$/, "");

// Every environment the arguments name (`--env x`, `--env=x`), and the arguments left once those are removed.
function readArgs(args, flags) {
  const environments = [];
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const flag = flags.find((f) => args[i] === f || args[i].startsWith(`${f}=`));
    if (!flag) rest.push(args[i]);
    else if (args[i] === flag) environments.push(lower(args[++i] ?? ""));
    else environments.push(lower(args[i].slice(flag.length + 1)));
  }
  return { environments, rest };
}

// A read-only entry may be several words (`variables list`): the subcommand words must start with it.
function isReadOnly(rest, readOnly) {
  if (rest.some((a) => HELP_FLAGS.has(a)) || lower(rest[0] ?? "") === "help") return true;
  const words = rest.filter((a) => !a.startsWith("-")).map(lower);
  return readOnly.some((entry) => entry.every((word, i) => words[i] === word));
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

// The reason to refuse one shell segment, or null.
export function environmentReason(toks, rules) {
  if (!rules.length) return null;
  const i = skipPrefix(toks);
  const rule = rules.find((r) => r.command === commandName(toks[i]));
  if (!rule) return null;
  const { environments, rest } = readArgs(toks.slice(i + 1), rule.flags);
  const touchesProtected = environments.length === 0 || environments.some((e) => rule.protected.has(e));
  if (!touchesProtected || isReadOnly(rest, rule.readOnly)) return null;
  return refusal(rule, rest, environments);
}
