// Every skill's evals/evals.json is runnable as docs/skill-evals.md describes: it parses in
// skill-creator's schema, names files that exist, says how to sandbox the run, never hands the
// agent its fixture builder, and its review diffs have hunk headers that match their lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsDir = join(repoDir, ".agents", "skills");
const skills = readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, "SKILL.md")));

for (const skill of skills) {
  const root = join(skillsDir, skill);
  const file = join(root, "evals", "evals.json");

  test(`${skill}: has evals/evals.json in skill-creator's schema`, () => {
    assert.ok(existsSync(file), "missing evals/evals.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(doc.skill_name, skill);
    assert.match(doc.sandbox ?? "", /docs\/skill-evals\.md/, "sandbox must point at the runbook");
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
  });

  const diff = join(root, "evals", "files", "review.diff");
  if (!existsSync(diff)) continue;
  test(`${skill}: review.diff hunk headers match their lines`, () => {
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
    assert.deepEqual(wrong, []);
  });
}
