import { describe, expect, it } from "vitest";

import { buildDemoSpmsqAssessmentSnapshot } from "./demo";
import {
  buildSpmsqTrialPreview,
  parseCreateSpmsqDraft,
  parseSpmsqActionError,
  parseSpmsqActionSuccess,
  parseSpmsqAssessmentMutation,
  parseSpmsqOperationResult,
} from "./parser";
import { filterDemoSpmsqAssessmentSnapshot } from "./projection";
import {
  SPMSQ_ITEM_IDS,
  SPMSQ_RULE_VERSION,
  type SpmsqAnswers,
} from "./types";

const clientId = "11000000-0000-4000-8000-000000000091";
const authorUserId = "11100000-0000-4000-8000-000000000091";
const assessmentKey = "11200000-0000-4000-8000-000000000091";
const versionId = "11300000-0000-4000-8000-000000000091";
const operationId = "11400000-0000-4000-8000-000000000091";
const idempotencyKey = "11500000-0000-4000-8000-000000000091";
const requestId = "11600000-0000-4000-8000-000000000091";

function answered(incorrect: readonly number[]): SpmsqAnswers {
  const wrong = new Set(incorrect);
  return Object.fromEntries(SPMSQ_ITEM_IDS.map((id, index) => [
    id,
    { state: "answered", value: wrong.has(index + 1)
      ? "incorrect" : "correct" },
  ])) as unknown as SpmsqAnswers;
}

const completeAnswers = answered([1, 3, 6]);
const createBody = {
  action: "create_draft" as const,
  clientId,
  assessedOn: "2026-09-02",
  answers: completeAnswers,
  educationContext: {
    state: "answered" as const,
    value: "middle_or_high_school" as const,
  },
  culturalContext: {
    state: "recorded" as const,
    note: "合成測試：以個案熟悉語言確認作答脈絡。",
  },
  ruleVersionId: SPMSQ_RULE_VERSION,
};

