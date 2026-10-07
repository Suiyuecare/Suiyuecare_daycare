import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Offline preflight for a pseudonymized Jubo patient-master inventory.
 *
 * This deliberately does not accept names, identity numbers, addresses, source
 * records, credentials or attachments. A trusted exporter must create the HMACs
 * and hashes separately; this module cannot attest to that export, access Jubo,
 * approve a match, or write a client. Never treat its result as import approval.
 */
export const JUBO_SOURCE_MANIFEST_VERSION = "jubo-source-manifest@1" as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedCount = z.number().int().min(0).max(1_000_000);
const sourceStatus = z.string().min(1).max(32).regex(/^[a-z_]+$/u);
const sourceRowSchema = z.object({
  sourceIdHmacSha256: digest,
  rowSha256: digest,
  identityHmacSha256: digest.nullable(),
  sourceBranchHmacSha256: digest.nullable(),
  sourceStatus,
  sourceUpdatedAt: z.string().max(40).nullable(),
  statusEffectiveOn: z.string().max(10).nullable(),
  historicalRecordCount: boundedCount.nullable(),
  attachmentCount: boundedCount.nullable(),
}).strict();

const statusTotalsSchema = z.object({
  present: boundedCount,
  pause: boundedCount,
  closed: boundedCount,
  other: boundedCount,
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(JUBO_SOURCE_MANIFEST_VERSION),
  snapshotId: z.uuid(),
  organizationId: z.uuid(),
  targetBranchId: z.uuid(),
  hmacAlgorithm: z.literal("HMAC-SHA256"),
  hmacKeyId: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/u),
  sourceSnapshotSha256: digest,
  declaredRecordSetSha256: digest,
  declaredRowCount: boundedCount,
  declaredStatusTotals: statusTotalsSchema,
  rows: z.array(sourceRowSchema).min(1).max(500),
}).strict();

const expectedScopeSchema = z.object({
  organizationId: z.uuid(),
  targetBranchId: z.uuid(),
  sourceBranchHmacSha256: digest,
  hmacKeyId: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/u),
}).strict();

export type JuboManifestRow = z.infer<typeof sourceRowSchema>;
export type JuboSourceManifest = z.infer<typeof manifestSchema>;
export type JuboExpectedScope = z.infer<typeof expectedScopeSchema>;
export type JuboManifestIssueCode =
  | "DESTINATION_SCOPE_MISMATCH" | "HMAC_KEY_MISMATCH" | "DECLARED_ROW_COUNT_MISMATCH"
  | "DECLARED_STATUS_TOTAL_MISMATCH" | "RECORD_SET_HASH_MISMATCH"
  | "DUPLICATE_SOURCE_ID" | "DUPLICATE_IDENTITY" | "DUPLICATE_ROW_HASH"
  | "IDENTITY_DIGEST_MISSING" | "SOURCE_BRANCH_MISSING" | "SOURCE_BRANCH_MISMATCH"
  | "UNMAPPED_SOURCE_STATUS" | "SOURCE_TIMESTAMP_INVALID" | "STATUS_DATE_INVALID"
  | "STATUS_REVIEW_REQUIRED" | "LIFECYCLE_DATE_REVIEW_REQUIRED"
  | "HISTORY_INVENTORY_MISSING" | "ATTACHMENT_INVENTORY_MISSING";

export type JuboManifestIssue = {
  code: JuboManifestIssueCode;
  severity: "error" | "review";
  rowNumber: number | null;
};

