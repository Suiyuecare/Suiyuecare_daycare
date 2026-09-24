import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  buildDemoGdsAssessmentSnapshot,
  candidateAnswers,
  GDS_DEMO_RULE_SNAPSHOT,
} from "./demo";
import {
  buildGdsTrialPreview,
  gdsAnswersSchema,
  gdsRuleSnapshotSchema,
  parseCreateGdsDraft,
  parseGdsActionError,
  parseGdsActionSuccess,
  parseGdsAssessmentMutation,
  parseGdsOperationResult,
} from "./parser";
import {
  filterDemoGdsAssessmentSnapshot,
  projectGdsAssessmentSnapshot,
} from "./projection";
import { parseGdsAssessmentFilters } from "./query";
import { GDS_RULE_VERSION, type GdsAnswers } from "./types";

const clientId = "12000000-0000-4000-8000-000000000001";
const assessmentKey = "12200000-0000-4000-8000-000000000001";
const versionId = "12100000-0000-4000-8000-000000000002";
const authorId = "12000000-0000-4000-8000-000000000012";
const operationId = "12300000-0000-4000-8000-000000000001";
const idem = "12400000-0000-4000-8000-000000000001";

function createBody(answers: GdsAnswers = candidateAnswers(5)) {
  return {
    action: "create_draft",
    clientId,
    assessedOn: "2026-09-02",
    answers,
    ruleVersionId: GDS_RULE_VERSION,
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
    rule_version_id: GDS_RULE_VERSION,
    governance_status: "candidate_unactivated",
    preview_status: "candidate_complete",
    preview_candidate_points: 5,
    preview_band_key: "elevated_5_8",
    committed_at: "2026-09-02T03:00:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("GDS candidate rule", () => {
  it.each([
    [0, "reference_0_4"],
    [4, "reference_0_4"],
    [5, "elevated_5_8"],
    [8, "elevated_5_8"],
    [9, "high_9_11"],
    [11, "high_9_11"],
    [12, "very_high_12_15"],
    [15, "very_high_12_15"],
  ])("reproduces %i candidate points in %s", (points, bandKey) => {
    expect(buildGdsTrialPreview(candidateAnswers(points))).toEqual({
      status: "candidate_complete",
      candidatePoints: points,
      bandKey,
    });
  });

  it("does not turn an unanswered item into zero", () => {
    const answers = ({
      ...candidateAnswers(5),
      gds_01: { state: "missing" },
    }) as GdsAnswers;
    expect(buildGdsTrialPreview(answers)).toEqual({
      status: "incomplete",
      candidatePoints: null,
      bandKey: null,
    });
  });

  it("preserves not-applicable separately and suppresses preview", () => {
    const answers = {
      ...candidateAnswers(5),
      gds_01: { state: "not_applicable", reason: "本次無法確認" },
    } as GdsAnswers;
    expect(gdsAnswersSchema.parse(answers).gds_01).toEqual({
      state: "not_applicable",
      reason: "本次無法確認",
    });
    expect(buildGdsTrialPreview(answers).candidatePoints).toBeNull();
  });

  it("pins all fifteen answer slots and the exact candidate snapshot", () => {
    expect(Object.keys(gdsAnswersSchema.parse(candidateAnswers(4)))).toHaveLength(15);
    expect(gdsRuleSnapshotSchema.parse(GDS_DEMO_RULE_SNAPSHOT)).toEqual(
      GDS_DEMO_RULE_SNAPSHOT,
    );
  });
});

