import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { samePath } from "../scripts/install/paths.mjs";
import { FIXTURE_FILES, FIXTURE_SKILLS, freshDir, makeFixtureClone } from "./support/fixture-clone.mjs";

const posix = (path) => path.split(sep).join("/");
const isLinkTo = (path, target) => lstatSync(path).isSymbolicLink() && realpathSync(path) === realpathSync(target);
// An agent is installed as a file symlink where the platform allows one, else as a copy.
const isAgentFrom = (path, target) => existsSync(path) && (isLinkTo(path, target) || (!lstatSync(path).isSymbolicLink() && readFileSync(path).equals(readFileSync(target))));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const backupsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("backup-")) : []);
const hookCommands = (settings) => (settings.hooks?.PreToolUse ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));
const answersFile = (home) => join(home, ".config", "agent-config", "config-install.json");
// The answers without the bookkeeping every run records: the copy hashes and the import lines written.
const answers = (home) => {
  const { copies, imports, ...rest } = readJson(answersFile(home));
  return rest;
};

// Every run skips npx, so the suite needs no network, and decides each optional piece by
// flag, so it never waits on a prompt.
function install(clone, args, env = process.env) {
  return spawnSync(process.execPath, [join(clone, "scripts", "install.mjs"), ...args], { encoding: "utf8", env });
}

const global = (clone, home, ...extra) => install(clone, ["--global", "--home", home, "--skip-skills", ...extra]);
const project = (clone, dir, ...extra) => install(clone, ["--project", dir, ...extra]);
const claudeHome = (clone, home, ...extra) => global(clone, home, "--tool", "claude", ...extra);

const guardCommand = (clone, tool) => `node "${posix(clone)}/.agents/hooks/git-guard/git-guard.mjs" --tool ${tool}`;
const GUARD_RELATIVE = "node .agents/hooks/git-guard/git-guard.mjs";

// ---- project mode ----

test("project mode with every tool copies the whole drop-in, without the skills' evals or this repo's tests", (t) => {
  const clone = makeFixtureClone(t);
  writeFileSync(join(clone, ".agents", "hooks", "git-guard", "git-guard.test.mjs"), "// tests\n");
  const dir = freshDir(t);
  const result = project(clone, dir);
  assert.equal(result.status, 0, result.stderr);
  for (const path of Object.keys(FIXTURE_FILES)) {
    if (path.includes("/evals/")) assert.ok(!existsSync(join(dir, path)), `${path} should not be copied`);
    else assert.equal(readFileSync(join(dir, path), "utf8"), FIXTURE_FILES[path], path);
  }
  assert.ok(!existsSync(join(dir, ".agents", "hooks", "git-guard", "git-guard.test.mjs")), "tests should not be copied");
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
  assert.match(again.stdout, /0 written, 0 merged/);

  writeFileSync(join(dir, "AGENTS.md"), "# mine\n");
  const conflict = project(clone, dir, "--tool", "claude");
  assert.equal(conflict.status, 1);
  assert.match(conflict.stdout, /conflict {2}AGENTS\.md \(differs; re-run with --force to overwrite\)/);
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "# mine\n");

  const forced = project(clone, dir, "--tool", "claude", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), FIXTURE_FILES["AGENTS.md"]);
});

test("project mode merges the git-guard entry into a project's own settings.json and hooks files, keeping the rest", (t) => {
  const clone = makeFixtureClone(t);
  const dir = freshDir(t);
  mkdirSync(join(dir, ".claude"));
  writeJson(join(dir, ".claude", "settings.json"), { permissions: { allow: ["Bash(npm test)"] }, hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "prettier" }] }] } });
  mkdirSync(join(dir, ".cursor"));
  writeJson(join(dir, ".cursor", "hooks.json"), { version: 1, hooks: { beforeShellExecution: [{ command: "./mine.sh" }] } });
  const result = project(clone, dir, "--tool", "claude", "--tool", "cursor");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /merged {4}\.claude\/settings\.json/);
  assert.match(result.stdout, /merged {4}\.cursor\/hooks\.json/);

  const settings = readJson(join(dir, ".claude", "settings.json"));
  assert.deepEqual(settings.permissions.allow, ["Bash(npm test)"]);
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].command, "prettier");
  assert.deepEqual(hookCommands(settings), [`node "$CLAUDE_PROJECT_DIR/.agents/hooks/git-guard/git-guard.mjs" --tool claude`]);
  const cursor = readJson(join(dir, ".cursor", "hooks.json"));
  assert.deepEqual(cursor.hooks.beforeShellExecution.map((entry) => entry.command), ["./mine.sh", `${GUARD_RELATIVE} --tool cursor`]);

  const again = project(clone, dir, "--tool", "claude", "--tool", "cursor");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 written, 0 merged/);
  assert.deepEqual(readJson(join(dir, ".claude", "settings.json")), settings);
});

