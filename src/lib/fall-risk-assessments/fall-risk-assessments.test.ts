import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  buildDemoFallRiskAssessmentSnapshot,
  candidateAnswers,
  FALL_RISK_DEMO_RULE_SNAPSHOT,
} from "./demo";
import {
  buildFallRiskTrialPreview,
  fallRiskAnswersSchema,
  fallRiskRuleSnapshotSchema,
  parseCreateFallRiskDraft,
  parseFallRiskActionError,
  parseFallRiskActionSuccess,
  parseFallRiskAssessmentMutation,
  parseFallRiskOperationResult,
} from "./parser";
import {
  filterDemoFallRiskAssessmentSnapshot,
  projectFallRiskAssessmentSnapshot,
} from "./projection";
import { parseFallRiskAssessmentFilters } from "./query";
import { FALL_RISK_RULE_VERSION, type FallRiskAnswers } from "./types";

const clientId = "12000000-0000-4000-8000-000000000001";
const assessmentKey = "12200000-0000-4000-8000-000000000001";
const versionId = "12100000-0000-4000-8000-000000000002";
const authorId = "12000000-0000-4000-8000-000000000012";
const operationId = "12300000-0000-4000-8000-000000000001";
const idem = "12400000-0000-4000-8000-000000000001";

function createBody(answers: FallRiskAnswers = candidateAnswers(4)) {
  return {
    action: "create_draft",
    clientId,
    assessedOn: "2026-09-02",
    answers,
    ruleVersionId: FALL_RISK_RULE_VERSION,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    version_id: versionId,
    assessment_version: 1,
    record_state: "draft_preview",
    assessed_on: "2026-09-02",
    author_user_id: authorId,
    service_status_at_assessment: "active",
    rule_version_id: FALL_RISK_RULE_VERSION,
    governance_status: "candidate_unactivated",
    preview_status: "candidate_complete",
    preview_candidate_points: 4,
    preview_band_key: "candidate_high_review_4_6",
    content_hash: "a".repeat(64),
    committed_at: "2026-09-02T03:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("manual unstandardized fall-risk candidate rule", () => {
  it.each([
    [0, "candidate_observation_0_1"],
    [1, "candidate_observation_0_1"],
    [2, "candidate_review_2_3"],
    [3, "candidate_review_2_3"],
    [4, "candidate_high_review_4_6"],
    [6, "candidate_high_review_4_6"],
  ])("reproduces %i candidate points in %s", (points, bandKey) => {
    expect(buildFallRiskTrialPreview(candidateAnswers(points))).toEqual({
      status: "candidate_complete",
      candidatePoints: points,
      bandKey,
    });
  });

  it("does not turn an unanswered item into zero", () => {
    const answers = ({
      ...candidateAnswers(4),
      fall_factor_01: { state: "missing" },
    }) as FallRiskAnswers;
    expect(buildFallRiskTrialPreview(answers)).toEqual({
      status: "incomplete",
      candidatePoints: null,
      bandKey: null,
    });
  });

  it("preserves not-applicable separately and suppresses preview", () => {
    const answers = {
      ...candidateAnswers(4),
      fall_factor_01: { state: "not_applicable", reason: "本次無法確認" },
    } as FallRiskAnswers;
    expect(fallRiskAnswersSchema.parse(answers).fall_factor_01).toEqual({
      state: "not_applicable",
      reason: "本次無法確認",
    });
    expect(buildFallRiskTrialPreview(answers).candidatePoints).toBeNull();
  });

  it("pins all six factor definitions and the exact candidate snapshot", () => {
    expect(Object.keys(fallRiskAnswersSchema.parse(candidateAnswers(4)))).toHaveLength(6);
    expect(fallRiskRuleSnapshotSchema.parse(FALL_RISK_DEMO_RULE_SNAPSHOT)).toEqual(
      FALL_RISK_DEMO_RULE_SNAPSHOT,
    );
    expect(FALL_RISK_DEMO_RULE_SNAPSHOT.factor_definitions).toHaveLength(6);
  });
});

