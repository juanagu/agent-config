// Cross-references in the prose that loads into sessions: every `§N` pointer names a section that
// exists (a skill's own, or the skill named next to it as "`<skill>` skill, §N"), every architecture
// skill's description says which sibling skills it is not for, and every agent-like or architecture-skill
// name points at a file that exists. Each of these has cost a review round when it drifted.
// The canonical skills are .agents/skills/; the .claude/skills/ copies are generated from them and not read here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatter } from "./support/frontmatter.mjs";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoDir, path), "utf8");

const SKILLS = ".agents/skills";
const skillNames = readdirSync(join(repoDir, SKILLS)).filter((name) => existsSync(join(repoDir, SKILLS, name, "SKILL.md")));
const skillFile = (name) => `${SKILLS}/${name}/SKILL.md`;
const skillOf = (file) => file.match(/^\.agents\/skills\/([^/]+)\//)?.[1];
const agentNames = readdirSync(join(repoDir, "agents"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));
const agentFiles = agentNames.map((name) => `agents/${name}.md`);
const architectureSkills = skillNames.filter((name) => name.endsWith("-architecture"));
// README.md is written last, and AGENTS.md/CLAUDE.md land with the standards port; a missing one is skipped, not failed.
const rootProse = ["AGENTS.md", "CLAUDE.md", "README.md"].filter((file) => existsSync(join(repoDir, file)));
const proseFiles = [...rootProse, ...agentFiles, ...skillNames.map(skillFile)];

// Fenced blocks are kept: in the skills they are layout trees whose comments carry pointers too.
const sections = new Map(skillNames.map((name) => [name, new Set([...read(skillFile(name)).matchAll(/^## (\d+)\./gm)].map((m) => m[1]))]));
const SECTION_POINTER = /§(\d+)/g;
// "`android-architecture` skill, §10" or "`flutter-architecture` skill (§9)": a pointer into another skill.
const CROSS_POINTER = /`([a-z-]+-architecture)` skill[,]? \(?§(\d+)/g;

// Every §N in a file: a cross pointer must name a skill and one of its sections; any other §N must be
// in a skill and name one of its own sections. In an agent file or the standards, a bare §N is unresolvable.
function danglingPointers(file) {
  const text = read(file);
  const own = sections.get(skillOf(file));
  const consumed = new Set();
  const dangling = [];
  for (const m of text.matchAll(CROSS_POINTER)) {
    consumed.add(m.index + m[0].indexOf("§"));
    if (!sections.get(m[1])?.has(m[2])) dangling.push(`${m[1]} §${m[2]}`);
  }
  for (const m of text.matchAll(SECTION_POINTER)) {
    if (consumed.has(m.index)) continue;
    if (!own) dangling.push(`§${m[1]} (not of the form "\`<skill>\` skill, §N")`);
    else if (!own.has(m[1])) dangling.push(`§${m[1]}`);
  }
  return dangling;
}

test("there are skills and agents to check", () => {
  assert.ok(skillNames.length > 0);
  assert.ok(agentNames.length > 0);
});

for (const file of proseFiles) {
  test(`${file}: every §N pointer names a section that exists`, () => {
    const dangling = danglingPointers(file);
    assert.deepEqual(dangling, [], `dangling: ${dangling.join(", ")}`);
  });
}

for (const name of architectureSkills) {
  test(`${name}: its description names every other architecture skill it is not for`, () => {
    const text = frontmatter(join(repoDir, skillFile(name))).description ?? "";
    const at = text.toLowerCase().lastIndexOf("not for");
    assert.notEqual(at, -1, 'the description has no "Not for" clause');
    const notFor = text.slice(at);
    const missing = architectureSkills.filter((other) => other !== name && !notFor.includes(other));
    assert.deepEqual(missing, [], `missing from "Not for": ${missing.join(", ")}`);
  });
}

// An agent-like name ends the way an existing agent's name does (…-engineer, …-writer, …-reviewer, designer).
const agentSuffixes = new Set(agentNames.map((name) => name.split("-").pop()));
const NAME = /\b[a-z]+(?:-[a-z]+)*\b/gi;
const looksLikeAgent = (name) => agentSuffixes.has(name.split("-").pop());

for (const file of proseFiles) {
  test(`${file}: every agent-like and architecture-skill name exists`, () => {
    const names = new Set([...read(file).matchAll(NAME)].map((m) => m[0].toLowerCase()));
    const dangling = [...names].filter(
      (name) =>
        (looksLikeAgent(name) && !agentNames.includes(name) && !agentSuffixes.has(name)) ||
        (name.endsWith("-architecture") && !skillNames.includes(name)),
    );
    assert.deepEqual(dangling, [], `dangling: ${dangling.join(", ")}`);
  });
}
