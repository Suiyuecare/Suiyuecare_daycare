import { chmodSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

// Only descriptors created here or explicitly bound to a prior successful
// restore receipt can authorize cleanup; no environment/glob/broad path input.
const ownedDirectories = new WeakSet();

export function createNativeRestoreDirectory() {
  const created = mkdtempSync(join(tmpdir(), "daycare-native-restore-"));
  chmodSync(created, 0o700);
  // Preserve the OS-provided short alias for pg_ctl/Unix sockets. On macOS,
  // expanding /var to /private/var can exceed sockaddr_un's path limit.
  // Identity checks still bind every operation to the captured canonical root.
  const path = created, canonicalPath = realpathSync(created);
  const info = lstatSync(path);
  const descriptor = Object.freeze({ path, canonicalPath, device: info.dev, inode: info.ino, uid: info.uid });
  ownedDirectories.add(descriptor);
  verifyDirectory(descriptor);
  return descriptor;
}

export function adoptNativeRestoreDirectoryFromReport(report) {
  if (!report || report.operation !== "native_restore" || report.project !== "diompsnswchpfguvryan" ||
    report.serverStopped !== true || report.exactRowFingerprintMatch !== true ||
    typeof report.localDataDirectory !== "string" || !isAbsolute(report.localDataDirectory) ||
    resolve(report.localDataDirectory) !== report.localDataDirectory || basename(report.localDataDirectory) !== "data")
    throw new Error("RESTORE_PREVIOUS_RECEIPT_INVALID");
  const candidate = dirname(report.localDataDirectory);
  let info, path;
  try {
    info = lstatSync(candidate);
    path = realpathSync(candidate);
  } catch { throw new Error("RESTORE_PREVIOUS_DIRECTORY_UNAVAILABLE"); }
  if (!info.isDirectory() || info.isSymbolicLink() || dirname(path) !== realpathSync(tmpdir()) ||
    !/^daycare-native-restore-[A-Za-z0-9]+$/u.test(basename(path)))
    throw new Error("RESTORE_PREVIOUS_DIRECTORY_INVALID");
  const descriptor = Object.freeze({ path: candidate, canonicalPath: path,
    device: info.dev, inode: info.ino, uid: info.uid, previousReceipt: true });
  ownedDirectories.add(descriptor);
  verifyDirectory(descriptor);
  return descriptor;
}

function verifyDirectory(directory) {
  if (!directory || !ownedDirectories.has(directory)) throw new Error("RESTORE_CLEANUP_DIRECTORY_NOT_OWNED");
  let info;
  try { info = lstatSync(directory.path); }
  catch { throw new Error("RESTORE_CLEANUP_DIRECTORY_UNAVAILABLE"); }
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory.path) !== directory.canonicalPath ||
    dirname(directory.canonicalPath) !== realpathSync(tmpdir()) ||
    ![tmpdir(), realpathSync(tmpdir())].includes(dirname(directory.path)) ||
    !/^daycare-native-restore-[A-Za-z0-9]+$/u.test(basename(directory.path)) ||
    info.dev !== directory.device || info.ino !== directory.inode || info.uid !== directory.uid ||
    (typeof process.getuid === "function" && info.uid !== process.getuid()) || (info.mode & 0o777) !== 0o700)
    throw new Error("RESTORE_CLEANUP_DIRECTORY_CHANGED");
}

export async function cleanupNativeRestoreDirectory({ directory, startAttempted, runPgCtl }) {
  verifyDirectory(directory);
  const data = join(directory.path, "data");
  const dataInfo = lstatSync(data, { throwIfNoEntry: false });
  if ((dataInfo && (!dataInfo.isDirectory() || dataInfo.isSymbolicLink() || realpathSync(data) !== join(directory.canonicalPath, "data"))) ||
    (startAttempted && !dataInfo)) throw new Error("RESTORE_CLEANUP_DATA_DIRECTORY_CHANGED");
  const pidFile = join(data, "postmaster.pid");
  if (startAttempted) {
    // pg_ctl -w start can return nonzero after launching postmaster. Inspect
    // our exact -D directory even when the caller never observed start success.
    const status = await runPgCtl(["-D", data, "status"], [0, 3]);
    if (status !== 0 && status !== 3) throw new Error("RESTORE_CLEANUP_STATUS_UNCONFIRMED");
    if (status === 0) {
      if (directory.previousReceipt) throw new Error("RESTORE_PREVIOUS_SERVER_STILL_RUNNING");
      await runPgCtl(["-D", data, "-m", "fast", "-w", "stop"], [0]);
      if (await runPgCtl(["-D", data, "status"], [0, 3]) !== 3)
        throw new Error("RESTORE_CLEANUP_SERVER_STILL_RUNNING");
    }
  }
  // An ambiguous startup/stale PID must not be erased or reported as stopped.
  // The operator can investigate the retained private directory after failure.
  if (lstatSync(pidFile, { throwIfNoEntry: false })) throw new Error("RESTORE_CLEANUP_PID_UNCONFIRMED");
  verifyDirectory(directory);
  // The exact mkdtemp directory has been revalidated by identity and ownership.
  // rmSync unlinks any nested symlinks; it does not follow their external target.
  try { rmSync(directory.path, { recursive: true, force: false }); }
  catch { throw new Error("RESTORE_CLEANUP_REMOVE_FAILED"); }
  if (existsSync(directory.path)) throw new Error("RESTORE_CLEANUP_PLAINTEXT_REMAINS");
  return { serverStopped: true, plaintextDirectoryRemoved: true };
}