test("project mode re-points a git-guard entry a project registered from an older path", (t) => {
  const clone = makeFixtureClone(t);
  const dir = freshDir(t);
  mkdirSync(join(dir, ".cursor"));
  writeJson(join(dir, ".cursor", "hooks.json"), { version: 1, hooks: { beforeShellExecution: [{ command: 'node "C:/old/hooks/git-guard.mjs"', timeout: 5 }] } });
  assert.equal(project(clone, dir, "--tool", "cursor").status, 0);
  assert.deepEqual(readJson(join(dir, ".cursor", "hooks.json")).hooks.beforeShellExecution, [{ command: `${GUARD_RELATIVE} --tool cursor`, timeout: 5 }]);
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

test("a fresh home gets the import, one entry per agent and skill, and settings from the template for Claude Code", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const result = claudeHome(clone, home, "--no-optional");
  assert.equal(result.status, 0, result.stderr);
  const claude = join(home, ".claude");
  assert.equal(readFileSync(join(claude, "CLAUDE.md"), "utf8"), `@${posix(clone)}/CLAUDE.md\n`);
  assert.ok(!lstatSync(join(claude, "agents")).isSymbolicLink(), "the agents folder is a real directory");
  assert.ok(isAgentFrom(join(claude, "agents", "demo.md"), join(clone, ".claude", "agents", "demo.md")));
  for (const skill of FIXTURE_SKILLS) assert.ok(isLinkTo(join(claude, "skills", skill), join(clone, ".agents", "skills", skill)), skill);
  const settings = readJson(join(claude, "settings.json"));
  assert.deepEqual(hookCommands(settings), [guardCommand(clone, "claude")]);
  assert.equal(settings.permissions, undefined, "the template carries no optional piece");
  assert.equal(settings.env.ENABLE_TOOL_SEARCH, "auto");
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
  assert.doesNotMatch(again.stdout, /Updated the import/);
  assert.deepEqual(backupsIn(join(home, ".claude")), []);
});

test("the user's own agents and CLAUDE.md lines stay; only the import line and our agents are ours", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(join(claude, "agents", "mine.md"), "mine");
  writeFileSync(join(claude, "CLAUDE.md"), "@C:/Users/me/Projects/claude-code-config/CLAUDE.md\n\n# my own notes\nkeep me\n");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  assert.deepEqual(backupsIn(claude), []);
  assert.equal(readFileSync(join(claude, "agents", "mine.md"), "utf8"), "mine");
  assert.ok(isAgentFrom(join(claude, "agents", "demo.md"), join(clone, ".claude", "agents", "demo.md")));
  assert.equal(readFileSync(join(claude, "CLAUDE.md"), "utf8"), `@${posix(clone)}/CLAUDE.md\n\n# my own notes\nkeep me\n`);
});

test("an agents folder that an older install linked whole becomes a real folder with one entry per agent", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  const oldClone = join(home, "old-clone-agents");
  mkdirSync(oldClone);
  writeFileSync(join(oldClone, "old.md"), "old");
  mkdirSync(claude);
  symlinkSync(oldClone, join(claude, "agents"), "junction");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  assert.ok(!lstatSync(join(claude, "agents")).isSymbolicLink());
  assert.deepEqual(readdirSync(join(claude, "agents")), ["demo.md"]);
  assert.equal(readFileSync(join(oldClone, "old.md"), "utf8"), "old", "the old clone is untouched");
});

