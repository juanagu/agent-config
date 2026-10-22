// templates/ci.yml's weekly npm audit: a job of its own that runs on the schedule only, reports to
// its own issue, and under sh with a fake npm passes on a clean audit, fails on a fixable high
// advisory, warns on one with no fix (or only a downgrade), and warns when the endpoint stays down.
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
const lines = template.split("\n");
const indentOf = (line) => line.match(/^ */)[0].length;

// The lines of a job, from `  <name>:` to the next job.
function jobLines(name) {
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `no ${name} job`);
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

// The literal block under `<key>: |` in some lines, de-indented.
function literalBlock(scope, key) {
  const at = scope.findIndex((line) => line.trim() === `${key}: |`);
  assert.notEqual(at, -1, `no ${key} block`);
  const indent = indentOf(scope[at + 1]);
  const body = [];
  for (const line of scope.slice(at + 1)) {
    if (line.trim() && indentOf(line) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

const job = jobLines("npm-audit");
const stepStart = job.findIndex((line) => line.includes("- name: npm audit (production, high and above)"));
const reportStart = job.findIndex((line) => line.includes("- name: Open the audit issue"));
const auditStep = job.slice(stepStart, reportStart);
const TRIAGE = literalBlock(auditStep, "TRIAGE");
const SCRIPT = literalBlock(auditStep, "run");

// A POSIX sh: on PATH, else the one Git for Windows ships beside its exec path.
function findSh() {
  const candidates = ["sh"];
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8", env: cleanGitEnv() }).trim();
  for (const up of ["../../../usr/bin/sh.exe", "../../../bin/sh.exe", "../../usr/bin/sh.exe", "../../bin/sh.exe"]) candidates.push(join(execPath, up));
  return candidates.find((candidate) => spawnSync(candidate, ["-c", "exit 0"]).status === 0);
}
const sh = findSh();

// A fake npm that prints the next canned answer each call; `timeout` and `sleep` that return at once.
function runStep(t, answers, lock = null) {
  const dir = freshDir(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));
  if (lock) writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
  const node = process.execPath.replace(/\\/g, "/");
  const fakeNpm = `#!/bin/sh\nexec "${node}" -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync("answers.json","utf8"));const n=+(fs.existsSync("calls")?fs.readFileSync("calls","utf8"):0);fs.writeFileSync("calls",String(n+1));const x=a[Math.min(n,a.length-1)];process.stdout.write(x.out);process.exit(x.code)'\n`;
  const fakes = { npm: fakeNpm, sleep: "#!/bin/sh\nexit 0\n", timeout: '#!/bin/sh\nshift\nexec "$@"\n' };
  for (const [name, content] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), content);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(dir, "step.sh"), SCRIPT);
  const env = cleanGitEnv({ TRIAGE, PATH: `${bin}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}` });
  const result = spawnSync(sh, ["-e", "step.sh"], { cwd: dir, encoding: "utf8", env });
  return { ...result, calls: +readFileSync(join(dir, "calls"), "utf8") };
}

const report = (vulnerabilities) => ({ out: JSON.stringify({ vulnerabilities }), code: Object.keys(vulnerabilities).length ? 1 : 0 });
const CLEAN = report({});
const FIXABLE = report({ vite: { name: "vite", severity: "high", range: "<6.3.6", fixAvailable: true } });
const NO_FIX = report({ tar: { name: "tar", severity: "critical", range: "*", fixAvailable: false } });
const DOWNGRADE = report({ "eslint-config-next": { name: "eslint-config-next", severity: "high", range: ">=15", fixAvailable: { name: "eslint-config-next", version: "14.2.35", isSemVerMajor: true } } });
const DOWNGRADE_LOCK = { packages: { "node_modules/eslint-config-next": { version: "16.3.8" } } };
const DOWN = { out: JSON.stringify({ error: { code: "ETIMEDOUT", summary: "timed out" } }), code: 1 };
const skip = !sh && "no POSIX sh";

test("the audit is its own job on the weekly schedule only, bounded, with its own issue", () => {
  const condition = job.find((line) => line.trim().startsWith("if:"));
  assert.match(condition, /github\.event_name == 'schedule'/);
  assert.doesNotMatch(condition, /pull_request|push|workflow_dispatch/);
  assert.ok(job.some((line) => /^ {4}timeout-minutes: \d+$/.test(line)), "the job has a timeout");
  assert.ok(auditStep.some((line) => /timeout-minutes: \d+/.test(line)), "the step has a timeout");
  assert.match(SCRIPT, /timeout \d+ npm audit --omit=dev --audit-level=high/);
  const report = job.slice(reportStart).join("\n");
  assert.match(report, /if: \$\{\{ failure\(\) \}\}/);
  assert.match(report, /TITLE: "Weekly npm audit: high or critical in production dependencies"/);
  assert.match(report, /gh issue comment "\$existing"/);
  assert.doesNotMatch(jobLines("report-full-tier").join("\n"), /npm-audit/, "the full tier's issue never folds in the audit");
  assert.doesNotMatch(jobLines("checks").join("\n"), /npm audit/, "checks does not run the audit");
});

test("a clean audit passes on the first call", { skip }, (t) => {
  const result = runStep(t, [CLEAN]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls, 1);
});

test("a high advisory with a fix fails the step and names the package", { skip }, (t) => {
  const result = runStep(t, [FIXABLE]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /high\tvite\t<6\.3\.6\tfix available/);
});

test("an advisory with no fix, or only an older major, warns and passes", { skip }, (t) => {
  const none = runStep(t, [NO_FIX]);
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /::warning::critical tar/);
  const downgrade = runStep(t, [DOWNGRADE], DOWNGRADE_LOCK);
  assert.equal(downgrade.status, 0, downgrade.stderr);
  assert.match(downgrade.stdout, /::warning::high eslint-config-next/);
  assert.equal(runStep(t, [DOWNGRADE]).status, 1, "without a lockfile a major is still a fix");
});

test("an endpoint that recovers is retried; one that stays down is a warning, not a failure", { skip }, (t) => {
  const recovered = runStep(t, [DOWN, FIXABLE]);
  assert.equal(recovered.status, 1);
  assert.equal(recovered.calls, 2);
  const down = runStep(t, [DOWN]);
  assert.equal(down.status, 0, down.stderr);
  assert.equal(down.calls, 3);
  assert.match(down.stdout, /::warning::npm audit could not reach/);
});
