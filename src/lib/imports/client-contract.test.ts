import { describe, expect, it } from "vitest";

import {
  ImportClientContractError,
  importErrorMessage,
  parseImportPreviewEnvelope,
  parseImportReparseEnvelope,
  parseImportUploadEnvelope,
} from "./client-contract";

const batch = {
  id: "80000000-0000-4000-8000-000000000001", version: 1, status: "parsed",
  fileName: "sample.html", byteLength: 31, fileSha256: "a".repeat(64),
  contentFingerprint: "b".repeat(64), mappingVersion: "central-care-plan-html@1",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  sectionCount: 0, fieldCount: 0, warningCount: 0, conflictCount: 0,
  security: { parser: "cheerio-static", scriptElementsBlocked: 0,
    formElementsNeutralized: 0, redirectElementsBlocked: 0, activeElementsBlocked: 0,
    inlineEventHandlersBlocked: 0, externalReferencesBlocked: 0, externalRequestCount: 0 },
} as const;
const wrap = (data: unknown) => ({ requestId: "80000000-0000-4000-8000-000000000002", status: "ok", data, errors: [] });

describe("import browser response contracts", () => {
  it("accepts a correlated upload receipt and rejects status or file substitution", () => {
    const raw = wrap({ status: "parsed", duplicate: false, replayed: false, batch });
    expect(parseImportUploadEnvelope(raw, { fileName: "sample.html", byteLength: 31, httpStatus: 201 }).data.batch.id).toBe(batch.id);
    expect(() => parseImportUploadEnvelope(raw, { fileName: "other.html", byteLength: 31, httpStatus: 201 })).toThrow(ImportClientContractError);
    expect(() => parseImportUploadEnvelope(raw, { fileName: "sample.html", byteLength: 31, httpStatus: 200 })).toThrow(ImportClientContractError);
  });

  it("accepts an immutable duplicate replay and a renamed duplicate only with the exact content hash", () => {
    const raw = wrap({ status: "duplicate", duplicate: true, replayed: true, batch: { ...batch, status: "duplicate" } });
    const expected = { fileName: "renamed.html", byteLength: 31, fileSha256: batch.fileSha256, httpStatus: 200 };
    expect(parseImportUploadEnvelope(raw, expected).data).toMatchObject({ duplicate: true, replayed: true });
    expect(() => parseImportUploadEnvelope(raw, { ...expected, fileSha256: "c".repeat(64) })).toThrow(ImportClientContractError);
    expect(() => parseImportUploadEnvelope(raw, { ...expected, fileSha256: undefined })).toThrow(ImportClientContractError);
    expect(() => parseImportUploadEnvelope(raw, { ...expected, byteLength: 32 })).toThrow(ImportClientContractError);
    expect(() => parseImportUploadEnvelope(wrap({ status: "parsed", duplicate: false, replayed: true, batch }), expected)).toThrow(ImportClientContractError);
  });

  it("rejects mismatched bytes even when the returned filename and size match", () => {
    const raw = wrap({ status: "parsed", duplicate: false, replayed: false, batch });
    expect(() => parseImportUploadEnvelope(raw, {
      fileName: batch.fileName, byteLength: batch.byteLength, httpStatus: 201, fileSha256: "c".repeat(64),
    })).toThrow(ImportClientContractError);
  });

  it("requires preview counts and identity to match the returned arrays", () => {
    const previewData = { batch, sections: [], fields: [], warnings: [], conflicts: [] };
    const raw = wrap(previewData);
    expect(parseImportPreviewEnvelope(raw, { batchId: batch.id, httpStatus: 200 }).data.fields).toEqual([]);
    expect(() => parseImportPreviewEnvelope(wrap({ ...previewData, batch: { ...batch, fieldCount: 1 } }), { batchId: batch.id, httpStatus: 200 })).toThrow(ImportClientContractError);
    expect(() => parseImportPreviewEnvelope(raw, { batchId: "80000000-0000-4000-8000-000000000099", httpStatus: 200 })).toThrow(ImportClientContractError);
  });

  it("rejects forged reparse identity and external-request claims", () => {
    expect(parseImportReparseEnvelope(wrap(batch), { batchId: batch.id, mappingVersion: batch.mappingVersion, httpStatus: 200 }).data.version).toBe(1);
    expect(() => parseImportReparseEnvelope(wrap({ ...batch, id: "80000000-0000-4000-8000-000000000099" }), { batchId: batch.id, mappingVersion: batch.mappingVersion, httpStatus: 200 })).toThrow(ImportClientContractError);
    expect(() => parseImportReparseEnvelope(wrap({ ...batch, security: { ...batch.security, externalRequestCount: 1 } }), { batchId: batch.id, mappingVersion: batch.mappingVersion, httpStatus: 200 })).toThrow(ImportClientContractError);
  });

  it("uses only a structurally verified error message", () => {
    const raw = { requestId: "80000000-0000-4000-8000-000000000003", status: "error", data: null,
      errors: [{ code: "INVALID", message: "安全訊息" }] };
    expect(importErrorMessage(raw, "fallback")).toBe("安全訊息");
    expect(importErrorMessage({ ...raw, debug: "secret" }, "fallback")).toBe("fallback");
  });
});
