import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { importBatchRecordSchema, importOperationKeySchema, importUploadOperationSchema } from "./production-model";
import { parseCentralCareHtml } from "./parser";
import { validateHtmlImportFile } from "./validation";
import { CURRENT_MAPPING_VERSION } from "./types";

const organizationId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const reservationId = "00000000-0000-4000-8000-000000000004";
function record(unknown = false, conflict = false) {
  const file = validateHtmlImportFile({ fileName: "synthetic.html", mimeType: "text/html", bytes: new TextEncoder().encode(
    `<!doctype html><meta charset=utf-8><h5>${unknown ? "未知區段" : "需要服務者基本資料"}</h5><table><tr><th>個案姓名</th><td>合成甲</td></tr>${conflict ? "<tr><th>個案姓名</th><td>合成乙</td></tr>" : ""}</table>`) });
  const parsed = parseCentralCareHtml(file, CURRENT_MAPPING_VERSION);
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const retained = new Date(createdAt); retained.setUTCFullYear(retained.getUTCFullYear() + 7);
  return { ...parsed, id: "00000000-0000-4000-8000-000000000005", organizationId, branchId, createdBy: userId,
    version: 1, status: unknown ? "mapping_required" : "ready_for_approval", fileName: file.fileName, mimeType: file.mimeType,
    charset: file.charset, fileSha256: file.sha256, byteLength: file.bytes.length, createdAt, updatedAt: createdAt,
    approval: null, operationKeys: { upload: "original-upload" }, originalObjectReference: JSON.stringify({ reservationId,
      archive: { key: `organizations/${organizationId}/branches/${branchId}/central-html/${file.sha256}/${reservationId}.html`,
        versionId: "immutable-version", retainUntil: retained.toISOString(), sha256: file.sha256, createdAt, byteLength: file.bytes.length } }) };
}
beforeEach(() => vi.useRealTimers());
describe("strict durable general import snapshots", () => {
  it("accepts real static parser output and its exact immutable source", () => {
    expect(importBatchRecordSchema.safeParse(record()).success).toBe(true);
    expect(importBatchRecordSchema.safeParse(record(true)).success).toBe(true);
    expect(importBatchRecordSchema.safeParse(record(false, true)).success).toBe(true);
  });
  it.each(["id", "organizationId", "branchId", "createdBy"])("rejects forged %s UUID", key => {
    expect(importBatchRecordSchema.safeParse({ ...record(), [key]: "forged" }).success).toBe(false);
  });
  it.each([{ originalBytes: new Uint8Array([1]) }, { browserField: true }, { status: "imported" },
    { mappingVersion: "central-care-plan-html@2" }, { contentFingerprint: "f" }, { fileName: "../synthetic.html" },
    { operationKeys: {} }, { operationKeys: { upload: "original-upload", unrecognized: "forged" } },
    { version: 0 }, { updatedAt: "2000-01-01T00:00:00Z" }])("rejects unsupported or inconsistent snapshot fields %#", patch => {
    expect(importBatchRecordSchema.safeParse({ ...record(), ...patch }).success).toBe(false);
  });
  it.each([{ versionId: "null" }, { versionId: "bad version" }, { retainUntil: "2027-01-01T00:00:00Z" },
    { sha256: "f".repeat(64) }, { byteLength: 1 }, { createdAt: "2000-01-01T00:00:00Z" }, { key: "another-scope" }])("rejects changed immutable archive metadata %#", patch => {
    const value = record(); const reference = JSON.parse(value.originalObjectReference);
    value.originalObjectReference = JSON.stringify({ ...reference, archive: { ...reference.archive, ...patch } });
    expect(importBatchRecordSchema.safeParse(value).success).toBe(false);
  });
  it("rejects unknown-field status deception, duplicate field IDs and forged conflict candidates", () => {
    expect(importBatchRecordSchema.safeParse({ ...record(true), status: "ready_for_approval" }).success).toBe(false);
    const value = record(); value.fields.push(value.fields[0]); expect(importBatchRecordSchema.safeParse(value).success).toBe(false);
    const conflicting = record(false, true); expect(conflicting.conflicts.length).toBe(1);
    conflicting.conflicts[0].candidates[0].value = "changed";
    expect(importBatchRecordSchema.safeParse(conflicting).success).toBe(false);
  });
  it("accepts exact approved staging snapshots but never permits incomplete resolutions", () => {
    const value = record(false, true); const updatedAt = new Date().toISOString();
    const conflictResolutions = Object.fromEntries(value.conflicts.map(item => [item.id, item.candidates[0].fieldId]));
    const approved = { ...value, version: 2, updatedAt, operationKeys: { ...value.operationKeys, approve: "approve-key" },
      approval: { approvedAt: updatedAt, approvedBy: userId, idempotencyKey: "approve-key", conflictResolutions } };
    expect(importBatchRecordSchema.safeParse(approved).success).toBe(true);
    expect(importBatchRecordSchema.safeParse({ ...approved, approval: { ...approved.approval, conflictResolutions: {} } }).success).toBe(false);
    expect(importBatchRecordSchema.safeParse({ ...approved, version: 1 }).success).toBe(false);
    expect(importBatchRecordSchema.safeParse({ ...approved, operationKeys: value.operationKeys }).success).toBe(false);
  });
  it("requires exact original metadata for nonduplicate upload but preserves duplicate request names", () => {
    const batch = record(); const request = { fileSha256: batch.fileSha256, fileName: batch.fileName, mimeType: batch.mimeType };
    expect(importUploadOperationSchema.safeParse({ batch, request, duplicate: false, replayed: false }).success).toBe(true);
    const renamed = { batch, request: { ...request, fileName: "renamed.html" }, duplicate: true, replayed: true };
    expect(importUploadOperationSchema.safeParse(renamed).success).toBe(true);
    expect(importUploadOperationSchema.safeParse({ ...renamed, duplicate: false }).success).toBe(false);
    expect(importUploadOperationSchema.safeParse({ ...renamed, request: { ...renamed.request, fileSha256: "f".repeat(64) } }).success).toBe(false);
  });
  it.each(["", " ", "key\n", "key\u0000", "a".repeat(201)])("rejects invalid operation keys %#", key => {
    expect(importOperationKeySchema.safeParse(key).success).toBe(false);
  });
});
