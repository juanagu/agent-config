// The dependency-audit skill's helper (.agents/skills/dependency-audit/): npm audit's retries and
// lockfile fallback, the fix triage (a downgrade is no fix), the Node pins and their verdicts, and
// the Dependabot read. npm, gh and the network are replaced by fakes; nothing here goes online.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditRepoSafely, guarded, parseArgs, resolveDirs, siblingRepos } from "../.agents/skills/dependency-audit/audit.mjs";
import { dependabotAlerts, repoSlug } from "../.agents/skills/dependency-audit/dependabot.mjs";
import { evaluatePin, latestSecurity } from "../.agents/skills/dependency-audit/node-runtime.mjs";
import { auditNpm, fixKind, parseAuditOutput, runNpmAudit } from "../.agents/skills/dependency-audit/npm-audit.mjs";
import { dockerVersions, findPins, workflowVersions } from "../.agents/skills/dependency-audit/pins.mjs";
import { freshDir } from "./support/fixture-clone.mjs";

const LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { name: "app" },
    "node_modules/next": { version: "16.0.0" },
    "node_modules/eslint-config-next": { version: "16.3.8", dev: true },
    "node_modules/vitest": { version: "2.1.4", dev: true },
  },
};
const REPORT = {
  vulnerabilities: {
    next: { name: "next", severity: "high", isDirect: true, via: [{ title: "SSRF", url: "https://github.com/advisories/GHSA-1111-2222-3333", severity: "high" }], fixAvailable: true },
    "eslint-config-next": { name: "eslint-config-next", severity: "high", isDirect: true, via: ["@next/eslint-plugin-next"], fixAvailable: { name: "eslint-config-next", version: "14.2.35", isSemVerMajor: true } },
    vitest: { name: "vitest", severity: "critical", isDirect: true, via: [], fixAvailable: { name: "vitest", version: "4.1.11", isSemVerMajor: true } },
  },
};
const PROD_REPORT = { vulnerabilities: { next: REPORT.vulnerabilities.next } };
const ENDPOINT_DOWN = JSON.stringify({ error: { code: "ETIMEDOUT", summary: "request to the audit endpoint timed out" } });
const noSleep = async () => {};

function repoWithLock(t) {
  const dir = freshDir(t);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", engines: { node: ">=22" } }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(LOCK));
  return dir;
}

test("an npm error object or non-JSON output is an endpoint failure, never a finding", () => {
  assert.ok(parseAuditOutput(JSON.stringify(REPORT)).report);
  assert.match(parseAuditOutput(ENDPOINT_DOWN).error, /timed out/);
  assert.ok(parseAuditOutput("npm ERR! network").error);
});

