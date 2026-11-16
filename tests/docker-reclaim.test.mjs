// The docker-reclaim skill's helper (.agents/skills/docker-reclaim/reclaim.mjs): the prune list
// never touches volumes, the engine being down stops the run, and compact names the real path.
// Docker is injected, so none of this needs it installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, DEFAULT_OLDER_THAN, main, parseCli, parseDf, prune, pruneSteps, report, vhdxCandidates } from "../.agents/skills/docker-reclaim/reclaim.mjs";

const GB = 1024 ** 3;
const DF = [
  { Type: "Images", TotalCount: "40", Active: "3", Size: "120GB", Reclaimable: "110GB (91%)" },
  { Type: "Build Cache", TotalCount: "900", Active: "0", Size: "80GB", Reclaimable: "80GB" },
].map((row) => JSON.stringify(row)).join("\n");

// A fake host: docker answers from `replies` by its first words, and every call is recorded.
function fakeDeps({ platform = "win32", engine = "up", existing = [], free = [5 * GB, 9 * GB] } = {}) {
  const calls = [];
  let reads = 0;
  const env = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
  return {
    calls,
    env,
    platform,
    home: "/home/me",
    statfs: () => ({ bavail: free[Math.min(reads++, free.length - 1)], bsize: 1 }),
    exists: (path) => existing.includes(path),
    fileSize: () => 300 * GB,
    docker(args) {
      calls.push(args);
      if (args[0] === "info") {
        if (engine === "missing") return { ok: false, missing: true, stdout: "", stderr: "" };
        if (engine === "hung") return { ok: false, timedOut: true, stdout: "", stderr: "" };
        return { ok: engine === "up", stdout: "27.0\n", stderr: "down" };
      }
      if (args[0] === "system") return { ok: true, stdout: DF, stderr: "" };
      return { ok: true, stdout: "Total reclaimed space: 1GB\n", stderr: "" };
    },
  };
}

test("the prune list is the safe set, with the age as a named constant, and never a volume", () => {
  assert.equal(DEFAULT_OLDER_THAN, "168h");
  assert.deepEqual(pruneSteps(), [
    ["container", "prune", "-f"],
    ["image", "prune", "-f"],
    ["image", "prune", "-a", "-f", "--filter", "until=168h"],
    ["builder", "prune", "-f", "--filter", "until=168h"],
  ]);
  for (const hours of ["168h", "1h"]) {
    for (const step of pruneSteps(hours)) {
      assert.ok(!step.some((word) => /volume/i.test(word)), `volume in ${step.join(" ")}`);
      assert.notEqual(step[0], "system");
    }
  }
});

test("prune runs exactly that list, never a volume command, and reports space before and after", () => {
  const deps = fakeDeps();
  const { ok, text } = prune(deps);
  assert.ok(ok);
  const pruneCalls = deps.calls.filter((args) => args[0] !== "info" && args[0] !== "system");
  assert.deepEqual(pruneCalls, pruneSteps());
  assert.ok(!deps.calls.flat().some((word) => /volume/i.test(word)));
  assert.match(text, /Free space before: 5\.0 GB/);
  assert.match(text, /Free space after: 9\.0 GB/);
  assert.match(text, /compact/);
});

test("--older-than changes the age, and only hours are accepted", () => {
  assert.deepEqual(parseCli(["prune", "--older-than", "72h"]), { command: "prune", olderThan: "72h" });
  assert.equal(parseCli(["prune"]).olderThan, "168h");
  assert.throws(() => parseCli(["prune", "--older-than", "1d"]), /hours/);
  assert.throws(() => parseCli(["volumes"]), /Usage/);
  const deps = fakeDeps();
  main(["prune", "--older-than", "24h"], deps);
  assert.ok(deps.calls.some((args) => args.includes("until=24h")));
});

test("a dead, hung or missing engine stops report and prune before anything else runs", () => {
  for (const [engine, message] of [["down", /not running/], ["hung", /did not answer within 15s/], ["missing", /not installed/]]) {
    for (const action of [report, prune]) {
      const deps = fakeDeps({ engine });
      const result = action(deps);
      assert.equal(result.ok, false);
      assert.match(result.text, message);
      assert.deepEqual(deps.calls.map((args) => args[0]), ["info"], `${engine}: only the liveness check ran`);
    }
  }
});

test("report shows free space, the df breakdown and the Docker disk images on Windows", () => {
  const [disk] = vhdxCandidates(fakeDeps().env);
  const { ok, text } = report(fakeDeps({ existing: [disk] }));
  assert.ok(ok);
  assert.match(text, /Free space on the home drive: 5\.0 GB/);
  assert.match(text, /Images: 40 total, 3 active, 120GB \(reclaimable 110GB \(91%\)\)/);
  assert.match(text, /300\.0 GB/);
  assert.ok(text.includes(disk));
  assert.doesNotMatch(report(fakeDeps({ platform: "linux" })).text, /vhdx/);
});

test("parseDf reads one object per line or a JSON array", () => {
  assert.equal(parseDf(DF).length, 2);
  assert.equal(parseDf(`[${DF.split("\n").join(",")}]`).length, 2);
  assert.deepEqual(parseDf("  "), []);
});

test("compact prints the steps with the real path, for both ways, and runs nothing", () => {
  const [disk, main_] = vhdxCandidates(fakeDeps().env);
  const deps = fakeDeps({ existing: [disk, main_] });
  const { text } = compact(deps);
  for (const path of [disk, main_]) {
    assert.ok(text.includes(`Optimize-VHD -Path "${path}" -Mode Full`), path);
    for (const line of [`select vdisk file="${path}"`, "attach vdisk readonly", "compact vdisk", "detach vdisk"]) assert.ok(text.includes(line), line);
  }
  assert.match(text, /wsl --shutdown/);
  assert.match(text, /Quit Docker Desktop/);
  assert.match(text, /Administrator/);
  assert.deepEqual(deps.calls, []);
});

test("compact falls back to the usual path when no disk image is found, and says so", () => {
  const { text } = compact(fakeDeps());
  assert.ok(text.includes(vhdxCandidates(fakeDeps().env)[0]));
  assert.match(text, /no disk image found/);
});

test("compact says no step is needed on macOS and Linux", () => {
  for (const platform of ["darwin", "linux"]) {
    const { text } = compact(fakeDeps({ platform }));
    assert.match(text, /No compaction step is needed/);
    assert.doesNotMatch(text, /Optimize-VHD/);
  }
});
