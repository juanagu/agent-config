import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { FIXTURE_FILES, FIXTURE_SKILLS, freshDir, makeFixtureClone } from "./support/fixture-clone.mjs";

const posix = (path) => path.split(sep).join("/");
const isLinkTo = (path, target) => lstatSync(path).isSymbolicLink() && realpathSync(path) === realpathSync(target);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const backupsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("backup-")) : []);
const hookCommands = (settings) => (settings.hooks?.PreToolUse ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));
const answersFile = (home) => join(home, ".config", "agent-config", "config-install.json");

// Every run skips npx, so the suite needs no network, and decides each optional piece by
// flag, so it never waits on a prompt.
function install(clone, args, env = process.env) {
  return spawnSync(process.execPath, [join(clone, "scripts", "install.mjs"), ...args], { encoding: "utf8", env });
}

const global = (clone, home, ...extra) => install(clone, ["--global", "--home", home, "--skip-skills", ...extra]);
const project = (clone, dir, ...extra) => install(clone, ["--project", dir, ...extra]);
const claudeHome = (clone, home, ...extra) => global(clone, home, "--tool", "claude", ...extra);

const guardCommand = (clone, tool) => `node "${posix(clone)}/.agents/hooks/git-guard/git-guard.mjs" --tool ${tool}`;

// ---- project mode ----

test("project mode with every tool copies the whole drop-in, without the skills' evals", (t) => {
  const clone = makeFixtureClone(t);
  const dir = freshDir(t);
  const result = project(clone, dir);
  assert.equal(result.status, 0, result.stderr);
  for (const path of Object.keys(FIXTURE_FILES)) {
    if (path.includes("/evals/")) assert.ok(!existsSync(join(dir, path)), `${path} should not be copied`);
    else assert.equal(readFileSync(join(dir, path), "utf8"), FIXTURE_FILES[path], path);
  }
  assert.match(result.stdout, /wrote {5}AGENTS\.md/);
  assert.match(result.stdout, /0 conflicting/);
});

test("project mode with --tool cursor copies AGENTS.md, the shared .agents pieces and .cursor only", (t) => {
  const clone = makeFixtureClone(t);
  const dir = freshDir(t);
  assert.equal(project(clone, dir, "--tool", "cursor").status, 0);
  for (const path of ["AGENTS.md", ".agents/skills/demo-skill/SKILL.md", ".agents/hooks/git-guard/git-guard.mjs", ".cursor/hooks.json", ".cursor/agents/demo.md"]) {
    assert.ok(existsSync(join(dir, path)), path);
  }
  for (const path of ["CLAUDE.md", ".claude", ".github", ".agents/hooks.json", ".agents/agents"]) {
    assert.ok(!existsSync(join(dir, path)), `${path} should not be copied`);
  }
});

test("project mode leaves identical files alone, refuses a differing one without --force, and overwrites with it", (t) => {
  const clone = makeFixtureClone(t);
  const dir = freshDir(t);
  assert.equal(project(clone, dir, "--tool", "claude").status, 0);
  const again = project(clone, dir, "--tool", "claude");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 written/);

  writeFileSync(join(dir, "AGENTS.md"), "# mine\n");
  const conflict = project(clone, dir, "--tool", "claude");
  assert.equal(conflict.status, 1);
  assert.match(conflict.stdout, /conflict {2}AGENTS\.md \(differs; re-run with --force to overwrite\)/);
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "# mine\n");

  const forced = project(clone, dir, "--tool", "claude", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), FIXTURE_FILES["AGENTS.md"]);
});

test("project mode refuses to run from a clone whose generated files are missing", (t) => {
  const clone = makeFixtureClone(t, { skip: [".cursor/agents"] });
  const dir = freshDir(t);
  const result = project(clone, dir, "--tool", "cursor");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing in .*: \.cursor\/agents\. Run npm run build first\./);
  assert.deepEqual(readdirSync(dir), []);
});

// ---- global mode: Claude Code ----

test("a fresh home gets the import, the links and settings from the template for Claude Code", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const result = claudeHome(clone, home, "--no-optional");
  assert.equal(result.status, 0, result.stderr);
  const claude = join(home, ".claude");
  assert.equal(readFileSync(join(claude, "CLAUDE.md"), "utf8").trim(), `@${posix(clone)}/CLAUDE.md`);
  assert.ok(isLinkTo(join(claude, "agents"), join(clone, ".claude", "agents")));
  for (const skill of FIXTURE_SKILLS) assert.ok(isLinkTo(join(claude, "skills", skill), join(clone, ".agents", "skills", skill)), skill);
  const commands = hookCommands(readJson(join(claude, "settings.json")));
  assert.deepEqual(commands, [guardCommand(clone, "claude")]);
  assert.deepEqual(backupsIn(claude), []);
  for (const other of [".cursor", ".copilot", ".gemini"]) assert.ok(!existsSync(join(home, other)), other);
});

