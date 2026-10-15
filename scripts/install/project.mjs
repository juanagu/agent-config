// Project mode: copies the drop-in files for the chosen tools into a project.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCopier, toRelative } from "./copy.mjs";
import { projectFiles } from "./targets.mjs";

export function installProject(repoDir, { project, tools, force }) {
  const target = resolve(project);
  const files = projectFiles(tools);
  const missing = files.filter((file) => !existsSync(join(repoDir, file)));
  if (missing.length) throw new Error(`Missing in ${repoDir}: ${missing.join(", ")}. Run npm run build first.`);

  const copier = createCopier({ force });
  for (const file of files) copier.copyTree(join(repoDir, file), join(target, file));
  const { written, conflicts, skipped } = copier.result();

  for (const path of written) console.log(`wrote     ${toRelative(target, path)}`);
  for (const path of conflicts) console.log(`conflict  ${toRelative(target, path)} (differs; re-run with --force to overwrite)`);
  console.log(`Installed ${tools.join(", ")} into ${target}: ${written.length} written, ${skipped} unchanged, ${conflicts.length} conflicting.`);
  return conflicts.length ? 1 : 0;
}
