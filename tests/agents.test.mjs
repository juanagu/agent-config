// Every agent source names itself, a tier (what a wrong call costs, not a model name that goes
// stale) and an access level, so scripts/build.mjs can map it into each tool's dialect
// (docs/architecture.md, "Agents: one source, four dialects").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatter } from "./support/frontmatter.mjs";

const agentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agents");
const TIERS = new Set(["judgment", "implementation"]);
const ACCESS = new Set(["read", "write"]);
const EFFORTS = new Set(["low", "medium", "high"]);
// Claude Code's documented colours; the other tools drop the field.
const COLORS = new Set(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]);

const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

test("there are agents to check", () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`${file} has neutral frontmatter: its own name, a tier, an access level`, () => {
    const fm = frontmatter(join(agentsDir, file));
    assert.equal(fm.name, basename(file, ".md"));
    assert.ok(fm.description, "description is required");
    assert.ok(TIERS.has(fm.tier), `tier is "${fm.tier}", expected one of ${[...TIERS].join(", ")}`);
    assert.ok(ACCESS.has(fm.access), `access is "${fm.access}", expected one of ${[...ACCESS].join(", ")}`);
    if (fm.effort !== undefined) assert.ok(EFFORTS.has(fm.effort), `effort is "${fm.effort}", expected one of ${[...EFFORTS].join(", ")}`);
    if (fm.color !== undefined) assert.ok(COLORS.has(fm.color), `color is "${fm.color}", expected one of ${[...COLORS].join(", ")}`);
    assert.equal(fm.model, undefined, "model is derived from tier by the build; do not set it in the source");
    assert.equal(fm.tools, undefined, "tools are derived from access by the build; do not set them in the source");
  });
}
