#!/usr/bin/env node
// Offline-only: accepts a digest-only manifest and expected scope, never a raw
// Jubo export. It does not read credentials, use the network, or write files.
import { lstat, readFile } from "node:fs/promises";

import { inspectJuboSourceManifest } from "./source-manifest.ts";

const MAX_INPUT_BYTES = 1024 * 1024;

async function readBoundedJson(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_INPUT_BYTES) {
    throw new Error("JUBO_MANIFEST_INPUT_REJECTED");
  }
  return JSON.parse(await readFile(path, "utf8"));
}

if (process.argv.length !== 4) {
  process.stderr.write("用法：node src/lib/jubo-migration/check-source-manifest.mjs <去識別來源清冊.json> <預期分支範圍.json>\n");
  process.exitCode = 2;
} else {
  try {
    const manifest = await readBoundedJson(process.argv[2]);
    const scope = await readBoundedJson(process.argv[3]);
    const inspection = inspectJuboSourceManifest(manifest, scope);
    const issueCounts = Object.create(null);
    for (const issue of inspection.issues) issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    // Only aggregate counts and issue codes leave the process; never print
    // pseudonymous keys, input JSON, file paths, identities or parse errors.
    process.stdout.write(`${JSON.stringify({
      schemaVersion: inspection.schemaVersion,
      sourceRows: inspection.sourceRows,
      blockedRows: inspection.blockedRows,
      statusTotals: inspection.statusTotals,
      issueCounts,
      offlineConsistencyPassed: inspection.offlineConsistencyPassed,
      sourceSnapshotExternallyVerified: inspection.sourceSnapshotExternallyVerified,
      hmacProvenanceExternallyVerified: inspection.hmacProvenanceExternallyVerified,
      approvedForCommit: inspection.approvedForCommit,
    }, null, 2)}\n`);
    if (!inspection.offlineConsistencyPassed) process.exitCode = 2;
  } catch {
    process.stderr.write("JUBO_MANIFEST_INPUT_REJECTED：只接受 1 MB 以下的去識別來源清冊與預期範圍。\n");
    process.exitCode = 2;
  }
}