test("an agent the clone no longer has is removed from the user folder; a user's file with the same name was backed up first", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(join(claude, "agents", "demo.md"), "the user's own demo");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  assert.ok(isAgentFrom(join(claude, "agents", "demo.md"), join(clone, ".claude", "agents", "demo.md")));
  const [backup] = backupsIn(claude);
  assert.ok(backup, "a differing file of the user's is kept in the backup");
  assert.equal(readFileSync(join(claude, backup, "demo.md"), "utf8"), "the user's own demo");

  rmSync(join(clone, ".claude", "agents", "demo.md"));
  const result = claudeHome(clone, home, "--no-optional");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(claude, "agents", "demo.md")));
  assert.match(result.stdout, /Removed agents the clone no longer has: demo\.md/);
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

test("a git-guard entry from the old claude-code-config install is re-pointed at this clone, and its matcher kept", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), {
    model: "opus",
    hooks: { PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: 'node "C:/Users/me/.claude/hooks/git-guard.mjs"' }] }, { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] },
  });
  const result = claudeHome(clone, home, "--no-optional");
  assert.equal(result.status, 0, result.stderr);
  const settings = readJson(join(claude, "settings.json"));
  assert.equal(settings.model, "opus");
  assert.deepEqual(hookCommands(settings), [guardCommand(clone, "claude"), "rtk hook claude"]);
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash|PowerShell");
  assert.match(result.stdout, /Updated .*settings\.json/);
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
  assert.deepEqual(answers(home), {});
});

test("--yes merges the rtk hook and the CodeGraph and Context7 rules once, and keeps no answers", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), { permissions: { allow: ["Read"] } });
  assert.equal(claudeHome(clone, home, "--yes").status, 0);
  assert.equal(claudeHome(clone, home, "--yes").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.deepEqual(settings.permissions.allow, ["Read", "mcp__codegraph__*", "mcp__context7__*"]);
  assert.deepEqual(hookCommands(settings).filter((command) => command.includes("rtk")), ["rtk hook claude"]);
  assert.equal(hookCommands(settings).filter((command) => command.includes("git-guard")).length, 1);
  assert.deepEqual(answers(home), {});
});

test("explicit --rtk and --no-codegraph beat the defaults and are remembered, on a fresh home too", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeJson(join(claude, "settings.json"), {});
  assert.equal(claudeHome(clone, home, "--rtk", "--no-codegraph", "--no-context7").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.ok(hookCommands(settings).includes("rtk hook claude"));
  assert.equal(settings.permissions, undefined);
  assert.deepEqual(answers(home), { rtk: true, codegraph: false, context7: false });

  const fresh = freshDir(t);
  assert.equal(claudeHome(clone, fresh, "--no-rtk", "--no-codegraph", "--no-context7").status, 0);
  const created = readJson(join(fresh, ".claude", "settings.json"));
  assert.equal(created.permissions, undefined, "--no-codegraph and --no-context7 are honoured when settings.json is created");
  assert.deepEqual(hookCommands(created), [guardCommand(clone, "claude")]);
  assert.deepEqual(answers(fresh), { rtk: false, codegraph: false, context7: false });
});

// Every run here sets --home, so the server is never added for real: the installer prints the
// command instead, and still adds the allow rule.
test("--context7 adds the allow rule once and prints the command the server needs under another --home", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const first = claudeHome(clone, home, "--no-rtk", "--no-codegraph", "--context7");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /--home is not your home directory: Context7 was not added .* claude mcp add --scope user --transport http context7 https:\/\/mcp\.context7\.com\/mcp/);
  assert.deepEqual(readJson(join(home, ".claude", "settings.json")).permissions.allow, ["mcp__context7__*"]);
  assert.deepEqual(answers(home), { rtk: false, codegraph: false, context7: true });

  assert.equal(claudeHome(clone, home, "--no-rtk", "--no-codegraph", "--context7").status, 0);
  assert.deepEqual(readJson(join(home, ".claude", "settings.json")).permissions.allow, ["mcp__context7__*"]);
});

