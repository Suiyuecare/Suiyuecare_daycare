import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  buildDemoNsiNutritionScreeningSnapshot,
  NSI_NUTRITION_DEMO_RULE_SNAPSHOT,
  nutritionAnswersWithObservedCount,
} from "./demo";
import {
  buildNsiNutritionTrialPreview,
  nsiNutritionAnswersSchema,
  nsiNutritionRuleSnapshotSchema,
  parseCreateNsiNutritionDraft,
  parseNsiNutritionActionError,
  parseNsiNutritionActionSuccess,
  parseNsiNutritionScreeningMutation,
  parseNsiNutritionOperationResult,
} from "./parser";
import {
  filterDemoNsiNutritionScreeningSnapshot,
  projectNsiNutritionScreeningSnapshot,
} from "./projection";
import { parseNsiNutritionScreeningFilters } from "./query";
import {
  NSI_NUTRITION_ITEM_IDS,
  NSI_NUTRITION_OBSERVATION_LABELS,
  NSI_NUTRITION_RULE_VERSION,
  type NsiNutritionAnswers,
} from "./types";

const clientId = "12000000-0000-4000-8000-000000000001";
const assessmentKey = "12200000-0000-4000-8000-000000000001";
const versionId = "12100000-0000-4000-8000-000000000002";
const authorId = "12000000-0000-4000-8000-000000000012";
const operationId = "12300000-0000-4000-8000-000000000001";
const idem = "12400000-0000-4000-8000-000000000001";

function createBody(
  answers: NsiNutritionAnswers = nutritionAnswersWithObservedCount(3),
) {
  return {
    action: "create_draft",
    clientId,
    assessedOn: "2026-09-02",
    answers,
    ruleVersionId: NSI_NUTRITION_RULE_VERSION,
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
    rule_version_id: NSI_NUTRITION_RULE_VERSION,
    governance_status: "candidate_unactivated",
    preview_status: "candidate_complete",
    preview_observed_count: 3,
    content_hash: "a".repeat(64),
    committed_at: "2026-09-02T03:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("page 14 manual nutrition observation candidate replay", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    "replays %i observed fields without assigning a score or band",
    (observedCount) => {
      expect(buildNsiNutritionTrialPreview(
        nutritionAnswersWithObservedCount(observedCount),
      )).toEqual({ status: "candidate_complete", observedCount });
    },
  );

  it("does not turn a missing field into zero", () => {
    const answers = {
      ...nutritionAnswersWithObservedCount(3),
      nutrition_observation_01: { state: "missing" },
    } as NsiNutritionAnswers;
    expect(buildNsiNutritionTrialPreview(answers)).toEqual({
      status: "incomplete",
      observedCount: null,
    });
  });

  it("preserves not-applicable separately and suppresses the count", () => {
    const answers = {
      ...nutritionAnswersWithObservedCount(3),
      nutrition_observation_01: {
        state: "not_applicable",
        reason: "合成測試：本次無法套用此人工觀察欄位。",
      },
    } as NsiNutritionAnswers;
    expect(nsiNutritionAnswersSchema.parse(answers).nutrition_observation_01)
      .toEqual({
        state: "not_applicable",
        reason: "合成測試：本次無法套用此人工觀察欄位。",
      });
    expect(buildNsiNutritionTrialPreview(answers).observedCount).toBeNull();
  });

  it("pins six neutral fields and the exact immutable rule snapshot", () => {
    expect(Object.keys(nsiNutritionAnswersSchema.parse(
      nutritionAnswersWithObservedCount(3),
    ))).toEqual(NSI_NUTRITION_ITEM_IDS);
    expect(nsiNutritionRuleSnapshotSchema.parse(
      NSI_NUTRITION_DEMO_RULE_SNAPSHOT,
    )).toEqual(NSI_NUTRITION_DEMO_RULE_SNAPSHOT);
    expect(NSI_NUTRITION_DEMO_RULE_SNAPSHOT.field_definitions).toEqual(
      NSI_NUTRITION_ITEM_IDS.map((id) => ({
        id,
        label: NSI_NUTRITION_OBSERVATION_LABELS[id],
        data_kind: "manual_presence_observation",
      })),
    );
    expect(NSI_NUTRITION_DEMO_RULE_SNAPSHOT).toMatchObject({
      formal_questionnaire_status: "not_configured",
      licensed_source_status: "not_configured",
      formal_weights_status: "not_configured",
      formal_scoring_status: "not_configured",
      formal_risk_classification_status: "not_configured",
      formal_use_permitted: false,
    });
    expect(NSI_NUTRITION_DEMO_RULE_SNAPSHOT).not.toHaveProperty("bands");
  });
});

