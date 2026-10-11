import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { adoptNativeRestoreDirectoryFromReport, cleanupNativeRestoreDirectory, createNativeRestoreDirectory } from "../../lib/native-restore-cleanup.mjs";

const scenario = process.argv[2];
const fixture = mkdtempSync(join(tmpdir(), "daycare-cleanup-fixture-"));
const directory = createNativeRestoreDirectory();
const data = join(directory.path, "data");
const backup = join(fixture, "synthetic-encrypted-backup.aes");
const receipt = join(fixture, "synthetic-receipt.json");
const log = join(fixture, "calls.jsonl");
const external = join(fixture, "external");
writeFileSync(backup, "SYNTHETIC-ENCRYPTED-FIXTURE-NOT-A-BACKUP\n");
writeFileSync(log, "");
mkdirSync(external);
writeFileSync(join(external, "preserved-marker.txt"), "SYNTHETIC-NOT-PATIENT-DATA\n");
mkdirSync(data);
writeFileSync(join(data, "synthetic-rows.txt"), "SYNTHETIC-NOT-PATIENT-DATA\n");
let startAttempted = false, cleanup, failure, cleanupDirectory = directory;
const mock = fileURLToPath(new URL("./native-restore-pgctl-mock.mjs", import.meta.url));
async function runPgCtl(args, acceptable) {
  const result = spawnSync(process.execPath, [mock, scenario, log, ...args], {
    encoding: "utf8", env: {}, timeout: 3000, maxBuffer: 4096,
  });
  if (result.error || result.signal || !acceptable.includes(result.status))
    throw new Error(`SYNTHETIC_PGCTL_${args.at(-1).toUpperCase()}_FAILED`);
  return result.status;
}
try {
  try {
    if (scenario === "never-started") throw new Error("SYNTHETIC_INITDB_FAILED");
    startAttempted = true;
    await runPgCtl(["-D", data, "start"], [0]);
    if (scenario.startsWith("prior-")) {
      if (scenario !== "prior-running") await runPgCtl(["-D", data, "stop"], [0]);
      const prior = { operation: "native_restore", project: "diompsnswchpfguvryan", serverStopped: true,
        exactRowFingerprintMatch: true, localDataDirectory: data };
      if (scenario === "prior-invalid-receipt") prior.serverStopped = false;
      if (scenario === "prior-broad-directory") prior.localDataDirectory = "/data";
      cleanupDirectory = adoptNativeRestoreDirectoryFromReport(prior);
    } else if (scenario === "root-symlink" || scenario === "root-replaced") {
      await runPgCtl(["-D", data, "stop"], [0]);
      renameSync(directory.path, join(fixture, "retained-original"));
      if (scenario === "root-symlink") symlinkSync(external, directory.path);
      else mkdirSync(directory.path, { mode: 0o700 });
    } else if (scenario === "permissions-changed") chmodSync(directory.path, 0o755);
    else if (scenario === "data-symlink") {
      await runPgCtl(["-D", data, "stop"], [0]);
      renameSync(data, join(fixture, "retained-data"));
      symlinkSync(external, data);
    } else if (scenario === "nested-symlink") symlinkSync(external, join(data, "external-link"));
  } finally {
    // Invalid prior receipts must not fall through to destructive cleanup.
    if (scenario !== "prior-invalid-receipt" && scenario !== "prior-broad-directory")
      cleanup = await cleanupNativeRestoreDirectory({ directory: cleanupDirectory, startAttempted, runPgCtl });
  }
  // Like the real operator script: receipt is after finally, never on error.
  writeFileSync(receipt, JSON.stringify(cleanup));
} catch (error) { failure = error.message; }

const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const result = { scenario, startAttempted, failure, cleanup, receiptWritten: existsSync(receipt),
  directoryExists: existsSync(directory.path), directoryMode: existsSync(directory.path) ? lstatSync(directory.path).mode & 0o777 : null,
  backupPreserved: readFileSync(backup, "utf8") === "SYNTHETIC-ENCRYPTED-FIXTURE-NOT-A-BACKUP\n",
  externalPreserved: existsSync(join(external, "preserved-marker.txt")),
  calls: calls.map(call => ({ action: call.action, exactDataDirectory: call.data === data })),
  productionVerified: false };
// Test-owned synthetic fixtures only; no real cluster or data is present.
rmSync(directory.path, { recursive: true, force: true });
rmSync(fixture, { recursive: true, force: true });
console.log(JSON.stringify(result));
