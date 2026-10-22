// Every place a repo names a Node version, as written: Dockerfiles (`FROM node:…`, through the
// file's `ARG` defaults), CI `node-version` (a scalar, a list, or a matrix it points at), .nvmrc,
// .node-version and `engines`. node-runtime.mjs judges them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const MAX_DEPTH = 3;
const FROM_NODE = /^\s*FROM\s+(?:--\S+\s+)*(?:[\w.:-]+\/)*node:([^\s@]+)/gim;
const DOCKER_ARG = /^\s*ARG\s+(\w+)=["']?([^\s"']+)/gim;
const ARG_REFERENCE = /\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)/g;
const MATRIX_REFERENCE = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/;

function walk(dir, depth = 0, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), depth + 1, out);
    else if (entry.isFile()) out.push(join(dir, entry.name));
  }
  return out;
}

const isDockerfile = (name) => /^Dockerfile/i.test(name) || /\.Dockerfile$/i.test(name);
const isWorkflow = (file) => /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(file);
const stripComment = (text) => text.replace(/\s+#.*$/, "");
const unquote = (text) => text.trim().replace(/^['"]|['"]$/g, "").trim();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The values a YAML key holds anywhere in a file: a scalar, an inline `[a, b]` list, or a block
// list of `- a` items under it. Enough YAML for workflow files, not a parser.
export function yamlValues(text, key) {
  const lines = text.split(/\r?\n/);
  const keyLine = new RegExp(`^(\\s*)(?:-\\s+)?${escapeRegExp(key)}:\\s*(.*)$`);
  const values = [];
  lines.forEach((line, i) => {
    const m = line.match(keyLine);
    if (!m) return;
    const rest = stripComment(m[2]).trim();
    if (rest.startsWith("[")) values.push(...rest.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean));
    else if (rest) values.push(unquote(rest));
    else values.push(...blockList(lines.slice(i + 1), m[1].length));
  });
  return values;
}

function blockList(lines, keyIndent) {
  const items = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = line.match(/^(\s*)-\s+(.*)$/);
    if (!item || item[1].length < keyIndent) break;
    items.push(unquote(stripComment(item[2])));
  }
  return items;
}

const indentOf = (line) => line.match(/^ */)[0].length;
const isContent = (line) => line.trim() && !line.trim().startsWith("#");

// Each job's lines: the keys one level under `jobs:`. A file with no `jobs:` is one block.
function jobBlocks(lines) {
  const at = lines.findIndex((line) => /^jobs:\s*(#.*)?$/.test(line));
  if (at === -1) return [lines];
  const blocks = [];
  let jobIndent = null;
  for (const line of lines.slice(at + 1)) {
    if (!isContent(line)) {
      blocks.at(-1)?.push(line);
      continue;
    }
    if (indentOf(line) === 0) break;
    jobIndent ??= indentOf(line);
    if (indentOf(line) === jobIndent) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks;
}

// The lines nested under the first `<key>:` that opens a block.
function sectionUnder(lines, key) {
  const at = lines.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(#.*)?$`).test(line));
  if (at === -1) return [];
  const section = [];
  for (const line of lines.slice(at + 1)) {
    if (isContent(line) && indentOf(line) <= indentOf(lines[at])) break;
    section.push(line);
  }
  return section;
}

// `node-version` values per job, with `${{ matrix.x }}` replaced by every value that job's own
// matrix lists for x; a reference it cannot resolve is kept as written.
export function workflowVersions(text) {
  return jobBlocks(text.split(/\r?\n/)).flatMap((job) => {
    const matrix = sectionUnder(job, "matrix").join("\n");
    return yamlValues(job.join("\n"), "node-version").flatMap((value) => {
      const ref = value.match(MATRIX_REFERENCE);
      if (!ref) return [value];
      const listed = yamlValues(matrix, ref[1]).filter((v) => !MATRIX_REFERENCE.test(v));
      return listed.length ? listed : [value];
    });
  });
}

// `FROM node:<tag>` tags, with `$NAME` and `${NAME}` (or `${NAME:-default}`) filled from the
// file's `ARG NAME=default` lines; a reference with no default stays as written.
export function dockerVersions(text) {
  const args = {};
  for (const m of text.matchAll(DOCKER_ARG)) args[m[1]] ??= m[2];
  return [...text.matchAll(FROM_NODE)].map((m) => m[1].replace(ARG_REFERENCE, (all, braced, fallback, bare) => args[braced ?? bare] ?? fallback ?? all));
}

export function findPins(dir) {
  const pins = [];
  const rel = (path) => relative(dir, path).replace(/\\/g, "/");
  for (const file of walk(dir)) {
    const name = file.split(/[\\/]/).pop();
    if (isDockerfile(name)) for (const raw of dockerVersions(readFileSync(file, "utf8"))) pins.push({ file: rel(file), kind: "docker", raw });
    if (isWorkflow(file)) for (const raw of workflowVersions(readFileSync(file, "utf8"))) pins.push({ file: rel(file), kind: "ci", raw });
  }
  for (const name of [".nvmrc", ".node-version"]) {
    const path = join(dir, name);
    if (existsSync(path)) pins.push({ file: name, kind: "version-file", raw: readFileSync(path, "utf8").trim() });
  }
  const engines = readEngines(dir);
  if (engines) pins.push({ file: "package.json", kind: "engines", raw: engines });
  // A multi-stage Dockerfile or a workflow with several jobs names the same version more than once.
  const seen = new Set();
  return pins.filter((pin) => !seen.has(`${pin.file}\n${pin.raw}`) && seen.add(`${pin.file}\n${pin.raw}`));
}

function readEngines(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).engines?.node ?? null;
  } catch {
    return null;
  }
}