function operationRow(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    version_id: versionId,
    assessment_version: 1,
    record_state: "draft_preview",
    assessed_on: "2026-09-02",
    author_user_id: authorUserId,
    service_status_at_assessment: "active",
    rule_version_id: SPMSQ_RULE_VERSION,
    governance_status: "candidate_unactivated",
    preview_status: "candidate_complete",
    preview_raw_errors: 3,
    preview_adjusted_errors: 3,
    preview_band_key: "mild_3_4_errors",
    committed_at: "2026-09-02T02:00:00Z",
    replayed: false,
    ...overrides,
  };
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
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
      recordState: "draft_preview",
      assessedOn: "2026-09-02",
      authorUserId,
      serviceStatusAtAssessment: "active",
      ruleVersionId: SPMSQ_RULE_VERSION,
      governanceStatus: "candidate_unactivated",
      previewStatus: "candidate_complete",
      previewRawErrors: 3,
      previewAdjustedErrors: 3,
      previewBandKey: "mild_3_4_errors",
      committedAt: "2026-09-02T02:00:00Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("page 11 SPMSQ candidate contracts", () => {
  it.each([
    ["grade_school_or_less", 2],
    ["middle_or_high_school", 3],
    ["beyond_high_school", 4],
  ] as const)("reproduces fixed answers with education context %s", (value, expected) => {
    expect(buildSpmsqTrialPreview(completeAnswers, {
      state: "answered",
      value,
    })).toEqual({
      status: "candidate_complete",
      rawErrors: 3,
      adjustedErrors: expected,
      bandKey: expected <= 2 ? "reference_0_2_errors" : "mild_3_4_errors",
    });
  });

  it.each([
    [{ ...completeAnswers, spmsq_04: { state: "missing" as const } }, "missing"],
    [{
      ...completeAnswers,
      spmsq_04: {
        state: "not_applicable" as const,
        reason: "合成測試：本次無法取得適用脈絡。",
      },
    }, "not applicable"],
  ])("never treats explicit non-answers as zero: %s", (answers, label) => {
    expect(label.length).toBeGreaterThan(0);
    expect(buildSpmsqTrialPreview(answers, createBody.educationContext)).toEqual({
      status: "incomplete",
      rawErrors: null,
      adjustedErrors: null,
      bandKey: null,
    });
  });

  it("never previews without an answered education context", () => {
    expect(buildSpmsqTrialPreview(completeAnswers, { state: "missing" }))
      .toMatchObject({ status: "incomplete", adjustedErrors: null });
  });

  it("accepts an exact candidate draft and actor-scoped idempotency key", () => {
    expect(parseCreateSpmsqDraft(createBody, idempotencyKey)).toEqual({
      ...createBody,
      idempotencyKey,
    });
  });

  it("requires all ten exact answer keys and rejects invented clinical fields", () => {
    const nineAnswers = { ...completeAnswers } as Record<string, unknown>;
    delete nineAnswers.spmsq_10;
    expect(() => parseCreateSpmsqDraft({
      ...createBody,
      answers: nineAnswers,
    }, idempotencyKey)).toThrow(/十題答案/u);
    expect(() => parseCreateSpmsqDraft({
      ...createBody,
      diagnosis: "不得夾帶診斷",
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("requires reasons for not applicable and a valid idempotency key", () => {
    expect(() => parseCreateSpmsqDraft({
      ...createBody,
      answers: {
        ...completeAnswers,
        spmsq_01: { state: "not_applicable", reason: "" },
      },
    }, idempotencyKey)).toThrow(/未通過驗證/u);
    expect(() => parseCreateSpmsqDraft(createBody, null)).toThrow(/冪等鍵/u);
  });

  it("keeps the blocked sign contract strict and content-free", () => {
    expect(parseSpmsqAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idempotencyKey)).toMatchObject({ action: "sign", expectedVersion: 1 });
    expect(() => parseSpmsqAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      officialScore: 3,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("parses only internally aligned database receipts", () => {
    expect(parseSpmsqOperationResult(operationRow(), "create_draft"))
      .toMatchObject({ clientId, previewAdjustedErrors: 3 });
    expect(() => parseSpmsqOperationResult(operationRow({
      preview_status: "incomplete",
    }), "create_draft")).toThrow(/憑證不一致/u);
    expect(() => parseSpmsqOperationResult(operationRow({ official_score: 3 }),
      "create_draft")).toThrow(/憑證格式不完整/u);
  });

  it("correlates HTTP status, replay, client and immutable version", () => {
    expect(parseSpmsqActionSuccess(successEnvelope(), {
      action: "create_draft", clientId,
    }, 201).data.clientId).toBe(clientId);
    expect(parseSpmsqActionSuccess(successEnvelope({ replayed: true }), {
      action: "create_draft", clientId,
    }, 200).data.replayed).toBe(true);
    expect(() => parseSpmsqActionSuccess(successEnvelope(), {
      action: "create_draft", clientId,
    }, 200)).toThrow(/MISMATCHED/u);
    expect(() => parseSpmsqActionSuccess(successEnvelope({ assessmentVersion: 3 }), {
      action: "create_draft", clientId,
    }, 201)).toThrow(/MISMATCHED/u);
  });

  it("parses only structured API errors", () => {
    expect(parseSpmsqActionError({
      requestId,
      status: "error",
      data: null,
      errors: [{ code: "SPMSQ_RULE_NOT_ACTIVATED", message: "正式簽署已封鎖" }],
    })?.errors[0]?.code).toBe("SPMSQ_RULE_NOT_ACTIVATED");
    expect(parseSpmsqActionError({ stack: "sensitive" })).toBeNull();
  });

  it("builds an entirely synthetic, candidate-only demo", () => {
    const snapshot = buildDemoSpmsqAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items.every((item) => item.clientDisplayName.includes("合成")))
      .toBe(true);
    expect(snapshot).toMatchObject({
      ruleActivationStatus: "candidate_unactivated",
      formalSignStatus: "blocked_rule_not_activated",
      formalScoreStatus: "not_available",
      careDecisionStatus: "blocked",
      culturalAdjustmentStatus: "not_configured_context_only",
      attachmentStatus: "not_configured",
      exportStatus: "not_configured",
      offlineSyncStatus: "not_configured",
    });
    expect(snapshot.metrics).toEqual({
      notAssessed: 1,
      candidateComplete: 1,
      incomplete: 1,
      drafts: 2,
    });
  });

  it("composes exact-client, preview and education filters", () => {
    const snapshot = buildDemoSpmsqAssessmentSnapshot();
    const selected = snapshot.items.find((item) =>
      item.previewStatus === "candidate_complete")!;
    const filtered = filterDemoSpmsqAssessmentSnapshot(snapshot, {
      clientId: selected.clientId,
      previewStatus: "candidate_complete",
      educationState: "answered",
    });
    expect(filtered.items.map((item) => item.clientId)).toEqual([
      selected.clientId,
    ]);
    expect(filtered.metrics).toEqual({
      notAssessed: 0,
      candidateComplete: 1,
      incomplete: 0,
      drafts: 1,
    });
  });

  it("keeps every historical version reproducible from its own snapshot", () => {
    const snapshot = buildDemoSpmsqAssessmentSnapshot();
    const versioned = snapshot.items.find((item) =>
      item.versionHistory.length === 2)!;
    expect(versioned.versionHistory.map((version) =>
      buildSpmsqTrialPreview(version.answers, version.educationContext)))
      .toEqual(versioned.versionHistory.map((version) => ({
        status: version.previewStatus,
        rawErrors: version.previewRawErrors,
        adjustedErrors: version.previewAdjustedErrors,
        bandKey: version.previewBandKey,
      })));
  });
});