describe("page 14 strict request and receipt parsers", () => {
  it("accepts an exact create draft and actor-scoped idempotency key", () => {
    expect(parseCreateNsiNutritionDraft(createBody(), idem)).toMatchObject({
      action: "create_draft",
      clientId,
      idempotencyKey: idem,
      ruleVersionId: NSI_NUTRITION_RULE_VERSION,
    });
  });

  it.each([
    [{ ...createBody(), unknown: true }, "unknown property"],
    [{
      ...createBody(),
      answers: {
        ...nutritionAnswersWithObservedCount(3),
        nutrition_observation_07: { state: "missing" },
      },
    }, "seventh field"],
    [{
      ...createBody(),
      answers: Object.fromEntries(Object.entries(
        nutritionAnswersWithObservedCount(3),
      ).slice(0, 5)),
    }, "missing field"],
    [{ ...createBody(), assessedOn: "2026-02-30" }, "invalid date"],
    [{ ...createBody(), ruleVersionId: "unapproved-rule" }, "wrong rule"],
  ])("rejects malformed candidate input (%s: %s)", (body, label) => {
    expect(label).toBeTruthy();
    expect(() => parseCreateNsiNutritionDraft(body, idem))
      .toThrow(IntegrationError);
  });

  it("distinguishes immutable revision and blocked signing inputs", () => {
    expect(parseNsiNutritionScreeningMutation({
      ...createBody(),
      action: "revise_draft",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("revise_draft");
    expect(parseNsiNutritionScreeningMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("sign");
  });

  it("rejects a receipt whose replay fields disagree", () => {
    expect(() => parseNsiNutritionOperationResult(row({
      preview_status: "incomplete",
    }), "create_draft")).toThrowError(/憑證/u);
    expect(() => parseNsiNutritionOperationResult(row({
      preview_observed_count: null,
    }), "create_draft")).toThrowError(/憑證/u);
  });

  it("parses only an exact receipt and matching HTTP semantics", () => {
    const parsed = parseNsiNutritionOperationResult(row(), "create_draft");
    const envelope = {
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "ok",
      data: { ...parsed, persisted: true, demo: false },
      errors: [],
    };
    expect(parseNsiNutritionActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 201).data.previewObservedCount).toBe(3);
    expect(() => parseNsiNutritionActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 200)).toThrow(/MISMATCHED/u);
    expect(() => parseNsiNutritionOperationResult({
      ...row(),
      formal_score: 3,
    }, "create_draft")).toThrowError(/憑證/u);
  });

  it("only accepts the structured error envelope", () => {
    expect(parseNsiNutritionActionError({
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "error",
      data: null,
      errors: [{
        code: "NSI_NUTRITION_RULE_NOT_ACTIVATED",
        message: "正式規則未啟用",
      }],
    })?.status).toBe("error");
    expect(parseNsiNutritionActionError({ error: "raw" })).toBeNull();
  });
});

describe("page 14 server projection and synthetic demo", () => {
  it("projects one latest row per assigned client and immutable history", () => {
    const snapshot = buildDemoNsiNutritionScreeningSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items).toHaveLength(3);
    expect(new Set(snapshot.items.map((item) => item.clientId)).size).toBe(3);
    expect(snapshot.items[0]!.versionHistory.map((item) =>
      item.assessmentVersion)).toEqual([2, 1]);
    expect(snapshot.formalScoreStatus).toBe("not_available");
    expect(snapshot.formalRiskClassificationStatus).toBe("not_available");
    expect(snapshot.diagnosisStatus).toBe("blocked");
    expect(snapshot.careDecisionStatus).toBe("blocked");
    expect(snapshot.nutritionFollowUpStatus).toBe("not_configured");
    expect(snapshot.nutritionReferralStatus).toBe("not_configured");
    expect(snapshot.notificationStatus).toBe("not_configured");
  });

  it("filters exact answer states without widening client scope", () => {
    const snapshot = filterDemoNsiNutritionScreeningSnapshot(
      buildDemoNsiNutritionScreeningSnapshot(),
      { clientId: null, previewStatus: "all", answerState: "has_missing" },
    );
    expect(snapshot.items.map((item) => item.clientDisplayName)).toEqual([
      "黃O生（合成）",
    ]);
    expect(snapshot.metrics.incomplete).toBe(1);
  });

  it("rejects a malformed projection instead of trusting a count", () => {
    const source = buildDemoNsiNutritionScreeningSnapshot();
    expect(() => projectNsiNutritionScreeningSnapshot({
      row: {
        organization_id: source.organizationId,
        branch_id: source.branchId,
        generated_at: source.generatedAt,
        items: [],
      },
      expectedOrganizationId: source.organizationId,
      expectedBranchId: source.branchId,
      demo: false,
    })).toThrow(/INVALID_NSI_NUTRITION/u);
  });
});

describe("page 14 strict list query", () => {
  it("accepts omitted and explicit all filters", () => {
    expect(parseNsiNutritionScreeningFilters({})).toEqual({
      filters: {
        clientId: null,
        previewStatus: "all",
        answerState: "all",
      },
      invalidFilters: false,
    });
    expect(parseNsiNutritionScreeningFilters({
      client: "",
      preview: "all",
      answers: "all",
    }).invalidFilters).toBe(false);
  });

  it("preserves an exact client and whitelisted statuses", () => {
    expect(parseNsiNutritionScreeningFilters({
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
  ])("fails closed for malformed query (%s: %s)", (query, label) => {
    expect(label).toBeTruthy();
    expect(parseNsiNutritionScreeningFilters(query).invalidFilters).toBe(true);
  });
});
