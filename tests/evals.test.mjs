// Every skill's evals/evals.json is runnable as docs/skill-evals.md describes, and every agent's
// agents/evals/<name>/evals.json as docs/agent-evals.md does: it parses in skill-creator's schema, names
// files that exist, says how to sandbox the run, never hands the agent its fixture builder, and its review
// diffs have hunk headers that match their lines. An agent's evals also grade its description as a routing
// signal, with near-misses on both sides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsDir = join(repoDir, ".agents", "skills");
const skills = readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, "SKILL.md")));
const agentsDir = join(repoDir, "agents");
const agents = readdirSync(agentsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
const MIN_DISPATCH_EACH_WAY = 3;

// The checks every evals.json shares; `root` is what its `files` are relative to.
function assertRunnable(doc, root, runbook) {
  assert.ok((doc.sandbox ?? "").includes(runbook), `sandbox must point at ${runbook}`);
  const ids = doc.evals.map((ev) => ev.id);
  assert.equal(new Set(ids).size, ids.length, "eval ids must be unique");
  for (const ev of doc.evals) {
    assert.ok(ev.prompt && ev.expected_output, `eval ${ev.id}: prompt and expected_output`);
    assert.ok(Array.isArray(ev.expectations) && ev.expectations.length > 0, `eval ${ev.id}: expectations`);
    for (const input of ev.files ?? []) {
      assert.ok(existsSync(join(root, input)), `eval ${ev.id}: ${input} does not exist`);
      assert.ok(!input.endsWith("setup.sh"), `eval ${ev.id}: setup.sh is a runner step, not an agent input`);
    }
  }
  if (doc.setup) assert.ok(existsSync(join(root, doc.setup.split(" ")[0])), `setup script ${doc.setup} does not exist`);
}

function hunkMismatches(diff) {
  const lines = readFileSync(diff, "utf8").replace(/\r\n/g, "\n").split("\n");
  const wrong = [];
  lines.forEach((line, i) => {
    const m = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (!m) return;
    m[1] ??= "1"; // a count left out means one line
    m[2] ??= "1";
    let oldN = 0, newN = 0;
    for (let j = i + 1; j < lines.length && !/^(@@ |diff --git )/.test(lines[j]); j++) {
      if (lines[j].startsWith(" ")) { oldN++; newN++; }
      else if (lines[j].startsWith("-")) oldN++;
      else if (lines[j].startsWith("+")) newN++;
    }
    if (oldN !== +m[1] || newN !== +m[2]) wrong.push(`line ${i + 1}: says -${m[1]} +${m[2]}, has -${oldN} +${newN}`);
  });
  return wrong;
}

// Every review.diff under a folder, at any depth.
function reviewDiffs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).filter((p) => p.endsWith("review.diff")).map((p) => join(dir, p));
}

for (const skill of skills) {
  const root = join(skillsDir, skill);
  const file = join(root, "evals", "evals.json");

  test(`${skill}: has evals/evals.json in skill-creator's schema`, () => {
    assert.ok(existsSync(file), "missing evals/evals.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(doc.skill_name, skill);
    assertRunnable(doc, root, "docs/skill-evals.md");
  });

  for (const diff of reviewDiffs(join(root, "evals", "files"))) {
    test(`${skill}: ${diff.slice(root.length + 1)} hunk headers match their lines`, () => {
      assert.deepEqual(hunkMismatches(diff), []);
    });
  }
}

for (const agent of agents) {
  const root = join(agentsDir, "evals", agent);
  const file = join(root, "evals.json");

  test(`${agent}: has agents/evals/${agent}/evals.json in skill-creator's schema`, () => {
    assert.ok(existsSync(file), `missing agents/evals/${agent}/evals.json`);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(doc.agent_name, agent);
    assertRunnable(doc, root, "docs/agent-evals.md");
  });

  test(`${agent}: its dispatch cases grade the description both ways`, () => {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const cases = doc.dispatch ?? [];
    for (const c of cases) assert.ok(c.query && typeof c.should_dispatch === "boolean", `bad dispatch case: ${JSON.stringify(c)}`);
    const yes = cases.filter((c) => c.should_dispatch).length;
    assert.ok(yes >= MIN_DISPATCH_EACH_WAY, `${yes} should_dispatch: true, need ${MIN_DISPATCH_EACH_WAY}`);
    assert.ok(cases.length - yes >= MIN_DISPATCH_EACH_WAY, `${cases.length - yes} should_dispatch: false, need ${MIN_DISPATCH_EACH_WAY}`);
  });

  for (const diff of reviewDiffs(root)) {
    test(`${agent}: ${diff.slice(root.length + 1)} hunk headers match their lines`, () => {
      assert.deepEqual(hunkMismatches(diff), []);
    });
  }
}