// The home is a temp dir posing as the real one, and a stub `claude` (a .cmd on Windows, the form
// an npm install leaves) records what it was called with.
function stubClaudeAtRealHome(t) {
  const home = freshDir(t);
  const bin = freshDir(t);
  const record = join(bin, "args.txt");
  if (process.platform === "win32") writeFileSync(join(bin, "claude.cmd"), `@echo %*> "${record}"\r\n`);
  else writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$@" > "${record}"\n`, { mode: 0o755 });
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const env = { ...process.env, HOME: home, USERPROFILE: home, [pathKey]: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey]}` };
  const clone = makeFixtureClone(t);
  const run = (...extra) => install(clone, ["--global", "--home", home, "--tool", "claude", "--skip-skills", "--no-rtk", "--no-codegraph", ...extra], env);
  return { home, record, run };
}

test("--context7 at the real home runs claude mcp add, and names the leftovers of Context7's own setup", (t) => {
  const { home, record, run } = stubClaudeAtRealHome(t);
  mkdirSync(join(home, ".claude", "rules"), { recursive: true });
  writeFileSync(join(home, ".claude", "rules", "context7.md"), "always\n");
  const result = run("--context7");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(record, "utf8").trim(), "mcp add --scope user --transport http context7 https://mcp.context7.com/mcp");
  assert.doesNotMatch(result.stdout, /Context7 was not added/);
  assert.doesNotMatch(result.stderr, /DEP0190/);
  assert.match(result.stdout, /Context7's own setup left .*context7\.md/);
  assert.ok(existsSync(join(home, ".claude", "rules", "context7.md")), "the user's file is named, not deleted");
});

test("without a terminal or a flag, Context7 is not added; a server already there gets its allow rule", (t) => {
  const { home, record, run } = stubClaudeAtRealHome(t);
  assert.equal(run().status, 0);
  assert.ok(!existsSync(record), "claude mcp add must not run unasked");
  assert.equal(readJson(join(home, ".claude", "settings.json")).permissions, undefined);

  writeJson(join(home, ".claude.json"), { mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp" } } });
  assert.equal(run().status, 0);
  assert.deepEqual(readJson(join(home, ".claude", "settings.json")).permissions.allow, ["mcp__context7__*"]);
});

test("a Context7 server already in ~/.claude.json gets only the allow rule, and nothing once both are there", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  writeJson(join(home, ".claude.json"), { mcpServers: { context7: { type: "http", url: "https://mcp.context7.com/mcp" } } });
  const result = claudeHome(clone, home, "--no-rtk", "--no-codegraph", "--context7");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Context7 was not added/);
  assert.deepEqual(readJson(join(home, ".claude", "settings.json")).permissions.allow, ["mcp__context7__*"]);

  const again = claudeHome(clone, home, "--no-rtk", "--no-codegraph", "--no-context7");
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(readJson(join(home, ".claude", "settings.json")).permissions.allow, ["mcp__context7__*"], "a later no removes nothing");
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
  writeFileSync(join(claude, "settings.json"), "\ufeff{}");
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);

  const home2 = freshDir(t);
  const claude2 = join(home2, ".claude");
  mkdirSync(join(claude2, "agents"), { recursive: true });
  writeFileSync(join(claude2, "agents", "mine.md"), "mine");
  writeFileSync(join(claude2, "settings.json"), "{ oops");
  const result = claudeHome(clone, home2, "--no-optional");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /settings\.json is not valid JSON/);
  assert.deepEqual(readdirSync(join(claude2, "agents")), ["mine.md"]);
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

test("Cursor gets one entry per agent and skill and an absolute beforeShellExecution hook, merged once", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const cursor = join(home, ".cursor");
  mkdirSync(cursor);
  writeJson(join(cursor, "hooks.json"), { version: 1, hooks: { beforeShellExecution: [{ command: "./mine.sh" }], stop: [{ command: "./done.sh" }] } });
  const result = global(clone, home, "--tool", "cursor");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(isAgentFrom(join(cursor, "agents", "demo.md"), join(clone, ".cursor", "agents", "demo.md")));
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

test("a hook registration from a previous clone location is re-pointed for Cursor, Copilot and Antigravity", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  mkdirSync(join(home, ".cursor"));
  writeJson(join(home, ".cursor", "hooks.json"), { version: 1, hooks: { beforeShellExecution: [{ command: 'node "C:/old/.agents/hooks/git-guard/git-guard.mjs" --tool cursor', timeout: 30 }] } });
  mkdirSync(join(home, ".copilot", "hooks"), { recursive: true });
  writeJson(join(home, ".copilot", "hooks", "git-guard.json"), { version: 1, hooks: { preToolUse: [{ type: "command", bash: 'node "C:/old/.agents/hooks/git-guard/git-guard.mjs" --tool copilot', powershell: 'node "C:/old/.agents/hooks/git-guard/git-guard.mjs" --tool copilot' }] } });
  mkdirSync(join(home, ".gemini", "config"), { recursive: true });
  writeJson(join(home, ".gemini", "config", "hooks.json"), { "git-guard": { PreToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: 'node "C:/old/.agents/hooks/git-guard/git-guard.mjs" --tool antigravity' }] }] } });
  const result = global(clone, home, "--tool", "cursor", "--tool", "copilot", "--tool", "antigravity");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(join(home, ".cursor", "hooks.json")).hooks.beforeShellExecution, [{ command: guardCommand(clone, "cursor"), timeout: 30 }]);
  const copilot = readJson(join(home, ".copilot", "hooks", "git-guard.json")).hooks.preToolUse[0];
  assert.equal(copilot.bash, guardCommand(clone, "copilot"));
  assert.equal(copilot.powershell, guardCommand(clone, "copilot"));
  assert.equal(readJson(join(home, ".gemini", "config", "hooks.json"))["git-guard"].PreToolUse[0].hooks[0].command, guardCommand(clone, "antigravity"));
});

test("Copilot gets a copy of AGENTS.md that follows the clone until the user edits it, the agents and skills, and its hook file", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const copilot = join(home, ".copilot");
  const instructions = join(copilot, "copilot-instructions.md");
  assert.equal(global(clone, home, "--tool", "copilot").status, 0);
  assert.equal(readFileSync(instructions, "utf8"), FIXTURE_FILES["AGENTS.md"]);
  assert.ok(isAgentFrom(join(copilot, "agents", "demo.agent.md"), join(clone, ".github", "agents", "demo.agent.md")));
  for (const skill of FIXTURE_SKILLS) assert.ok(isLinkTo(join(copilot, "skills", skill), join(clone, ".agents", "skills", skill)), skill);
  const hooks = readJson(join(copilot, "hooks", "git-guard.json"));
  assert.deepEqual(hooks, { version: 1, hooks: { preToolUse: [{ type: "command", bash: guardCommand(clone, "copilot"), powershell: guardCommand(clone, "copilot") }] } });

  writeFileSync(join(clone, "AGENTS.md"), "# Standards v2\n");
  const refreshed = global(clone, home, "--tool", "copilot");
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.equal(readFileSync(instructions, "utf8"), "# Standards v2\n", "an unedited copy follows the clone");
  assert.match(refreshed.stdout, /Updated .*copilot-instructions\.md/);

  writeFileSync(instructions, "# mine\n");
  writeFileSync(join(clone, "AGENTS.md"), "# Standards v3\n");
  const kept = global(clone, home, "--tool", "copilot");
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(readFileSync(instructions, "utf8"), "# mine\n", "an edited copy is the user's");
  assert.match(kept.stdout, /copilot-instructions\.md was edited by you and is left alone/);
});

test("Antigravity gets ~/.gemini/AGENTS.md, one entry per agent under config/agents, antigravity-cli/skills links and the merged hook", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const gemini = join(home, ".gemini");
  assert.equal(global(clone, home, "--tool", "antigravity").status, 0);
  assert.equal(readFileSync(join(gemini, "AGENTS.md"), "utf8"), FIXTURE_FILES["AGENTS.md"]);
  assert.ok(isAgentFrom(join(gemini, "config", "agents", "demo.md"), join(clone, ".agents", "agents", "demo.md")));
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

// ---- the second review pass ----

test("re-pointing touches only the guard's own hook event: a permission rule and a Stop hook that name the script are kept", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  const allow = ["Bash(node ~/.claude/hooks/git-guard.mjs:*)", "Read"];
  const stop = [{ matcher: "", hooks: [{ type: "command", command: "node ~/.claude/hooks/git-guard.mjs --log" }] }];
  writeJson(join(claude, "settings.json"), {
    permissions: { allow },
    hooks: { PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: 'node "C:/Users/me/.claude/hooks/git-guard.mjs"' }] }], Stop: stop },
  });
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.deepEqual(settings.permissions.allow, allow);
  assert.deepEqual(settings.hooks.Stop, stop);
  assert.deepEqual(hookCommands(settings), [guardCommand(clone, "claude")]);
});

test("a Cursor hooks.json whose only mention of the guard is a stop hook still gets the beforeShellExecution entry", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const cursor = join(home, ".cursor");
  mkdirSync(cursor);
  const stop = [{ command: "node C:/old/.agents/hooks/git-guard/git-guard.mjs --report" }];
  writeJson(join(cursor, "hooks.json"), { version: 1, hooks: { stop } });
  assert.equal(global(clone, home, "--tool", "cursor").status, 0);
  const hooks = readJson(join(cursor, "hooks.json"));
  assert.deepEqual(hooks.hooks.stop, stop);
  assert.deepEqual(hooks.hooks.beforeShellExecution, [{ command: guardCommand(clone, "cursor"), timeout: 30 }]);
});

test("a clone at a directory not named after the repo keeps one import line across runs, and a path with a space is replaced", (t) => {
  const source = makeFixtureClone(t);
  const clone = join(freshDir(t, "cfg-"), "my cfg");
  cpSync(source, clone, { recursive: true });
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  writeFileSync(join(claude, "CLAUDE.md"), "@C:/Users/John Smith/Projects/claude-code-config/CLAUDE.md\n# notes\n");
  for (let i = 0; i < 2; i++) assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const content = readFileSync(join(claude, "CLAUDE.md"), "utf8");
  assert.equal(content, `@${posix(clone)}/CLAUDE.md\n# notes\n`);
  assert.equal(readJson(answersFile(home)).imports[posix(join(claude, "CLAUDE.md"))], `@${posix(clone)}/CLAUDE.md`);
});

