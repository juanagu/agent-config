import { readFileSync, writeFileSync } from "node:fs";

const BYTE_ORDER_MARK = 0xfeff;

// A leading byte-order mark (some editors add one) is dropped; anything else wrong
// names the file.
export function readJson(path) {
  const raw = readFileSync(path, "utf8");
  const text = raw.charCodeAt(0) === BYTE_ORDER_MARK ? raw.slice(1) : raw;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