test("runNpmAudit retries with backoff and stops at the first report", async () => {
  const outputs = [ENDPOINT_DOWN, "garbage", JSON.stringify(REPORT)];
  const delays = [];
  const result = await runNpmAudit("x", { exec: () => ({ stdout: outputs.shift() }), sleep: async (ms) => delays.push(ms), baseDelayMs: 10 });
  assert.ok(result.report);
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("deterministic npm errors are not retried; timeouts and transport errors are", async () => {
  for (const code of ["ENOAUDIT", "EAUDITNOLOCK", "ENOLOCK"]) {
    let calls = 0;
    const result = await runNpmAudit("x", { exec: () => (calls++, { stdout: JSON.stringify({ error: { code, summary: code } }) }), sleep: noSleep });
    assert.deepEqual([calls, result.attempts, result.error], [1, 1, code], code);
  }
  for (const out of [{ stdout: JSON.stringify({ error: { code: "ECONNRESET" } }) }, { stdout: JSON.stringify({ error: { code: "E503" } }) }, { stdout: "", timedOut: true }]) {
    let calls = 0;
    await runNpmAudit("x", { exec: () => (calls++, out), sleep: noSleep });
    assert.equal(calls, 3, JSON.stringify(out));
  }
});

test("fixKind: true is a patch or minor, a major is a major, an older version than installed is a downgrade", () => {
  assert.equal(fixKind(true, LOCK), "patch-minor");
  assert.equal(fixKind(false, LOCK), "none");
  assert.equal(fixKind({ name: "vitest", version: "4.1.11", isSemVerMajor: true }, LOCK), "major");
  assert.equal(fixKind({ name: "eslint-config-next", version: "14.2.35", isSemVerMajor: true }, LOCK), "downgrade");
  assert.equal(fixKind({ name: "next", version: "16.0.4", isSemVerMajor: false }, LOCK), "patch-minor");
});

test("auditNpm splits production from dev and triages each finding", async (t) => {
  const dir = repoWithLock(t);
  const exec = (_, args) => ({ stdout: JSON.stringify(args.includes("--omit=dev") ? PROD_REPORT : REPORT) });
  const result = await auditNpm(dir, { exec, sleep: noSleep });
  assert.equal(result.source, "npm audit");
  const by = Object.fromEntries(result.findings.map((f) => [f.package, f]));
  assert.deepEqual([by.next.scope, by.next.fix, by.next.advisories[0].ghsa], ["production", "patch-minor", "GHSA-1111-2222-3333"]);
  assert.deepEqual([by["eslint-config-next"].scope, by["eslint-config-next"].fix], ["dev", "downgrade"]);
  assert.deepEqual([by.vitest.scope, by.vitest.fix, by.vitest.installed], ["dev", "major", "2.1.4"]);
});

test("auditNpm falls back to the lockfile's versions when the endpoint stays down, and says so", async (t) => {
  const dir = repoWithLock(t);
  const result = await auditNpm(dir, { exec: () => ({ stdout: ENDPOINT_DOWN }), sleep: noSleep });
  assert.equal(result.source, "lockfile");
  assert.match(result.error, /failed after 3 attempts/);
  assert.deepEqual(result.packages.find((p) => p.package === "vitest"), { package: "vitest", version: "2.1.4", dev: true });
  assert.equal(result.findings, undefined, "a fallback reports no findings, so it cannot read as clean");
});

test("auditNpm keeps the production findings when only the dev run fails", async (t) => {
  const dir = repoWithLock(t);
  const exec = (_, args) => ({ stdout: args.includes("--omit=dev") ? JSON.stringify(PROD_REPORT) : ENDPOINT_DOWN });
  const result = await auditNpm(dir, { exec, sleep: noSleep });
  assert.equal(result.source, "npm audit, production only");
  assert.deepEqual(result.findings.map((f) => f.package), ["next"]);
});

test("a repo without package.json or lockfile is skipped, not reported clean", async (t) => {
  assert.ok((await auditNpm(freshDir(t))).skipped);
});

// ---- the Node runtime ----

const RELEASES = [
  { version: "v24.22.1", security: true },
  { version: "v22.23.4", security: true },
  { version: "v22.22.0", security: false },
  { version: "v22.11.1", security: false },
  { version: "v22.11.0", security: false },
  { version: "v20.19.0", security: true },
];
const SCHEDULE = { v20: { end: "2026-04-30" }, v22: { end: "2027-04-30" }, v24: { end: "2028-04-30" } };
const TODAY = new Date("2026-10-22");
const verdict = (raw, kind = "docker") => evaluatePin({ file: "f", kind, raw }, RELEASES, SCHEDULE, TODAY);

test("a pin whose newest release predates its line's newest security release is behind", () => {
  assert.equal(latestSecurity(RELEASES, 22), "v22.23.4");
  const old = verdict("22.11-alpine");
  assert.deepEqual([old.status, old.resolved, old.latestSecurity, old.securityReleasesBehind], ["behind", "v22.11.1", "v22.23.4", 1]);
  assert.equal(verdict("v22.23.4", "version-file").status, "current");
  assert.equal(verdict("22").status, "current", "a major-only tag floats to the newest release");
  assert.equal(verdict("22.x", "ci").status, "current");
  assert.equal(verdict("v24.22.1", "local").status, "current");
});

test("floating tags, engines ranges and end-of-life majors get their own verdicts", () => {
  assert.equal(verdict("lts-alpine").status, "floating");
  assert.equal(verdict("lts/*", "version-file").status, "floating");
  const range = verdict(">=22", "engines");
  assert.deepEqual([range.status, range.floor, range.floorBelowSecurity], ["range", "22", true]);
  assert.equal(verdict("20.19.0").eol, true);
  assert.equal(verdict("22.11-alpine").eol, false);
  assert.equal(verdict("${NODE_VERSION}-alpine").status, "unresolved");
});

test("bare variants float; LTS codenames are judged as their major line", () => {
  for (const tag of ["alpine3.20", "alpine", "bookworm-slim", "lts", "current", "lts/*"]) assert.equal(verdict(tag).status, "floating", tag);
  const hydrogen = verdict("hydrogen-alpine3.18");
  assert.equal(hydrogen.status, "unknown", "no 18.x in this fixture's index");
  assert.equal(verdict("jod-alpine3.20").status, "current");
  assert.equal(verdict("jod-alpine3.20").resolved, "v22.23.4");
  assert.deepEqual([verdict("lts/iron", "version-file").resolved, verdict("lts/iron", "version-file").eol], ["v20.19.0", true], "lts/iron is Node 20, past its end in this schedule");
  const gallium = evaluatePin({ file: "f", kind: "docker", raw: "gallium-alpine3.16" }, RELEASES, { v16: { end: "2023-09-11" } }, TODAY);
  assert.equal(gallium.eol, true, "gallium is Node 16, past end of life");
});

test("workflowVersions reads scalars, inline and block lists, and the matrix a node-version points at", () => {
  const workflow = [
    "jobs:",
    "  a:",
    "    strategy:",
    "      matrix:",
    "        node: [20, '22.x']  # supported lines",
    "    steps:",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: ${{ matrix.node }}",
    "  b:",
    "    strategy:",
    "      matrix:",
    "        runtime:",
    "          - 24",
    "          - \"22.11\"",
    "    steps:",
    "      - with:",
    "          node-version: ${{ matrix.runtime }}",
    "      - with:",
    "          node-version: '18'",
    "      - with:",
    "          node-version:",
    "            - 21",
    "            - 23",
    "      - with:",
    "          node-version: ${{ matrix.nowhere }}",
  ].join("\n");
  assert.deepEqual(workflowVersions(workflow), ["20", "22.x", "24", "22.11", "18", "21", "23", "${{ matrix.nowhere }}"]);
});

test("a matrix reference resolves from its own job's matrix, never from another job or an env key", () => {
  const workflow = [
    "env:",
    "  node: foo",
    "jobs:",
    "  test:",
    "    env:",
    "      node: bar",
    "    strategy:",
    "      matrix:",
    "        node: [20, 22]",
    "    steps:",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: ${{ matrix.node }}",
    "  lint:",
    "    steps:",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: ${{ matrix.node }}",
    "  release:",
    "    strategy:",
    "      matrix:",
    "        node:",
    "          - 24",
    "    steps:",
    "      - with:",
    "          node-version: ${{ matrix.node }}",
  ].join("\n");
  assert.deepEqual(workflowVersions(workflow), ["20", "22", "${{ matrix.node }}", "24"]);
});

test("dockerVersions fills FROM node:${ARG} from the file's ARG defaults", () => {
  const dockerfile = [
    "ARG NODE_VERSION=22.11",
    "ARG VARIANT=\"alpine\"",
    "FROM node:${NODE_VERSION}-${VARIANT} AS build",
    "FROM node:$NODE_VERSION",
    "FROM node:${OTHER:-20}-slim",
    "FROM node:${UNSET}",
  ].join("\n");
  assert.deepEqual(dockerVersions(dockerfile), ["22.11-alpine", "22.11", "20-slim", "${UNSET}"]);
});

test("findPins reads Dockerfiles, workflow node-version, .nvmrc and engines, once per file and version", (t) => {
  const dir = freshDir(t);
  writeFileSync(join(dir, "Dockerfile"), "FROM node:22.11-alpine AS build\nRUN x\nFROM --platform=linux/amd64 node:22.11-alpine\n");
  mkdirSync(join(dir, "docker"));
  writeFileSync(join(dir, "docker", "worker.Dockerfile"), "FROM docker.io/library/node:20-slim\n");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "with:\n  node-version: '22'\n  other: x\n  node-version: ${{ matrix.node }}\n");
  writeFileSync(join(dir, ".nvmrc"), "v22.11.0\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ engines: { node: ">=22" } }));
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "x", "Dockerfile"), "FROM node:8\n");
  const pins = findPins(dir).map((p) => `${p.kind} ${p.file} ${p.raw}`).sort();
  assert.deepEqual(pins, [
    "ci .github/workflows/ci.yml ${{ matrix.node }}",
    "ci .github/workflows/ci.yml 22",
    "docker Dockerfile 22.11-alpine",
    "docker docker/worker.Dockerfile 20-slim",
    "engines package.json >=22",
    "version-file .nvmrc v22.11.0",
  ]);
});

