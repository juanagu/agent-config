import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkGitIdentity, identityMessage, identityProblem, noreplyAddress, parseGithubUser } from "../scripts/install/git-identity.mjs";
import { freshDir } from "./support/fixture-clone.mjs";

const GITHUB = { id: "1234", login: "octo" };
const NOREPLY = "1234+octo@users.noreply.github.com";

test("an unset email gets the warning and the command with the noreply address gh gave", () => {
  const message = identityMessage("unset", "", GITHUB);
  assert.match(message, /git has no global user\.email, so it may refuse to commit, or author commits as user@hostname/);
  assert.ok(message.includes(`git config --global user.email "${NOREPLY}"`), message);
  assert.doesNotMatch(message, /gh api user/);
});

test("without gh the command carries placeholders and says how to find the id and login", () => {
  const message = identityMessage("unset", "", null);
  assert.ok(message.includes(`git config --global user.email "<id>+<login>@users.noreply.github.com"`), message);
  assert.ok(message.includes("gh api user -q '.id,.login'"), message);
});

test("a machine default is named in the warning", () => {
  const message = identityMessage("machine", "juani@Juans-MacBook.local", GITHUB);
  assert.match(message, /user\.email is juani@Juans-MacBook\.local, a machine default/);
});

test("machine-made addresses are flagged; real, corporate and noreply ones are not", () => {
  for (const email of ["juani@Juans-MacBook.local", "juani@Juans-MacBook", "juani@box.localdomain", "juani"]) {
    assert.equal(identityProblem(email), "machine", email);
  }
  for (const email of ["me@juani.dev", "juani@example.com", "juani@corp.lan", "juani@acme.internal", noreplyAddress(GITHUB)]) {
    assert.equal(identityProblem(email), null, email);
  }
});

test("gh's answer is read with LF or CRLF line ends", () => {
  assert.deepEqual(parseGithubUser("1234\nocto\n"), GITHUB);
  assert.deepEqual(parseGithubUser("1234\r\nocto\r\n"), GITHUB);
  assert.equal(parseGithubUser(""), null);
});

// A home whose .gitconfig holds `gitconfig` (none when null), with gh faked as `github`.
function identitySetup(t, gitconfig, github = GITHUB) {
  const home = freshDir(t);
  const file = join(home, ".gitconfig");
  if (gitconfig !== null) writeFileSync(file, gitconfig);
  const warn = t.mock.method(console, "warn", () => {});
  const run = () => {
    checkGitIdentity(home, { findGithubUser: () => github });
    assert.equal(existsSync(file) ? readFileSync(file, "utf8") : null, gitconfig, "the check never writes .gitconfig");
    return warn.mock.calls.map((call) => call.arguments[0]);
  };
  return { home, run };
}

test("an unset email warns with the noreply command, filled in from gh or with placeholders", (t) => {
  assert.ok(identitySetup(t, null).run()[0].includes(`git config --global user.email "${NOREPLY}"`));
  t.mock.restoreAll();
  const [message] = identitySetup(t, "[core]\n\tautocrlf = false\n", null).run();
  assert.match(message, /has no global user\.email/);
  assert.match(message, /<id>\+<login>/);
});

test("a .local email is flagged and a real domain is not", (t) => {
  assert.match(identitySetup(t, "[user]\n\temail = juani@box.local\n").run()[0], /juani@box\.local, a machine default/);
  t.mock.restoreAll();
  assert.deepEqual(identitySetup(t, "[user]\n\temail = me@juani.dev\n").run(), []);
});

test("an email set in an included file counts as set", (t) => {
  const other = join(freshDir(t), "identity.gitconfig");
  writeFileSync(other, "[user]\n\temail = me@juani.dev\n");
  assert.deepEqual(identitySetup(t, `[include]\n\tpath = ${other.replaceAll("\\", "/")}\n`).run(), []);
});

test("user.useConfigOnly skips the check, even with no email", (t) => {
  assert.deepEqual(identitySetup(t, "[user]\n\tuseConfigOnly = true\n").run(), []);
});

test("a malformed .gitconfig is reported as not checked, naming git's error", (t) => {
  const messages = identitySetup(t, "[user\n").run();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /could not be checked \(.*bad config/);
});

test("when git cannot be run the check says so and does not throw", (t) => {
  const { run } = identitySetup(t, null);
  const path = process.env.PATH;
  process.env.PATH = freshDir(t);
  let messages;
  try {
    messages = run();
  } finally {
    process.env.PATH = path;
  }
  assert.equal(messages.length, 1);
  assert.match(messages[0], /user\.email could not be checked/);
});
