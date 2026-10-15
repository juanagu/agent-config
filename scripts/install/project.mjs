// Project mode: copies the drop-in files for the chosen tools into a project. A hook
// registration file the project already has is merged, not compared: it is the project's
// settings with our one entry added or re-pointed.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCopier, toRelative } from "./copy.mjs";
import { readJson, writeJson } from "./json.mjs";
import { registerGuard } from "./settings.mjs";
import { REGISTRATION_FILES, projectFiles } from "./targets.mjs";

export function installProject(repoDir, { project, tools, force }) {
  const target = resolve(project);
  const files = projectFiles(tools);
  const missing = files.filter((file) => !existsSync(join(repoDir, file)));
  if (missing.length) throw new Error(`Missing in ${repoDir}: ${missing.join(", ")}. Run npm run build first.`);

  const copier = createCopier({ force });
  const merged = [];
  let unchangedRegistrations = 0;
  for (const file of files) {
    if (REGISTRATION_FILES.has(file) && existsSync(join(target, file))) {
      if (mergeRegistrationFile(join(repoDir, file), join(target, file))) merged.push(join(target, file));
      else unchangedRegistrations++;
    } else copier.copyTree(join(repoDir, file), join(target, file));
  }
  const { written, conflicts, skipped } = copier.result();

  for (const path of written) console.log(`wrote     ${toRelative(target, path)}`);
  for (const path of merged) console.log(`merged    ${toRelative(target, path)} (git-guard entry added or re-pointed; the rest is yours)`);
  for (const path of conflicts) console.log(`conflict  ${toRelative(target, path)} (differs; re-run with --force to overwrite)`);
  const unchanged = skipped + unchangedRegistrations;
  console.log(`Installed ${tools.join(", ")} into ${target}: ${written.length} written, ${merged.length} merged, ${unchanged} unchanged, ${conflicts.length} conflicting.`);
  return conflicts.length ? 1 : 0;
}

// True when the project's file changed. A file that is not JSON stops the run with its name,
// since replacing a project's settings is never ours to do.
function mergeRegistrationFile(source, target) {
  const { value, changed } = registerGuard(readJson(target), readJson(source));
  if (changed) writeJson(target, value);
  return changed;
}
