#!/usr/bin/env node
// Writes every generated file from the sources: the four agent dialects from agents/*.md, the
// Claude Code copies of .agents/skills (without evals), and the hook registration per tool.
// `node scripts/build.mjs` writes into the repo; `node scripts/build.mjs --check` exits 1 and
// lists the files that differ instead, which is what `npm test` runs.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderFrontmatter, splitFrontmatter } from "./build/frontmatter.mjs";
import { AGENT_TARGETS, HOOK_TARGETS, PROJECT_HOOK_COMMAND, TOOLS } from "./build/targets.mjs";

const TIERS = new Set(["judgment", "implementation"]);
const ACCESS = new Set(["read", "write"]);
const GENERATED_NOTE = (source) => `# Generated from ${source} by scripts/build.mjs. Edit the source and run npm run build.`;

export function readAgents(root) {
  const dir = join(root, "agents");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const { fields, body } = splitFrontmatter(readFileSync(join(dir, file), "utf8"), `agents/${file}`);
      const name = file.replace(/\.md$/, "");
      if (fields.name !== name) throw new Error(`agents/${file}: name "${fields.name}" is not the file name`);
      if (!TIERS.has(fields.tier)) throw new Error(`agents/${file}: tier must be judgment or implementation`);
      if (!ACCESS.has(fields.access)) throw new Error(`agents/${file}: access must be read or write`);
      return { ...fields, name, body, source: `agents/${file}` };
    });
}

function renderAgent(agent, target) {
  const frontmatter = renderFrontmatter(target.frontmatter(agent));
  const withNote = frontmatter.replace(/^---\n/, `---\n${GENERATED_NOTE(agent.source)}\n`);
  return `${withNote}\n${agent.body.replace(/^\n+/, "")}`;
}

// Every generated file as { path, content }, or { path, dir } for a copied skill folder.
export function plan(root) {
  const files = [];
  for (const agent of readAgents(root)) {
    for (const tool of TOOLS) {
      const target = AGENT_TARGETS[tool];
      files.push({ path: target.path(agent.name), content: renderAgent(agent, target) });
    }
  }
  for (const tool of TOOLS) {
    const target = HOOK_TARGETS[tool];
    files.push({ path: target.path, content: `${JSON.stringify(target.content(PROJECT_HOOK_COMMAND), null, 2)}\n` });
  }
  const skillsDir = join(root, ".agents", "skills");
  for (const name of readdirSync(skillsDir).sort()) {
    if (!existsSync(join(skillsDir, name, "SKILL.md"))) continue;
    files.push({ path: `.claude/skills/${name}`, dir: join(skillsDir, name) });
  }
  return files;
}

const skipEvals = (src) => !/[\\/]evals([\\/]|$)/.test(src);

export function build(root) {
  const written = [];
  for (const file of plan(root)) {
    const dest = join(root, file.path);
    if (file.dir) {
      rmSync(dest, { recursive: true, force: true });
      cpSync(file.dir, dest, { recursive: true, filter: skipEvals });
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.content);
    }
    written.push(file.path);
  }
  return written;
}

// Files whose committed content is not what the sources produce.
export function stale(root) {
  const out = [];
  for (const file of plan(root)) {
    const dest = join(root, file.path);
    if (file.dir) {
      if (!sameTree(file.dir, dest)) out.push(file.path);
    } else if (!existsSync(dest) || readFileSync(dest, "utf8") !== file.content) out.push(file.path);
  }
  return out;
}

function sameTree(src, dest) {
  if (!existsSync(dest)) return false;
  const list = (dir) =>
    readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && skipEvals(join(e.parentPath, e.name)))
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1).replace(/\\/g, "/"))
      .sort();
  const files = list(src);
  if (files.join("\n") !== list(dest).join("\n")) return false;
  return files.every((f) => readFileSync(join(src, f)).equals(readFileSync(join(dest, f))));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  if (process.argv.includes("--check")) {
    const out = stale(root);
    if (out.length) {
      console.error(["Stale generated files (run npm run build):", ...out].join("\n  "));
      process.exit(1);
    }
    console.log("Generated files are current.");
  } else {
    console.log(`Wrote ${build(root).length} generated paths.`);
  }
}
