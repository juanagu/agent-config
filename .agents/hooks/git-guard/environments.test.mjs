// Run with: node --test .agents/hooks/git-guard/environments.test.mjs
// Drives the hook with a made-up CLI declared under protectedEnvironments, the way git-guard.test.mjs drives
// the git rules: the payload on stdin, exit 0 to allow and exit 2 to block in Claude Code's dialect.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

const HOOK = path.join(import.meta.dirname, "git-guard.mjs");
const CLI = {
  command: "fakecloud",
  environmentFlags: ["--environment", "-e"],
  protected: ["production"],
  readOnly: ["status", "logs", "variables list"],
};

let home;
let cwd;

function writeConfig(config) {
  writeFileSync(path.join(home, ".config", "agent-config", "git-guard.json"), JSON.stringify(config));
}

function run(command, tool = "claude") {
  const payload = tool === "cursor" ? { command, cwd } : { tool_name: "Bash", cwd, tool_input: { command } };
  return spawnSync(process.execPath, [HOOK, "--tool", tool], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, GIT_GUARD_HOME: home, GIT_GUARD_CONFIG: "" },
  });
}

function blocked(command) {
  const r = run(command);
  assert.equal(r.status, 2, `expected block for "${command}", got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /^git-guard: /);
  return r.stderr;
}

function allowed(command) {
  const r = run(command);
  assert.equal(r.status, 0, `expected allow for "${command}", got ${r.status}\n${r.stderr}`);
}

before(() => {
  home = mkdtempSync(path.join(tmpdir(), "env-guard-"));
  cwd = path.join(home, "project");
  mkdirSync(cwd);
  mkdirSync(path.join(home, ".config", "agent-config"), { recursive: true });
  writeConfig({ protectedEnvironments: [CLI] });
});

after(() => rmSync(home, { recursive: true, force: true }));

describe("a declared CLI aimed at a protected environment", () => {
  it("blocks a flag naming it", () => {
    const reason = blocked("fakecloud up --environment production");
    assert.match(reason, /targets production, a protected environment/);
    assert.match(reason, /Only status, logs, variables list run there/);
  });
  it("blocks the short flag and the --flag=value form", () => {
    blocked("fakecloud ssh -e production");
    blocked("fakecloud deploy --environment=production");
  });
  it("matches the environment name in any case", () => blocked("fakecloud up -e Production"));
  it("blocks a subcommand the config never named (deny by default)", () => blocked("fakecloud brand-new-thing -e production"));
  it("allows the read-only subcommands there", () => {
    allowed("fakecloud status -e production");
    allowed("fakecloud logs --environment=production --tail");
    allowed("fakecloud variables list -e production");
  });
  it("matches a read-only entry of several words as a whole", () => blocked("fakecloud variables set KEY=v -e production"));
  it("allows help and version", () => {
    allowed("fakecloud up --help -e production");
    allowed("fakecloud help up");
    allowed("fakecloud --version");
  });
});

describe("a declared CLI that names no environment", () => {
  it("blocks anything outside the read-only list, saying how to name one", () => {
    const reason = blocked("fakecloud up");
    assert.match(reason, /names no environment/);
    assert.match(reason, /--environment <environment>/);
  });
  it("allows the read-only subcommands", () => allowed("fakecloud logs"));
});

describe("a declared CLI aimed at a non-protected environment", () => {
  it("allows any subcommand", () => {
    allowed("fakecloud up -e staging");
    allowed("fakecloud ssh --environment=preview");
  });
  it("blocks when one of several named environments is protected", () => blocked("fakecloud promote -e staging -e production"));
});

describe("the shell forms around the CLI", () => {
  it("blocks it inside a compound command", () => {
    blocked("npm run build && fakecloud up -e production");
    blocked("cd sub; fakecloud up");
    blocked("fakecloud logs | grep x; fakecloud up -e production");
  });
  it("reads past an rtk prefix, env assignments, a directory and .exe", () => {
    blocked("rtk fakecloud up -e production");
    blocked("TOKEN=x fakecloud up -e production");
    blocked("/usr/local/bin/fakecloud up -e production");
    blocked("fakecloud.exe up -e production");
  });
  it("does not read the CLI's name inside a quoted argument", () => allowed('echo "fakecloud up -e production"'));
  it("leaves other programs alone", () => allowed("othercloud up -e production"));
});

describe("the other dialects", () => {
  it("answers Cursor with its deny object", () => {
    const r = run("fakecloud up -e production", "cursor");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).permission, "deny");
  });
});

describe("the config", () => {
  it("changes nothing without a protectedEnvironments key", () => {
    writeConfig({ protectedCheckouts: [] });
    try {
      allowed("fakecloud up -e production");
    } finally {
      writeConfig({ protectedEnvironments: [CLI] });
    }
  });
  it("skips a malformed entry and still applies the well-formed ones", () => {
    writeConfig({ protectedEnvironments: [{ command: "broken" }, "nonsense", CLI] });
    try {
      allowed("broken up");
      blocked("fakecloud up -e production");
    } finally {
      writeConfig({ protectedEnvironments: [CLI] });
    }
  });
  it("blocks every subcommand outside help when an entry lists no readOnly", () => {
    writeConfig({ protectedEnvironments: [{ ...CLI, readOnly: undefined }] });
    try {
      blocked("fakecloud status -e production");
      allowed("fakecloud status -e staging");
    } finally {
      writeConfig({ protectedEnvironments: [CLI] });
    }
  });
});
