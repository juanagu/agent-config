// The build derives every tool's files from the neutral sources (docs/architecture.md): the
// frontmatter mapping per tool, the skill copies without evals, the hook registrations, and
// that what is committed is what the sources produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, plan, stale } from "../scripts/build.mjs";
import { splitFrontmatter } from "../scripts/build/frontmatter.mjs";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-config-build-"));
  mkdirSync(join(root, "agents"));
  mkdirSync(join(root, ".agents", "skills", "demo", "evals"), { recursive: true });
  writeFileSync(
    join(root, "agents", "judge.md"),
    `---\nname: judge\ndescription: "Decides: things. Not for doing."\ntier: judgment\naccess: read\neffort: high\ncolor: purple\n---\n\nYou decide.\n`,
  );
  writeFileSync(join(root, "agents", "builder.md"), `---\nname: builder\ndescription: Builds things.\ntier: implementation\naccess: write\n---\n\nYou build.\n`);
  writeFileSync(join(root, ".agents", "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: A demo.\n---\n\nBody.\n");
  writeFileSync(join(root, ".agents", "skills", "demo", "evals", "evals.json"), "{}");
  return root;
}

const read = (root, path) => readFileSync(join(root, path), "utf8");
const fm = (root, path) => splitFrontmatter(read(root, path), path);

test("each tool gets its own dialect of every agent", () => {
  const root = fixture();
  try {
    build(root);
    const claude = fm(root, ".claude/agents/judge.md");
    assert.equal(claude.fields.model, "opus");
    assert.equal(claude.fields.tools, "Read, Glob, Grep, Bash, Skill");
    assert.equal(claude.fields.effort, "high");
    assert.equal(claude.fields.description, "Decides: things. Not for doing.");
    assert.equal(fm(root, ".claude/agents/builder.md").fields.model, "sonnet");
    assert.equal(fm(root, ".claude/agents/builder.md").fields.tools, "Read, Glob, Grep, Edit, Write, Bash, Skill");

    const cursor = fm(root, ".cursor/agents/judge.md");
    assert.equal(cursor.fields.model, "inherit");
    assert.equal(cursor.fields.readonly, "true");
    assert.equal(fm(root, ".cursor/agents/builder.md").fields.readonly, undefined);
    assert.equal(fm(root, ".cursor/agents/builder.md").fields.effort, undefined);

    assert.equal(fm(root, ".github/agents/judge.agent.md").fields.tools, "[search, runCommands]");
    assert.equal(fm(root, ".github/agents/builder.agent.md").fields.tools, "[search, edit, runCommands]");

    assert.equal(fm(root, ".agents/agents/judge.md").fields.model, "pro");
    assert.equal(fm(root, ".agents/agents/builder.md").fields.model, "inherit");

    for (const path of [".claude/agents/judge.md", ".cursor/agents/judge.md", ".github/agents/judge.agent.md", ".agents/agents/judge.md"]) {
      assert.match(read(root, path), /^---\n# Generated from agents\/judge.md/, path);
      assert.ok(read(root, path).endsWith("---\nYou decide.\n"), `${path} keeps the body`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skills are copied for Claude Code without their evals", () => {
  const root = fixture();
  try {
    build(root);
    assert.equal(read(root, ".claude/skills/demo/SKILL.md"), read(root, ".agents/skills/demo/SKILL.md"));
    assert.ok(!existsSync(join(root, ".claude", "skills", "demo", "evals")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a clone under a directory named evals still gets its skill copies", () => {
  const parent = mkdtempSync(join(tmpdir(), "agent-config-"));
  const root = join(parent, "evals", "clone");
  try {
    mkdirSync(root, { recursive: true });
    const src = fixture();
    cpSync(src, root, { recursive: true });
    rmSync(src, { recursive: true, force: true });
    build(root);
    assert.ok(existsSync(join(root, ".claude", "skills", "demo", "SKILL.md")));
    assert.ok(!existsSync(join(root, ".claude", "skills", "demo", "evals")));
    assert.deepEqual(stale(root), []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("hook registrations point every tool at the one script with its own --tool flag", () => {
  const root = fixture();
  try {
    build(root);
    const script = ".agents/hooks/git-guard/git-guard.mjs";
    const claude = JSON.parse(read(root, ".claude/settings.json"));
    assert.equal(claude.hooks.PreToolUse[0].matcher, "Bash|PowerShell");
    assert.equal(claude.hooks.PreToolUse[0].hooks[0].command, `node "$CLAUDE_PROJECT_DIR/${script}" --tool claude`);
    const cursor = JSON.parse(read(root, ".cursor/hooks.json"));
    assert.equal(cursor.version, 1);
    assert.equal(cursor.hooks.beforeShellExecution[0].command, `node ${script} --tool cursor`);
    const copilot = JSON.parse(read(root, ".github/hooks/git-guard.json"));
    assert.equal(copilot.hooks.preToolUse[0].bash, `node ${script} --tool copilot`);
    assert.equal(copilot.hooks.preToolUse[0].matcher, "bash|powershell");
    const antigravity = JSON.parse(read(root, ".agents/hooks.json"));
    assert.equal(antigravity["git-guard"].PreToolUse[0].matcher, "run_command");
    assert.equal(antigravity["git-guard"].PreToolUse[0].hooks[0].command, `node ${script} --tool antigravity`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stale() names a generated file that was edited by hand, and nothing after a build", () => {
  const root = fixture();
  try {
    build(root);
    assert.deepEqual(stale(root), []);
    writeFileSync(join(root, ".cursor", "agents", "judge.md"), "edited");
    writeFileSync(join(root, ".claude", "skills", "demo", "SKILL.md"), "edited");
    assert.deepEqual(stale(root), [".cursor/agents/judge.md", ".claude/skills/demo"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a source agent with a bad tier or a name that differs from its file is refused", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "agents", "odd.md"), "---\nname: odd\ndescription: x\ntier: cheap\naccess: read\n---\n");
    assert.throws(() => plan(root), /tier must be/);
    writeFileSync(join(root, "agents", "odd.md"), "---\nname: other\ndescription: x\ntier: judgment\naccess: read\n---\n");
    assert.throws(() => plan(root), /not the file name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the committed generated files are what the sources produce", () => {
  const out = stale(repoDir);
  assert.deepEqual(out, [], `stale, run npm run build: ${out.join(", ")}`);
});
