import { describe, expect, it } from "vitest";

import { buildDemoPsychosocialAssessmentSnapshot } from "./demo";
import {
  parseCreatePsychosocialDraft,
  parsePsychosocialActionError,
  parsePsychosocialActionSuccess,
  parsePsychosocialAssessmentMutation,
  parsePsychosocialOperationResult,
} from "./parser";
import { filterDemoPsychosocialAssessmentSnapshot } from "./projection";

const clientId = "28000000-0000-4000-8000-000000000091";
const responsibleUserId = "28100000-0000-4000-8000-000000000091";
const assessmentKey = "28200000-0000-4000-8000-000000000091";
const versionId = "28300000-0000-4000-8000-000000000091";
const operationId = "28400000-0000-4000-8000-000000000091";
const idempotencyKey = "28500000-0000-4000-8000-000000000091";
const requestId = "28600000-0000-4000-8000-000000000091";

const dimensions = {
  family_relationships: { state: "provided" as const, detail: "合成家庭互動" },
  social_support: { state: "missing" as const, detail: null },
  social_participation: { state: "not_applicable" as const, detail: null },
  communication_context: { state: "provided" as const, detail: "合成溝通偏好" },
  resource_access: { state: "missing" as const, detail: null },
};

const createBody = {
  action: "create_draft" as const,
  clientId,
  assessedOn: "2026-09-01",
  reassessmentDueOn: "2026-09-15",
  dueBasis: "人工排定：合成服務會議紀錄",
  dimensions,
  assessmentSummary: "合成人工心理社會摘要",
  formVersionReference: "manual-psychosocial-v1" as const,
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
    responsible_user_id: responsibleUserId,
    service_status_at_assessment: "active",
    reassessment_due_on: "2026-09-15",
    form_version_reference: "manual-psychosocial-v1",
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
      responsibleUserId,
      serviceStatusAtAssessment: "active",
      reassessmentDueOn: "2026-09-15",
      formVersionReference: "manual-psychosocial-v1",
      committedAt: "2026-09-02T01:15:00Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("page 28 psychosocial assessment contracts", () => {
  it("builds a synthetic manual-only snapshot with explicit unavailable capabilities", () => {
    const snapshot = buildDemoPsychosocialAssessmentSnapshot();
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
      dueRuleStatus: "not_configured_manual_date_and_basis_only",
      scoreStatus: "not_configured",
      diagnosisStatus: "not_configured",
      attachmentStatus: "not_configured",
      exportStatus: "not_configured",
      offlineSyncStatus: "not_configured",
    });
  });

  it("keeps every demo identity visibly synthetic", () => {
    const snapshot = buildDemoPsychosocialAssessmentSnapshot();
    expect(snapshot.items.every((item) => item.clientDisplayName.includes("合成")))
      .toBe(true);
    expect(snapshot.responsibleOptions.every((item) =>
      item.displayName.includes("合成"))).toBe(true);
  });

  it("filters demo rows by exact client", () => {
    const snapshot = buildDemoPsychosocialAssessmentSnapshot();
    const selected = snapshot.items[0]!;
    const filtered = filterDemoPsychosocialAssessmentSnapshot(snapshot, {
      clientId: selected.clientId,
      responsibleUserId: null,
      serviceStatus: null,
      dueStatus: "all",
    });
    expect(filtered.items.map((item) => item.clientId)).toEqual([selected.clientId]);
    expect(filtered.matchingTotal).toBe(1);
  });

  it("composes responsible, current service status and due filters", () => {
    const snapshot = buildDemoPsychosocialAssessmentSnapshot();
    const filtered = filterDemoPsychosocialAssessmentSnapshot(snapshot, {
      clientId: null,
      responsibleUserId: snapshot.responsibleOptions[0]!.userId,
      serviceStatus: "active",
      dueStatus: "due",
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({
      clientDisplayName: "合成個案 C",
      reassessmentDue: true,
    });
  });

  it("keeps not assessed distinct from missing values", () => {
    const snapshot = buildDemoPsychosocialAssessmentSnapshot();
    const filtered = filterDemoPsychosocialAssessmentSnapshot(snapshot, {
      clientId: null,
      responsibleUserId: null,
      serviceStatus: "suspended",
      dueStatus: "not_assessed",
    });
    expect(filtered.metrics).toMatchObject({ assessed: 0, notAssessed: 1 });
    expect(filtered.items[0]?.dimensions).toBeNull();
  });

  it("accepts exact manual content and a valid actor-scoped idempotency key", () => {
    expect(parseCreatePsychosocialDraft(createBody, idempotencyKey)).toEqual({
      ...createBody,
      idempotencyKey,
    });
  });

  it("rejects provided domains without narrative", () => {
    expect(() => parseCreatePsychosocialDraft({
      ...createBody,
      dimensions: {
        ...dimensions,
        social_support: { state: "provided", detail: null },
      },
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("rejects extra or invented domains", () => {
    expect(() => parseCreatePsychosocialDraft({
      ...createBody,
      dimensions: { ...dimensions, clinical_score: 12 },
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("rejects reassessment dates before the assessment", () => {
    expect(() => parseCreatePsychosocialDraft({
      ...createBody,
      reassessmentDueOn: "2026-08-31",
    }, idempotencyKey)).toThrow(/不得早於/u);
  });

  it("rejects a missing idempotency key", () => {
    expect(() => parseCreatePsychosocialDraft(createBody, null))
      .toThrow(/冪等鍵/u);
  });

  it("keeps sign input strict and content-free", () => {
    expect(parsePsychosocialAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idempotencyKey)).toMatchObject({ action: "sign", expectedVersion: 1 });
    expect(() => parsePsychosocialAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      assessmentSummary: "不得夾帶內容",
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("requires a reason for signed correction", () => {
    expect(() => parsePsychosocialAssessmentMutation({
      ...createBody,
      action: "correct",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("parses a complete database receipt", () => {
    expect(parsePsychosocialOperationResult(row(), "create_draft")).toMatchObject({
      action: "create_draft",
      clientId,
      responsibleUserId,
      serviceStatusAtAssessment: "active",
      assessmentVersion: 1,
    });
  });

  it("fails closed on a partial or widened receipt", () => {
    expect(() => parsePsychosocialOperationResult({
      ...row(),
      clinical_score: 5,
    }, "create_draft")).toThrow(/憑證格式不完整/u);
  });

  it("accepts a correlated created success only with HTTP 201", () => {
    expect(parsePsychosocialActionSuccess(success(), {
      action: "create_draft",
      clientId,
    }, 201).data.clientId).toBe(clientId);
    expect(() => parsePsychosocialActionSuccess(success(), {
      action: "create_draft",
      clientId,
    }, 200)).toThrow(/MISMATCHED/u);
  });

  it("accepts exact replay only with HTTP 200", () => {
    expect(parsePsychosocialActionSuccess(success({ replayed: true }), {
      action: "create_draft",
      clientId,
    }, 200).data.replayed).toBe(true);
  });

  it("rejects a success receipt for a different client", () => {
    expect(() => parsePsychosocialActionSuccess(success({
      clientId: "28000000-0000-4000-8000-000000000099",
    }), {
      action: "create_draft",
      clientId,
    }, 201)).toThrow(/MISMATCHED/u);
  });

  it("parses only structured API errors", () => {
    expect(parsePsychosocialActionError({
      requestId,
      status: "error",
      data: null,
      errors: [{ code: "PSYCHOSOCIAL_VERSION_CONFLICT", message: "請重新載入" }],
    })?.errors[0]?.code).toBe("PSYCHOSOCIAL_VERSION_CONFLICT");
    expect(parsePsychosocialActionError({ error: "raw stack" })).toBeNull();
  });
});
