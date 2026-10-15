// Project mode's copier: a file is written when missing, left alone when identical, and
// reported as a conflict when it differs, unless --force. Nothing of the user's is ever
// overwritten silently. `evals/` folders are a skill's test fixtures and `*.test.mjs` files
// are this repo's tests; neither is part of what a project needs.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const SKIPPED_DIRS = new Set(["evals"]);
const isTestFile = (name) => name.endsWith(".test.mjs");

export function createCopier({ force = false } = {}) {
  const written = [];
  const conflicts = [];
  let skipped = 0;

  function copyFile(source, target) {
    const content = readFileSync(source);
    if (existsSync(target)) {
      if (readFileSync(target).equals(content)) {
        skipped++;
        return;
      }
      if (!force) {
        conflicts.push(target);
        return;
      }
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(target);
  }

  function copyTree(source, target) {
    if (!statSync(source).isDirectory()) return copyFile(source, target);
    for (const name of readdirSync(source)) {
      if (SKIPPED_DIRS.has(name) || isTestFile(name)) continue;
      copyTree(join(source, name), join(target, name));
    }
  }

  return { copyTree, result: () => ({ written, conflicts, skipped }) };
}

export function toRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}
