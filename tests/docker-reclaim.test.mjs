// The docker-reclaim skill's helper (.agents/skills/docker-reclaim/reclaim.mjs): the prune list
// never touches volumes, the engine being down stops the run, and compact names the real path.
// Docker is injected, so none of this needs it installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute, join, parse } from "node:path";
import { compact, DEFAULT_OLDER_THAN, DF_TIMEOUT_MS, main, parseCli, parseDf, parseSize, prune, pruneSteps, report, TRIM_COMMAND, trim, vhdxCandidates } from "../.agents/skills/docker-reclaim/reclaim.mjs";

const GB = 1024 ** 3;
const DF = [
  { Type: "Images", TotalCount: "40", Active: "3", Size: "120GB", Reclaimable: "110GB (91%)" },
  { Type: "Build Cache", TotalCount: "900", Active: "0", Size: "80GB", Reclaimable: "80GB" },
].map((row) => JSON.stringify(row)).join("\n");

// A fake host: docker answers from `replies` by its first words, and every call is recorded.
function fakeDeps({ platform = "win32", engine = "up", existing = [], free = [5 * GB, 9 * GB], df = "ok", fileSize = 300 * GB, wsl = "ok", stampFails = false, pruneFails = [], lastPrune = null } = {}) {
  const calls = [];
  const timeouts = [];
  const wslCalls = [];
  const stamps = [];
  let reads = 0;
  const env = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
  return {
    calls,
    timeouts,
    wslCalls,
    stamps,
    env,
    platform,
    home: "/home/me",
    statfs: () => ({ bavail: free[Math.min(reads++, free.length - 1)], bsize: 1 }),
    exists: (path) => existing.includes(path),
    fileSize: () => fileSize,
    lastPrune: () => lastPrune,
    stamp() {
      if (stampFails) throw new Error("read-only");
      stamps.push(true);
    },
    wsl(args) {
      wslCalls.push(args);
      return wsl === "ok" ? { ok: true, stdout: "/mnt/docker-desktop-disk: 20 GiB trimmed\n", stderr: "" } : { ok: false, timedOut: wsl === "hung", stdout: "", stderr: "" };
    },
    docker(args, timeout) {
      calls.push(args);
      timeouts.push([args[0], timeout]);
      if (args[0] === "info") {
        if (engine === "missing") return { ok: false, missing: true, stdout: "", stderr: "" };
        if (engine === "hung") return { ok: false, timedOut: true, stdout: "", stderr: "" };
        return { ok: engine === "up", stdout: "27.0\n", stderr: "permission denied on /var/run/docker.sock\nsecond line" };
      }
      if (args[0] === "system") return df === "ok" ? { ok: true, stdout: DF, stderr: "" } : { ok: false, timedOut: true, stdout: "", stderr: "" };
      if (pruneFails === "all" || pruneFails.includes(args.join(" "))) return { ok: false, stdout: "", stderr: "boom" };
      return { ok: true, stdout: "Total reclaimed space: 1GB\n", stderr: "" };
    },
  };
}

test("the prune list is the safe set, with the age as a named constant, and never a volume", () => {
  assert.equal(DEFAULT_OLDER_THAN, "168h");
  assert.deepEqual(pruneSteps(), [
    ["image", "prune", "-f"],
    ["image", "prune", "-a", "-f", "--filter", "until=168h"],
    ["builder", "prune", "-a", "-f", "--filter", "until=168h"],
  ]);
  for (const hours of ["168h", "1h"]) {
    for (const step of pruneSteps(hours)) {
      assert.ok(!step.some((word) => /volume/i.test(word)), `volume in ${step.join(" ")}`);
      assert.notEqual(step[0], "system");
      assert.notEqual(step[0], "container");
    }
  }
});

test("prune runs exactly that list, never a volume command, and reports space before and after", () => {
  const deps = fakeDeps();
  const { ok, text } = prune(deps);
  assert.ok(ok);
  const pruneCalls = deps.calls.filter((args) => args[0] !== "info" && args[0] !== "system");
  assert.deepEqual(pruneCalls, pruneSteps());
  assert.ok(!deps.calls.flat().some((word) => /volume|container/i.test(word)));
  assert.equal(deps.stamps.length, 1, "prune records its run for the nudge");
  assert.match(text, /Free space before: 5\.0 GB/);
  assert.match(text, /Free space after: 9\.0 GB/);
  assert.match(text, /compact/);
});

test("--older-than changes the age, and only hours are accepted", () => {
  assert.deepEqual(parseCli(["prune", "--older-than", "72h"]), { command: "prune", olderThan: "72h" });
  assert.equal(parseCli(["prune"]).olderThan, "168h");
  assert.throws(() => parseCli(["prune", "--older-than", "1d"]), /hours/);
  assert.throws(() => parseCli(["volumes"]), /Usage/);
  assert.throws(() => parseCli(["prune", "--older-than", "23h"]), /at least 24h/);
  assert.throws(() => parseCli(["prune", "--older-than", "0h"]), /at least 24h/);
  const deps = fakeDeps();
  main(["prune", "--older-than", "24h"], deps);
  assert.ok(deps.calls.some((args) => args.includes("until=24h")));
});

