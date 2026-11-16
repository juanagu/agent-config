---
name: "docker-reclaim"
description: "Frees disk space Docker holds: reports the drive's free space and `docker system df`, prunes the safe set (dangling images, unused images and build cache created more than a week ago; stopped containers and their images stay) and, on Windows, trims the disk image and prints the compaction steps the user must run, since the disk image only shrinks after that. Never touches volumes or stopped containers. Trigger when the user asks to free disk or Docker space, when the session-start disk nudge fires, or when a build fails with no space left on device. Not for deleting a project's data or volumes."
---

# Docker reclaim

Repeated local rebuilds pile up images and build cache. Pruning frees space inside Docker's disk, but on Windows the host drive gets it back only after that disk image is trimmed and compacted: a file of 300 GB can hold 15 GB of Docker data.

## Steps

1. **Report.** `node <this skill's folder>/reclaim.mjs report` prints the free space on the home drive, `docker system df` and, on Windows, the size of Docker Desktop's disk images, saying so when a disk image is far larger than what Docker uses (then compacting, not pruning, is what frees the space). If the engine does not answer within 15 seconds it says so and stops: tell the user to start Docker Desktop (or free some space first if the disk is what killed it), do not retry in a loop. `docker system df` itself may take up to two minutes on a big store.
2. **Prune, only when Docker's images or build cache are the cause.** `node <this skill's folder>/reclaim.mjs prune` runs the safe set only and prints the space before and after: dangling images, unused images and build cache created more than 168 hours ago (`--older-than 72h` to change it, 24h at the least: the filter goes by creation time, not last use). Stopped containers are kept, and so are the images they use, so a stopped compose stack stays intact. Run it without asking: it removes only what a rebuild or pull recreates. **It can take minutes**: run it with the shell's longest timeout or in the background, and read the summary it prints. It records the run, and the session-start nudge stays quiet for 24 hours after. On Windows it ends with a trim of the disk image (`wsl ... fstrim`, a warning if it fails).
3. **Compact (Windows).** `node <this skill's folder>/reclaim.mjs compact` prints the exact steps with the real paths. Give them to the user and stop: they need to quit Docker Desktop, run `wsl --shutdown` and use an Administrator PowerShell, which an agent cannot do. The steps trim first (`node <this skill's folder>/reclaim.mjs trim`, while Docker still runs), end the diskpart sequence with `detach vdisk` and check `(Get-DiskImage -ImagePath ...).Attached` prints False: a disk image left attached makes Docker fail to start. If space is still low after a prune that already ran, this is the step to remind the user of, not another prune. On macOS and Linux it says no step is needed.

## Never volumes

Local MongoDB and Redis data lives in Docker volumes. No `docker volume prune`, no `docker system prune --volumes`, no `docker container prune`, no Docker Desktop "Clean / Purge data", and no `docker volume rm` unless the user names that volume. The script has no such command; do not add one by hand. If volumes are the space hog, show the user `docker system df -v` and let them choose.
