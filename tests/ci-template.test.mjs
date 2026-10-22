// templates/ci.yml's weekly npm audit step: it runs on the schedule only, and under sh with a fake
// npm it passes on a clean audit, fails on a high advisory, and only warns when the endpoint stays down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freshDir } from "./support/fixture-clone.mjs";
import { cleanGitEnv } from "./support/git-env.mjs";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const template = readFileSync(join(repoDir, "templates", "ci.yml"), "utf8").replace(/\r\n/g, "\n");
const STEP_NAME = "npm audit (production, high and above)";

// The step's `if:` and its `run: |` block, de-indented.
function auditStep() {
  const start = template.indexOf(`- name: ${STEP_NAME}`);
  assert.notEqual(start, -1, "the audit step is missing");
  const lines = template.slice(start).split("\n");
  const condition = lines.find((line) => line.trim().startsWith("if:"));
  const runAt = lines.findIndex((line) => line.trim() === "run: |");
  const indent = lines[runAt + 1].match(/^ */)[0].length;
  const body = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() && line.match(/^ */)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return { condition, script: body.join("\n") };
}

// A POSIX sh: on PATH, else the one Git for Windows ships beside its exec path.
function findSh() {
  const candidates = ["sh"];
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8", env: cleanGitEnv() }).trim();
  for (const up of ["../../../usr/bin/sh.exe", "../../../bin/sh.exe", "../../usr/bin/sh.exe", "../../bin/sh.exe"]) candidates.push(join(execPath, up));
  return candidates.find((candidate) => spawnSync(candidate, ["-c", "exit 0"]).status === 0);
}
const sh = findSh();

// A fake npm that prints the next canned answer each call, and a sleep that returns at once.
function runStep(t, answers) {
  const dir = freshDir(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));
  const fakeNpm = `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, "/")}" -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync("answers.json","utf8"));const n=+(fs.existsSync("calls")?fs.readFileSync("calls","utf8"):0);fs.writeFileSync("calls",String(n+1));const x=a[Math.min(n,a.length-1)];process.stdout.write(x.out);process.exit(x.code)'\n`;
  for (const [name, content] of [["npm", fakeNpm], ["sleep", "#!/bin/sh\nexit 0\n"]]) {
    writeFileSync(join(bin, name), content);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(dir, "step.sh"), auditStep().script);
  const env = cleanGitEnv({ PATH: `${bin}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}` });
  const result = spawnSync(sh, ["-e", "step.sh"], { cwd: dir, encoding: "utf8", env });
  const calls = +readFileSync(join(dir, "calls"), "utf8");
  return { ...result, calls };
}

const CLEAN = { out: JSON.stringify({ vulnerabilities: {} }), code: 0 };
const HIGH = { out: JSON.stringify({ vulnerabilities: { vite: { name: "vite", severity: "high", range: "<6.3.6" } } }), code: 1 };
const DOWN = { out: JSON.stringify({ error: { code: "ETIMEDOUT", summary: "timed out" } }), code: 1 };

test("the audit step runs on the weekly schedule only, and even after an earlier step failed", () => {
  const { condition } = auditStep();
  assert.match(condition, /github\.event_name == 'schedule'/);
  assert.match(condition, /!cancelled\(\)/);
  assert.doesNotMatch(condition, /pull_request|push|workflow_dispatch/);
  assert.match(auditStep().script, /npm audit --omit=dev --audit-level=high/);
});

test("a clean audit passes on the first call", { skip: !sh && "no POSIX sh" }, (t) => {
  const result = runStep(t, [CLEAN]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls, 1);
});

test("a high advisory fails the step and names the package", { skip: !sh && "no POSIX sh" }, (t) => {
  const result = runStep(t, [HIGH]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /high\tvite\t<6\.3\.6/);
});

test("an endpoint that recovers is retried; one that stays down is a warning, not a failure", { skip: !sh && "no POSIX sh" }, (t) => {
  const recovered = runStep(t, [DOWN, HIGH]);
  assert.equal(recovered.status, 1);
  assert.equal(recovered.calls, 2);
  const down = runStep(t, [DOWN]);
  assert.equal(down.status, 0, down.stderr);
  assert.equal(down.calls, 3);
  assert.match(down.stdout, /::warning::npm audit could not reach/);
});
