// The little version arithmetic the audit needs, without a dependency: plain x.y.z only, which is
// what npm's lockfile and nodejs.org's release index hold.

export function parseVersion(text) {
  const m = String(text ?? "").trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return { major: +m[1], minor: m[2] === undefined ? null : +m[2], patch: m[3] === undefined ? null : +m[3] };
}

// Negative when a is older than b. A missing minor or patch counts as 0.
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (const key of ["major", "minor", "patch"]) {
    const diff = (x?.[key] ?? 0) - (y?.[key] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

// True when `version` is inside the prefix a pin names: "22" holds 22.x.y, "22.11" holds 22.11.y.
export function matchesPrefix(version, prefix) {
  const [v, p] = [parseVersion(version), parseVersion(prefix)];
  if (!v || !p) return false;
  return v.major === p.major && (p.minor === null || v.minor === p.minor) && (p.patch === null || v.patch === p.patch);
}