test("a run that fails on a later tool keeps the hashes of the copies an earlier tool wrote", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  mkdirSync(join(home, ".gemini", "config"), { recursive: true });
  writeFileSync(join(home, ".gemini", "config", "hooks.json"), "{ oops");
  const result = global(clone, home, "--tool", "copilot", "--tool", "antigravity");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /hooks\.json is not valid JSON/);
  const instructions = posix(join(home, ".copilot", "copilot-instructions.md"));
  assert.ok(readJson(answersFile(home)).copies[instructions], "the Copilot copy's hash was saved before Antigravity failed");
});

test("a fresh settings.json honours an earlier no to the git guard, and gets the hook under --yes", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  mkdirSync(join(home, ".config", "agent-config"), { recursive: true });
  writeJson(answersFile(home), { gitGuard: false });
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const declined = readJson(join(home, ".claude", "settings.json"));
  assert.deepEqual(hookCommands(declined), []);
  assert.equal(declined.env.ENABLE_TOOL_SEARCH, "auto", "the template's other settings are still written");

  const fresh = freshDir(t);
  assert.equal(claudeHome(clone, fresh, "--yes", "--no-codegraph").status, 0);
  assert.ok(hookCommands(readJson(join(fresh, ".claude", "settings.json"))).includes(guardCommand(clone, "claude")));
});

