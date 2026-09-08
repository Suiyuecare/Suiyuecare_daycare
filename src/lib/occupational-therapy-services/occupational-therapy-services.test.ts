import { describe, expect, it } from "vitest";

import { buildDemoOccupationalTherapyServiceSnapshot } from "./demo";
import {
  occupationalTherapyServiceValueSchema,
  parseCreateOccupationalTherapyServiceDraft,
  parseOccupationalTherapyServiceActionSuccess,
  parseOccupationalTherapyServiceMutation,
  parseOccupationalTherapyServiceOperationResult,
} from "./parser";
import { parseOccupationalTherapyServiceQuery } from "./query";

const organizationId = "41000000-0000-4000-8000-000000000001";
const branchId = "41000000-0000-4000-8000-000000000002";
const clientId = "41000000-0000-4000-8000-000000000011";
const therapistId = "41000000-0000-4000-8000-000000000003";
const operationKey = "41000000-0000-4000-8000-000000000091";
const occurredAt = "2026-09-02T01:00:00.000Z";

const recorded = (text: string) => ({ state: "recorded" as const, text, reason: null });
const missing = (reason: string) => ({ state: "missing" as const, text: null, reason });
const notApplicable = (reason: string) => ({
  state: "not_applicable" as const, text: null, reason,
});
const fields = {
  clientId,
  occurredAt,
  serviceContent: recorded("合成職能治療服務內容"),
  clientReaction: missing("本次尚未取得可記錄反應"),
  recommendation: notApplicable("本次沒有新增人工建議"),
};

function operationRow(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "41000000-0000-4000-8000-000000000092",
    organization_id: organizationId,
    branch_id: branchId,
    client_id: clientId,
    record_key: "41000000-0000-4000-8000-000000000093",
    version_id: "41000000-0000-4000-8000-000000000094",
    record_version: 1,
    record_state: "draft",
    occurred_at: occurredAt,
    therapist_user_id: therapistId,
    service_status_at_occurrence: "active",
    assessment_reference_version_id: null,
    committed_at: "2026-09-02T01:01:00.000Z",
    replayed: false,
    ...overrides,
  };
}

