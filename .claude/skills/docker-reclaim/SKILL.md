---
name: "docker-reclaim"
description: "Frees disk space Docker holds: reports the drive's free space and `docker system df`, prunes the safe set (stopped containers, dangling and week-old unused images, week-old build cache) and, on Windows, prints the compaction steps the user must run, since the disk image only shrinks after that. Never touches volumes. Trigger when the user asks to free disk or Docker space, when the session-start disk nudge fires, or when a build fails with no space left on device. Not for deleting a project's data or volumes."
---

# Docker reclaim

Repeated local rebuilds pile up images and build cache. Pruning frees space inside Docker's disk, but on Windows the host drive gets it back only after that disk image is compacted.

## Steps

1. **Report.** `node <this skill's folder>/reclaim.mjs report` prints the free space on the home drive, `docker system df` and, on Windows, the size of Docker Desktop's disk images. If the engine does not answer within 15 seconds it says so and stops: tell the user to start Docker Desktop (or free some space first if the disk is what killed it), do not retry in a loop.
2. **Prune.** `node <this skill's folder>/reclaim.mjs prune` runs the safe set only and prints the space before and after: stopped containers, dangling images, unused images and build cache older than 168 hours (`--older-than 72h` to change it). Run it without asking: it removes only what a rebuild recreates.
3. **Compact (Windows).** `node <this skill's folder>/reclaim.mjs compact` prints the exact steps with the real paths. Give them to the user and stop: they need to quit Docker Desktop, run `wsl --shutdown` and use an Administrator PowerShell, which an agent cannot do. On macOS and Linux it says no step is needed.

## Never volumes

Local MongoDB and Redis data lives in Docker volumes. No `docker volume prune`, no `docker system prune --volumes`, no Docker Desktop "Clean / Purge data", and no `docker volume rm` unless the user names that volume. The script has no such command; do not add one by hand. If volumes are the space hog, show the user `docker system df -v` and let them choose.
