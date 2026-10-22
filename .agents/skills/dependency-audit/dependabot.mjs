// (d) The repo's open Dependabot alerts, through `gh`. Alerts need a token with access to them;
// a missing `gh`, no GitHub remote or a 403 is reported as unavailable, never as "no alerts".
import { spawnSync } from "node:child_process";

const GH_TIMEOUT_MS = 60_000;

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: (result.stderr ?? "").trim(), missing: result.error?.code === "ENOENT" };
}

// owner/repo from an origin URL: https://github.com/o/r(.git) or git@github.com:o/r(.git).
export function repoSlug(remoteUrl) {
  return String(remoteUrl ?? "").trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

export function alertSummary(alert) {
  return {
    number: alert.number,
    package: alert.dependency?.package?.name,
    ecosystem: alert.dependency?.package?.ecosystem,
    manifest: alert.dependency?.manifest_path,
    scope: alert.dependency?.scope === "development" ? "dev" : "production",
    severity: alert.security_advisory?.severity,
    ghsa: alert.security_advisory?.ghsa_id,
    summary: alert.security_advisory?.summary,
    vulnerableRange: alert.security_vulnerability?.vulnerable_version_range,
    patched: alert.security_vulnerability?.first_patched_version?.identifier ?? null,
    url: alert.html_url,
  };
}

export function dependabotAlerts(dir, runner = run) {
  const remote = runner("git", ["remote", "get-url", "origin"], dir);
  const slug = remote.status === 0 ? repoSlug(remote.stdout) : null;
  if (!slug) return { unavailable: "no GitHub origin remote" };
  // One alert per line, whatever the number of pages.
  const gh = runner("gh", ["api", "--paginate", "--jq", ".[]", `repos/${slug}/dependabot/alerts?state=open&per_page=100`], dir);
  if (gh.missing) return { slug, unavailable: "gh is not installed" };
  if (gh.status !== 0) return { slug, unavailable: `gh api failed: ${gh.stderr.split("\n")[0]}` };
  const lines = gh.stdout.split("\n").filter((line) => line.trim());
  return { slug, alerts: lines.map((line) => alertSummary(JSON.parse(line))) };
}
