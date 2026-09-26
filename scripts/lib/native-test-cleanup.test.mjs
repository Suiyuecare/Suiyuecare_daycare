import { afterEach, describe, expect, it, vi } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createNativeTestRuntime } from "./native-test-cleanup.mjs";

// Only the removal-error unit probe substitutes fs.rm; every ownership/path
// check remains the real temporary filesystem. The native smoke is a separate
// process and uses actual fs.rm. No permission assumptions about CI's UID.
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal();
  return { ...filesystem, rm: vi.fn(filesystem.rm) };
});

const created = [];
const logger = () => ({ log: vi.fn(), error: vi.fn() });
async function fixture() {
  const logs = logger();
  const owned = await createNativeTestRuntime("/tmp/daycare-cleanup-unit.", { logger: logs });
  created.push(owned.runtime);
  await mkdir(owned.data);
  await writeFile(join(owned.data, "PG_VERSION"), "17\n");
  await writeFile(join(owned.data, "synthetic-row"), "not patient data");
  await writeFile(join(owned.runtime, "server.log"), "synthetic evidence");
  await writeFile(join(owned.runtime, "synthetic-backup.dump"), "synthetic backup");
  return { ...owned, logger: logs };
}
async function outsideFixture() {
  const path = await mkdtemp("/tmp/daycare-cleanup-outside.");
  created.push(path);
  await writeFile(join(path, "sentinel"), "untouched");
  return path;
}
const exists = async (path) => {
  try { await lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
};
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of created.splice(0)) {
    // Only exact directories created by this test file; never old runtimes.
    await rm(path, { recursive: true, force: false });
  }
  vi.clearAllMocks();
});

describe("owned native test cleanup safety", () => {
  it("removes only exact stopped data and preserves logs, backup and runtime", async () => {
    const f = await fixture(); const stop = vi.fn();
    expect(await f.cleanupNativeData({ started: true, stop })).toMatchObject({ status: "removed", data: f.data });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await exists(f.data)).toBe(false);
    expect(await readFile(join(f.runtime, "server.log"), "utf8")).toBe("synthetic evidence");
    expect(await readFile(join(f.runtime, "synthetic-backup.dump"), "utf8")).toBe("synthetic backup");
  });
  it("stops even when explicit retention is requested", async () => {
    vi.stubEnv("NATIVE_TEST_RETAIN_DATA", "1");
    const f = await fixture(); const stop = vi.fn();
    expect(await f.cleanupNativeData({ started: true, stop })).toMatchObject({ status: "retained", reason: "explicit_opt_in" });
    expect(stop).toHaveBeenCalledTimes(1); expect(await exists(f.data)).toBe(true);
  });
  it("preserves failed-test data and never replaces the original exception", async () => {
    const f = await fixture(); const original = new Error("original assertion");
    const work = async () => {
      try { throw original; }
      finally { await f.cleanupNativeData({ started: true, stop: () => { throw new Error("stop also failed"); }, testFailure: original }); }
    };
    await expect(work()).rejects.toBe(original);
    expect(await exists(f.data)).toBe(true); expect(f.logger.error).toHaveBeenCalledTimes(1);
  });
  it("fails a successful test if native stop fails, retaining data", async () => {
    const f = await fixture();
    await expect(f.cleanupNativeData({ started: true, stop: () => { throw new Error("stop failure"); } })).rejects.toBeInstanceOf(AggregateError);
    expect(await exists(f.data)).toBe(true);
  });
  it("preserves data and fails when a holder cleanup fails", async () => {
    const f = await fixture(); const stop = vi.fn();
    await expect(f.cleanupNativeData({ started: true, stop, cleanupErrors: [new Error("holder failure")] })).rejects.toBeInstanceOf(AggregateError);
    expect(stop).toHaveBeenCalledTimes(1); expect(await exists(f.data)).toBe(true);
  });
  it("never deletes when no server was confirmed started and stopped", async () => {
    const f = await fixture(); const stop = vi.fn();
    expect(await f.cleanupNativeData({ started: false, stop })).toMatchObject({ status: "retained", reason: "not_started" });
    expect(stop).not.toHaveBeenCalled(); expect(await exists(f.data)).toBe(true);
  });
  it.each(["/", "/tmp", "/tmp/data", "/tmp/daycare-cleanup-unit", "/Users/daycare-cleanup-unit.", "../tmp/daycare-cleanup-unit."])("rejects unsafe prefix %s before creating a target", async (prefix) => {
    await expect(createNativeTestRuntime(prefix)).rejects.toThrow();
  });
  it.each(["16\n", "", "17\nextra", "patient-data"])("refuses malformed or wrong PG_VERSION %j", async (version) => {
    const f = await fixture(); await writeFile(join(f.data, "PG_VERSION"), version);
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(await exists(f.data)).toBe(true);
  });
  it("refuses any postmaster.pid even after a reported successful stop", async () => {
    const f = await fixture(); await writeFile(join(f.data, "postmaster.pid"), "999999\n");
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(await exists(f.data)).toBe(true);
  });
  it("refuses a replaced/symlinked data child without touching outside target", async () => {
    const f = await fixture(); const outside = await outsideFixture();
    await rename(f.data, join(f.runtime, "old-data")); await symlink(outside, f.data);
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("untouched");
  });
  it("refuses a nested symlink without touching its target", async () => {
    const f = await fixture(); const outside = await outsideFixture();
    await symlink(outside, join(f.data, "nested-link"));
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(await exists(f.data)).toBe(true); expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("untouched");
  });
  it("refuses a symlinked version file", async () => {
    const f = await fixture(); await rename(join(f.data, "PG_VERSION"), join(f.runtime, "version-evidence"));
    await symlink(join(f.runtime, "version-evidence"), join(f.data, "PG_VERSION"));
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(await exists(f.data)).toBe(true);
  });
  it("refuses a replaced runtime identity", async () => {
    const f = await fixture(); const oldPath = `${f.runtime}-old`; created.push(oldPath);
    await rename(f.runtime, oldPath); await mkdir(f.runtime); await mkdir(f.data); await writeFile(join(f.data, "PG_VERSION"), "17\n");
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(await exists(f.data)).toBe(true); expect(await exists(join(oldPath, "data"))).toBe(true);
  });
  it("surfaces an actual removal-call error instead of passing silently", async () => {
    const f = await fixture();
    rm.mockRejectedValueOnce(new Error("synthetic removal failure"));
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toBeInstanceOf(AggregateError);
    expect(rm).toHaveBeenCalledWith(f.data, { recursive: true, force: false });
    expect(await exists(f.data)).toBe(true);
  });
  it("refuses a second cleanup call", async () => {
    const f = await fixture(); await f.cleanupNativeData({ started: true, stop: vi.fn() });
    await expect(f.cleanupNativeData({ started: true, stop: vi.fn() })).rejects.toThrow("only once");
  });
});
