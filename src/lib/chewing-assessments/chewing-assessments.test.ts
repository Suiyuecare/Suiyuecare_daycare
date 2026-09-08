import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  buildDemoChewingAssessmentSnapshot,
  CHEWING_DEMO_RULE_SNAPSHOT,
  chewingAnswersWithObservedCount,
} from "./demo";
import {
  buildChewingTrialPreview,
  chewingAnswersSchema,
  chewingRuleSnapshotSchema,
  parseCreateChewingDraft,
  parseChewingActionError,
  parseChewingActionSuccess,
  parseChewingAssessmentMutation,
  parseChewingOperationResult,
} from "./parser";
import {
  filterDemoChewingAssessmentSnapshot,
  projectChewingAssessmentSnapshot,
} from "./projection";
import { parseChewingAssessmentFilters } from "./query";
import {
  CHEWING_ITEM_IDS,
  CHEWING_OBSERVATION_LABELS,
  CHEWING_RULE_VERSION,
  type ChewingAnswers,
} from "./types";

const clientId = "12000000-0000-4000-8000-000000000001";
const assessmentKey = "12200000-0000-4000-8000-000000000001";
const versionId = "12100000-0000-4000-8000-000000000002";
const authorId = "12000000-0000-4000-8000-000000000012";
const operationId = "12300000-0000-4000-8000-000000000001";
const idem = "12400000-0000-4000-8000-000000000001";

function createBody(
  answers: ChewingAnswers = chewingAnswersWithObservedCount(3),
) {
  return {
    action: "create_draft",
    clientId,
    assessedOn: "2026-09-02",
    answers,
    ruleVersionId: CHEWING_RULE_VERSION,
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
    rule_version_id: CHEWING_RULE_VERSION,
    governance_status: "candidate_unactivated",
    preview_status: "candidate_complete",
    preview_observed_count: 3,
    content_hash: "a".repeat(64),
    committed_at: "2026-09-02T03:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("page 35 manual chewing observation candidate replay", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    "replays %i observed fields without assigning a score or band",
    (observedCount) => {
      expect(buildChewingTrialPreview(
        chewingAnswersWithObservedCount(observedCount),
      )).toEqual({ status: "candidate_complete", observedCount });
    },
  );

  it("does not turn a missing field into zero", () => {
    const answers = {
      ...chewingAnswersWithObservedCount(3),
      chewing_observation_01: { state: "missing" },
    } as ChewingAnswers;
    expect(buildChewingTrialPreview(answers)).toEqual({
      status: "incomplete",
      observedCount: null,
    });
  });

  it("preserves not-applicable separately and suppresses the count", () => {
    const answers = {
      ...chewingAnswersWithObservedCount(3),
      chewing_observation_01: {
        state: "not_applicable",
        reason: "合成測試：本次無法套用此人工觀察欄位。",
      },
    } as ChewingAnswers;
    expect(chewingAnswersSchema.parse(answers).chewing_observation_01)
      .toEqual({
        state: "not_applicable",
        reason: "合成測試：本次無法套用此人工觀察欄位。",
      });
    expect(buildChewingTrialPreview(answers).observedCount).toBeNull();
  });

  it("pins six neutral fields and the exact immutable rule snapshot", () => {
    expect(Object.keys(chewingAnswersSchema.parse(
      chewingAnswersWithObservedCount(3),
    ))).toEqual(CHEWING_ITEM_IDS);
    expect(chewingRuleSnapshotSchema.parse(
      CHEWING_DEMO_RULE_SNAPSHOT,
    )).toEqual(CHEWING_DEMO_RULE_SNAPSHOT);
    expect(CHEWING_DEMO_RULE_SNAPSHOT.field_definitions).toEqual(
      CHEWING_ITEM_IDS.map((id) => ({
        id,
        label: CHEWING_OBSERVATION_LABELS[id],
        data_kind: "manual_presence_observation",
      })),
    );
    expect(CHEWING_DEMO_RULE_SNAPSHOT).toMatchObject({
      formal_tool_status: "not_configured",
      licensed_source_status: "not_configured",
      formal_weights_status: "not_configured",
      formal_scoring_status: "not_configured",
      formal_ability_classification_status: "not_configured",
      formal_use_permitted: false,
    });
    expect(CHEWING_DEMO_RULE_SNAPSHOT).not.toHaveProperty("bands");
  });
});

