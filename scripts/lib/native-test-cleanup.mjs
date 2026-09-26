// This closure owns exactly one newly-created native-test runtime. Never scan,
// adopt or clean historical runtimes, a workspace, user home or a hosted store.
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino && left.uid === right.uid;
const directory = async (path) => {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Native cleanup refuses a symlink or non-directory.");
  return stat;
};
async function assertNoSymlinks(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const stat = await lstat(child);
    if (stat.isSymbolicLink()) throw new Error("Native cleanup refuses symlinks anywhere in its data tree.");
    if (stat.isDirectory()) await assertNoSymlinks(child);
    else if (!stat.isFile()) throw new Error("Native cleanup refuses special files in its data tree.");
  }
}
async function assertNoPostmasterPid(data) {
  try {
    await lstat(join(data, "postmaster.pid"));
    throw new Error("Native cleanup refuses any remaining postmaster.pid.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

export async function createNativeTestRuntime(prefix, { logger = console } = {}) {
  if (typeof prefix !== "string" || !prefix.startsWith("/")
    || !/^daycare-[a-z-]+\.$/.test(basename(prefix))) throw new Error("An explicit owned native-test mkdtemp prefix is required.");
  // Scripts deliberately use /tmp, not inherited TMPDIR (which on macOS can
  // differ, and must never redirect a deletion target into a user workspace).
  const canonicalTmp = await realpath("/tmp");
  const canonicalParent = await realpath(dirname(resolve(prefix)));
  if (canonicalParent !== canonicalTmp) throw new Error("Native cleanup runtime must be a direct child of the OS temporary directory.");
  const runtime = await mkdtemp(prefix);
  const runtimeReal = await realpath(runtime);
  const owner = await directory(runtime);
  if (dirname(runtimeReal) !== canonicalTmp || owner.uid !== process.getuid()) throw new Error("Native runtime ownership validation failed.");
  const data = join(runtime, "data");
  let finalized = false;

  async function cleanupNativeData({ started, stop, testFailure, cleanupErrors: earlierErrors = [] }) {
    if (finalized) throw new Error("Owned native cleanup may run only once.");
    finalized = true;
    const errors = [...earlierErrors];
    let stopped = false;
    try {
      if (started) {
        if (typeof stop !== "function") throw new Error("A successful native pg_ctl stop callback is required.");
        await stop();
        stopped = true;
      }
    } catch (error) { errors.push(error); }

    const retained = (reason) => {
      logger.log(`Native test data retained (${reason}); logs/backups/evidence remain at ${runtime}.`);
      if (errors.length) {
        if (!testFailure) throw new AggregateError(errors, "Native cluster cleanup failed; data retained.");
        // Do not replace an in-flight original test exception in its finally.
        logger.error("Native cleanup also failed; the original test failure is preserved.");
      }
      return { status: "retained", reason, runtime, data };
    };
    if (testFailure) return retained("test_failed");
    if (errors.length) return retained("stop_or_holder_failed");
    if (!stopped) return retained("not_started");
    if (process.env.NATIVE_TEST_RETAIN_DATA === "1") return retained("explicit_opt_in");

    try {
      if (!sameIdentity(await directory(runtime), owner) || await realpath(runtime) !== runtimeReal) throw new Error("Native cleanup refuses a replaced runtime.");
      const dataIdentity = await directory(data);
      if (dataIdentity.uid !== owner.uid || await realpath(data) !== join(runtimeReal, "data")) throw new Error("Native cleanup data is not its exact owned child.");
      const versionPath = join(data, "PG_VERSION");
      const versionStat = await lstat(versionPath);
      if (!versionStat.isFile() || versionStat.isSymbolicLink() || (await readFile(versionPath, "utf8")).trim() !== "17") {
        throw new Error("Native cleanup requires a regular PostgreSQL 17 PG_VERSION file.");
      }
      await assertNoPostmasterPid(data);
      await assertNoSymlinks(data);
      // Recheck both identities and real paths immediately before deleting only
      // this data child. rm never targets runtime, logs, backup or a parent path.
      if (!sameIdentity(await directory(runtime), owner)
        || !sameIdentity(await directory(data), dataIdentity)
        || await realpath(runtime) !== runtimeReal
        || await realpath(data) !== join(runtimeReal, "data")) throw new Error("Native cleanup tree changed during validation.");
      await assertNoPostmasterPid(data);
      await rm(data, { recursive: true, force: false });
      logger.log(`Stopped native test data removed; logs/backups/evidence retained at ${runtime}.`);
      return { status: "removed", runtime, data };
    } catch (error) {
      errors.push(error);
      return retained("validation_or_removal_failed");
    }
  }
  return { runtime, data, cleanupNativeData };
}
