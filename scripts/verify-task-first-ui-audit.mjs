// Non-executing UI scan of the actual changed source snapshot. Broader legacy
// findings remain in the separate repository-wide scope report; never suppress them.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const repo = process.cwd();
const audit = process.argv[2];
const output = process.argv[3];
if (!audit || !output || process.argv.length !== 4) throw new Error("Supply the installed audit script and report path only.");
const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src"], { cwd: repo, encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
if (!changed.length || changed.some((file) => !file.startsWith("src/") || file.includes(".."))) throw new Error("No valid changed source scope.");
const snapshot = await mkdtemp(resolve(tmpdir(), "daycare-task-first-audit."));
for (const file of [...changed, "DESIGN.md", "UX-CONTRACT.md", "package.json"]) {
  const target = resolve(snapshot, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(repo, file), target);
}
const manifest = JSON.parse(await readFile(resolve(repo, "premium-task-first.json"), "utf8"));
// The scanner only accepts directories, not individual-file sourceRoots.
manifest.sourceRoots = ["src"];
await writeFile(resolve(snapshot, "premium-task-first.json"), JSON.stringify(manifest, null, 2));
await mkdir(dirname(resolve(output)), { recursive: true });
const result = execFileSync("python3", [resolve(audit), snapshot, "--mode", "strict", "--config", "premium-task-first.json", "--output", resolve(output)], { encoding: "utf8" });
const report = JSON.parse(result);
console.log(JSON.stringify({ scope: "changed source snapshot only; not the full application", sourceFiles: changed, snapshot, output: resolve(output), summary: report.summary }, null, 2));