test("samePath treats a trailing slash, and on Windows a case difference, as the same directory; --home uses it", (t) => {
  assert.ok(samePath(`${homedir()}${sep}`, homedir()));
  assert.ok(samePath(join(homedir(), "x", ".."), homedir()));
  if (process.platform === "win32") assert.ok(samePath(homedir().toLowerCase(), homedir().toUpperCase()));
  assert.ok(!samePath(join(homedir(), "elsewhere"), homedir()));

  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const result = install(clone, ["--global", "--home", `${home}${sep}`, "--tool", "claude", "--no-optional"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--home is set: skipped the third-party skills/);
});

// ---- the weekly dependency-audit nudge ----

const nudgeCommand = (clone, tool) => `node "${posix(clone)}/.agents/hooks/audit-nudge/audit-nudge.mjs" --tool ${tool}`;
const sessionStartCommands = (settings) => (settings.hooks?.SessionStart ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));

test("Claude Code gets the nudge as a SessionStart hook once, beside the user's own, under --yes", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  const mine = { matcher: "startup", hooks: [{ type: "command", command: "echo hello" }] };
  writeJson(join(claude, "settings.json"), { hooks: { SessionStart: [mine] } });
  for (let i = 0; i < 2; i++) assert.equal(claudeHome(clone, home, "--yes", "--no-codegraph").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.deepEqual(sessionStartCommands(settings), ["echo hello", nudgeCommand(clone, "claude")]);
  assert.deepEqual(settings.hooks.SessionStart[1], { matcher: "startup", hooks: [{ type: "command", command: nudgeCommand(clone, "claude"), timeout: 5 }] });
  assert.ok(hookCommands(settings).includes(guardCommand(clone, "claude")), "the git guard is still added");
});

