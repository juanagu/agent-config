// A throwaway clone for the installer tests: the real scripts/ beside fixture content at every
// path the installer copies or links, so the suite needs neither `npm run build` nor the
// real skills, and so a change to the generated files cannot break these tests by accident.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const GUARD = ".agents/hooks/git-guard/git-guard.mjs";

export const FIXTURE_SKILLS = ["demo-skill", "other-skill"];

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const FIXTURE_FILES = {
  "AGENTS.md": "# Standards\n\nfixture\n",
  "CLAUDE.md": "@AGENTS.md\n",
  ".agents/hooks/git-guard/git-guard.mjs": "// fixture guard\n",
  ".agents/hooks/git-guard/shell-parse.mjs": "// fixture parser\n",
  ".agents/hooks.json": json({ "git-guard": { PreToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: `node ${GUARD} --tool antigravity` }] }] } }),
  ".agents/agents/demo.md": "---\nname: demo\ndescription: antigravity\n---\nbody\n",
  ".claude/settings.json": json({ hooks: { PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${GUARD}" --tool claude` }] }] } }),
  ".claude/agents/demo.md": "---\nname: demo\ndescription: claude\nmodel: sonnet\n---\nbody\n",
  ".cursor/hooks.json": json({ version: 1, hooks: { beforeShellExecution: [{ command: `node ${GUARD} --tool cursor`, timeout: 30 }] } }),
  ".cursor/agents/demo.md": "---\nname: demo\ndescription: cursor\nmodel: inherit\n---\nbody\n",
  ".github/hooks/git-guard.json": json({ version: 1, hooks: { preToolUse: [{ type: "command", bash: `node ${GUARD} --tool copilot`, powershell: `node ${GUARD} --tool copilot` }] } }),
  ".github/agents/demo.agent.md": "---\nname: demo\ndescription: copilot\n---\nbody\n",
};

for (const skill of FIXTURE_SKILLS) {
  FIXTURE_FILES[`.agents/skills/${skill}/SKILL.md`] = `---\nname: ${skill}\ndescription: fixture\n---\nbody\n`;
  FIXTURE_FILES[`.agents/skills/${skill}/evals/evals.json`] = json({ skill_name: skill, evals: [] });
  FIXTURE_FILES[`.claude/skills/${skill}/SKILL.md`] = FIXTURE_FILES[`.agents/skills/${skill}/SKILL.md`];
}

export function makeFixtureClone(t, { skip = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "agent-config-clone-"));
  t.after(() => rmSafely(dir));
  cpSync(join(repoDir, "scripts"), join(dir, "scripts"), { recursive: true });
  for (const name of ["package.json", "skills.txt", "skills.optional.txt"]) cpSync(join(repoDir, name), join(dir, name));
  for (const [path, content] of Object.entries(FIXTURE_FILES)) {
    if (skip.some((prefix) => path.startsWith(prefix))) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

export function freshDir(t, prefix = "agent-config-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSafely(dir));
  return dir;
}

async function rmSafely(dir) {
  const { rmSync } = await import("node:fs");
  rmSync(dir, { recursive: true, force: true });
}