test("a dead, hung or missing engine stops report and prune before anything else runs", () => {
  for (const [engine, message] of [["down", /not running \(permission denied on \/var\/run\/docker.sock\)/], ["hung", /did not answer within 15s/], ["missing", /not installed/]]) {
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
  const [first, second] = DF.split("\n");
  const noisy = [first, "WARNING: not json", second].join("\n");
  assert.equal(parseDf(noisy).length, 2, "a non-JSON line is skipped");
  assert.deepEqual(parseDf("[broken"), []);
});

test("compact prints the steps with the real path, for both ways, and runs nothing", () => {
  const [disk, main_] = vhdxCandidates(fakeDeps().env);
  const deps = fakeDeps({ existing: [disk, main_] });
  const { text } = compact(deps);
  for (const path of [disk, main_]) {
    assert.ok(text.includes(`Mount-VHD -Path "${path}" -ReadOnly; Optimize-VHD -Path "${path}" -Mode Full; Dismount-VHD -Path "${path}"`), path);
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

test("docker system df gets its own long timeout, and a timeout is named instead of an empty reason", () => {
  const deps = fakeDeps({ df: "hung" });
  const { text } = report(deps);
  assert.match(text, /docker system df failed: timed out after 120s/);
  assert.equal(DF_TIMEOUT_MS, 120_000);
  assert.deepEqual(deps.timeouts.find(([name]) => name === "system"), ["system", DF_TIMEOUT_MS]);
});

test("a prune whose stamp cannot be written still finishes", () => {
  const { ok, text } = prune(fakeDeps({ stampFails: true }));
  assert.ok(ok);
  assert.match(text, /Free space after/);
});

test("on Windows prune ends with an fstrim of the Docker disk, and a failure is only a warning", () => {
  const deps = fakeDeps();
  assert.match(prune(deps).text, /wsl fstrim -av: ok/);
  assert.deepEqual(deps.wslCalls, [TRIM_COMMAND]);
  assert.deepEqual(TRIM_COMMAND, ["-d", "docker-desktop", "-u", "root", "-e", "sh", "-c", "fstrim -av"]);
  const result = prune(fakeDeps({ wsl: "hung" }));
  assert.ok(result.ok);
  assert.match(result.text, /Warning: wsl fstrim did not run \(timed out after 300s\)/);
  const linux = fakeDeps({ platform: "linux" });
  prune(linux);
  assert.deepEqual(linux.wslCalls, []);
});

test("the trim subcommand runs the same command on Windows and nothing elsewhere", () => {
  const deps = fakeDeps();
  assert.match(main(["trim"], deps).text, /fstrim -av: ok/);
  assert.deepEqual(deps.wslCalls, [TRIM_COMMAND]);
  assert.match(trim(fakeDeps({ platform: "darwin" })).text, /No trim step/);
});

test("compact says trim first, ends diskpart with detach and checks the image is detached", () => {
  const [disk] = vhdxCandidates(fakeDeps().env);
  const { text } = compact(fakeDeps({ existing: [disk] }));
  assert.ok(text.indexOf("Trim first") !== -1 && text.indexOf("Trim first") < text.indexOf("wsl --shutdown"));
  assert.ok(text.indexOf("detach vdisk") < text.indexOf("exit"));
  assert.ok(text.includes(`(Get-DiskImage -ImagePath "${disk}").Attached`));
  assert.match(text, /must print False/);
  assert.match(text, /ERROR_SHARING_VIOLATION/);
});

test("report says compacting, not pruning, frees the space when the disk image is far larger than Docker's use", () => {
  const [disk] = vhdxCandidates(fakeDeps().env);
  assert.match(report(fakeDeps({ existing: [disk], fileSize: 1000 * GB })).text, /pruning will not shrink the file, compacting it/);
  assert.doesNotMatch(report(fakeDeps({ existing: [disk], fileSize: 150 * GB })).text, /compacting it/);
  assert.doesNotMatch(report(fakeDeps({ existing: [disk], df: "hung", fileSize: 1000 * GB })).text, /compacting it/);
});

test("parseSize reads Docker's decimal sizes", () => {
  assert.equal(parseSize("120GB"), 120e9);
  assert.equal(parseSize("1.5kB"), 1500);
  assert.equal(parseSize("0B"), 0);
  assert.ok(Number.isNaN(parseSize("n/a")));
});

test("vhdxCandidates falls back to the injected home, not the real one", () => {
  const [disk] = vhdxCandidates({}, join("injected", "home"));
  assert.ok(disk.startsWith(join("injected", "home", "AppData")));
});

test("prune stamps when at least one step succeeded, and neither stamps nor reports ok when all failed", () => {
  const partial = fakeDeps({ pruneFails: [pruneSteps()[0].join(" ")] });
  assert.equal(prune(partial).ok, true);
  assert.equal(partial.stamps.length, 1);
  const failed = fakeDeps({ pruneFails: "all" });
  const result = prune(failed);
  assert.equal(result.ok, false);
  assert.equal(failed.stamps.length, 0, "every step failed, so nothing is recorded");
  assert.match(result.text, /Every prune step failed/);
});

test("prune runs docker system df once, after the steps", () => {
  const deps = fakeDeps();
  const { text } = prune(deps);
  assert.equal(deps.calls.filter((args) => args[0] === "system").length, 1);
  assert.doesNotMatch(text, /df before/);
  assert.match(text, /docker system df after:/);
});

test("report prints the last prune date from the stamp, or never", () => {
  assert.match(report(fakeDeps({ lastPrune: "2026-11-14T10:00:00.000Z" })).text, /Last docker prune: 2026-11-14T10:00:00.000Z/);
  assert.match(report(fakeDeps()).text, /Last docker prune: never/);
});

test("compact prints the absolute path of reclaim.mjs and the drive of the disk image", () => {
  const [disk] = vhdxCandidates(fakeDeps().env);
  const { text } = compact(fakeDeps({ existing: [disk] }));
  const command = /node "([^"]+reclaim.mjs)" trim/.exec(text);
  assert.ok(command, "quoted node command");
  assert.ok(isAbsolute(command[1]), command[1]);
  assert.ok(text.includes(`Free space on ${parse(disk).root || "the drive that holds the disk image"} grows`));
  assert.doesNotMatch(text, /on C: grows/);
});