test("a second run changes nothing and makes no backup", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
  const again = claudeHome(clone, home, "--no-optional");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(home, ".claude", "settings.json"), "utf8"), before);
  assert.deepEqual(backupsIn(join(home, ".claude")), []);
});

test("a real agents directory and a different CLAUDE.md are moved to a backup", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(join(claude, "agents", "mine.md"), "mine");
  writeFileSync(join(claude, "CLAUDE.md"), "# mine\n");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const [backup, ...others] = backupsIn(claude);
  assert.ok(backup);
  assert.deepEqual(others, []);
  assert.equal(readFileSync(join(claude, backup, "agents", "mine.md"), "utf8"), "mine");
  assert.equal(readFileSync(join(claude, backup, "CLAUDE.md"), "utf8"), "# mine\n");
  assert.ok(isLinkTo(join(claude, "agents"), join(clone, ".claude", "agents")));
});

test("a skill link whose target is gone is removed", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const skills = join(home, ".claude", "skills");
  const gone = join(home, "gone-skill");
  mkdirSync(skills, { recursive: true });
  mkdirSync(gone);
  symlinkSync(gone, join(skills, "gone-skill"), "junction");
  rmSync(gone, { recursive: true });
  const result = claudeHome(clone, home, "--no-optional");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(skills, "gone-skill")));
  assert.match(result.stdout, /Removed broken skill links: gone-skill/);
});

test("an existing settings.json that already has the hook is left byte for byte", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), { model: "opus", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guardCommand(clone, "claude") }] }] } });
  const before = readFileSync(join(claude, "settings.json"), "utf8");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  assert.equal(readFileSync(join(claude, "settings.json"), "utf8"), before);
});

test("--no-optional adds only the git-guard hook to an existing settings.json, and keeps no answers", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), { model: "opus" });
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.equal(settings.model, "opus");
  assert.deepEqual(hookCommands(settings), [guardCommand(clone, "claude")]);
  assert.equal(settings.permissions, undefined);
  assert.deepEqual(readJson(answersFile(home)), {});
});

test("--yes merges the rtk hook and the CodeGraph rule once, and keeps no answers", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), { permissions: { allow: ["Read"] } });
  assert.equal(claudeHome(clone, home, "--yes").status, 0);
  assert.equal(claudeHome(clone, home, "--yes").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.deepEqual(settings.permissions.allow, ["Read", "mcp__codegraph__*"]);
  assert.deepEqual(hookCommands(settings).filter((command) => command.includes("rtk")), ["rtk hook claude"]);
  assert.equal(hookCommands(settings).filter((command) => command.includes("git-guard")).length, 1);
  assert.deepEqual(readJson(answersFile(home)), {});
});

test("explicit --rtk and --no-codegraph beat the defaults and are remembered", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), {});
  assert.equal(claudeHome(clone, home, "--rtk", "--no-codegraph").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.ok(hookCommands(settings).includes("rtk hook claude"));
  assert.equal(settings.permissions, undefined);
  assert.deepEqual(readJson(answersFile(home)), { rtk: true, codegraph: false });
});

test("an earlier no to the git-guard hook is honoured under --no-optional", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), {});
  mkdirSync(join(home, ".config", "agent-config"), { recursive: true });
  writeJson(answersFile(home), { gitGuard: false });
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  assert.deepEqual(readJson(join(claude, "settings.json")), {});
});

test("a settings.json with a BOM is read; one that is not JSON stops the run before anything is moved or linked", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(join(claude, "agents", "mine.md"), "mine");
  writeFileSync(join(claude, "settings.json"), "﻿{}");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);

  const home2 = freshDir(t);
  const claude2 = join(home2, ".claude");
  mkdirSync(join(claude2, "agents"), { recursive: true });
  writeFileSync(join(claude2, "agents", "mine.md"), "mine");
  writeFileSync(join(claude2, "settings.json"), "{ oops");
  const result = claudeHome(clone, home2, "--no-optional");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /settings\.json is not valid JSON/);
  assert.ok(!lstatSync(join(claude2, "agents")).isSymbolicLink());
  assert.ok(!existsSync(join(claude2, "CLAUDE.md")));
  assert.deepEqual(backupsIn(claude2), []);
});

test("--yes adds no rtk hook when rtk is not on PATH; an explicit --rtk adds it and says so", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), {});
  const noPath = { ...process.env, PATH: "", Path: "" };
  const quiet = install(clone, ["--global", "--home", home, "--tool", "claude", "--skip-skills", "--yes"], noPath);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.ok(!hookCommands(readJson(join(claude, "settings.json"))).includes("rtk hook claude"));
  assert.ok(hookCommands(readJson(join(claude, "settings.json"))).some((command) => command.includes("git-guard")));

  const explicit = install(clone, ["--global", "--home", home, "--tool", "claude", "--skip-skills", "--rtk", "--no-codegraph"], noPath);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.ok(hookCommands(readJson(join(claude, "settings.json"))).includes("rtk hook claude"));
  assert.match(explicit.stdout, /rtk is not on PATH/);
});

