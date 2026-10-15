// The pure parts of bin/bootstrap.mjs, kept apart so they can be tested without git.
import { requireValue } from "./args.mjs";

// `--dir` and `--repo` are the bootstrapper's own; everything else goes to scripts/install.mjs.
export function parseBootstrapArgs(argv, env = {}) {
  const args = argv.filter((arg) => arg !== "--");
  const parsed = { dir: env.AGENT_CONFIG_DIR || null, repo: null, passthrough: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") parsed.dir = requireValue(args, i++);
    else if (args[i] === "--repo") parsed.repo = requireValue(args, i++);
    else parsed.passthrough.push(args[i]);
  }
  return parsed;
}

// The forms npm accepts for `repository`: `owner/name`, `github:owner/name`, either
// with `#ref`, a clone URL, `git+https://…`, and the object form. Other hosts' shorthands
// are refused rather than handed to git as a path.
export function cloneTargetFromPackage(pkg) {
  const spec = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!spec) throw new Error("package.json has no `repository` field, so there is nothing to clone.");
  const [base, ref = null] = spec.split("#");
  const github = base.match(/^(?:github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (github) return { url: `https://github.com/${github[1]}.git`, ref };
  if (/^[a-z]+:[^/]/i.test(base)) throw new Error(`repository "${spec}" is not supported: use github:owner/name or a clone URL.`);
  return { url: base.replace(/^git\+/, ""), ref };
}

// `user@host:path`, `ssh://user@host/path` and `https://user@host/path` all name the
// same repository as `https://host/path`, on any host.
export function sameRepo(a, b) {
  const normalise = (url) =>
    url
      .trim()
      .toLowerCase()
      .replace(/^git\+/, "")
      .replace(/^[\w.-]+@([^:/]+):/, "https://$1/")
      .replace(/^ssh:\/\/[\w.-]+@([^/]+)\//, "https://$1/")
      .replace(/^(https?:\/\/)[^@/]+@/, "$1")
      .replace(/\.git$/, "")
      .replace(/\/+$/, "");
  return normalise(a) === normalise(b);
}