describe("page 35 strict request and receipt parsers", () => {
  it("accepts an exact create draft and actor-scoped idempotency key", () => {
    expect(parseCreateChewingDraft(createBody(), idem)).toMatchObject({
      action: "create_draft",
      clientId,
      idempotencyKey: idem,
      ruleVersionId: CHEWING_RULE_VERSION,
    });
  });

  it.each([
    [{ ...createBody(), unknown: true }, "unknown property"],
    [{
      ...createBody(),
      answers: {
        ...chewingAnswersWithObservedCount(3),
        chewing_observation_07: { state: "missing" },
      },
    }, "seventh field"],
    [{
      ...createBody(),
      answers: Object.fromEntries(Object.entries(
        chewingAnswersWithObservedCount(3),
      ).slice(0, 5)),
    }, "missing field"],
    [{ ...createBody(), assessedOn: "2026-02-30" }, "invalid date"],
    [{ ...createBody(), ruleVersionId: "unapproved-rule" }, "wrong rule"],
  ])("rejects malformed candidate input (%s: %s)", (body, label) => {
    expect(label).toBeTruthy();
    expect(() => parseCreateChewingDraft(body, idem))
      .toThrow(IntegrationError);
  });

  it("distinguishes immutable revision and blocked formal action inputs", () => {
    expect(parseChewingAssessmentMutation({
      ...createBody(),
      action: "revise_draft",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("revise_draft");
    expect(parseChewingAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("sign");
    expect(parseChewingAssessmentMutation({
      action: "correct",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      correctionReason: "合成測試：說明正式更正請求。",
    }, idem).action).toBe("correct");
    expect(() => parseChewingAssessmentMutation({
      action: "correct",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      correctionReason: "",
    }, idem)).toThrow(IntegrationError);
  });

  it("rejects a receipt whose replay fields disagree", () => {
    expect(() => parseChewingOperationResult(row({
      preview_status: "incomplete",
    }), "create_draft")).toThrowError(/憑證/u);
    expect(() => parseChewingOperationResult(row({
      preview_observed_count: null,
    }), "create_draft")).toThrowError(/憑證/u);
  });

  it("parses only an exact receipt and matching HTTP semantics", () => {
    const parsed = parseChewingOperationResult(row(), "create_draft");
    const envelope = {
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "ok",
      data: { ...parsed, persisted: true, demo: false },
      errors: [],
    };
    expect(parseChewingActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 201).data.previewObservedCount).toBe(3);
    expect(() => parseChewingActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 200)).toThrow(/MISMATCHED/u);
    expect(() => parseChewingOperationResult({
      ...row(),
      formal_score: 3,
    }, "create_draft")).toThrowError(/憑證/u);
  });

  it("only accepts the structured error envelope", () => {
    expect(parseChewingActionError({
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "error",
      data: null,
      errors: [{
        code: "CHEWING_RULE_NOT_ACTIVATED",
        message: "正式規則未啟用",
      }],
    })?.status).toBe("error");
    expect(parseChewingActionError({ error: "raw" })).toBeNull();
  });
});

describe("page 35 server projection and synthetic demo", () => {
  it("projects one latest row per assigned client and immutable history", () => {
    const snapshot = buildDemoChewingAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items).toHaveLength(3);
    expect(new Set(snapshot.items.map((item) => item.clientId)).size).toBe(3);
    expect(snapshot.items[0]!.versionHistory.map((item) =>
      item.assessmentVersion)).toEqual([2, 1]);
    expect(snapshot.formalScoreStatus).toBe("not_available");
    expect(snapshot.formalAbilityClassificationStatus).toBe("not_available");
    expect(snapshot.formalCorrectionStatus).toBe("blocked_no_signed_record");
    expect(snapshot.diagnosisStatus).toBe("blocked");
    expect(snapshot.careDecisionStatus).toBe("blocked");
    expect(snapshot.nutritionReferralStatus).toBe("not_configured");
    expect(snapshot.swallowingReferralStatus).toBe("not_configured");
    expect(snapshot.notificationStatus).toBe("not_configured");
  });

  it("filters exact answer states without widening client scope", () => {
    const snapshot = filterDemoChewingAssessmentSnapshot(
      buildDemoChewingAssessmentSnapshot(),
      { clientId: null, previewStatus: "all", answerState: "has_missing" },
    );
    expect(snapshot.items.map((item) => item.clientDisplayName)).toEqual([
      "合成個案 C",
    ]);
    expect(snapshot.metrics.incomplete).toBe(1);
  });

  it("rejects a malformed projection instead of trusting a count", () => {
    const source = buildDemoChewingAssessmentSnapshot();
    expect(() => projectChewingAssessmentSnapshot({
      row: {
        organization_id: source.organizationId,
        branch_id: source.branchId,
        generated_at: source.generatedAt,
        items: [],
      },
      expectedOrganizationId: source.organizationId,
      expectedBranchId: source.branchId,
      demo: false,
    })).toThrow(/INVALID_CHEWING/u);
  });
});

describe("page 35 strict list query", () => {
  it("accepts omitted and explicit all filters", () => {
    expect(parseChewingAssessmentFilters({})).toEqual({
      filters: {
        clientId: null,
        previewStatus: "all",
        answerState: "all",
      },
      invalidFilters: false,
    });
    expect(parseChewingAssessmentFilters({
      client: "",
      preview: "all",
      answers: "all",
    }).invalidFilters).toBe(false);
  });

  it("preserves an exact client and whitelisted statuses", () => {
    expect(parseChewingAssessmentFilters({
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
    [{ unexpected: "all" }, "unknown query key"],
  ])("fails closed for malformed query (%s: %s)", (query, label) => {
    expect(label).toBeTruthy();
    expect(parseChewingAssessmentFilters(query).invalidFilters).toBe(true);
  });
});
