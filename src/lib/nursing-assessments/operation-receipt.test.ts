import { describe, expect, it } from "vitest";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { parseNursingOperationReceipt, parseNursingOperationReceiptEnvelope, type NursingOperationReceiptExpected } from "./operation-receipt";
import type { NursingReceipt, NursingRequest } from "./types";
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T11:00:00Z");
const common = { organizationId: id(80), branchId: id(81), userId: id(13), clientId: id(1), idempotencyKey: id(40), nonce: id(41) };
function fixture(action: NursingRequest["action"] = "create_draft") {
  const source = buildDemoNursingAssessmentSnapshot(common.organizationId, common.branchId).clients[0]!.versions[0]!;
  const existing = { clientId: common.clientId, assessmentKey: source.assessmentKey, previousVersionId: source.versionId,
    expectedVersion: 1, expectedContentHash: source.contentHash };
  const request: NursingRequest = action === "create_draft" ? { action, clientId: common.clientId, content: source.content }
    : action === "sign" ? { action, ...existing } : action === "correct"
      ? { action, ...existing, content: source.content, correctionReason: "合成更正" } : { action, ...existing, content: source.content };
  const signed = action === "sign" || action === "correct", createdAt = new Date(now - 1000).toISOString();
  const receipt: NursingReceipt = { operationId: id(90), organizationId: common.organizationId, branchId: common.branchId,
    actorUserId: common.userId, idempotencyKey: common.idempotencyKey, request, replayed: false, persisted: true, demo: false,
    result: { ...source, versionId: id(91), version: action === "create_draft" ? 1 : 2,
      previousVersionId: action === "create_draft" ? null : source.versionId,
      previousContentHash: action === "create_draft" ? null : source.contentHash, state: action === "correct" ? "corrected" : signed ? "signed" : "draft",
      correctionReason: action === "correct" ? "合成更正" : null, createdAt, signedAt: signed ? createdAt : null,
      signedBy: signed ? common.userId : null, signerDisplayName: signed ? "合成人員" : null,
      signaturePurpose: signed ? action === "sign" ? "人工護理評估簽署" : "人工護理評估更正簽署" : null,
      signatureChallengeId: signed ? id(92) : null } };
  const expected: NursingOperationReceiptExpected = { ...common, action, request };
  const proof = { schemaVersion: 1, status: "committed", ...common, actorUserId: common.userId, action,
    verifiedAt: new Date(now).toISOString(), persisted: true, demo: false, receipt };
  const { userId: _userId, ...wire } = proof; void _userId;
  return { expected, proof: wire, receipt };
}
describe("exact nursing original-operation read proof", () => {
  it.each(["create_draft", "revise_draft", "sign", "correct"] as const)("accepts exact %s without claiming write replay", (action) => {
    const { expected, proof } = fixture(action), result = parseNursingOperationReceipt(proof, expected, now);
    expect(result.status).toBe("committed"); expect(result.receipt?.replayed).toBe(false);
    const { request: _request, ...serverExpected } = expected; void _request;
    expect(parseNursingOperationReceipt(proof, serverExpected, now)).toEqual(result);
    expect(parseNursingOperationReceiptEnvelope({ requestId: id(100), status: "ok", errors: [], data: proof }, expected, now)).toEqual(result);
  });
  it("returns not_found only as false/null, never failure or retry permission", () => {
    const { expected, proof } = fixture(); const absence = { ...proof, status: "not_found", persisted: false, receipt: null };
    expect(parseNursingOperationReceipt(absence, expected, now)).toEqual(absence);
  });
  it.each([{ persisted: true }, { receipt: {} }, { demo: true }, { nonce: id(999) }])("rejects contradictory or mismatched absence %#", (change) => {
    const { expected, proof } = fixture();
    expect(() => parseNursingOperationReceipt({ ...proof, status: "not_found", persisted: false, receipt: null, ...change }, expected, now)).toThrow();
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "idempotencyKey", "nonce"])("binds outer %s", (field) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceipt({ ...proof, [field]: id(999) }, expected, now)).toThrow();
  });
  it.each([{ action: "sign" }, { schemaVersion: 2 }, { demo: true }, { persisted: false }, { receipt: null },
    { unknown: "SECRET" }, { verifiedAt: "2026-09-27T11:00:00" }, { verifiedAt: "2026-02-30T00:00:00Z" },
    { status: "failed" }])("rejects contradictory or unknown outer values %#", (change) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceipt({ ...proof, ...change }, expected, now)).toThrow();
  });
  it.each([-60000, 60000])("accepts exact inclusive clock-skew boundary %d", (offset) => {
    const { expected, proof } = fixture(); proof.receipt.result.createdAt = new Date(now - 120000).toISOString();
    expect(parseNursingOperationReceipt({ ...proof, verifiedAt: new Date(now + offset).toISOString() }, expected, now).status).toBe("committed");
  });
  it.each([-60001, 60001])("rejects stale/future proof beyond %d", (offset) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceipt({ ...proof, verifiedAt: new Date(now + offset).toISOString() }, expected, now)).toThrow();
  });
  it.each([NaN, Infinity])("rejects invalid observation clock %s", (clock) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceipt(proof, expected, clock)).toThrow();
  });
  it.each(["operationId", "organizationId", "branchId", "actorUserId", "idempotencyKey"])("strict inner binding %s", (field) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceipt({ ...proof,
      receipt: { ...proof.receipt, [field]: field === "operationId" ? "bad" : id(999) } }, expected, now)).toThrow();
  });
  it.each([{ replayed: true }, { demo: true }, { persisted: false }, { privateNote: "CLINICAL_SECRET" }])("rejects inner mutation/replay/extra fields %#", (change) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceipt({ ...proof, receipt: { ...proof.receipt, ...change } }, expected, now)).toThrow();
  });
  it.each(["versionId", "previousVersionId", "previousContentHash", "version", "assessmentKey", "recordedBy"])("checks existing version chain %s", (field) => {
    const { expected, proof } = fixture("revise_draft"); const value = field === "versionId" ? proof.receipt.result.previousVersionId
      : field === "previousContentHash" ? "b".repeat(64) : field === "version" ? 9 : id(999);
    expect(() => parseNursingOperationReceipt({ ...proof, receipt: { ...proof.receipt,
      result: { ...proof.receipt.result, [field]: value } } }, expected, now)).toThrow();
  });
  it("rejects createdAt after verification", () => {
    const { expected, proof } = fixture(); proof.receipt.result.createdAt = new Date(now + 1).toISOString();
    expect(() => parseNursingOperationReceipt(proof, expected, now)).toThrow();
  });
  it("server expects stored original but browser rechecks entire frozen clinical request", () => {
    const { expected, proof } = fixture(); const request = expected.request!;
    if (!("content" in request)) throw new Error("fixture");
    const changed = { ...request, content: { ...request.content, assessedOn: "2026-09-01" } };
    expect(() => parseNursingOperationReceipt(proof, { ...expected, request: changed }, now)).toThrow();
    const { request: _request, ...serverExpected } = expected; void _request;
    proof.receipt.request = { ...proof.receipt.request, clientId: id(999) };
    expect(() => parseNursingOperationReceipt(proof, serverExpected, now)).toThrow();
  });
  it.each([{ status: "error" }, { requestId: "bad" }, { errors: [{ message: "SECRET" }] }, { secret: true }])("rejects malformed envelope %#", (change) => {
    const { expected, proof } = fixture(); expect(() => parseNursingOperationReceiptEnvelope({ requestId: id(100), status: "ok", errors: [], data: proof, ...change }, expected, now)).toThrow();
  });
  it("redacts every validation error and normalizes offset and UUIDs", () => {
    const { expected, proof } = fixture(); proof.verifiedAt = "2026-09-27T19:00:00+08:00";
    expect(parseNursingOperationReceipt(proof, expected, now).verifiedAt).toBe("2026-09-27T11:00:00.000Z");
    try { parseNursingOperationReceipt({ secret: "CLINICAL_SECRET" }, expected, now); }
    catch (error) { expect(String(error)).not.toContain("CLINICAL_SECRET"); expect(error).toMatchObject({ code: "NURSING_OPERATION_RECEIPT_INVALID" }); }
  });
});