export type JuboManifestInspection = {
  schemaVersion: typeof JUBO_SOURCE_MANIFEST_VERSION;
  snapshotId: string;
  computedRecordSetSha256: string;
  batchFingerprint: string;
  sourceRows: number;
  structurallyValidRows: number;
  blockedRows: number;
  statusTotals: z.infer<typeof statusTotalsSchema>;
  issues: JuboManifestIssue[];
  rows: Array<{
    rowNumber: number;
    externalKeyCandidate: string;
    targetStatusCandidate: "active" | "suspended" | "closed" | null;
    issues: JuboManifestIssue[];
  }>;
  offlineConsistencyPassed: boolean;
  /** Source file and keyed digest provenance need independent human attestation. */
  sourceSnapshotExternallyVerified: false;
  hmacProvenanceExternallyVerified: false;
  approvedForCommit: false;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validTimestamp(value: string | null) {
  if (value === null) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match || !validCalendarDate(match[1]!)) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute > 0)) return false;
  return Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: string | null) {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** A canonical digest of the declared pseudonymous inventory, independent of row order. */
export function computeJuboRecordSetSha256(rows: readonly JuboManifestRow[]) {
  const checked = z.array(sourceRowSchema).min(1).max(500).safeParse(rows);
  if (!checked.success) throw new Error("JUBO_MANIFEST_INVALID_SHAPE");
  const tuples = checked.data.map((row) => [
    row.sourceIdHmacSha256, row.rowSha256, row.identityHmacSha256,
    row.sourceBranchHmacSha256, row.sourceStatus, row.sourceUpdatedAt,
    row.statusEffectiveOn, row.historicalRecordCount, row.attachmentCount,
  ]);
  tuples.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return sha256(JSON.stringify([JUBO_SOURCE_MANIFEST_VERSION, tuples]));
}

/** No network, filesystem, database, credential or mutation capability. */
export function inspectJuboSourceManifest(input: unknown, expectedInput: unknown): JuboManifestInspection {
  const manifestResult = manifestSchema.safeParse(input);
  const expectedResult = expectedScopeSchema.safeParse(expectedInput);
  // Do not return schema errors: an accidental raw patient export could contain PHI.
  if (!manifestResult.success || !expectedResult.success) throw new Error("JUBO_MANIFEST_INVALID_SHAPE");
  const manifest = manifestResult.data;
  const expected = expectedResult.data;
  const issues: JuboManifestIssue[] = [];
  const add = (code: JuboManifestIssueCode, severity: JuboManifestIssue["severity"], rowNumber: number | null = null) => {
    issues.push({ code, severity, rowNumber });
  };
  if (manifest.organizationId !== expected.organizationId || manifest.targetBranchId !== expected.targetBranchId) add("DESTINATION_SCOPE_MISMATCH", "error");
  if (manifest.hmacKeyId !== expected.hmacKeyId) add("HMAC_KEY_MISMATCH", "error");
  if (manifest.declaredRowCount !== manifest.rows.length) add("DECLARED_ROW_COUNT_MISMATCH", "error");
  const statusTotals = { present: 0, pause: 0, closed: 0, other: 0 };
  for (const row of manifest.rows) statusTotals[row.sourceStatus === "present" || row.sourceStatus === "pause" || row.sourceStatus === "closed" ? row.sourceStatus : "other"]++;
  if (Object.keys(statusTotals).some((status) => statusTotals[status as keyof typeof statusTotals] !== manifest.declaredStatusTotals[status as keyof typeof statusTotals])) {
    add("DECLARED_STATUS_TOTAL_MISMATCH", "error");
  }
  const computedRecordSetSha256 = computeJuboRecordSetSha256(manifest.rows);
  if (computedRecordSetSha256 !== manifest.declaredRecordSetSha256) add("RECORD_SET_HASH_MISMATCH", "error");

  const duplicated = (field: "sourceIdHmacSha256" | "identityHmacSha256" | "rowSha256", code: JuboManifestIssueCode) => {
    const seen = new Map<string, number[]>();
    manifest.rows.forEach((row, index) => {
      const value = row[field];
      if (value !== null) seen.set(value, [...(seen.get(value) ?? []), index + 1]);
    });
    for (const numbers of seen.values()) if (numbers.length > 1) for (const number of numbers) add(code, "error", number);
  };
  duplicated("sourceIdHmacSha256", "DUPLICATE_SOURCE_ID");
  duplicated("identityHmacSha256", "DUPLICATE_IDENTITY");
  duplicated("rowSha256", "DUPLICATE_ROW_HASH");

  const rows = manifest.rows.map((row, index) => {
    const rowNumber = index + 1;
    if (row.identityHmacSha256 === null) add("IDENTITY_DIGEST_MISSING", "error", rowNumber);
    if (row.sourceBranchHmacSha256 === null) add("SOURCE_BRANCH_MISSING", "error", rowNumber);
    else if (row.sourceBranchHmacSha256 !== expected.sourceBranchHmacSha256) add("SOURCE_BRANCH_MISMATCH", "error", rowNumber);
    if (!validTimestamp(row.sourceUpdatedAt)) add("SOURCE_TIMESTAMP_INVALID", "error", rowNumber);
    if (row.statusEffectiveOn !== null && !validCalendarDate(row.statusEffectiveOn)) add("STATUS_DATE_INVALID", "error", rowNumber);
    if (row.statusEffectiveOn === null) add("LIFECYCLE_DATE_REVIEW_REQUIRED", "review", rowNumber);
    if (row.historicalRecordCount === null) add("HISTORY_INVENTORY_MISSING", "review", rowNumber);
    if (row.attachmentCount === null) add("ATTACHMENT_INVENTORY_MISSING", "review", rowNumber);
    const targetStatusCandidate = row.sourceStatus === "present" ? "active" as const
      : row.sourceStatus === "pause" ? "suspended" as const
        : row.sourceStatus === "closed" ? "closed" as const : null;
    if (targetStatusCandidate === null) add("UNMAPPED_SOURCE_STATUS", "error", rowNumber);
    else add("STATUS_REVIEW_REQUIRED", "review", rowNumber);
    return {
      rowNumber,
      externalKeyCandidate: `jubo:${manifest.hmacKeyId}:${row.sourceIdHmacSha256}`,
      targetStatusCandidate,
      issues: [] as JuboManifestIssue[],
    };
  });
  for (const issue of issues) if (issue.rowNumber !== null) rows[issue.rowNumber - 1]!.issues.push(issue);
  const blockedRows = rows.filter((row) => row.issues.some((issue) => issue.severity === "error")).length;
  const offlineConsistencyPassed = !issues.some((issue) => issue.severity === "error");
  return {
    schemaVersion: JUBO_SOURCE_MANIFEST_VERSION,
    snapshotId: manifest.snapshotId,
    computedRecordSetSha256,
    batchFingerprint: sha256(JSON.stringify([
      JUBO_SOURCE_MANIFEST_VERSION, manifest.organizationId, manifest.targetBranchId,
      manifest.hmacKeyId, manifest.sourceSnapshotSha256, computedRecordSetSha256,
    ])),
    sourceRows: rows.length,
    structurallyValidRows: rows.length - blockedRows,
    blockedRows,
    statusTotals,
    issues,
    rows,
    offlineConsistencyPassed,
    sourceSnapshotExternallyVerified: false,
    hmacProvenanceExternallyVerified: false,
    approvedForCommit: false,
  };
}
