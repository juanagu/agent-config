// YAML frontmatter as a flat map of string fields, plus the body after it. Quoted values lose
// their quotes. Only `field: value` lines are supported, which is all the agent sources use; a
// wrapped or block scalar is refused so a parse never silently returns ">".
export function splitFrontmatter(text, label = "file") {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error(`${label}: no frontmatter`);
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error(`${label}: unterminated frontmatter`);
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_-]+):(.*)$/);
    if (!m) throw new Error(`${label}: not a "field: value" line: ${line}`);
    const value = m[2].trim();
    if (/^[>|]/.test(value)) throw new Error(`${label}: block scalars are not supported (${m[1]})`);
    fields[m[1]] = value.replace(/^"(.*)"$/, "$1");
  }
  return { fields, body: lines.slice(end + 1).join("\n") };
}

// A value is quoted when YAML would otherwise read it as something else than a plain string.
export function yamlValue(value) {
  if (typeof value !== "string") return String(value);
  const risky = /[:#]|^[\s"'[\]{}&*!|>%@`-]|\s$|^(true|false|null|yes|no|on|off|~)$/i;
  return risky.test(value) ? JSON.stringify(value) : value;
}

export function renderFrontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) lines.push(`${key}: [${value.join(", ")}]`);
    else if (typeof value === "boolean") lines.push(`${key}: ${value}`);
    else lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}