test("a run without a terminal adds the nudge by default; --no-optional and --no-audit-nudge leave it out, and the no is remembered", (t) => {
  const clone = makeFixtureClone(t);
  const byDefault = freshDir(t);
  assert.equal(claudeHome(clone, byDefault, "--no-rtk", "--no-codegraph").status, 0);
  assert.deepEqual(sessionStartCommands(readJson(join(byDefault, ".claude", "settings.json"))), [nudgeCommand(clone, "claude")]);

  const core = freshDir(t);
  assert.equal(claudeHome(clone, core, "--no-optional").status, 0);
  assert.equal(readJson(join(core, ".claude", "settings.json")).hooks.SessionStart, undefined);

  const declined = freshDir(t);
  assert.equal(claudeHome(clone, declined, "--no-audit-nudge", "--no-rtk", "--no-codegraph").status, 0);
  assert.equal(answers(declined).auditNudge, false);
  assert.equal(claudeHome(clone, declined).status, 0, "a later run without the flag");
  assert.equal(readJson(join(declined, ".claude", "settings.json")).hooks.SessionStart, undefined);
});

test("a nudge entry from an earlier clone is re-pointed at this one, even under --no-optional", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  const old = 'node "C:/old/.agents/hooks/audit-nudge/audit-nudge.mjs" --tool claude';
  writeJson(join(claude, "settings.json"), { hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: old, timeout: 9 }] }] } });
  assert.equal(claudeHome(clone, home, "--no-optional").status, 0);
  const settings = readJson(join(claude, "settings.json"));
  assert.deepEqual(settings.hooks.SessionStart, [{ matcher: "startup", hooks: [{ type: "command", command: nudgeCommand(clone, "claude"), timeout: 9 }] }]);
});

test("Cursor, Copilot and Antigravity get the nudge in their own session-start shape, once, keeping the rest", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  mkdirSync(join(home, ".cursor"));
  writeJson(join(home, ".cursor", "hooks.json"), { version: 1, hooks: { sessionStart: [{ command: "./mine.sh" }] } });
  const tools = ["--tool", "cursor", "--tool", "copilot", "--tool", "antigravity"];
  for (let i = 0; i < 2; i++) assert.equal(global(clone, home, ...tools).status, 0);

  const cursor = readJson(join(home, ".cursor", "hooks.json"));
  assert.deepEqual(cursor.hooks.sessionStart, [{ command: "./mine.sh" }, { command: nudgeCommand(clone, "cursor"), timeout: 5 }]);
  assert.equal(cursor.hooks.beforeShellExecution[0].command, guardCommand(clone, "cursor"));

  const copilot = readJson(join(home, ".copilot", "hooks", "audit-nudge.json"));
  const command = nudgeCommand(clone, "copilot");
  assert.deepEqual(copilot, { version: 1, hooks: { sessionStart: [{ type: "command", bash: command, powershell: command, timeoutSec: 5 }] } });
  assert.equal(readJson(join(home, ".copilot", "hooks", "git-guard.json")).hooks.sessionStart, undefined, "the guard's file stays the guard's");

  const antigravity = readJson(join(home, ".gemini", "config", "hooks.json"));
  assert.deepEqual(antigravity["audit-nudge"], { SessionStart: [{ type: "command", command: nudgeCommand(clone, "antigravity"), timeout: 5 }] });
  assert.equal(antigravity["git-guard"].PreToolUse[0].hooks[0].command, guardCommand(clone, "antigravity"));
});

