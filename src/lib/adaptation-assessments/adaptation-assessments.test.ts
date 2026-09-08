import { describe, expect, it } from "vitest";

import { buildDemoAdaptationAssessmentSnapshot } from "./demo";
import {
  parseAdaptationActionSuccess,
  parseAdaptationAssessmentOperationResult,
  parseAdaptationFollowUpMutation,
  parseCreateAdaptationDraft,
} from "./parser";
import {
  filterDemoAdaptationAssessmentSnapshot,
  projectAdaptationAssessmentSnapshot,
} from "./projection";

const organizationId = "32100000-0000-4000-8000-000000000091";
const branchId = "32200000-0000-4000-8000-000000000091";
const clientId = "32300000-0000-4000-8000-000000000091";
const assessorId = "32400000-0000-4000-8000-000000000091";
const assessmentKey = "32500000-0000-4000-8000-000000000091";
const draftVersionId = "32600000-0000-4000-8000-000000000091";
const signedVersionId = "32600000-0000-4000-8000-000000000092";
const operationId = "32700000-0000-4000-8000-000000000091";
const idempotencyKey = "32800000-0000-4000-8000-000000000091";

function sourceRow(overrides: Record<string, unknown> = {}) {
  const draft = {
    version_id: draftVersionId,
    assessment_version: 1,
    record_state: "draft",
    assessed_on: "2026-09-01",
    adaptation_status: "adjusting",
    assessment_summary: "合成人工評估摘要",
    reassessment_due_on: "2026-09-15",
    needs_follow_up: true,
    form_basis: "manual_unstandardized",
    form_version_reference: "manual-adaptation-v1",
    correction_reason: null,
    assessor_display_name: "測試社工",
    signed_at: null,
    signer_display_name: null,
    created_at: "2026-09-01T02:00:00.000Z",
  };
  const signed = {
    ...draft,
    version_id: signedVersionId,
    assessment_version: 2,
    record_state: "signed",
    signed_at: "2026-09-01T02:10:00.000Z",
    signer_display_name: "測試社工",
    created_at: "2026-09-01T02:10:00.000Z",
  };
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-02T02:00:00.000Z",
    items: [{
      client_id: clientId,
      client_display_name: "合成個案 A",
      service_status: "active",
      admitted_on: "2026-01-01",
      ended_on: null,
      version_id: signedVersionId,
      assessment_key: assessmentKey,
      assessment_version: 2,
      record_state: "signed",
      assessed_on: "2026-09-01",
      adaptation_status: "adjusting",
      assessment_summary: "合成人工評估摘要",
      reassessment_due_on: "2026-09-15",
      reassessment_due: false,
      needs_follow_up: true,
      current_follow_up_status: "not_started",
      form_basis: "manual_unstandardized",
      form_version_reference: "manual-adaptation-v1",
      assessor_user_id: assessorId,
      assessor_display_name: "測試社工",
      correction_reason: null,
      signed_at: "2026-09-01T02:10:00.000Z",
      signer_display_name: "測試社工",
      created_at: "2026-09-01T02:10:00.000Z",
      follow_up_event_id: null,
      follow_up_sequence: 0,
      follow_up_status: null,
      follow_up_due_on: null,
      follow_up_plan: null,
      follow_up_outcome: null,
      follow_up_transition_reason: null,
      follow_up_committer_display_name: null,
      follow_up_committed_at: null,
      follow_up_overdue: false,
      version_history: [draft, signed],
      version_history_total: 2,
      follow_up_history: [],
      follow_up_history_total: 0,
    }],
    item_total: 1,
    matching_total: 1,
    items_truncated: false,
    assessed_total: 1,
    not_assessed_total: 0,
    reassessment_due_total: 0,
    needs_follow_up_total: 1,
    open_follow_up_total: 0,
    overdue_follow_up_total: 0,
    draft_total: 0,
    completed_total: 1,
    client_options: [{
      client_id: clientId,
      display_name: "合成個案 A",
      service_status: "active",
      admitted_on: "2026-01-01",
      ended_on: null,
    }],
    client_total: 1,
    client_options_truncated: false,
    assessor_options: [{ user_id: assessorId, display_name: "測試社工" }],
    assessor_total: 1,
    assessor_options_truncated: false,
    assessment_method_status: "manual_unstandardized_only",
    form_publication_status: "not_published_not_claimed",
    offline_sync_status: "not_configured",
    follow_up_notification_status: "none_not_sent",
    ...overrides,
  };
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "32900000-0000-4000-8000-000000000091",
    status: "ok",
    data: {
      receiptKind: "assessment",
      action: "sign",
      operationId,
      clientId,
      assessmentKey,
      versionId: signedVersionId,
      assessmentVersion: 2,
      recordState: "signed",
      assessedOn: "2026-09-01",
      adaptationStatus: "adjusting",
      reassessmentDueOn: "2026-09-15",
      needsFollowUp: true,
      formVersionReference: "manual-adaptation-v1",
      committedAt: "2026-09-01T02:10:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("adaptation assessment projection and parsers", () => {
  it("projects the manual unstandardized contract and exact scope", () => {
    const snapshot = projectAdaptationAssessmentSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false,
    });
    expect(snapshot).toMatchObject({
      itemTotal: 1,
      matchingTotal: 1,
      assessmentMethodStatus: "manual_unstandardized_only",
      formPublicationStatus: "not_published_not_claimed",
      offlineSyncStatus: "not_configured",
      metrics: { assessed: 1, needsFollowUp: 1, completed: 1 },
    });
    expect(snapshot.items[0]).toMatchObject({
      clientId,
      formVersionReference: "manual-adaptation-v1",
      currentFollowUpStatus: "not_started",
    });
    expect(() => projectAdaptationAssessmentSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId,
      expectedBranchId: "32200000-0000-4000-8000-000000000099", demo: false,
    })).toThrow("INVALID_ADAPTATION_ASSESSMENT_PROJECTION");
  });

  it("rejects invented publication claims and contradictory complete metrics", () => {
    expect(() => projectAdaptationAssessmentSnapshot({
      row: sourceRow({ form_publication_status: "published" }),
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_ADAPTATION_ASSESSMENT_PROJECTION");
    expect(() => projectAdaptationAssessmentSnapshot({
      row: sourceRow({ not_assessed_total: 1 }),
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false,
    })).toThrow("INVALID_ADAPTATION_ASSESSMENT_PROJECTION");
  });

  it("rejects terminal/version mismatches and reassessment-date drift", () => {
    const terminalMismatch = sourceRow();
    terminalMismatch.items[0]!.assessment_summary = "與歷程不同";
    expect(() => projectAdaptationAssessmentSnapshot({ row: terminalMismatch,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false }))
      .toThrow("INVALID_ADAPTATION_ASSESSMENT_PROJECTION");
    const wrongDue = sourceRow();
    wrongDue.items[0]!.reassessment_due = true;
    expect(() => projectAdaptationAssessmentSnapshot({ row: wrongDue,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false }))
      .toThrow("INVALID_ADAPTATION_ASSESSMENT_PROJECTION");
  });

  it("includes no-assessment clients and filters demo without expanding options", () => {
    const snapshot = buildDemoAdaptationAssessmentSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.items.some((item) => item.versionId === null)).toBe(true);
    const selected = snapshot.items.find((item) => item.versionId === null)!;
    const filtered = filterDemoAdaptationAssessmentSnapshot(snapshot, {
      clientId: selected.clientId,
      serviceStatus: null,
      assessmentPresence: "not_assessed",
      reassessmentStatus: "all",
      adaptationStatus: null,
      followUpFilter: "all",
    });
    expect(filtered.items.map((item) => item.clientId)).toEqual([selected.clientId]);
    expect(filtered.metrics.notAssessed).toBe(1);
    expect(filtered.clientOptions).toEqual(snapshot.clientOptions);
  });

  it("strictly parses only manual fields and checks the manual due date", () => {
    expect(parseCreateAdaptationDraft({
      action: "create_draft", clientId, assessedOn: "2026-09-01",
      adaptationStatus: "adjusting", assessmentSummary: " 人工摘要 ",
      reassessmentDueOn: "2026-09-15", needsFollowUp: true,
      formVersionReference: "manual-adaptation-v1",
    }, idempotencyKey)).toMatchObject({
      clientId, assessmentSummary: "人工摘要", adaptationStatus: "adjusting",
    });
    expect(() => parseCreateAdaptationDraft({
      action: "create_draft", clientId, assessedOn: "2026-09-15",
      adaptationStatus: "settled", assessmentSummary: "人工摘要",
      reassessmentDueOn: "2026-09-01", needsFollowUp: false,
      formVersionReference: "manual-adaptation-v1",
    }, idempotencyKey)).toThrow(/不得早於/u);
    expect(() => parseCreateAdaptationDraft({
      action: "create_draft", clientId, assessedOn: "2026-09-01",
      adaptationStatus: "settled", assessmentSummary: "人工摘要",
      reassessmentDueOn: "2026-09-15", needsFollowUp: false,
      formVersionReference: "official-scale-v1", score: 12,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
  });

  it("normalizes append-only follow-up actions without hidden notification state", () => {
    expect(parseAdaptationFollowUpMutation({
      action: "complete_follow_up", clientId, assessmentKey,
      assessmentVersionId: signedVersionId, expectedSequence: 1,
      followUpOutcome: "完成合成追蹤",
    }, idempotencyKey)).toMatchObject({
      dueOn: null,
      followUpPlan: null,
      followUpOutcome: "完成合成追蹤",
      transitionReason: null,
    });
  });

  it("strictly parses database receipts and correlates exact client IDs", () => {
    expect(parseAdaptationAssessmentOperationResult({
      operation_id: operationId,
      client_id: clientId,
      assessment_key: assessmentKey,
      version_id: signedVersionId,
      assessment_version: "2",
      record_state: "signed",
      assessed_on: "2026-09-01",
      adaptation_status: "adjusting",
      reassessment_due_on: "2026-09-15",
      needs_follow_up: true,
      form_version_reference: "manual-adaptation-v1",
      committed_at: "2026-09-01T02:10:00Z",
      replayed: false,
    }, "sign")).toMatchObject({ clientId, assessmentVersion: 2 });
    expect(parseAdaptationActionSuccess(successEnvelope(), {
      action: "sign", clientId, assessmentKey, expectedVersion: 1,
    }, 201).data).toMatchObject({ clientId, recordState: "signed" });
    expect(() => parseAdaptationActionSuccess(successEnvelope({
      clientId: "32300000-0000-4000-8000-000000000099",
    }), {
      action: "sign", clientId, assessmentKey, expectedVersion: 1,
    }, 201)).toThrow("MISMATCHED_ADAPTATION_SUCCESS");
  });

  it("rejects unknown receipt fields and non-replay 200 responses", () => {
    expect(() => parseAdaptationAssessmentOperationResult({
      operation_id: operationId, client_id: clientId,
      assessment_key: assessmentKey, version_id: signedVersionId,
      assessment_version: 2, record_state: "signed",
      assessed_on: "2026-09-01", adaptation_status: "adjusting",
      reassessment_due_on: "2026-09-15", needs_follow_up: true,
      form_version_reference: "manual-adaptation-v1",
      committed_at: "2026-09-01T02:10:00Z", replayed: false,
      diagnosis: "forbidden",
    }, "sign")).toThrow(/完成憑證/u);
    expect(() => parseAdaptationActionSuccess(successEnvelope(), {
      action: "sign", clientId, assessmentKey, expectedVersion: 1,
    }, 200)).toThrow("INVALID_ADAPTATION_HTTP_STATUS");
  });
});
