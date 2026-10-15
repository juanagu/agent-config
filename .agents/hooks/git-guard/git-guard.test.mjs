// Run with: node --test .agents/hooks/git-guard/git-guard.test.mjs
// Builds two throwaway repos (one listed as protected) and drives the hook the way each tool does: its
// payload on stdin, then the rules through Claude Code's dialect (exit 0 allows, exit 2 blocks) and each
// other tool's deny JSON once per tool.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { worktreeRecipe } from "./git-guard.mjs";

const HOOK = path.join(import.meta.dirname, "git-guard.mjs");
const onWindows = process.platform === "win32";

let home;
let protectedRepo;
let plainRepo;

function sh(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRepo(root, name, trunk = "main") {
  const dir = path.join(root, name);
  mkdirSync(dir);
  sh(dir, ["init", "-q", "-b", trunk]);
  sh(dir, ["config", "user.email", "t@example.com"]);
  sh(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  sh(dir, ["add", "."]);
  sh(dir, ["commit", "-q", "-m", "init"]);
  sh(dir, ["branch", "feat/x"]);
  return dir;
}

const configFile = () => path.join(home, ".config", "agent-config", "git-guard.json");

function posix(p) {
  return p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, "/");
}

// Drives the hook with a raw payload (a string is sent as is, so a broken one can be tested) for one tool.
function runRaw(payload, tool, env = {}) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const args = tool ? [HOOK, "--tool", tool] : [HOOK];
  const result = spawnSync(process.execPath, args, {
    input,
    encoding: "utf8",
    env: { ...process.env, GIT_GUARD_HOME: home, GIT_GUARD_CONFIG: "", ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(command, cwd, toolName = "Bash") {
  return runRaw({ tool_name: toolName, cwd, tool_input: { command } });
}

function blocked(command, cwd, toolName) {
  const r = run(command, cwd, toolName);
  assert.equal(r.code, 2, `expected block for "${command}", got ${r.code}\n${r.stderr}`);
  assert.match(r.stderr, /^git-guard: /);
}

function allowed(command, cwd, toolName) {
  const r = run(command, cwd, toolName);
  assert.equal(r.code, 0, `expected allow for "${command}", got ${r.code}\n${r.stderr}`);
}

function onBranch(repo, fn) {
  sh(repo, ["switch", "-q", "feat/x"]);
  try {
    fn();
  } finally {
    sh(repo, ["switch", "-q", "main"]);
  }
}

before(() => {
  home = mkdtempSync(path.join(tmpdir(), "git-guard-"));
  protectedRepo = makeRepo(home, "served");
  plainRepo = makeRepo(home, "plain");
  mkdirSync(path.join(home, ".config", "agent-config"), { recursive: true });
  writeFileSync(configFile(), JSON.stringify({ protectedCheckouts: [protectedRepo] }));
});

after(() => rmSync(home, { recursive: true, force: true }));

describe("trunk protection (any repo)", () => {
  it("blocks a commit on trunk", () => blocked("git commit -m x", plainRepo));
  it("blocks a commit on trunk inside a compound command", () => blocked("git add . && git commit -m x", plainRepo));
  it("blocks a local merge on trunk", () => blocked("git merge feat/x", plainRepo));
  it("blocks an implicit push while on trunk", () => blocked("git push", plainRepo));
  it("blocks a push naming trunk", () => blocked("git push origin main", plainRepo));
  it("blocks a force-push naming trunk", () => blocked("git push --force origin main", plainRepo));
  it("blocks the + force refspec and refs/heads/ forms", () => {
    blocked("git push origin +main", plainRepo);
    blocked("git push origin refs/heads/main", plainRepo);
    blocked("git push origin HEAD:main", plainRepo);
  });
  it("blocks deleting the remote trunk", () => blocked("git push origin --delete main", plainRepo));
  it("blocks --all and --mirror", () => {
    blocked("git push --all origin", plainRepo);
    blocked("git push --mirror origin", plainRepo);
  });
  it("blocks --no-verify anywhere", () => blocked("git commit --no-verify -m x", plainRepo));
  it("blocks commit -n on a branch too", () => onBranch(plainRepo, () => blocked("git commit -n -m x", plainRepo)));
  it("allows push -n (dry run) on a branch", () => onBranch(plainRepo, () => allowed("git push -n origin feat/x", plainRepo)));
  it("allows pushing only tags from trunk", () => allowed("git push --tags", plainRepo));
  it("allows a commit on a branch, and a branch push", () =>
    onBranch(plainRepo, () => {
      allowed("git commit -m x", plainRepo);
      allowed("git push -u origin feat/x", plainRepo);
      allowed("git push --force-with-lease origin feat/x", plainRepo);
    }));
  it("allows creating a branch and committing in one command", () => {
    allowed("git switch -c feat/y && git commit -m x", plainRepo);
    allowed("git checkout -b feat/y && git commit -m x && git push -u origin feat/y", plainRepo);
  });
  it("allows deleting a remote branch", () => allowed("git push origin --delete feat/x", plainRepo));
  it("blocks push origin @ and HEAD~0 while on trunk", () => {
    blocked("git push origin @", plainRepo);
    blocked("git push origin HEAD~0:main", plainRepo);
  });
  it("blocks cherry-pick, rebase and revert on trunk", () => {
    blocked("git cherry-pick feat/x", plainRepo);
    blocked("git rebase feat/x", plainRepo);
    blocked("git revert HEAD", plainRepo);
  });
  it("blocks -c overrides that disable hooks or signing", () =>
    onBranch(plainRepo, () => {
      blocked("git -c core.hooksPath=/dev/null commit -m x", plainRepo);
      blocked("git -c commit.gpgsign=false commit -m x", plainRepo);
      allowed("git -c user.name=t commit -m x", plainRepo);
    }));
  it("does not read shell separators or flags inside a quoted commit message", () =>
    onBranch(plainRepo, () => {
      allowed('git commit -m "chore: block --no-verify; add tests"', plainRepo);
      allowed("git commit -m 'fix: a | b && git push origin main'", plainRepo);
    }));
  it("does not read a heredoc body as commands", () =>
    onBranch(plainRepo, () => {
      allowed("git commit -q -F - <<'EOF'\nfeat: x\n\ngit push origin main\n--no-verify\nEOF\ngit status", plainRepo);
    }));
  it("falls back to master when origin/HEAD is unknown", () => {
    const repo = makeRepo(home, "master-repo", "master");
    sh(repo, ["switch", "-q", "feat/x"]);
    blocked("git push origin master", repo);
    blocked("git push origin HEAD:master", repo);
    allowed("git push origin feat/x", repo);
  });
  it("allows read-only git", () => allowed("git status && git log --oneline -5", plainRepo));
  it("honours git -C <dir>", () => blocked(`git -C "${plainRepo}" commit -m x`, home));
  it("honours cd in a compound command", () => blocked(`cd "${plainRepo}" && git commit -m x`, home));
  it("applies to the PowerShell tool", () => {
    blocked("git commit -m x", plainRepo, "PowerShell");
    blocked(`Set-Location '${plainRepo}'; git commit -m x`, home, "PowerShell");
  });
  it("understands Git Bash paths on Windows", { skip: !onWindows }, () => {
    blocked(`cd ${posix(plainRepo)} && git commit -m x`, home);
    blocked(`git -C ${posix(plainRepo)} commit -m x`, home);
    blocked("git commit -m x", posix(plainRepo));
  });
});

describe("branch switching in a protected checkout", () => {
  it("blocks git switch", () => blocked("git switch feat/x", protectedRepo));
  it("blocks git checkout <branch>", () => blocked("git checkout feat/x", protectedRepo));
  it("blocks git checkout -b and switch -c", () => {
    blocked("git checkout -b feat/y", protectedRepo);
    blocked("git switch -c feat/y", protectedRepo);
  });
  it("allows restoring files with --", () => allowed("git checkout -- a.txt", protectedRepo));
  it("allows restoring a path that is not a ref", () => allowed("git checkout a.txt", protectedRepo));
  it("allows restoring a path from a ref", () => allowed("git checkout HEAD a.txt", protectedRepo));
  it("blocks switching back with -", () => {
    blocked("git switch -", protectedRepo);
    blocked("git checkout -", protectedRepo);
  });
  it("blocks checking out a branch that exists only on origin, and --orphan", () => {
    sh(protectedRepo, ["update-ref", "refs/remotes/origin/feat/remote", "HEAD"]);
    blocked("git checkout feat/remote", protectedRepo);
    blocked("git checkout feat/not-anywhere", protectedRepo);
    blocked("git checkout --orphan fresh", protectedRepo);
  });
  it("allows switching in a repo that is not protected", () => allowed("git switch feat/x", plainRepo));
  it("blocks gh pr checkout, which switches the branch without saying git", () => {
    blocked("gh pr checkout 99", protectedRepo);
    blocked("gh co 99", protectedRepo);
    blocked("gh pr checkout", protectedRepo);
    blocked("gh pr checkout 99 --detach", protectedRepo);
    blocked("gh -R owner/repo pr checkout 99 -b mine", protectedRepo);
    blocked("gh --repo owner/repo pr checkout 99", protectedRepo);
    blocked(`cd "${protectedRepo}" && gh pr checkout 99`, home);
  });
  it("allows gh pr checkout in a plain repo, and what follows it runs on the PR branch", () => {
    allowed("gh pr checkout 99", plainRepo);
    allowed("gh pr checkout 99 && git commit -m x && git push", plainRepo);
    allowed("gh pr list && gh pr view 99", protectedRepo);
  });
  it("follows pushd, Push-Location and the -Path forms into a protected checkout", () => {
    blocked(`pushd "${protectedRepo}" && git checkout feat/x`, home);
    blocked(`Push-Location '${protectedRepo}'; git checkout feat/x`, home, "PowerShell");
    blocked(`Push-Location -Path '${protectedRepo}'; gh pr checkout 99`, home, "PowerShell");
    blocked(`Set-Location -LiteralPath '${protectedRepo}'; git switch feat/x`, home, "PowerShell");
  });
  it("names the trunk it found in the worktree recipe", () => {
    const repo = makeRepo(home, "served-master", "master");
    const config = configFile();
    const before = readFileSync(config, "utf8");
    writeFileSync(config, JSON.stringify({ protectedCheckouts: [protectedRepo, repo] }));
    try {
      const r = run("git switch feat/x", repo);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /origin\/master/);
    } finally {
      writeFileSync(config, before);
    }
  });
  it("tracks a bare Push-Location, which pushes the current location and stays", () => {
    blocked(`Push-Location; Push-Location '${home}'; Pop-Location; git checkout feat/x`, protectedRepo, "PowerShell");
    allowed(`Push-Location '${home}'; Push-Location; git checkout feat/x`, protectedRepo, "PowerShell");
  });
  it("blocks git stash branch, which switches too", () => {
    blocked("git stash branch feat/y stash@{0}", protectedRepo);
    allowed("git stash branch feat/y stash@{0}", plainRepo);
  });
  it("blocks a stash push, save, pop or apply, which rewrite the served working tree", () => {
    blocked("git stash push -u -m wip", protectedRepo);
    blocked("git stash save wip", protectedRepo);
    blocked("git stash apply stash@{0}", protectedRepo);
    blocked("git stash pop stash@{0}", protectedRepo);
    allowed("git stash push -u -m wip && git stash apply stash@{0}", plainRepo);
  });
  it("allows the stash forms that leave the served tree alone, and points a bare stash at them", () => {
    allowed("git stash list && git stash show stash@{0}", protectedRepo);
    allowed("git stash create && git stash store -m wip deadbeef", protectedRepo);
    allowed("git stash --help && git stash -h", protectedRepo);
    for (const form of ["git stash", "git stash -u", "git stash -p", "git stash pop", "git stash apply"]) {
      const r = run(form, protectedRepo);
      assert.equal(r.code, 2, form);
      assert.match(r.stderr, /git stash create, then git stash store -m <tag> <sha>/, form);
    }
    blocked("git stash push -m -h", protectedRepo);
    allowed("git stash -u -m --help", plainRepo);
  });
  it("follows popd, Pop-Location and cd - back out of, and into, a protected checkout", () => {
    allowed(`pushd "${protectedRepo}" && popd && git checkout feat/x`, home);
    blocked(`pushd "${home}" && popd && git checkout feat/x`, protectedRepo);
    blocked(`cd "${home}" && cd - && git checkout feat/x`, protectedRepo);
    allowed(`Push-Location '${protectedRepo}'; Pop-Location; git checkout feat/x`, home, "PowerShell");
  });
  it("recognises git.exe and gh.exe", () => {
    blocked("gh.exe pr checkout 99", protectedRepo, "PowerShell");
    blocked("git.exe commit -m x", plainRepo, "PowerShell");
  });
});

describe("a branch whose upstream is trunk", () => {
  it("blocks a bare push, and allows one that names the branch", () => {
    const repo = makeRepo(home, "tracks-trunk");
    sh(repo, ["switch", "-q", "feat/x"]);
    sh(repo, ["branch", "--set-upstream-to=main"]);
    blocked("git push", repo);
    blocked("git push origin", repo);
    allowed("git push -u origin feat/x", repo);
    sh(repo, ["switch", "-q", "main"]);
    blocked("git switch feat/x && git push", repo);
    sh(repo, ["switch", "-q", "feat/x"]);
  });
  it("tells the safe form", () => {
    const r = run("git push", path.join(home, "tracks-trunk"));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /git push -u origin <branch>/);
  });
});

describe("stash (any repo)", () => {
  it("blocks a bare stash, with or without flags", () => {
    blocked("git stash", plainRepo);
    blocked("git stash -u", plainRepo);
    blocked("git stash push", plainRepo);
    blocked("git stash push -u", plainRepo);
  });
  it("blocks pop, apply, drop and branch without a stash reference, and clear", () => {
    blocked("git stash pop", plainRepo);
    blocked("git stash apply", plainRepo);
    blocked("git stash drop", plainRepo);
    blocked("git stash branch feat/y", plainRepo);
    blocked("git stash clear", plainRepo);
  });
  it("allows the help forms", () => {
    allowed("git stash --help", plainRepo);
    allowed("git stash -h", plainRepo);
  });
  it("blocks stash save and stash store without a message", () => {
    blocked("git stash save", plainRepo);
    blocked("git stash store deadbeef", plainRepo);
    allowed("git stash store -m wip deadbeef", plainRepo);
  });
  it("reads a message that happens to be an action word as the message", () => {
    allowed("git stash -u -m pop", plainRepo);
    allowed("git stash push --message clear", plainRepo);
  });
  it("allows a tagged push, an attached message, and any action naming its entry", () => {
    allowed("git stash push -u -m wip-review", plainRepo);
    allowed("git stash push --message=wip", plainRepo);
    allowed("git stash -um wip", plainRepo);
    allowed("git stash -mwip", plainRepo);
    allowed("git stash save wip", plainRepo);
    allowed("git stash apply stash@{0}", plainRepo);
    allowed("git stash pop stash@{2} && git stash drop stash@{1}", plainRepo);
    allowed("git stash list --format='%H %s' && git stash show -p stash@{1}", plainRepo);
  });
  it("names the safe form in the reason, with a command that prints hashes", () => {
    const r = run("git stash", plainRepo);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /git stash push -u -m <tag>/);
    assert.match(r.stderr, /--format='%H %s'/);
  });
});

describe("fail open", () => {
  it("ignores non-git commands", () => allowed("npm test", plainRepo));
  it("ignores other tools", () => allowed("git commit -m x", plainRepo, "Read"));
  it("allows on malformed input", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    assert.equal(r.status, 0);
  });
  it("allows outside a repository", () => allowed("git commit -m x", home));
  it("still refuses the unsafe stash forms where the repo cannot be located", () => {
    blocked("git stash", home);
    blocked('cd "$REPO" && git stash pop', home);
  });
});