function apiSuccess(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "41000000-0000-4000-8000-000000000095",
    status: "ok",
    data: {
      action: "create_draft",
      operationId: "41000000-0000-4000-8000-000000000092",
      organizationId,
      branchId,
      clientId,
      recordKey: "41000000-0000-4000-8000-000000000093",
      versionId: "41000000-0000-4000-8000-000000000094",
      recordVersion: 1,
      recordState: "draft",
      occurredAt,
      therapistUserId: therapistId,
      serviceStatusAtOccurrence: "active",
      assessmentReferenceVersionId: null,
      committedAt: "2026-09-02T01:01:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("Page 41 occupational therapy service domain", () => {
  it("parses exact filters and keeps the date range", () => {
    expect(parseOccupationalTherapyServiceQuery({
      from: "2026-09-01", to: "2026-09-02", client: clientId,
      therapist: therapistId, state: "signed", q: " 人工建議 ",
    })).toEqual({
      dateFrom: "2026-09-01", dateTo: "2026-09-02", clientId,
      therapistUserId: therapistId, recordState: "signed", keyword: "人工建議",
    });
  });

  it.each([
    { client: [clientId, clientId] },
    { unknown: "value" },
    { from: "2026-09-03", to: "2026-09-02" },
    { client: "not-a-uuid" },
    { from: "2026-02-31" },
    { q: "bad\u0000query" },
  ])("fails closed for invalid or broadening query %#", (query) => {
    expect(() => parseOccupationalTherapyServiceQuery(query)).toThrow(
      "INVALID_OCCUPATIONAL_THERAPY_SERVICE_QUERY",
    );
  });

  it.each([
    recorded("已記錄內容"),
    missing("未取得資料的人工理由"),
    notApplicable("本次情境不適用"),
  ])("accepts the three explicit value states", (value) => {
    expect(occupationalTherapyServiceValueSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    { state: "recorded", text: null, reason: null },
    { state: "recorded", text: "內容", reason: "不得夾帶理由" },
    { state: "missing", text: "不得夾帶內容", reason: "理由" },
    { state: "not_applicable", text: null, reason: "" },
    { state: "missing", text: null, reason: "理由", score: 3 },
  ])("rejects ambiguous or invented value payload %#", (value) => {
    expect(occupationalTherapyServiceValueSchema.safeParse(value).success).toBe(false);
  });

  it("parses a strict create draft with an actor operation key", () => {
    expect(parseCreateOccupationalTherapyServiceDraft(
      { action: "create_draft", ...fields }, operationKey,
    )).toEqual({ action: "create_draft", ...fields, idempotencyKey: operationKey });
  });

  it("rejects extra create fields and invalid operation keys", () => {
    expect(() => parseCreateOccupationalTherapyServiceDraft(
      { action: "create_draft", ...fields, therapistUserId: therapistId }, operationKey,
    )).toThrow();
    expect(() => parseCreateOccupationalTherapyServiceDraft(
      { action: "create_draft", ...fields }, "bad-key",
    )).toThrow();
  });

  it("parses revise, sign and reasoned correction as separate strict actions", () => {
    const chain = {
      clientId,
      recordKey: "41000000-0000-4000-8000-000000000093",
      previousVersionId: "41000000-0000-4000-8000-000000000094",
      expectedVersion: 1,
    };
    expect(parseOccupationalTherapyServiceMutation(
      { action: "revise_draft", ...chain, ...fields }, operationKey,
    ).action).toBe("revise_draft");
    expect(parseOccupationalTherapyServiceMutation(
      { action: "sign", ...chain }, operationKey,
    ).action).toBe("sign");
    expect(parseOccupationalTherapyServiceMutation(
      { action: "correct", ...chain, ...fields, correctionReason: "狹義更正理由" },
      operationKey,
    ).action).toBe("correct");
  });

  it("rejects correction without a reason and signing with narrative fields", () => {
    const chain = {
      clientId,
      recordKey: "41000000-0000-4000-8000-000000000093",
      previousVersionId: "41000000-0000-4000-8000-000000000094",
      expectedVersion: 1,
    };
    expect(() => parseOccupationalTherapyServiceMutation(
      { action: "correct", ...chain, ...fields, correctionReason: "" }, operationKey,
    )).toThrow();
    expect(() => parseOccupationalTherapyServiceMutation(
      { action: "sign", ...chain, serviceContent: recorded("偽造") }, operationKey,
    )).toThrow();
  });

  it("normalizes a strict database receipt and rejects extra fields", () => {
    expect(parseOccupationalTherapyServiceOperationResult(
      operationRow(), "create_draft",
    )).toMatchObject({ action: "create_draft", recordVersion: 1, recordState: "draft" });
    expect(() => parseOccupationalTherapyServiceOperationResult(
      operationRow({ unknown: true }), "create_draft",
    )).toThrow();
  });

  it("correlates exact browser success status and rejects forged scope", () => {
    const expectation = { action: "create_draft" as const, organizationId,
      branchId, clientId };
    expect(parseOccupationalTherapyServiceActionSuccess(
      apiSuccess(), expectation, 201,
    ).data.recordVersion).toBe(1);
    expect(() => parseOccupationalTherapyServiceActionSuccess(
      apiSuccess({ branchId: clientId }), expectation, 201,
    )).toThrow("MISMATCHED_OCCUPATIONAL_THERAPY_SERVICE_SUCCESS");
    expect(() => parseOccupationalTherapyServiceActionSuccess(
      apiSuccess(), expectation, 200,
    )).toThrow("MISMATCHED_OCCUPATIONAL_THERAPY_SERVICE_SUCCESS");
  });

  it("accepts an exact replay only with HTTP 200", () => {
    const expectation = { action: "create_draft" as const, organizationId,
      branchId, clientId };
    expect(parseOccupationalTherapyServiceActionSuccess(
      apiSuccess({ replayed: true }), expectation, 200,
    ).data.replayed).toBe(true);
  });

  it("projects a synthetic immutable history without claiming governed integrations", () => {
    const snapshot = buildDemoOccupationalTherapyServiceSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.records).toHaveLength(3);
    expect(snapshot.metrics).toEqual(expect.objectContaining({
      drafts: 1, signed: 1, corrected: 1, linkedAssessments: 2,
    }));
    expect(snapshot.records.find((record) => record.recordState === "corrected")
      ?.versionHistory).toHaveLength(3);
    expect(snapshot.assessmentLinkStatus).toBe("readonly_latest_terminal");
    expect([
      snapshot.formulaStatus, snapshot.diagnosisStatus,
      snapshot.automaticRecommendationStatus, snapshot.attachmentStatus,
      snapshot.exportStatus, snapshot.offlineSyncStatus,
    ]).toEqual(Array(6).fill("not_configured"));
  });

  it("filters the synthetic snapshot without changing the source identities", () => {
    const all = buildDemoOccupationalTherapyServiceSnapshot();
    const corrected = buildDemoOccupationalTherapyServiceSnapshot({
      dateFrom: null, dateTo: null, clientId: null, therapistUserId: null,
      recordState: "corrected", keyword: "桌面任務",
    });
    expect(corrected.records).toHaveLength(1);
    expect(corrected.records[0]?.recordState).toBe("corrected");
    expect(all.records.map((record) => record.recordKey)).toContain(
      corrected.records[0]?.recordKey,
    );
  });
});
