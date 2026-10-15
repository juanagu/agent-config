import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { readJson, writeJson } from "./json.mjs";

// Yes/no questions. An answer given at the prompt, or by an explicit flag through
// decide(), is kept in ~/.config/agent-config/config-install.json so a re-run or --update
// asks only what it has not asked before. --yes and --no-optional apply to one run and are
// not kept; without a terminal the default is used and not kept either. The same file holds
// `copies`, the hash of every file the installer wrote as a copy, and `imports`, the import
// line it wrote into each CLAUDE.md (see link.mjs).
export function createPrompter({ file, yes, noOptional, ask }) {
  const saved = existsSync(file) ? readJson(file) : {};
  const interactive = Boolean(stdin.isTTY && stdout.isTTY);
  const copies = saved.copies ?? {};
  const imports = saved.imports ?? {};

  // An essential piece (the git-guard hook) is still added under --no-optional,
  // unless an earlier run said no to it.
  async function confirm(key, question, fallback = false, { essential = false } = {}) {
    const earlier = typeof saved[key] === "boolean" ? saved[key] : null;
    if (yes) return true;
    if (noOptional) return essential ? (earlier ?? fallback) : false;
    if (!ask && earlier !== null) return earlier;
    if (!interactive) return fallback;
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question(`${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    rl.close();
    return decide(key, answer === "" ? fallback : answer.startsWith("y"));
  }

  function decide(key, value) {
    saved[key] = value;
    return value;
  }

  function save() {
    for (const [key, value] of [["copies", copies], ["imports", imports]]) {
      if (Object.keys(value).length) saved[key] = value;
      else delete saved[key];
    }
    mkdirSync(dirname(file), { recursive: true });
    writeJson(file, saved);
  }

  return { confirm, decide, save, copies, imports };
}
