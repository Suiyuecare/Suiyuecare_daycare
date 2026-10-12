import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cleanupNativeRestoreDirectory, createNativeRestoreDirectory } from "../lib/native-restore-cleanup.mjs";

const driver = fileURLToPath(new URL("./fixtures/native-restore-cleanup-child.mjs", import.meta.url));
function run(scenario) {
  const result = spawnSync(process.execPath, [driver, scenario], { encoding: "utf8", env: {}, timeout: 15_000, maxBuffer: 8192 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const value = JSON.parse(result.stdout);
  assert.equal(value.productionVerified, false, "Synthetic fixture is not a real restore proof.");
  assert.equal(value.backupPreserved, true);
  assert.equal(value.externalPreserved, true);
  assert.ok(value.calls.every(call => call.exactDataDirectory), "No native action can target a different data directory.");
  return value;
}
test("successful synthetic start is checked, stopped, rechecked and plaintext removed before receipt", () => {
  const value = run("success");
  assert.equal(value.failure, undefined);
  assert.deepEqual(value.calls.map(call => call.action), ["start", "status", "stop", "status"]);
  assert.deepEqual(value.cleanup, { serverStopped: true, plaintextDirectoryRemoved: true });
  assert.equal(value.directoryExists, false);
  assert.equal(value.receiptWritten, true);
});
test("nonzero start that launched a synthetic server still stops and removes it; operation cannot issue a receipt", () => {
  const value = run("failed-start-running");
  assert.equal(value.failure, "SYNTHETIC_PGCTL_START_FAILED");
  assert.deepEqual(value.calls.map(call => call.action), ["start", "status", "stop", "status"]);
  assert.equal(value.directoryExists, false);
  assert.equal(value.cleanup.serverStopped, true);
  assert.equal(value.receiptWritten, false);
});
test("nonzero start without a server checks its exact directory and removes plaintext without issuing receipt", () => {
  const value = run("failed-start-no-server");
  assert.equal(value.failure, "SYNTHETIC_PGCTL_START_FAILED");
  assert.deepEqual(value.calls.map(call => call.action), ["start", "status"]);
  assert.equal(value.directoryExists, false);
  assert.equal(value.receiptWritten, false);
});
for (const [scenario, error, actions] of [
  ["stop-failure", "SYNTHETIC_PGCTL_STOP_FAILED", ["start", "status", "stop"]],
  ["status-failure", "SYNTHETIC_PGCTL_STATUS_FAILED", ["start", "status"]],
  ["still-running", "RESTORE_CLEANUP_SERVER_STILL_RUNNING", ["start", "status", "stop", "status"]],
  ["ambiguous-pid", "RESTORE_CLEANUP_PID_UNCONFIRMED", ["start", "status"]],
]) {
  test(`${scenario} preserves the private directory and cannot write a success receipt`, () => {
    const value = run(scenario);
    assert.equal(value.failure, error);
    assert.deepEqual(value.calls.map(call => call.action), actions);
    assert.equal(value.directoryExists, true);
    assert.equal(value.directoryMode, 0o700);
    assert.equal(value.receiptWritten, false);
    assert.equal(value.cleanup, undefined);
  });
}
test("failed initialization removes its own plaintext without invoking pg_ctl", () => {
  const value = run("never-started");
  assert.equal(value.startAttempted, false);
  assert.equal(value.failure, "SYNTHETIC_INITDB_FAILED");
  assert.deepEqual(value.calls, []);
  assert.equal(value.directoryExists, false);
  assert.equal(value.receiptWritten, false);
});
for (const scenario of ["root-symlink", "root-replaced", "permissions-changed"]) {
  test(`${scenario} is rejected without cleanup of a changed root or an external target`, () => {
    const value = run(scenario);
    assert.equal(value.failure, "RESTORE_CLEANUP_DIRECTORY_CHANGED");
    assert.equal(value.directoryExists, true);
    assert.equal(value.receiptWritten, false);
  });
}
test("a symlinked data directory cannot redirect pg_ctl to an external cluster", () => {
  const value = run("data-symlink");
  assert.equal(value.failure, "RESTORE_CLEANUP_DATA_DIRECTORY_CHANGED");
  assert.deepEqual(value.calls.map(call => call.action), ["start", "stop"]);
  assert.equal(value.directoryExists, true);
  assert.equal(value.receiptWritten, false);
});
test("nested symlinks are unlinked without deleting their external target", () => {
  const value = run("nested-symlink");
  assert.equal(value.failure, undefined);
  assert.equal(value.directoryExists, false);
  assert.equal(value.receiptWritten, true);
});
test("an exact stopped directory recorded by a prior restore receipt can be rechecked and removed", () => {
  const value = run("prior-stopped");
  assert.equal(value.failure, undefined);
  assert.deepEqual(value.calls.map(call => call.action), ["start", "stop", "status"]);
  assert.equal(value.directoryExists, false);
  assert.equal(value.cleanup.plaintextDirectoryRemoved, true);
});
test("a prior receipt claiming stopped cannot delete or stop a currently running cluster", () => {
  const value = run("prior-running");
  assert.equal(value.failure, "RESTORE_PREVIOUS_SERVER_STILL_RUNNING");
  assert.deepEqual(value.calls.map(call => call.action), ["start", "status"]);
  assert.equal(value.directoryExists, true);
  assert.equal(value.receiptWritten, false);
});
for (const [scenario, code] of [["prior-invalid-receipt", "RESTORE_PREVIOUS_RECEIPT_INVALID"],
  ["prior-broad-directory", "RESTORE_PREVIOUS_DIRECTORY_INVALID"]]) {
  test(`${scenario} cannot authorize deletion`, () => {
    const value = run(scenario);
    assert.equal(value.failure, code);
    assert.equal(value.directoryExists, true);
    assert.equal(value.receiptWritten, false);
    assert.deepEqual(value.calls.map(call => call.action), ["start", "stop"]);
  });
}
test("a supplied broad path cannot authorize recursive cleanup", async () => {
  let called = false;
  await assert.rejects(cleanupNativeRestoreDirectory({ directory: { path: "/" }, startAttempted: true,
    runPgCtl: () => { called = true; } }), /RESTORE_CLEANUP_DIRECTORY_NOT_OWNED/u);
  assert.equal(called, false);
});
test("new restore roots preserve the OS-provided socket alias while binding canonical identity", async () => {
  const directory = createNativeRestoreDirectory();
  try {
    assert.equal(dirname(directory.path), tmpdir());
    assert.equal(directory.canonicalPath, realpathSync(directory.path));
    assert.equal(dirname(directory.canonicalPath), realpathSync(tmpdir()));
  } finally {
    await cleanupNativeRestoreDirectory({ directory, startAttempted: false,
      runPgCtl: () => { throw new Error("NOT_STARTED"); } });
  }
});
test("operator source attempts start before awaiting and issues receipt only after mandatory cleanup", async () => {
  const source = await readFile(new URL("../ops/native-backup-drill.mjs", import.meta.url), "utf8");
  assert.match(source, /startAttempted = true;\s*await run\("pg_ctl"/u);
  assert.match(source, /finally \{\s*await client\?\.end\(\)\.catch\(\(\) => \{\}\);\s*cleanup = await cleanupNativeRestoreDirectory/u);
  assert.ok(source.indexOf("Object.assign(report, cleanup)") > source.indexOf("cleanup = await cleanupNativeRestoreDirectory"));
  assert.ok(source.indexOf("`${filename}.restore-report.json`") > source.indexOf("Object.assign(report, cleanup)"));
  assert.doesNotMatch(source, /if \(running\)/u);
});