// ---- global mode: the other tools ----

test("Cursor gets the agents and skills links and an absolute beforeShellExecution hook, merged once", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const cursor = join(home, ".cursor");
  mkdirSync(cursor);
  writeJson(join(cursor, "hooks.json"), { version: 1, hooks: { beforeShellExecution: [{ command: "./mine.sh" }], stop: [{ command: "./done.sh" }] } });
  const result = global(clone, home, "--tool", "cursor");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(isLinkTo(join(cursor, "agents"), join(clone, ".cursor", "agents")));
  for (const skill of FIXTURE_SKILLS) assert.ok(isLinkTo(join(cursor, "skills", skill), join(clone, ".agents", "skills", skill)), skill);
  const hooks = readJson(join(cursor, "hooks.json"));
  assert.equal(hooks.version, 1);
  assert.deepEqual(hooks.hooks.stop, [{ command: "./done.sh" }]);
  assert.deepEqual(hooks.hooks.beforeShellExecution, [{ command: "./mine.sh" }, { command: guardCommand(clone, "cursor"), timeout: 30 }]);
  assert.match(result.stdout, /User Rules/);

  const before = readFileSync(join(cursor, "hooks.json"), "utf8");
  assert.equal(global(clone, home, "--tool", "cursor").status, 0);
  assert.equal(readFileSync(join(cursor, "hooks.json"), "utf8"), before);
  assert.ok(!existsSync(join(home, ".claude")));
});

test("Copilot gets a one-time copy of AGENTS.md, the links, and its own absolute hook file", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const copilot = join(home, ".copilot");
  assert.equal(global(clone, home, "--tool", "copilot").status, 0);
  assert.equal(readFileSync(join(copilot, "copilot-instructions.md"), "utf8"), FIXTURE_FILES["AGENTS.md"]);
  assert.ok(isLinkTo(join(copilot, "agents"), join(clone, ".github", "agents")));
  for (const skill of FIXTURE_SKILLS) assert.ok(isLinkTo(join(copilot, "skills", skill), join(clone, ".agents", "skills", skill)), skill);
  const hooks = readJson(join(copilot, "hooks", "git-guard.json"));
  assert.deepEqual(hooks, { version: 1, hooks: { preToolUse: [{ type: "command", bash: guardCommand(clone, "copilot"), powershell: guardCommand(clone, "copilot") }] } });

  writeFileSync(join(copilot, "copilot-instructions.md"), "# mine\n");
  assert.equal(global(clone, home, "--tool", "copilot").status, 0);
  assert.equal(readFileSync(join(copilot, "copilot-instructions.md"), "utf8"), "# mine\n");
});

test("Antigravity gets ~/.gemini/AGENTS.md, the config/agents link, antigravity-cli/skills links and the merged hook", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const gemini = join(home, ".gemini");
  assert.equal(global(clone, home, "--tool", "antigravity").status, 0);
  assert.equal(readFileSync(join(gemini, "AGENTS.md"), "utf8"), FIXTURE_FILES["AGENTS.md"]);
  assert.ok(isLinkTo(join(gemini, "config", "agents"), join(clone, ".agents", "agents")));
  for (const skill of FIXTURE_SKILLS) assert.ok(isLinkTo(join(gemini, "antigravity-cli", "skills", skill), join(clone, ".agents", "skills", skill)), skill);
  const hooks = readJson(join(gemini, "config", "hooks.json"));
  assert.deepEqual(hooks["git-guard"].PreToolUse[0].hooks[0].command, guardCommand(clone, "antigravity"));
});

test("with no --tool every tool is installed, and a Claude-style $VAR path is made absolute too", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const result = global(clone, home, "--no-optional");
  assert.equal(result.status, 0, result.stderr);
  for (const dir of [".claude", ".cursor", ".copilot", ".gemini"]) assert.ok(existsSync(join(home, dir)), dir);
  assert.deepEqual(hookCommands(readJson(join(home, ".claude", "settings.json"))), [guardCommand(clone, "claude")]);
});

// ---- arguments ----

test("--global with --project, an unknown tool and an unknown option each fail with a message and touch nothing", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  for (const [args, message] of [
    [["--global", "--project", home], /--global and --project cannot be combined/],
    [["--global", "--home", home, "--tool", "codex"], /Unknown tool codex/],
    [["--global", "--home", home, "--bogus"], /Unknown option --bogus/],
  ]) {
    const result = install(clone, args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, message);
  }
  assert.deepEqual(readdirSync(home), []);
});

test("--help prints both modes", (t) => {
  const clone = makeFixtureClone(t);
  const result = install(clone, ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--project \[dir\]/);
  assert.match(result.stdout, /--global/);
  assert.match(result.stdout, /--tool <name>/);
});
