// The README's diagrams (docs/assets/) restate facts the repo owns: the agent and skill counts, the four tools, and
// what the build writes for one agent. These tests fail when one of those changes and the drawing does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_TARGETS, TOOLS } from "../scripts/build/targets.mjs";
import { frontmatter } from "./support/frontmatter.mjs";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABELS = { claude: "Claude Code", cursor: "Cursor", copilot: "GitHub Copilot", antigravity: "Antigravity CLI" };
const EXAMPLE_AGENT = "architect-engineer";
// Only the keys the diagram draws; name and description are the same everywhere, effort and color are Claude-only.
const DRAWN_KEYS = ["model", "tools", "readonly"];

// The text a viewer sees: title and desc (the alt text, which repeats it) dropped, then tags, entities decoded,
// whitespace collapsed.
function svgText(file) {
  const raw = readFileSync(join(repoDir, "docs/assets", file), "utf8");
  return raw
    .replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
const yamlValue = (value) => (Array.isArray(value) ? `[${value.join(", ")}]` : String(value));

test("every supported tool has a label for the diagrams", () => {
  assert.deepEqual(Object.keys(LABELS).sort(), [...TOOLS].sort());
});

test("hero.svg names every tool and the current agent and skill counts", () => {
  const text = svgText("hero.svg");
  const agents = readdirSync(join(repoDir, "agents")).filter((f) => f.endsWith(".md"));
  for (const tool of TOOLS) assert.ok(text.includes(LABELS[tool]), `missing ${LABELS[tool]}`);
  assert.ok(text.includes(`${agents.length} specialists`), `expected "${agents.length} specialists"`);
  const skills = readdirSync(join(repoDir, ".agents/skills")).filter((name) => existsSync(join(repoDir, ".agents/skills", name, "SKILL.md")));
  assert.ok(text.includes(`${skills.length} skills`), `expected "${skills.length} skills"`);
});

test("how-it-works.svg shows what the build really writes for its example agent", () => {
  const text = svgText("how-it-works.svg");
  const source = frontmatter(join(repoDir, "agents", `${EXAMPLE_AGENT}.md`));
  for (const key of ["tier", "access"]) assert.ok(text.includes(`${key}: ${source[key]}`), `source ${key}`);
  for (const tool of TOOLS) {
    const target = AGENT_TARGETS[tool];
    assert.ok(text.includes(LABELS[tool]), `missing ${LABELS[tool]}`);
    assert.ok(text.includes(target.path(EXAMPLE_AGENT)), `${tool}: missing ${target.path(EXAMPLE_AGENT)}`);
    const written = target.frontmatter(source);
    for (const key of DRAWN_KEYS) {
      if (written[key] === undefined) continue;
      const line = `${key}: ${yamlValue(written[key])}`;
      assert.ok(text.includes(line), `${tool}: missing "${line}"`);
    }
  }
});