describe("the worktree recipe", () => {
  it("is quoted verbatim in AGENTS.md, so the hook's message and the rule cannot drift", () => {
    const standards = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "AGENTS.md"), "utf8");
    assert.ok(standards.includes(worktreeRecipe("main")), `AGENTS.md does not contain: ${worktreeRecipe("main")}`);
  });
});

describe("where the protected checkouts are read from", () => {
  it("names the config file and the standards in the block message", () => {
    const r = run("git switch feat/x", protectedRepo);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /~\/\.config\/agent-config\/git-guard\.json/);
    assert.match(r.stderr, /\(AGENTS\.md, Workflow\)/);
  });
  it("falls back to the file claude-code-config wrote when the current one is absent", () => {
    const current = configFile();
    const legacy = path.join(home, ".claude", "git-guard.json");
    const saved = readFileSync(current, "utf8");
    rmSync(current);
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, saved);
    try {
      blocked("git switch feat/x", protectedRepo);
    } finally {
      writeFileSync(current, saved);
      rmSync(legacy);
    }
  });
  it("lets GIT_GUARD_CONFIG name the file", () => {
    const other = path.join(home, "elsewhere.json");
    writeFileSync(other, JSON.stringify({ protectedCheckouts: [plainRepo] }));
    const r = runRaw({ tool_name: "Bash", cwd: plainRepo, tool_input: { command: "git switch feat/x" } }, null, { GIT_GUARD_CONFIG: other });
    assert.equal(r.code, 2, r.stderr);
    const unaffected = runRaw({ tool_name: "Bash", cwd: protectedRepo, tool_input: { command: "git switch feat/x" } }, null, { GIT_GUARD_CONFIG: other });
    assert.equal(unaffected.code, 0, unaffected.stderr);
  });
});