// ---- Dependabot and the sibling clones ----

test("repoSlug reads https and ssh GitHub remotes", () => {
  assert.equal(repoSlug("https://github.com/juanagu/cmc-bff.git\n"), "juanagu/cmc-bff");
  assert.equal(repoSlug("git@github.com:juanagu/cmc-bff.git"), "juanagu/cmc-bff");
  assert.equal(repoSlug("https://gitlab.com/x/y.git"), null);
});

test("dependabotAlerts summarises each open alert and reports gh trouble as unavailable", () => {
  const alert = { number: 6, html_url: "u", dependency: { package: { name: "vitest", ecosystem: "npm" }, manifest_path: "package-lock.json", scope: "development" }, security_advisory: { severity: "critical", ghsa_id: "GHSA-5xrq-8626-4rwp", summary: "s" }, security_vulnerability: { vulnerable_version_range: "< 3.2.6", first_patched_version: { identifier: "3.2.6" } } };
  const runner = (cmd, args) => (cmd === "git" ? { status: 0, stdout: "https://github.com/o/r.git\n" } : { status: 0, stdout: `${JSON.stringify(alert)}\n`, args });
  const result = dependabotAlerts("x", runner);
  assert.equal(result.slug, "o/r");
  assert.deepEqual([result.alerts[0].package, result.alerts[0].scope, result.alerts[0].patched], ["vitest", "dev", "3.2.6"]);
  const forbidden = dependabotAlerts("x", (cmd) => (cmd === "git" ? { status: 0, stdout: "git@github.com:o/r.git" } : { status: 1, stdout: "", stderr: "HTTP 403" }));
  assert.match(forbidden.unavailable, /403/);
  assert.match(dependabotAlerts("x", () => ({ status: 2, stdout: "" })).unavailable, /no GitHub origin/);
});

