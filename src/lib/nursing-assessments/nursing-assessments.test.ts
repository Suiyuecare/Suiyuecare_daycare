import { describe, expect, it } from "vitest";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { nursingContentSchema, nursingRequestSchema, nursingSnapshotSchema, nursingVersionSchema,
  parseNursingActionSuccess, parseNursingReceipt, parseNursingRequest, projectNursingAssessmentSnapshot } from "./parser";
import type { NursingReceipt, NursingRequest, NursingVersion } from "./types";

const id = "51000000-0000-4000-8000-000000000001";
const demo = buildDemoNursingAssessmentSnapshot(id, id);
const version = demo.clients[0]!.versions[0]!;
const request: NursingRequest = { action: "create_draft", clientId: id, content: version.content };
const expected = { request, idempotencyKey: id, organizationId: id, branchId: id, actorUserId: version.recordedBy };
const receipt: NursingReceipt = { operationId: id, ...expected, result: version, replayed: false, persisted: true, demo: false };

describe("manual nursing contracts", () => {
  it("accepts explicit missing / NA with reasons and requires no official score", () => {
    expect(nursingContentSchema.safeParse(version.content).success).toBe(true);
    expect(nursingSnapshotSchema.safeParse(demo).success).toBe(true);
  });
  it.each([
    { state: "missing", detail: null, reason: null },
    { state: "not_applicable", detail: "hidden", reason: "NA" },
    { state: "recorded", detail: null, reason: null },
    { state: "recorded", detail: "observation", reason: "contradictory" },
  ])("rejects ambiguous nursing field %j", (field) => {
    const content = structuredClone(version.content);
    Object.assign(content.domains.observations, field);
    expect(nursingContentSchema.safeParse(content).success).toBe(false);
  });
  it.each([
    { state: "missing", dueOn: "2026-10-01", reason: "unknown" },
    { state: "recorded", dueOn: null, reason: "manual" },
    { state: "recorded", dueOn: "2000-01-01", reason: "too early" },
    { state: "not_applicable", dueOn: null, reason: "" },
  ])("rejects contradictory reassessment %j", (reassessment) => {
    expect(nursingContentSchema.safeParse({ ...version.content, reassessment }).success).toBe(false);
  });
  it("rejects invalid calendar dates, control characters and extra clinical scores", () => {
    expect(nursingContentSchema.safeParse({ ...version.content, assessedOn: "2026-02-30" }).success).toBe(false);
    expect(nursingContentSchema.safeParse({ ...version.content, officialScore: 0 }).success).toBe(false);
    const copy = structuredClone(version.content); copy.domains.observations.detail = "bad\u0001";
    expect(nursingContentSchema.safeParse(copy).success).toBe(false);
  });
  it("requires valid actor idempotency UUID and strict operation keys", () => {
    expect(() => parseNursingRequest(request, "invalid")).toThrow();
    expect(nursingRequestSchema.safeParse({ ...request, nurseUserId: id }).success).toBe(false);
  });
  it("sign cannot smuggle revised content", () => {
    expect(nursingRequestSchema.safeParse({ action: "sign", clientId: id, assessmentKey: id,
      previousVersionId: id, expectedVersion: 1, expectedContentHash: "a".repeat(64), content: version.content }).success).toBe(false);
  });
  it("rejects unsigned evidence labelled signed", () => {
    expect(nursingVersionSchema.safeParse({ ...version, state: "signed" }).success).toBe(false);
  });
  it("accepts exact persisted correlated receipt", () => {
    expect(parseNursingReceipt(receipt, expected, 201)).toEqual(receipt);
  });
  it.each(["actorUserId", "branchId", "organizationId", "idempotencyKey"])("rejects other %s receipt", (key) => {
    expect(() => parseNursingReceipt({ ...receipt, [key]: "51000000-0000-4000-8000-000000000099" }, expected)).toThrow();
  });
  it("rejects receipt with changed result narrative even when request matches", () => {
    const content = structuredClone(version.content); content.domains.observations.detail = "wrong narrative";
    expect(() => parseNursingReceipt({ ...receipt, result: { ...version, content } }, expected)).toThrow();
  });
  it("rejects mismatched success HTTP status and envelope fields", () => {
    const body = { requestId: id, status: "ok", data: receipt, errors: [] };
    expect(() => parseNursingActionSuccess(body, expected, 200)).toThrow();
    expect(() => parseNursingActionSuccess({ ...body, persisted: true }, expected, 201)).toThrow();
    expect(parseNursingActionSuccess(body, expected, 201).persisted).toBe(true);
  });
  function signedSnapshot() {
    const signed: NursingVersion = { ...structuredClone(version), version: 2,
      versionId: "51000000-0000-4000-8000-000000000021", previousVersionId: version.versionId,
      previousContentHash: version.contentHash, state: "signed", signedAt: version.createdAt,
      signedBy: version.recordedBy, signerDisplayName: version.recorderDisplayName,
      signaturePurpose: "人工護理評估簽署", signatureChallengeId: id };
    return { ...demo, demo: false, clients: [{ ...demo.clients[0]!, versions: [signed, version], versionsTotal: 2 }], clientTotal: 1 };
  }
  it("accepts a complete immutable draft-to-sign chain", () => {
    expect(projectNursingAssessmentSnapshot(signedSnapshot(), id, id).clients[0]!.versions).toHaveLength(2);
  });
  it("rejects missing predecessor in an allegedly complete version list", () => {
    const snapshot = signedSnapshot(); snapshot.clients[0]!.versions.pop(); snapshot.clients[0]!.versionsTotal = 1;
    expect(() => projectNursingAssessmentSnapshot(snapshot, id, id)).toThrow();
  });
  it("rejects signed content that differs from the predecessor draft", () => {
    const snapshot = signedSnapshot(); snapshot.clients[0]!.versions[0]!.content.domains.observations.detail = "tampered";
    expect(() => projectNursingAssessmentSnapshot(snapshot, id, id)).toThrow();
  });
  it("rejects signed-to-draft transition even when IDs and hashes link", () => {
    const snapshot = signedSnapshot();
    const previous = snapshot.clients[0]!.versions[0]!;
    const draft: NursingVersion = { ...version, version: 3, versionId: "51000000-0000-4000-8000-000000000031",
      previousVersionId: previous.versionId, previousContentHash: previous.contentHash };
    snapshot.clients[0]!.versions.unshift(draft); snapshot.clients[0]!.versionsTotal++;
    expect(() => projectNursingAssessmentSnapshot(snapshot, id, id)).toThrow();
  });
  it("rejects draft directly labelled as signed correction", () => {
    const snapshot = signedSnapshot(); Object.assign(snapshot.clients[0]!.versions[0]!, {
      state: "corrected", correctionReason: "reason", signaturePurpose: "人工護理評估更正簽署" });
    expect(() => projectNursingAssessmentSnapshot(snapshot, id, id)).toThrow();
  });
});
