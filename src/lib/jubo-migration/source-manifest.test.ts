import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  computeJuboRecordSetSha256,
  inspectJuboSourceManifest,
  JUBO_SOURCE_MANIFEST_VERSION,
  type JuboManifestRow,
  type JuboSourceManifest,
} from "./source-manifest";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const expected = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  targetBranchId: "22222222-2222-4222-8222-222222222222",
  sourceBranchHmacSha256: hash("synthetic-source-branch"),
  hmacKeyId: "synthetic-key-v1",
};

function row(suffix: string, status = "present"): JuboManifestRow {
  return {
    sourceIdHmacSha256: hash(`synthetic-source-id-${suffix}`),
    rowSha256: hash(`synthetic-canonical-row-${suffix}`),
    identityHmacSha256: hash(`synthetic-identity-${suffix}`),
    sourceBranchHmacSha256: expected.sourceBranchHmacSha256,
    sourceStatus: status,
    sourceUpdatedAt: "2026-09-25T08:00:00Z",
    statusEffectiveOn: "2026-09-01",
    historicalRecordCount: 0,
    attachmentCount: 0,
  };
}

function manifest(rows: JuboManifestRow[]): JuboSourceManifest {
  return {
    schemaVersion: JUBO_SOURCE_MANIFEST_VERSION,
    snapshotId: "33333333-3333-4333-8333-333333333333",
    organizationId: expected.organizationId,
    targetBranchId: expected.targetBranchId,
    hmacAlgorithm: "HMAC-SHA256",
    hmacKeyId: expected.hmacKeyId,
    sourceSnapshotSha256: hash("synthetic-encrypted-export-bytes"),
    declaredRecordSetSha256: computeJuboRecordSetSha256(rows),
    declaredRowCount: rows.length,
    declaredStatusTotals: {
      present: rows.filter((item) => item.sourceStatus === "present").length,
      pause: rows.filter((item) => item.sourceStatus === "pause").length,
      closed: rows.filter((item) => item.sourceStatus === "closed").length,
      other: rows.filter((item) => !["present", "pause", "closed"].includes(item.sourceStatus)).length,
    },
    rows,
  };
}

