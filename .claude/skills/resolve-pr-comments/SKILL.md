---
name: "resolve-pr-comments"
description: "Fetches unresolved review comments on an open PR, turns them into a triaged fix plan, implements the fixes, and replies/marks threads resolved with explicit confirmation before anything is pushed or posted. Trigger when the user asks to address/resolve/handle PR feedback, review comments, or reviewer requests on an already-open PR. Do not trigger for writing a new review (use code-review) or for opening a new PR (use open-pr)."
---

# Resolve PR comments

Work through human reviewer feedback on an already-open pull request: fetch it, plan it, fix it, and only reply/resolve/push with the user's explicit go-ahead — posting PR comments and pushing commits are both explicit-permission actions regardless of how this skill was invoked.

## Quick start

1. Identify the PR: use the current branch's associated PR (`gh pr view --json number,url,headRefName`) unless the user names a specific PR number/branch.
2. Confirm you're checked out on that PR's branch (`git branch --show-current`) before making any fixes — don't edit files against the wrong branch.

## Workflow

### 1. Fetch all feedback
- Inline review comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments`.
- Review-level comments: `gh api repos/{owner}/{repo}/pulls/{number}/reviews`.
- General PR conversation comments: `gh pr view {number} --json comments`.
- Thread resolution state (GitHub only exposes this via GraphQL): 
  ```
  gh api graphql -f query='
    query($owner:String!,$repo:String!,$number:Int!) {
      repository(owner:$owner,name:$repo) {
        pullRequest(number:$number) {
          reviewThreads(first:100) {
            nodes { id isResolved comments(first:1) { nodes { body path line } } }
          }
        }
      }
    }' -f owner={owner} -f repo={repo} -F number={number}
  ```
- Filter out threads already marked `isResolved: true` — only plan around what's actually still open.

### 2. Build a triage plan and show it before touching code
For each unresolved comment/thread, produce one line: file:line, a one-sentence paraphrase of the ask, and a proposed action — **fix**, **push back / needs discussion** (reviewer's ask is wrong, out of scope, or conflicts with something), or **already addressed elsewhere** (verify against the current diff before claiming this). Present this full list to the user before implementing anything — don't start editing files off your own triage without a chance for the user to redirect, since some comments may be contentious or need their judgment.

### 3. Implement the agreed fixes
- Route each fix through the normal pipeline for its layer: `backend-engineer` or the client's engineer (`AGENTS.md`, Agents) for implementation-level feedback, `architect-engineer` if a comment reveals a real design issue spanning layers, `security-engineer` if the feedback is security-relevant.
- Keep fixes scoped to what the comment actually asked — don't use this pass to also refactor unrelated code (that's a separate PR under the trunk-based small-PR model).
- For "push back" items, draft the reply explaining the reasoning rather than silently ignoring the comment.

### 4. Commit
- Use the `conventional-commit` skill for the fix commit(s). Prefer a small number of focused commits (e.g. one per reviewer or per theme) over one commit per comment, but don't force everything into a single commit if the fixes are logically distinct.

### 5. Push — ask first
- Pushing updates a shared PR others are watching: confirm with the user before `git push`, even though "resolve the PR comments" implies it. State what will be pushed (commit summary) when asking.

### 6. Reply to comments and resolve threads — ask first
- Posting replies and resolving threads happen on the user's own GitHub identity and are visible to every other participant on the PR — always confirm before doing either, even within an otherwise-approved run of this skill.
- Reply to an inline comment: `gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies -f body="..."`.
- Resolve a thread (after replying): 
  ```
  gh api graphql -f query='mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } } }' -f threadId={thread_id}
  ```
- For "push back" items, reply with the reasoning but leave the thread unresolved — resolving is the reviewer's call, not something to do on their behalf just because you responded.
- Do not resolve a thread you didn't actually address with a code change or a substantive reply.

### 7. Summarize
Report back: what was fixed, what was pushed back on (and why), what's still open needing the reviewer's own input, and the final commit(s)/push status.

## Notes
- If GraphQL thread IDs are hard to map to specific file/line comments, cross-reference via the comment's `id` returned from the REST calls in step 1 — GitHub's REST and GraphQL comment IDs differ, don't assume they're interchangeable.
- If the repo uses a different review tool than native GitHub PR reviews (e.g. comments only in Slack), fall back to whatever the user pastes in and skip the `gh api` fetch steps.
