// The frontmatter of an agent or skill file as a flat map of string fields, for tests. The parser is
// the build's, so a file the tests accept is one the build accepts.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { splitFrontmatter } from "../../scripts/build/frontmatter.mjs";

export function frontmatter(path) {
  return splitFrontmatter(readFileSync(path, "utf8"), basename(path)).fields;
}
