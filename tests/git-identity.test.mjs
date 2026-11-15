import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkGitIdentity, identityMessage, identityProblem, noreplyAddress, parseGithubUser } from "../scripts/install/git-identity.mjs";
import { createPrompter } from "../scripts/install/prompts.mjs";
import { freshDir } from "./support/fixture-clone.mjs";

const HOST = "Juans-MacBook.local";
const GITHUB = { id: "1234", login: "octo" };
const NOREPLY = "1234+octo@users.noreply.github.com";

test("an unset email gets the warning and the command with the noreply address gh gave", () => {
  const message = identityMessage("unset", "", GITHUB);
  assert.match(message, /git has no global user\.email/);
  assert.ok(message.includes(`git config --global user.email "${NOREPLY}"`), message);
  assert.doesNotMatch(message, /gh api user/);
});

test("without gh the command carries placeholders and says how to find the id and login", () => {
  const message = identityMessage("unset", "", null);
  assert.ok(message.includes(`git config --global user.email "<id>+<login>@users.noreply.github.com"`), message);
  assert.ok(message.includes("gh api user -q '.id,.login'"), message);
});

test("a hostname default is named in the warning", () => {
  const message = identityMessage("hostname", `juani@${HOST}`, GITHUB);
  assert.match(message, /user\.email is juani@Juans-MacBook\.local, a hostname default/);
});

test("hostname-shaped addresses are flagged; real, corporate and noreply ones are not", () => {
  const flagged = ["juani@Juans-MacBook.local", "juani@Juans-MacBook", "juani@box.localdomain", "juani@juans-macbook", "juani"];
  for (const email of flagged) assert.equal(identityProblem(email, HOST), "hostname", email);
  // A Linux FQDN: the domain starts with the short hostname.
  assert.equal(identityProblem("juani@myhost.fritz.box", "myhost"), "hostname");
  assert.equal(identityProblem("juani@myhost.fritz.box", "myhost.fritz.box"), "hostname");
  for (const email of ["juani@example.com", "juani@corp.lan", "juani@acme.internal", "juani@myhostess.com", noreplyAddress(GITHUB)]) {
    assert.equal(identityProblem(email, "myhost"), null, email);
  }
});

test("gh's answer is read with LF or CRLF line ends", () => {
  assert.deepEqual(parseGithubUser("1234\nocto\n"), GITHUB);
  assert.deepEqual(parseGithubUser("1234\r\nocto\r\n"), GITHUB);
  assert.equal(parseGithubUser(""), null);
});

// A home with a hostname-default .gitconfig, a prompter on its own answers file, and gh faked.
function identitySetup(t, { yes = false, saved } = {}) {
  const home = freshDir(t);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\temail = juani@localhost\n");
  const file = join(home, ".config", "agent-config", "config-install.json");
  if (saved) {
    mkdirSync(join(home, ".config", "agent-config"), { recursive: true });
    writeFileSync(file, JSON.stringify(saved));
  }
  const prompter = createPrompter({ file, yes, noOptional: false, ask: false });
  const warn = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
  const run = () => checkGitIdentity(home, prompter, { yes, findGithubUser: () => GITHUB });
  const gitconfig = () => readFileSync(join(home, ".gitconfig"), "utf8");
  return { run, gitconfig, warn };
}

test("--yes warns but never changes git's global user.email", async (t) => {
  const { run, gitconfig, warn } = identitySetup(t, { yes: true });
  await run();
  assert.match(gitconfig(), /juani@localhost/);
  assert.match(warn.mock.calls[0].arguments[0], new RegExp(NOREPLY.replace(/[.+]/g, "\\$&")));
});

test("--yes leaves git alone even after a saved yes; a saved no is respected without --yes", async (t) => {
  const yes = identitySetup(t, { yes: true, saved: { gitIdentity: true } });
  await yes.run();
  assert.match(yes.gitconfig(), /juani@localhost/);

  const no = identitySetup(t, { saved: { gitIdentity: false } });
  await no.run();
  assert.match(no.gitconfig(), /juani@localhost/);
});

test("a saved yes sets the noreply address in the home's .gitconfig", async (t) => {
  const { run, gitconfig } = identitySetup(t, { saved: { gitIdentity: true } });
  await run();
  assert.match(gitconfig(), new RegExp(NOREPLY.replace(/[.+]/g, "\\$&")));
});

test("when git cannot be run the check says so and does not throw", async (t) => {
  const { run, warn } = identitySetup(t);
  const empty = freshDir(t);
  const path = process.env.PATH;
  process.env.PATH = empty;
  try {
    await run();
  } finally {
    process.env.PATH = path;
  }
  assert.equal(warn.mock.calls.length, 1);
  assert.match(warn.mock.calls[0].arguments[0], /git could not be run/);
  assert.doesNotMatch(warn.mock.calls[0].arguments[0], /has no global user\.email/);
});