test("--no-audit-nudge takes out only the nudge's own hook from a group the user shares, and keeps the group", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  const claude = join(home, ".claude");
  mkdirSync(claude);
  const mine = { type: "command", command: "echo mine" };
  const nudgeHook = { type: "command", command: 'node "C:/old/.agents/hooks/audit-nudge/audit-nudge.mjs" --tool claude' };
  writeJson(join(claude, "settings.json"), { hooks: { SessionStart: [{ matcher: "startup", hooks: [nudgeHook, mine] }, { matcher: "startup", hooks: [nudgeHook] }] } });
  mkdirSync(join(home, ".gemini", "config"), { recursive: true });
  writeJson(join(home, ".gemini", "config", "hooks.json"), { "audit-nudge": { SessionStart: [{ hooks: [{ ...nudgeHook }, { type: "command", command: "./mine.sh" }] }] } });
  const result = global(clone, home, "--tool", "claude", "--tool", "antigravity", "--no-audit-nudge", "--no-rtk", "--no-codegraph");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(join(claude, "settings.json")).hooks.SessionStart, [{ matcher: "startup", hooks: [mine] }]);
  assert.deepEqual(readJson(join(home, ".gemini", "config", "hooks.json"))["audit-nudge"], { SessionStart: [{ hooks: [{ type: "command", command: "./mine.sh" }] }] });
});

test("--no-audit-nudge keeps Copilot's nudge file when the user added hooks of their own to it", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  assert.equal(global(clone, home, "--tool", "copilot").status, 0);
  const file = join(home, ".copilot", "hooks", "audit-nudge.json");
  const withMine = readJson(file);
  const mine = { type: "command", bash: "./mine.sh", powershell: "./mine.ps1" };
  withMine.hooks.sessionStart.push(mine);
  withMine.hooks.sessionEnd = [mine];
  writeJson(file, withMine);
  assert.equal(global(clone, home, "--tool", "copilot", "--no-audit-nudge").status, 0);
  assert.deepEqual(readJson(file), { version: 1, hooks: { sessionStart: [mine], sessionEnd: [mine] } });
});

test("--no-audit-nudge takes an installed nudge out of every tool's file, keeps the rest, and records the no", (t) => {
  const clone = makeFixtureClone(t);
  const home = freshDir(t);
  assert.equal(global(clone, home, "--no-rtk", "--no-codegraph").status, 0);
  const claudeSettings = join(home, ".claude", "settings.json");
  assert.deepEqual(sessionStartCommands(readJson(claudeSettings)), [nudgeCommand(clone, "claude")]);
  const copilotNudge = join(home, ".copilot", "hooks", "audit-nudge.json");
  assert.ok(existsSync(copilotNudge));

  const result = global(clone, home, "--no-audit-nudge", "--no-rtk", "--no-codegraph");
  assert.equal(result.status, 0, result.stderr);
  const settings = readJson(claudeSettings);
  assert.equal(settings.hooks.SessionStart, undefined);
  assert.deepEqual(hookCommands(settings), [guardCommand(clone, "claude")]);
  const cursor = readJson(join(home, ".cursor", "hooks.json"));
  assert.equal(cursor.hooks.sessionStart, undefined);
  assert.equal(cursor.hooks.beforeShellExecution[0].command, guardCommand(clone, "cursor"));
  assert.ok(!existsSync(copilotNudge), "Copilot's nudge-only file is deleted");
  const antigravity = readJson(join(home, ".gemini", "config", "hooks.json"));
  assert.equal(antigravity["audit-nudge"], undefined);
  assert.ok(antigravity["git-guard"]);
  assert.equal(answers(home).auditNudge, false);

  assert.equal(global(clone, home, "--no-rtk", "--no-codegraph").status, 0);
  assert.equal(readJson(claudeSettings).hooks.SessionStart, undefined, "the remembered no keeps it out");
});