describe("FALL_RISK strict request and receipt parsers", () => {
  it("accepts an exact create draft and actor-scoped idempotency key", () => {
    expect(parseCreateFallRiskDraft(createBody(), idem)).toMatchObject({
      action: "create_draft",
      clientId,
      idempotencyKey: idem,
      ruleVersionId: FALL_RISK_RULE_VERSION,
    });
  });

  it.each([
    [{ ...createBody(), unknown: true }, "unknown property"],
    [{ ...createBody(), answers: { ...candidateAnswers(4), fall_factor_07: { state: "missing" } } }, "seventh slot"],
    [{ ...createBody(), answers: Object.fromEntries(Object.entries(candidateAnswers(4)).slice(0, 5)) }, "missing slot"],
    [{ ...createBody(), assessedOn: "2026-02-30" }, "invalid date"],
    [{ ...createBody(), ruleVersionId: "unapproved-rule" }, "wrong rule"],
  ])("rejects %s (%s)", (body, _label) => {
    void _label;
    expect(() => parseCreateFallRiskDraft(body, idem)).toThrow(IntegrationError);
  });

  it("distinguishes revise and blocked sign input", () => {
    expect(parseFallRiskAssessmentMutation({
      ...createBody(),
      action: "revise_draft",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("revise_draft");
    expect(parseFallRiskAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("sign");
  });

  it("rejects a receipt whose completeness fields disagree", () => {
    expect(() => parseFallRiskOperationResult(row({
      preview_status: "incomplete",
    }), "create_draft")).toThrowError(/憑證/);
  });

  it("parses an exact operation receipt and HTTP status", () => {
    const parsed = parseFallRiskOperationResult(row(), "create_draft");
    const envelope = {
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "ok",
      data: { ...parsed, persisted: true, demo: false },
      errors: [],
    };
    expect(parseFallRiskActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 201).data.previewCandidatePoints).toBe(4);
    expect(() => parseFallRiskActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 200)).toThrow(/MISMATCHED/);
  });

  it("only accepts the structured error envelope", () => {
    expect(parseFallRiskActionError({
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "error",
      data: null,
      errors: [{ code: "FALL_RISK_RULE_NOT_ACTIVATED", message: "規則未啟用" }],
    })?.status).toBe("error");
    expect(parseFallRiskActionError({ error: "raw" })).toBeNull();
  });
});

describe("FALL_RISK server projection and synthetic demo", () => {
  it("projects one latest card per assigned client and immutable history", () => {
    const snapshot = buildDemoFallRiskAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items).toHaveLength(3);
    expect(new Set(snapshot.items.map((item) => item.clientId)).size).toBe(3);
    expect(snapshot.items[0]!.versionHistory.map((item) =>
      item.assessmentVersion)).toEqual([2, 1]);
    expect(snapshot.formalRiskStatus).toBe("not_available");
    expect(snapshot.draftTaskSuggestionStatus).toBe("not_configured");
    expect(snapshot.notificationStatus).toBe("not_configured");
  });

  it("filters demo items by exact answer state without widening scope", () => {
    const snapshot = filterDemoFallRiskAssessmentSnapshot(
      buildDemoFallRiskAssessmentSnapshot(),
      { clientId: null, previewStatus: "all", answerState: "has_missing" },
    );
    expect(snapshot.items.map((item) => item.clientDisplayName)).toEqual([
      "合成個案 C",
    ]);
    expect(snapshot.metrics.incomplete).toBe(1);
  });

  it("rejects a tampered snapshot rather than trusting candidate points", () => {
    const source = buildDemoFallRiskAssessmentSnapshot();
    expect(() => projectFallRiskAssessmentSnapshot({
      row: {
        organization_id: source.organizationId,
        branch_id: source.branchId,
        generated_at: source.generatedAt,
        items: [],
      },
      expectedOrganizationId: source.organizationId,
      expectedBranchId: source.branchId,
      demo: false,
    })).toThrow(/INVALID_FALL_RISK/);
  });
});

describe("FALL_RISK list query", () => {
  it("accepts an omitted or explicitly broad filter without changing its meaning", () => {
    expect(parseFallRiskAssessmentFilters({})).toEqual({
      filters: {
        clientId: null,
        previewStatus: "all",
        answerState: "all",
      },
      invalidFilters: false,
    });
    expect(parseFallRiskAssessmentFilters({
      client: "",
      preview: "all",
      answers: "all",
    }).invalidFilters).toBe(false);
  });

  it("preserves a valid exact client and whitelisted statuses", () => {
    expect(parseFallRiskAssessmentFilters({
      client: clientId.toUpperCase(),
      preview: "candidate_complete",
      answers: "has_not_applicable",
    })).toEqual({
      filters: {
        clientId,
        previewStatus: "candidate_complete",
        answerState: "has_not_applicable",
      },
      invalidFilters: false,
    });
  });

  it.each([
    [{ client: "not-a-client-id" }, "invalid client"],
    [{ preview: "complete" }, "unknown preview"],
    [{ answers: "answered" }, "unknown answer state"],
    [{ client: [clientId] }, "array client"],
    [{ preview: ["all"] }, "array preview"],
    [{ answers: ["all"] }, "array answer state"],
  ])("fails closed for %s (%s)", (query, label) => {
    expect(label).toBeTruthy();
    expect(parseFallRiskAssessmentFilters(query).invalidFilters).toBe(true);
  });
});
