import { describe, expect, it } from "vitest";

import { buildDemoPhysicalTherapyServiceSnapshot } from "./demo";
import {
  parseCreatePhysicalTherapyServiceDraft,
  parsePhysicalTherapyServiceActionError,
  parsePhysicalTherapyServiceActionSuccess,
  parsePhysicalTherapyServiceMutation,
  parsePhysicalTherapyServiceOperationResult,
} from "./parser";
import { filterDemoPhysicalTherapyServiceSnapshot } from "./projection";
import { parsePhysicalTherapyServiceQuery } from "./query";

const organizationId = "34000000-0000-4000-8000-000000000001";
const branchId = "34000000-0000-4000-8000-000000000002";
const clientId = "34000000-0000-4000-8000-000000000011";
const therapistUserId = "34000000-0000-4000-8000-000000000003";
const recordKey = "34000000-0000-4000-8000-000000000021";
const versionId = "34000000-0000-4000-8000-000000000022";
const operationId = "34000000-0000-4000-8000-000000000081";
const idempotencyKey = "34000000-0000-4000-8000-000000000082";
const requestId = "34000000-0000-4000-8000-000000000083";
const occurredAt = "2026-09-02T01:30:00.000Z";

const recorded = (text: string) => ({
  state: "recorded" as const,
  text,
  reason: null,
});
const missing = (reason: string) => ({
  state: "missing" as const,
  text: null,
  reason,
});
const notApplicable = (reason: string) => ({
  state: "not_applicable" as const,
  text: null,
  reason,
});

const createBody = {
  action: "create_draft" as const,
  clientId,
  occurredAt,
  serviceContent: recorded("合成服務內容"),
  clientReaction: missing("合成示例：本次未取得反應"),
  recommendation: notApplicable("合成示例：本次沒有新建議"),
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    organization_id: organizationId,
    branch_id: branchId,
    client_id: clientId,
    record_key: recordKey,
    version_id: versionId,
    record_version: 1,
    record_state: "draft",
    occurred_at: occurredAt,
    therapist_user_id: therapistUserId,
    service_status_at_occurrence: "active",
    assessment_reference_version_id: null,
    committed_at: "2026-09-02T01:31:00.000Z",
    replayed: false,
    ...overrides,
  };
}

