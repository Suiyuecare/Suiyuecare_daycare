import { describe, expect, it } from "vitest";

import { buildDemoPhysicalTherapyAssessmentSnapshot } from "./demo";
import {
  parseCreatePhysicalTherapyDraft,
  parsePhysicalTherapyActionError,
  parsePhysicalTherapyActionSuccess,
  parsePhysicalTherapyAssessmentMutation,
  parsePhysicalTherapyOperationResult,
} from "./parser";
import { filterDemoPhysicalTherapyAssessmentSnapshot } from "./projection";
import { parsePhysicalTherapyAssessmentFilters } from "./query";

const clientId = "28000000-0000-4000-8000-000000000091";
const therapistUserId = "28100000-0000-4000-8000-000000000091";
const assessmentKey = "28200000-0000-4000-8000-000000000091";
const versionId = "28300000-0000-4000-8000-000000000091";
const operationId = "28400000-0000-4000-8000-000000000091";
const idempotencyKey = "28500000-0000-4000-8000-000000000091";
const requestId = "28600000-0000-4000-8000-000000000091";

const measurements = [
  {
    name: "起立行走人工計時",
    state: "numeric" as const,
    value: "12.50",
    unit: "秒",
    reason: null,
  },
  {
    name: "步態人工觀察",
    state: "text" as const,
    value: "合成示例：可依口頭提示完成熟悉步驟。",
    unit: null,
    reason: null,
  },
  {
    name: "步行距離",
    state: "missing" as const,
    value: null,
    unit: null,
    reason: "合成示例：本次未取得有效測量。",
  },
  {
    name: "階梯活動",
    state: "not_applicable" as const,
    value: null,
    unit: null,
    reason: "合成示例：本次評估情境不包含戶外活動。",
  },
];

