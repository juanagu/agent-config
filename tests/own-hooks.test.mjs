// This repo carries the pre-push hook its standards require of every Node repo, and the hook is the
// template with only its two path filters changed, so a template fix reaches it (AGENTS.md, Workflow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(repoDir, path), "utf8").replace(/\r\n/g, "\n");
const FILTERS = /^(CI_IGNORED|CI_RUNS_ANYWAY)=.*$/gm;

test(".githooks/pre-push is templates/pre-push with only the CI path filters changed", () => {
  assert.equal(read(".githooks/pre-push").replace(FILTERS, "$1=…"), read("templates/pre-push").replace(FILTERS, "$1=…"));
  assert.notEqual(read(".githooks/pre-push").match(FILTERS)[0], "CI_IGNORED=''", "the repo's hook sets its own ignored paths");
});

test("scripts/install-git-hooks.mjs is the template, installed by the prepare script", () => {
  assert.equal(read("scripts/install-git-hooks.mjs"), read("templates/install-git-hooks.mjs"));
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts.prepare, /install-git-hooks\.mjs/);
});
