// Non-executing UI scan of the actual changed source snapshot. Broader legacy
// findings remain in the separate repository-wide scope report; never suppress them.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { isAuditSourcePath } from "./audit-source-path.mjs";

const repo = process.cwd();
const audit = process.argv[2];
const output = process.argv[3];
if (!audit || !output || process.argv.length !== 4) throw new Error("Supply the installed audit script and report path only.");
const changed = [...new Set([
  ...execFileSync("git", ["diff", "--name-only", "-z", "HEAD", "--", "src"], { cwd: repo, encoding: "utf8" }).split("\0"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", "src"], { cwd: repo, encoding: "utf8" }).split("\0"),
].filter(Boolean))];
if (!changed.length || changed.some((file) => !isAuditSourcePath(file))) throw new Error("No valid changed source scope.");
const snapshot = await mkdtemp(resolve(tmpdir(), "daycare-task-first-audit."));
for (const file of [...changed, "DESIGN.md", "UX-CONTRACT.md", "package.json"]) {
  const target = resolve(snapshot, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(repo, file), target);
}
const manifest = JSON.parse(await readFile(resolve(repo, "premium-task-first.json"), "utf8"));
// Keep the declared real failure-path test without enlarging the scanned source
// scope. Tests still run independently in the full repository, not this snapshot.
if (manifest.evidence?.failurePaths) {
  const failurePath = manifest.evidence.failurePaths;
  if (!isAuditSourcePath(failurePath)) throw new Error("Invalid failure-path evidence.");
  await mkdir(resolve(snapshot, "evidence"), { recursive: true });
  await copyFile(resolve(repo, failurePath), resolve(snapshot, "evidence/failure-path.test.tsx"));
  manifest.evidence.failurePaths = "evidence/failure-path.test.tsx";
}
// The scanner only accepts directories, not individual-file sourceRoots.
manifest.sourceRoots = ["src"];
await writeFile(resolve(snapshot, "premium-task-first.json"), JSON.stringify(manifest, null, 2));
await mkdir(dirname(resolve(output)), { recursive: true });
const result = execFileSync("python3", [resolve(audit), snapshot, "--mode", "strict", "--config", resolve(snapshot, "premium-task-first.json"), "--output", resolve(output)], { encoding: "utf8" });
const report = JSON.parse(result);
console.log(JSON.stringify({ scope: "changed source snapshot only; not the full application", sourceFiles: changed, snapshot, output: resolve(output), summary: report.summary }, null, 2));