const createBody = {
  action: "create_draft" as const,
  clientId,
  assessedOn: "2026-09-01",
  reassessmentDueOn: "2026-09-15",
  dueBasis: "人工排定：合成跨專業會議紀錄",
  measurements,
  functionalObservation: "合成示例：在熟悉環境可依簡短提示完成起立與行走。",
  goals: "合成示例：逐步減少轉位中的口頭提示。",
  recommendations: "合成示例：移動時由旁側守護並保留充分反應時間。",
  followUpPlan: "合成示例：下次人工複評比較提示需求。",
  formVersionReference: "manual-physical-therapy-v1" as const,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    version_id: versionId,
    assessment_version: 1,
    record_state: "draft",
    assessed_on: "2026-09-01",
    therapist_user_id: therapistUserId,
    service_status_at_assessment: "active",
    reassessment_due_on: "2026-09-15",
    form_version_reference: "manual-physical-therapy-v1",
    committed_at: "2026-09-02T01:15:00Z",
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
      clientId,
      assessmentKey,
      versionId,
      assessmentVersion: 1,
      recordState: "draft",
      assessedOn: "2026-09-01",
      therapistUserId,
      serviceStatusAtAssessment: "active",
      reassessmentDueOn: "2026-09-15",
      formVersionReference: "manual-physical-therapy-v1",
      committedAt: "2026-09-02T01:15:00Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("page 34 physical therapy assessment contracts", () => {
  it("builds a synthetic manual-only snapshot with unavailable capabilities explicit", () => {
    const snapshot = buildDemoPhysicalTherapyAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.metrics).toEqual({
      assessed: 2,
      notAssessed: 1,
      due: 1,
      upcoming: 1,
      drafts: 0,
      completed: 2,
    });
    expect(snapshot).toMatchObject({
      assessmentMethodStatus: "manual_unstandardized_only",
      formPublicationStatus: "not_published_not_claimed",
      dueRuleStatus: "not_configured_manual_date_and_basis_only",
      formulaStatus: "not_configured",
      scoreStatus: "not_configured",
      diagnosisStatus: "not_configured",
      attachmentStatus: "not_configured",
      exportStatus: "not_configured",
      reminderStatus: "not_configured",
      offlineSyncStatus: "not_configured",
    });
  });

  it("keeps all demo people and content visibly synthetic", () => {
    const snapshot = buildDemoPhysicalTherapyAssessmentSnapshot();
    expect(snapshot.items.every((item) => item.clientDisplayName.includes("合成")))
      .toBe(true);
    expect(snapshot.therapistOptions.every((item) =>
      item.displayName.includes("合成"))).toBe(true);
    expect(snapshot.items.filter((item) => item.measurements).every((item) =>
      item.measurements?.every((measurement) =>
        measurement.state === "numeric" ||
        measurement.value?.includes("合成") ||
        measurement.reason?.includes("合成")))).toBe(true);
  });

  it("filters demo rows by exact client", () => {
    const snapshot = buildDemoPhysicalTherapyAssessmentSnapshot();
    const selected = snapshot.items[0]!;
    const filtered = filterDemoPhysicalTherapyAssessmentSnapshot(snapshot, {
      clientId: selected.clientId,
      therapistUserId: null,
      serviceStatus: null,
      dueStatus: "all",
    });
    expect(filtered.items.map((item) => item.clientId)).toEqual([selected.clientId]);
    expect(filtered.matchingTotal).toBe(1);
  });

  it("composes therapist, current service status and due filters", () => {
    const snapshot = buildDemoPhysicalTherapyAssessmentSnapshot();
    const filtered = filterDemoPhysicalTherapyAssessmentSnapshot(snapshot, {
      clientId: null,
      therapistUserId: snapshot.therapistOptions[0]!.userId,
      serviceStatus: "active",
      dueStatus: "due",
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({
      clientDisplayName: "合成個案 C",
      reassessmentDue: true,
    });
  });

  it("parses exact filters and fails closed on arrays, unknown keys or bad values", () => {
    expect(parsePhysicalTherapyAssessmentFilters({
      client: clientId.toUpperCase(), therapist: therapistUserId,
      service: "active", due: "upcoming",
    })).toEqual({
      filters: {
        clientId,
        therapistUserId,
        serviceStatus: "active",
        dueStatus: "upcoming",
      },
      invalid: false,
    });
    for (const query of [
      { client: [clientId] },
      { extra: "widen" },
      { service: "invented" },
      { due: "invented" },
      { therapist: "not-a-uuid" },
    ]) {
      expect(parsePhysicalTherapyAssessmentFilters(query).invalid).toBe(true);
    }
  });

  it("keeps not assessed distinct from a measured item marked missing", () => {
    const snapshot = buildDemoPhysicalTherapyAssessmentSnapshot();
    const filtered = filterDemoPhysicalTherapyAssessmentSnapshot(snapshot, {
      clientId: null,
      therapistUserId: null,
      serviceStatus: "suspended",
      dueStatus: "not_assessed",
    });
    expect(filtered.metrics).toMatchObject({ assessed: 0, notAssessed: 1 });
    expect(filtered.items[0]?.measurements).toBeNull();
    expect(snapshot.items[2]?.measurements?.some((item) => item.state === "missing"))
      .toBe(true);
  });

  it("accepts exact manual measurements and actor-scoped idempotency", () => {
    expect(parseCreatePhysicalTherapyDraft(createBody, idempotencyKey)).toEqual({
      ...createBody,
      idempotencyKey,
    });
  });

  it("preserves a numeric measurement as exact text instead of calculating", () => {
    const parsed = parseCreatePhysicalTherapyDraft(createBody, idempotencyKey);
    expect(parsed.measurements[0]).toMatchObject({ value: "12.50", unit: "秒" });
  });

  it.each([
    [{ ...measurements[0], value: "12e3" }, "invalid numeric text"],
    [{ ...measurements[0], unit: "" }, "numeric measurement without unit"],
    [{ ...measurements[1], value: "" }, "text measurement without observation"],
    [{ ...measurements[2], reason: "" }, "missing measurement without reason"],
    [{ ...measurements[3], value: "0" }, "not applicable measurement with value"],
  ])("rejects an invalid measurement", (invalidMeasurement, _label) => {
    expect(_label.length).toBeGreaterThan(0);
    expect(() => parseCreatePhysicalTherapyDraft({
      ...createBody,
      measurements: [invalidMeasurement],
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("rejects duplicate measurement names and invented fields", () => {
    expect(() => parseCreatePhysicalTherapyDraft({
      ...createBody,
      measurements: [measurements[0], { ...measurements[1], name: measurements[0].name }],
    }, idempotencyKey)).toThrow(/未通過驗證/u);
    expect(() => parseCreatePhysicalTherapyDraft({
      ...createBody,
      clinicalScore: 12,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("rejects reverse dates and a missing idempotency key", () => {
    expect(() => parseCreatePhysicalTherapyDraft({
      ...createBody,
      reassessmentDueOn: "2026-08-31",
    }, idempotencyKey)).toThrow(/不得早於/u);
    expect(() => parseCreatePhysicalTherapyDraft(createBody, null))
      .toThrow(/冪等鍵/u);
  });

  it("keeps sign input strict and content-free", () => {
    expect(parsePhysicalTherapyAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idempotencyKey)).toMatchObject({ action: "sign", expectedVersion: 1 });
    expect(() => parsePhysicalTherapyAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      diagnosis: "不得夾帶內容",
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("requires a reason for a signed correction", () => {
    expect(() => parsePhysicalTherapyAssessmentMutation({
      ...createBody,
      action: "correct",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("parses only a complete database receipt", () => {
    expect(parsePhysicalTherapyOperationResult(row(), "create_draft"))
      .toMatchObject({
        action: "create_draft",
        clientId,
        therapistUserId,
        serviceStatusAtAssessment: "active",
        assessmentVersion: 1,
      });
    expect(() => parsePhysicalTherapyOperationResult({
      ...row(),
      clinical_score: 5,
    }, "create_draft")).toThrow(/憑證格式不完整/u);
  });

  it("correlates HTTP status, replay, client and immutable chain", () => {
    expect(parsePhysicalTherapyActionSuccess(success(), {
      action: "create_draft", clientId,
    }, 201).data.clientId).toBe(clientId);
    expect(parsePhysicalTherapyActionSuccess(success({ replayed: true }), {
      action: "create_draft", clientId,
    }, 200).data.replayed).toBe(true);
    expect(() => parsePhysicalTherapyActionSuccess(success(), {
      action: "create_draft", clientId,
    }, 200)).toThrow(/MISMATCHED/u);
    expect(() => parsePhysicalTherapyActionSuccess(success({
      clientId: "28000000-0000-4000-8000-000000000099",
    }), { action: "create_draft", clientId }, 201)).toThrow(/MISMATCHED/u);
  });

  it("parses only structured API errors", () => {
    expect(parsePhysicalTherapyActionError({
      requestId,
      status: "error",
      data: null,
      errors: [{ code: "PHYSICAL_THERAPY_VERSION_CONFLICT", message: "請重新載入" }],
    })?.errors[0]?.code).toBe("PHYSICAL_THERAPY_VERSION_CONFLICT");
    expect(parsePhysicalTherapyActionError({ error: "raw stack" })).toBeNull();
    expect(parsePhysicalTherapyActionError({
      requestId,
      status: "error",
      data: null,
      errors: [{ code: "unsafe-lowercase", message: "不可信" }],
    })).toBeNull();
    expect(parsePhysicalTherapyActionError({
      requestId,
      status: "error",
      data: null,
      errors: [{ code: "SAFE_CODE", message: "不可信\n控制字元" }],
    })).toBeNull();
  });
});