describe("pseudonymous Jubo source manifest preflight", () => {
  it("creates stable keys and order-independent hashes without authorizing a commit", () => {
    const source = [row("a", "present"), row("b", "pause"), row("c", "closed")];
    const first = inspectJuboSourceManifest(manifest(source), expected);
    const reordered = inspectJuboSourceManifest(manifest([...source].reverse()), expected);

    expect(first.offlineConsistencyPassed).toBe(true);
    expect(first.blockedRows).toBe(0);
    expect(first.statusTotals).toEqual({ present: 1, pause: 1, closed: 1, other: 0 });
    expect(first.computedRecordSetSha256).toBe(reordered.computedRecordSetSha256);
    expect(first.batchFingerprint).toBe(reordered.batchFingerprint);
    expect(first.rows[0]?.externalKeyCandidate).toBe(`jubo:${expected.hmacKeyId}:${source[0]!.sourceIdHmacSha256}`);
    expect(first.rows.map((item) => item.targetStatusCandidate)).toEqual(["active", "suspended", "closed"]);
    expect(first.issues.filter((issue) => issue.code === "STATUS_REVIEW_REQUIRED")).toHaveLength(3);
    expect(first.sourceSnapshotExternallyVerified).toBe(false);
    expect(first.hmacProvenanceExternallyVerified).toBe(false);
    expect(first.approvedForCommit).toBe(false);
  });

  it("blocks mismatched declaration, scope, HMAC key and record-set hash", () => {
    const source = manifest([row("a")]);
    const result = inspectJuboSourceManifest({
      ...source,
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      hmacKeyId: "other-key",
      declaredRowCount: 2,
      declaredStatusTotals: { present: 0, pause: 1, closed: 0, other: 0 },
      declaredRecordSetSha256: hash("wrong"),
    }, expected);
    expect(result.offlineConsistencyPassed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "DESTINATION_SCOPE_MISMATCH", "HMAC_KEY_MISMATCH", "DECLARED_ROW_COUNT_MISMATCH",
      "DECLARED_STATUS_TOTAL_MISMATCH", "RECORD_SET_HASH_MISMATCH",
    ]));
    expect(result.approvedForCommit).toBe(false);
  });

  it("blocks duplicate stable source, identity and row hashes", () => {
    const duplicate = row("a");
    const result = inspectJuboSourceManifest(manifest([duplicate, { ...duplicate }]), expected);
    expect(result.blockedRows).toBe(2);
    for (const code of ["DUPLICATE_SOURCE_ID", "DUPLICATE_IDENTITY", "DUPLICATE_ROW_HASH"]) {
      expect(result.issues.filter((issue) => issue.code === code)).toHaveLength(2);
    }
  });

  it("distinguishes missing inventory from confirmed zero and blocks branch/status ambiguity", () => {
    const source = row("a", "unknown");
    const result = inspectJuboSourceManifest(manifest([{
      ...source,
      identityHmacSha256: null,
      sourceBranchHmacSha256: hash("other-branch"),
      sourceUpdatedAt: "not-a-date",
      statusEffectiveOn: "2026-02-30",
      historicalRecordCount: null,
      attachmentCount: null,
    }]), expected);
    expect(result.statusTotals.other).toBe(1);
    expect(result.rows[0]?.targetStatusCandidate).toBeNull();
    expect(result.rows[0]?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "IDENTITY_DIGEST_MISSING", "SOURCE_BRANCH_MISMATCH", "SOURCE_TIMESTAMP_INVALID",
      "STATUS_DATE_INVALID", "UNMAPPED_SOURCE_STATUS", "HISTORY_INVENTORY_MISSING",
      "ATTACHMENT_INVENTORY_MISSING",
    ]));
    expect(result.offlineConsistencyPassed).toBe(false);
    expect(inspectJuboSourceManifest(manifest([row("b")]), expected).issues.map((issue) => issue.code))
      .not.toContain("HISTORY_INVENTORY_MISSING");
  });

  it("rejects impossible timestamps and keeps missing branch/date review explicit", () => {
    for (const timestamp of ["2026-02-30T08:00:00Z", "2026-09-01T25:00:00Z", "2026-09-01T08:00:00+15:00"]) {
      const source = { ...row(timestamp), sourceUpdatedAt: timestamp, sourceBranchHmacSha256: null, statusEffectiveOn: null };
      const result = inspectJuboSourceManifest(manifest([source]), expected);
      expect(result.rows[0]?.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
        "SOURCE_TIMESTAMP_INVALID", "SOURCE_BRANCH_MISSING", "LIFECYCLE_DATE_REVIEW_REQUIRED",
      ]));
      expect(result.offlineConsistencyPassed).toBe(false);
    }
  });

  it("rejects extra patient fields and malformed input without reflecting their values", () => {
    const source = manifest([row("a")]);
    const accidentalPatientField = { ...source, rows: [{ ...source.rows[0], displayName: "SYNTHETIC PRIVATE NAME" }] };
    expect(() => inspectJuboSourceManifest(accidentalPatientField, expected))
      .toThrowError("JUBO_MANIFEST_INVALID_SHAPE");
    expect(() => inspectJuboSourceManifest({ ...source, sourceSnapshotSha256: "not-a-hash" }, expected))
      .toThrowError("JUBO_MANIFEST_INVALID_SHAPE");
    expect(() => inspectJuboSourceManifest({ ...source, rows: Array.from({ length: 501 }, (_, index) => row(String(index))) }, expected))
      .toThrowError("JUBO_MANIFEST_INVALID_SHAPE");
  });

  it("CLI prints only aggregate, non-identifying counts and rejects raw fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daycare-jubo-manifest-"));
    const manifestPath = join(directory, "manifest.json");
    const scopePath = join(directory, "scope.json");
    try {
      const source = manifest([row("synthetic-a")]);
      await writeFile(manifestPath, JSON.stringify(source), { mode: 0o600 });
      await writeFile(scopePath, JSON.stringify(expected), { mode: 0o600 });
      const cli = fileURLToPath(new URL("./check-source-manifest.mjs", import.meta.url));
      const valid = spawnSync(process.execPath, [cli, manifestPath, scopePath], { encoding: "utf8" });
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({
        sourceRows: 1, blockedRows: 0, offlineConsistencyPassed: true, approvedForCommit: false,
      });
      expect(valid.stdout).not.toContain(source.rows[0]!.sourceIdHmacSha256);
      await writeFile(manifestPath, JSON.stringify({ ...source, rows: [{ ...source.rows[0], displayName: "SYNTHETIC PRIVATE NAME" }] }), { mode: 0o600 });
      const invalid = spawnSync(process.execPath, [cli, manifestPath, scopePath], { encoding: "utf8" });
      expect(invalid.status).toBe(2);
      expect(invalid.stderr).not.toContain("SYNTHETIC PRIVATE NAME");
      expect(invalid.stdout).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