function success(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    status: "ok",
    data: {
      action: "create_draft",
      operationId,
      organizationId,
      branchId,
      clientId,
      recordKey,
      versionId,
      recordVersion: 1,
      recordState: "draft",
      occurredAt,
      therapistUserId,
      serviceStatusAtOccurrence: "active",
      assessmentReferenceVersionId: null,
      committedAt: "2026-09-02T01:31:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("page 40 physical therapy service contracts", () => {
  it("builds a synthetic service snapshot with explicit unavailable boundaries", () => {
    const snapshot = buildDemoPhysicalTherapyServiceSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.metrics).toMatchObject({
      drafts: 1,
      signed: 1,
      corrected: 1,
      linkedAssessments: 2,
    });
    expect(snapshot).toMatchObject({
      assessmentLinkStatus: "readonly_latest_terminal",
      formulaStatus: "not_configured",
      diagnosisStatus: "not_configured",
      automaticRecommendationStatus: "not_configured",
      attachmentStatus: "not_configured",
      exportStatus: "not_configured",
      offlineSyncStatus: "not_configured",
    });
  });

  it("keeps all demo identities and narratives visibly synthetic", () => {
    const snapshot = buildDemoPhysicalTherapyServiceSnapshot();
    expect(snapshot.records.every((item) =>
      item.clientDisplayName.includes("合成"))).toBe(true);
    expect(snapshot.therapistOptions.every((item) =>
      item.displayName.includes("合成"))).toBe(true);
  });

  it("keeps missing and not applicable distinct through the projection", () => {
    const snapshot = buildDemoPhysicalTherapyServiceSnapshot();
    expect(snapshot.records.some((item) =>
      item.clientReaction.state === "missing")).toBe(true);
    expect(snapshot.records.some((item) =>
      item.recommendation.state === "not_applicable")).toBe(true);
    expect(snapshot.records.some((item) =>
      item.assessmentReference.status === "none_available")).toBe(true);
  });

  it("filters the same projected collection by client therapist state and keyword", () => {
    const snapshot = buildDemoPhysicalTherapyServiceSnapshot();
    const selected = snapshot.records.find((item) =>
      item.recordState === "signed")!;
    const filtered = filterDemoPhysicalTherapyServiceSnapshot(snapshot, {
      dateFrom: null,
      dateTo: null,
      clientId: selected.clientId,
      therapistUserId: selected.therapistUserId,
      recordState: "signed",
      keyword: "坐站轉位",
    });
    expect(filtered.records.map((item) => item.recordKey))
      .toEqual([selected.recordKey]);
    expect(filtered.metrics.signed).toBe(1);
    expect(filtered.matchingTotal).toBe(1);
  });

  it("parses exact query keys and rejects arrays, reverse dates and controls", () => {
    expect(parsePhysicalTherapyServiceQuery({
      from: "2026-09-01",
      to: "2026-09-02",
      client: clientId.toUpperCase(),
      therapist: therapistUserId,
      state: "signed",
      q: " 合成服務 ",
    })).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-02",
      clientId,
      therapistUserId,
      recordState: "signed",
      keyword: "合成服務",
    });
    for (const value of [
      { client: [clientId] },
      { extra: "widen" },
      { from: "2026-09-03", to: "2026-09-02" },
      { state: "delivered" },
      { q: "unsafe\u0000" },
    ]) {
      expect(() => parsePhysicalTherapyServiceQuery(value))
        .toThrow("INVALID_PHYSICAL_THERAPY_SERVICE_QUERY");
    }
  });

  it("accepts explicit recorded missing and not-applicable service values", () => {
    expect(parseCreatePhysicalTherapyServiceDraft(createBody, idempotencyKey))
      .toEqual({ ...createBody, idempotencyKey });
  });

  it.each([
    [{ ...createBody, serviceContent: recorded("") }, "empty recorded"],
    [{ ...createBody, clientReaction: missing("") }, "missing no reason"],
    [{ ...createBody, recommendation: {
      state: "not_applicable", text: "forged", reason: "reason",
    } }, "not applicable with text"],
    [{ ...createBody, diagnosis: "invented" }, "unknown clinical field"],
    [{ ...createBody, occurredAt: "2026-09-02T09:30:00" }, "no offset"],
  ])("rejects malformed service content: %s", (body, _label) => {
    expect(_label.length).toBeGreaterThan(0);
    expect(() => parseCreatePhysicalTherapyServiceDraft(body, idempotencyKey))
      .toThrow(/未通過驗證/u);
  });

  it("requires a valid actor-scoped idempotency key", () => {
    expect(() => parseCreatePhysicalTherapyServiceDraft(createBody, null))
      .toThrow(/冪等鍵/u);
    expect(() => parseCreatePhysicalTherapyServiceDraft(createBody, "same"))
      .toThrow(/冪等鍵/u);
  });

  it("keeps sign input strict and narrative free", () => {
    expect(parsePhysicalTherapyServiceMutation({
      action: "sign",
      clientId,
      recordKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idempotencyKey)).toMatchObject({ action: "sign", expectedVersion: 1 });
    expect(() => parsePhysicalTherapyServiceMutation({
      action: "sign",
      clientId,
      recordKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      recommendation: recorded("forged"),
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("requires a reason and full explicit values for correction", () => {
    const correction = {
      ...createBody,
      action: "correct" as const,
      recordKey,
      previousVersionId: versionId,
      expectedVersion: 2,
      correctionReason: "修正原簽署紀錄中的事實",
    };
    expect(parsePhysicalTherapyServiceMutation(correction, idempotencyKey))
      .toMatchObject({ action: "correct", correctionReason: correction.correctionReason });
    expect(() => parsePhysicalTherapyServiceMutation({
      ...correction,
      correctionReason: "",
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("strictly parses a database receipt without widening", () => {
    expect(parsePhysicalTherapyServiceOperationResult(row(), "create_draft"))
      .toMatchObject({
        action: "create_draft",
        organizationId,
        branchId,
        clientId,
        recordVersion: 1,
        assessmentReferenceVersionId: null,
      });
    expect(() => parsePhysicalTherapyServiceOperationResult({
      ...row(), score: 9,
    }, "create_draft")).toThrow(/完成憑證/u);
  });

  it("correlates success to tenant branch client action version and HTTP status", () => {
    expect(parsePhysicalTherapyServiceActionSuccess(success(), {
      action: "create_draft",
      organizationId,
      branchId,
      clientId,
    }, 201).data.recordKey).toBe(recordKey);
    for (const [payload, status] of [
      [success({ organizationId: "34000000-0000-4000-8000-000000000099" }), 201],
      [success({ branchId: "34000000-0000-4000-8000-000000000099" }), 201],
      [success({ clientId: "34000000-0000-4000-8000-000000000099" }), 201],
      [success({ recordState: "signed" }), 201],
      [success(), 200],
    ] as const) {
      expect(() => parsePhysicalTherapyServiceActionSuccess(payload, {
        action: "create_draft", organizationId, branchId, clientId,
      }, status)).toThrow(/MISMATCHED/u);
    }
  });

  it("accepts HTTP 200 only for an exact replay", () => {
    expect(parsePhysicalTherapyServiceActionSuccess(success({ replayed: true }), {
      action: "create_draft", organizationId, branchId, clientId,
    }, 200).data.replayed).toBe(true);
  });

  it("rejects arbitrary structured error codes and control characters", () => {
    const valid = {
      requestId,
      status: "error",
      data: null,
      errors: [{ code: "SERVICE_NOT_CONFIGURED", message: "尚未設定" }],
    };
    expect(parsePhysicalTherapyServiceActionError(valid)).toEqual(valid);
    expect(parsePhysicalTherapyServiceActionError({
      ...valid, errors: [{ code: "unsafe-code", message: "尚未設定" }],
    })).toBeNull();
    expect(parsePhysicalTherapyServiceActionError({
      ...valid, errors: [{ code: "SAFE_CODE", message: "unsafe\u0000" }],
    })).toBeNull();
  });
});
