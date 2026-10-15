#!/usr/bin/env bash
# Builds a sandbox PR for the resolve-pr-comments evals: setup.sh <target-dir>
# The repo is on the PR branch with origin as a local bare repo; gh-fixtures/ stands in for gh's output.
set -euo pipefail
# The sandbox ignores the caller's git config and hooks: signing or a global pre-push would break or change it.
unset GIT_DIR GIT_WORK_TREE
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
target="$1"
# A fresh target only: re-running into an old sandbox would keep its refs and pushes.
if [ -e "$target" ]; then echo "setup.sh: $target already exists; pass a new directory" >&2; exit 1; fi
mkdir -p "$target"; cd "$target"
git init -q --bare origin.git
git init -q -b main repo; cd repo
git config user.email eval@example.com; git config user.name eval
git remote add origin ../origin.git
cat > package.json <<'EOF'
{ "name": "invites-api", "private": true, "type": "module", "scripts": { "test": "node --test" } }
EOF
mkdir -p src test
printf 'export class NotFound extends Error {}\nexport class Expired extends Error {}\n' > src/errors.js
git add -A; git commit -qm "chore: initial commit"; git push -q -u origin main

git checkout -qb feat/accept-invite
cat > src/accept-invite.js <<'EOF'
import { NotFound, Expired } from "./errors.js";

export function makeAcceptInvite(repo, now = () => Date.now()) {
  return async function acceptInvite(token) {
    const invite = await repo.findByToken(token);
    if (!invite) throw new NotFound();
    if (now() - invite.createdAt > 7 * 24 * 3600 * 1000) throw new Expired();
    await repo.markAccepted(invite.id);
    return { workspaceId: invite.workspaceId, role: invite.role };
  };
}
EOF
cat > src/accept-invite-route.js <<'EOF'
import { NotFound } from "./errors.js";

export function acceptInviteHandler(acceptInvite) {
  return async (req, reply) => {
    try {
      const result = await acceptInvite(req.params.token);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof NotFound) return reply.code(404).send({ error: "invite_not_found" });
      return reply.code(500).send({ error: "internal" });
    }
  };
}
EOF
cat > test/accept-invite.test.js <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAcceptInvite } from "../src/accept-invite.js";
test("accepts a fresh invite", async () => {
  const repo = { findByToken: async () => ({ id: "i1", workspaceId: "w1", role: "editor", createdAt: 0 }), markAccepted: async () => {} };
  assert.deepEqual(await makeAcceptInvite(repo, () => 1000)("t"), { workspaceId: "w1", role: "editor" });
});
EOF
git add -A; git commit -qm "feat(invites): accept an invite by token"; git push -q -u origin feat/accept-invite

mkdir -p ../gh-fixtures
cat > ../gh-fixtures/pr-view.json <<'EOF'
{ "number": 17, "url": "https://github.com/acme/invites-api/pull/17", "headRefName": "feat/accept-invite",
  "body": "Adds POST /invites/:token/accept. The web app (acme/web-app#31) already parses its 200 body as `{ workspaceId, role }`.",
  "comments": [ { "author": { "login": "maria-reviewer" }, "body": "LGTM once the error handling is sorted." } ] }
EOF
cat > ../gh-fixtures/pulls-comments.json <<'EOF'
[
  { "id": 9001, "path": "src/accept-invite-route.js", "line": 10, "user": { "login": "maria-reviewer" },
    "body": "An expired invite falls through to a 500 here. It should be a 410 with `invite_expired` so the web app can show the 'ask for a new invite' state." },
  { "id": 9002, "path": "src/accept-invite-route.js", "line": 7, "user": { "login": "maria-reviewer" },
    "body": "nit: could we wrap the response as `{ data: { workspaceId, role } }`? feels more consistent with how I'd design it." },
  { "id": 9003, "path": "src/accept-invite.js", "line": 7, "user": { "login": "maria-reviewer" },
    "body": "Magic number: name the 7-day expiry." },
  { "id": 9004, "path": "src/accept-invite.js", "line": 1, "user": { "login": "maria-reviewer" },
    "body": "typo in the import order" }
]
EOF
cat > ../gh-fixtures/reviews.json <<'EOF'
[ { "id": 501, "user": { "login": "maria-reviewer" }, "state": "CHANGES_REQUESTED", "body": "A few things inline." } ]
EOF
cat > ../gh-fixtures/review-threads.json <<'EOF'
{ "data": { "repository": { "pullRequest": { "reviewThreads": { "nodes": [
  { "id": "PRRT_a1", "isResolved": false, "comments": { "nodes": [ { "databaseId": 9001, "body": "An expired invite falls through to a 500 here...", "path": "src/accept-invite-route.js", "line": 10 } ] } },
  { "id": "PRRT_a2", "isResolved": false, "comments": { "nodes": [ { "databaseId": 9002, "body": "nit: could we wrap the response as `{ data: ... }`?", "path": "src/accept-invite-route.js", "line": 7 } ] } },
  { "id": "PRRT_a3", "isResolved": false, "comments": { "nodes": [ { "databaseId": 9003, "body": "Magic number: name the 7-day expiry.", "path": "src/accept-invite.js", "line": 7 } ] } },
  { "id": "PRRT_a4", "isResolved": true, "comments": { "nodes": [ { "databaseId": 9004, "body": "typo in the import order", "path": "src/accept-invite.js", "line": 1 } ] } }
] } } } } }
EOF
