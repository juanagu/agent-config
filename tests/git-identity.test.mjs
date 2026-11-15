import { test } from "node:test";
import assert from "node:assert/strict";
import { identityMessage, identityProblem, noreplyAddress } from "../scripts/install/git-identity.mjs";

const HOST = "Juans-MacBook.local";
const GITHUB = { id: "1234", login: "octo" };

test("an unset email gets the warning and the command with the noreply address gh gave", () => {
  const message = identityMessage("", GITHUB, HOST);
  assert.match(message, /git has no global user\.email/);
  assert.ok(message.includes(`git config --global user.email "1234+octo@users.noreply.github.com"`), message);
  assert.doesNotMatch(message, /gh api user/);
});

test("without gh the command carries placeholders and says how to find the id and login", () => {
  const message = identityMessage("", null, HOST);
  assert.ok(message.includes(`git config --global user.email "<id>+<login>@users.noreply.github.com"`), message);
  assert.ok(message.includes("gh api user -q '.id,.login'"), message);
});

test("a hostname default is named in the warning", () => {
  const message = identityMessage(`juani@${HOST}`, GITHUB, HOST);
  assert.match(message, /user\.email is juani@Juans-MacBook\.local, a hostname default/);
});

test("hostname-shaped addresses are flagged; real and noreply ones are not", () => {
  for (const email of ["juani@Juans-MacBook.local", "juani@Juans-MacBook", "juani@box.localdomain", "juani@juans-macbook", "juani"]) {
    assert.equal(identityProblem(email, HOST), "hostname", email);
  }
  for (const email of ["juani@example.com", noreplyAddress(GITHUB)]) {
    assert.equal(identityProblem(email, HOST), null, email);
    assert.equal(identityMessage(email, GITHUB, HOST), null, email);
  }
});