test("--all takes a directory, not an option, and is not mixed with directories", (t) => {
  assert.throws(() => parseArgs(["--all", "--match", "cmc-"]), /--all needs a directory/);
  assert.throws(() => parseArgs(["--all", "../", "cmc-bff"]), /--all audits every clone under one folder; drop the directories named as well \(cmc-bff\)/);
  assert.throws(() => parseArgs(["--all", "../", "--match"]), /--match needs a prefix/);
  assert.deepEqual(parseArgs(["--all", "../", "--match", "cmc-"]), { dirs: [], all: "../", match: "cmc-", stamp: false });
});

test("the dirs named are checked before any is audited", (t) => {
  const dir = freshDir(t);
  assert.deepEqual(resolveDirs(parseArgs([dir])), [dir]);
  assert.throws(() => resolveDirs(parseArgs([dir, join(dir, "typo")])), /Not a directory: .*typo/);
  assert.throws(() => resolveDirs(parseArgs(["--all", join(dir, "nope")])), /--all: .* is not a directory/);
  assert.throws(() => parseArgs(["--all"]), /--all needs a directory/);
});

test("a repo whose audit throws is reported with its error, and the run goes on", async () => {
  const failing = await auditRepoSafely("/repo/a", null, async () => {
    throw new Error("EACCES reading Dockerfile");
  });
  assert.deepEqual(failing, { dir: "/repo/a", error: "EACCES reading Dockerfile" });
  assert.deepEqual(await auditRepoSafely("/repo/b", null, async (dir) => ({ dir, npm: {} })), { dir: "/repo/b", npm: {} });
});

test("a check that throws is reported on its own, and the repo's other checks still count", async () => {
  assert.deepEqual(await guarded("Node pins", () => {
    throw new Error("EACCES reading Dockerfile");
  }), { error: "Node pins failed: EACCES reading Dockerfile" });
  assert.deepEqual(await guarded("npm audit", async () => ({ source: "npm audit", findings: [] })), { source: "npm audit", findings: [] });
});

test("siblingRepos lists the git checkouts under a folder that match the prefix", (t) => {
  const parent = freshDir(t);
  for (const name of ["cmc-bff", "cmc-web", "other"]) mkdirSync(join(parent, name, ".git"), { recursive: true });
  mkdirSync(join(parent, "worktrees"));
  assert.deepEqual(siblingRepos(parent, "cmc-").map((dir) => dir.slice(parent.length + 1)), ["cmc-bff", "cmc-web"]);
});
