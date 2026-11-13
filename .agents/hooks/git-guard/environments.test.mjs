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
  command: ["fakecloud", "@fake/cloud-cli"],
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
  it("reads a quoted value and a short flag's attached value", () => {
    blocked('fakecloud up --environment="production"');
    blocked("fakecloud up --environment='production'");
    blocked('fakecloud up -e "production"');
    blocked("fakecloud up -eproduction -e staging");
  });
  it("does not let help after -- stand for the CLI's own help", () => {
    blocked("fakecloud run -e production -- du -h");
    allowed("fakecloud run -e staging -- du -h");
  });
  it("does not read a help flag passed to the program the CLI runs", () => {
    blocked("fakecloud run -e production psql -h db");
    blocked("fakecloud run psql -h");
  });
  it("does not read an environment flag after -- as the CLI's own", () => blocked("fakecloud run -- foo -e staging"));
  it("does not read an option's value as a read-only subcommand", () => blocked("fakecloud --service logs up -e production"));
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
  it("counts a flag left without a value as naming none", () => blocked("fakecloud up -e"));
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
  it("finds it after a background &, in a subshell, a substitution and backticks", () => {
    blocked("npm run build & fakecloud up -e production");
    blocked("(fakecloud up -e production)");
    blocked("echo $(fakecloud up -e production)");
    blocked("echo `fakecloud up -e production`");
    blocked("& fakecloud up -e production");
    blocked("fakecloud up -e production&fakecloud logs");
    blocked("othercloud x&fakecloud up");
    allowed("fakecloud up -e staging 2>&1 && fakecloud logs &> out.txt");
    blocked('echo "$(fakecloud up)"');
    blocked('x="$(fakecloud up -e production)"');
    allowed("fakecloud up -e staging & othercloud down");
  });
  it("finds it behind a wrapper and inside a shell's -c string", () => {
    blocked("sudo fakecloud up -e production");
    blocked("sudo -E env TOKEN=x fakecloud up -e production");
    blocked("time fakecloud up -e production");
    blocked("npx -y fakecloud up -e production");
    blocked("npx @fake/cloud-cli up");
    blocked("sudo -u me fakecloud up");
    blocked("env -u VAR fakecloud up");
    blocked("bash -e -c 'fakecloud up'");
    blocked("bash --norc -lc 'fakecloud up'");
    blocked("pwsh -NoProfile -Command 'fakecloud up'");
    blocked('cmd /c "fakecloud up"');
    blocked('bash -c "fakecloud up -e production"');
    blocked("pwsh -Command 'cd x; fakecloud up -e production'");
    allowed('bash -c "fakecloud logs -e production"');
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
  it("skips an entry with no environment flags", () => {
    writeConfig({ protectedEnvironments: [{ ...CLI, environmentFlags: [] }] });
    try {
      allowed("fakecloud up -e staging");
    } finally {
      writeConfig({ protectedEnvironments: [CLI] });
    }
  });
  it("still applies when protectedCheckouts is malformed", () => {
    writeConfig({ protectedCheckouts: "not-a-list", protectedEnvironments: [CLI] });
    try {
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