// One suite per tool dialect: the same rules, read from that tool's payload and answered in its shape.
// BLOCK is a command the protected repo refuses; PASS is one every repo allows.
const BLOCK = "git switch feat/x";
const PASS = "git status";
const DIALECTS = [
  {
    tool: "cursor",
    shell: (command, cwd) => ({ command, cwd }),
    other: () => null,
    deny: (reason) => ({ continue: true, permission: "deny", user_message: reason, agent_message: reason }),
  },
  {
    tool: "copilot",
    shell: (command, cwd) => ({ toolName: "bash", toolArgs: { command }, cwd }),
    other: (cwd) => ({ toolName: "edit", toolArgs: { command: BLOCK }, cwd }),
    deny: (reason) => ({ permissionDecision: "deny", permissionDecisionReason: reason }),
  },
  {
    tool: "antigravity",
    shell: (command, cwd) => ({ toolCall: { name: "run_command", args: { CommandLine: command, Cwd: cwd } }, workspacePaths: [home] }),
    other: (cwd) => ({ toolCall: { name: "view_file", args: { CommandLine: BLOCK, Cwd: cwd } }, workspacePaths: [cwd] }),
    deny: (reason) => ({ decision: "deny", reason }),
  },
];

for (const d of DIALECTS) {
  describe(`the ${d.tool} dialect`, () => {
    it("denies in the tool's JSON, with the reason, exit 0", () => {
      const r = runRaw(d.shell(BLOCK, protectedRepo), d.tool);
      assert.equal(r.code, 0, r.stderr);
      const answer = JSON.parse(r.stdout);
      const reason = Object.values(answer).find((v) => typeof v === "string" && v.startsWith("git-guard: "));
      assert.ok(reason, `no reason in ${r.stdout}`);
      assert.match(reason, /serves a running dev server/);
      assert.deepEqual(answer, d.deny(reason));
      assert.equal(r.stderr, "");
    });
    it("allows with exit 0 and nothing on stdout", () => {
      const r = runRaw(d.shell(PASS, protectedRepo), d.tool);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, "");
    });
    if (d.other(protectedRepo)) {
      it("ignores a call to a tool that is not the shell", () => {
        const r = runRaw(d.other(protectedRepo), d.tool);
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stdout, "");
      });
    }
    it("fails open on a payload that does not parse", () => {
      const r = runRaw("{not json", d.tool);
      assert.equal(r.code, 0);
      assert.equal(r.stdout, "");
    });
  });
}

describe("the copilot PascalCase form and string arguments", () => {
  it("reads the Claude-shaped payload Copilot sends under PreToolUse", () => {
    const r = runRaw({ tool_name: "Bash", tool_input: { command: BLOCK }, cwd: protectedRepo }, "copilot");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).permissionDecision, "deny");
  });
  it("reads toolArgs handed over as a JSON string", () => {
    const r = runRaw({ toolName: "powershell", toolArgs: JSON.stringify({ command: BLOCK }), cwd: protectedRepo }, "copilot");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).permissionDecision, "deny");
  });
});

describe("the antigravity working directory", () => {
  it("falls back to the first workspace path when the call names no Cwd", () => {
    const r = runRaw({ toolCall: { name: "run_command", args: { CommandLine: BLOCK } }, workspacePaths: [protectedRepo] }, "antigravity");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).decision, "deny");
  });
});

describe("an unknown tool, and a broken payload for claude", () => {
  it("fails open on a tool the hook does not know", () => {
    const r = runRaw({ tool_name: "Bash", tool_input: { command: BLOCK }, cwd: protectedRepo }, "codex");
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
  });
  it("fails open on a payload that does not parse", () => {
    const r = runRaw("{not json", null);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
  });
});