describe("GDS strict request and receipt parsers", () => {
  it("accepts an exact create draft and actor-scoped idempotency key", () => {
    expect(parseCreateGdsDraft(createBody(), idem)).toMatchObject({
      action: "create_draft",
      clientId,
      idempotencyKey: idem,
      ruleVersionId: GDS_RULE_VERSION,
    });
  });

  it.each([
    [{ ...createBody(), unknown: true }, "unknown property"],
    [{ ...createBody(), answers: { ...candidateAnswers(4), gds_16: { state: "missing" } } }, "sixteenth slot"],
    [{ ...createBody(), answers: Object.fromEntries(Object.entries(candidateAnswers(4)).slice(0, 14)) }, "missing slot"],
    [{ ...createBody(), assessedOn: "2026-02-30" }, "invalid date"],
    [{ ...createBody(), ruleVersionId: "unapproved-rule" }, "wrong rule"],
  ])("rejects %s (%s)", (body, _label) => {
    void _label;
    expect(() => parseCreateGdsDraft(body, idem)).toThrow(IntegrationError);
  });

  it("distinguishes revise and blocked sign input", () => {
    expect(parseGdsAssessmentMutation({
      ...createBody(),
      action: "revise_draft",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("revise_draft");
    expect(parseGdsAssessmentMutation({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    }, idem).action).toBe("sign");
  });

  it("rejects a receipt whose completeness fields disagree", () => {
    expect(() => parseGdsOperationResult(row({
      preview_status: "incomplete",
    }), "create_draft")).toThrowError(/憑證/);
  });

  it("parses an exact operation receipt and HTTP status", () => {
    const parsed = parseGdsOperationResult(row(), "create_draft");
    const envelope = {
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "ok",
      data: { ...parsed, persisted: true, demo: false },
      errors: [],
    };
    expect(parseGdsActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 201).data.previewCandidatePoints).toBe(5);
    expect(() => parseGdsActionSuccess(envelope, {
      action: "create_draft",
      clientId,
    }, 200)).toThrow(/MISMATCHED/);
  });

  it("only accepts the structured error envelope", () => {
    expect(parseGdsActionError({
      requestId: "12500000-0000-4000-8000-000000000001",
      status: "error",
      data: null,
      errors: [{ code: "GDS_RULE_NOT_ACTIVATED", message: "規則未啟用" }],
    })?.status).toBe("error");
    expect(parseGdsActionError({ error: "raw" })).toBeNull();
  });
});

describe("GDS server projection and synthetic demo", () => {
  it("projects one latest card per assigned client and immutable history", () => {
    const snapshot = buildDemoGdsAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items).toHaveLength(3);
    expect(new Set(snapshot.items.map((item) => item.clientId)).size).toBe(3);
    expect(snapshot.items[0]!.versionHistory.map((item) =>
      item.assessmentVersion)).toEqual([2, 1]);
    expect(snapshot.formalRiskStatus).toBe("not_available");
    expect(snapshot.notificationStatus).toBe("not_configured");
  });

  it("filters demo items by exact answer state without widening scope", () => {
    const snapshot = filterDemoGdsAssessmentSnapshot(
      buildDemoGdsAssessmentSnapshot(),
      { clientId: null, previewStatus: "all", answerState: "has_missing" },
    );
    expect(snapshot.items.map((item) => item.clientDisplayName)).toEqual([
      "黃O生（合成）",
    ]);
    expect(snapshot.metrics.incomplete).toBe(1);
  });

  it("rejects a tampered snapshot rather than trusting candidate points", () => {
    const source = buildDemoGdsAssessmentSnapshot();
    expect(() => projectGdsAssessmentSnapshot({
      row: {
        organization_id: source.organizationId,
        branch_id: source.branchId,
        generated_at: source.generatedAt,
        items: [],
      },
      expectedOrganizationId: source.organizationId,
      expectedBranchId: source.branchId,
      demo: false,
    })).toThrow(/INVALID_GDS/);
  });
});

describe("GDS list query", () => {
  it("accepts an omitted or explicitly broad filter without changing its meaning", () => {
    expect(parseGdsAssessmentFilters({})).toEqual({
      filters: {
        clientId: null,
        previewStatus: "all",
        answerState: "all",
      },
      invalidFilters: false,
    });
    expect(parseGdsAssessmentFilters({
      client: "",
      preview: "all",
      answers: "all",
    }).invalidFilters).toBe(false);
  });

  it("preserves a valid exact client and whitelisted statuses", () => {
    expect(parseGdsAssessmentFilters({
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
    expect(parseGdsAssessmentFilters(query).invalidFilters).toBe(true);
  });
});
