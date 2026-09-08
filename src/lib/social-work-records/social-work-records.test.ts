import { describe, expect, it } from "vitest";

import { buildDemoSocialWorkRecordSnapshot } from "./demo";
import {
  parseCreateSocialWorkDraft,
  parseSocialWorkActionSuccess,
  parseSocialWorkFollowUpMutation,
  parseSocialWorkRecordOperationResult,
} from "./parser";
import {
  filterDemoSocialWorkRecordSnapshot,
  projectSocialWorkRecordSnapshot,
} from "./projection";

const organizationId = "29100000-0000-4000-8000-000000000001";
const branchId = "29200000-0000-4000-8000-000000000001";
const clientId = "29400000-0000-4000-8000-000000000001";
const authorId = "29000000-0000-4000-8000-000000001001";
const recordKey = "29700000-0000-4000-8000-000000000001";
const operationId = "29800000-0000-4000-8000-000000000001";
const draftVersionId = "29710000-0000-4000-8000-000000000001";
const signedVersionId = "29710000-0000-4000-8000-000000000002";
const idempotencyKey = "29900000-0000-4000-8000-000000000001";

function sourceRow(overrides: Record<string, unknown> = {}) {
  const draft = {
    version_id: draftVersionId,
    record_version: 1,
    record_state: "draft",
    occurred_at: "2026-09-02T01:00:00.000Z",
    service_type: "家庭支持",
    service_content: "合成服務內容",
    service_result: "合成服務結果",
    correction_reason: null,
    author_display_name: "測試社工",
    signed_at: null,
    signer_display_name: null,
    created_at: "2026-09-02T01:10:00.000Z",
  };
  const signed = {
    ...draft,
    version_id: signedVersionId,
    record_version: 2,
    record_state: "signed",
    signed_at: "2026-09-02T01:15:00.000Z",
    signer_display_name: "測試社工",
    created_at: "2026-09-02T01:15:00.000Z",
  };
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-02T02:00:00.000Z",
    records: [{
      record_key: recordKey,
      version_id: signedVersionId,
      record_version: 2,
      record_state: "signed",
      client_id: clientId,
      client_display_name: "合成個案甲",
      occurred_at: "2026-09-02T01:00:00.000Z",
      service_type: "家庭支持",
      service_content: "合成服務內容",
      service_result: "合成服務結果",
      author_user_id: authorId,
      author_display_name: "測試社工",
      correction_reason: null,
      signed_at: "2026-09-02T01:15:00.000Z",
      signer_display_name: "測試社工",
      created_at: "2026-09-02T01:15:00.000Z",
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
    record_total: 1,
    matching_total: 1,
    records_truncated: false,
    current_month_total: 1,
    pending_follow_up_total: 0,
    overdue_follow_up_total: 0,
    draft_total: 0,
    signed_total: 1,
    client_options: [{
      client_id: clientId,
      display_name: "合成個案甲",
      client_status: "active",
      admitted_on: "2026-01-01",
      ended_on: null,
    }],
    client_total: 1,
    client_options_truncated: false,
    service_type_options: ["家庭支持"],
    service_type_total: 1,
    service_type_options_truncated: false,
    author_options: [{ user_id: authorId, display_name: "測試社工" }],
    author_total: 1,
    author_options_truncated: false,
    offline_sync_status: "not_configured",
    follow_up_notification_status: "none_not_sent",
    ...overrides,
  };
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "29800000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      receiptKind: "record",
      action: "sign",
      operationId,
      recordKey,
      versionId: signedVersionId,
      recordVersion: 2,
      recordState: "signed",
      committedAt: "2026-09-02T01:15:00.000Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("social-work record projection and parsers", () => {
  it("projects a scoped immutable record and rejects a scope mismatch", () => {
    const snapshot = projectSocialWorkRecordSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId,
      expectedBranchId: branchId, demo: false,
    });
    expect(snapshot).toMatchObject({
      recordTotal: 1,
      matchingTotal: 1,
      metrics: { currentMonth: 1, pendingFollowUp: 0, drafts: 0, signed: 1 },
      offlineSyncStatus: "not_configured",
      followUpNotificationStatus: "none_not_sent",
    });
    expect(snapshot.records[0]?.versionHistory.map((item) => item.recordVersion))
      .toEqual([1, 2]);
    expect(() => projectSocialWorkRecordSnapshot({
      row: sourceRow(), expectedOrganizationId: organizationId,
      expectedBranchId: "29200000-0000-4000-8000-000000000099", demo: false,
    })).toThrow("INVALID_SOCIAL_WORK_RECORD_PROJECTION");
  });

  it("rejects a terminal/version-history mismatch and contradictory totals", () => {
    const terminalMismatch = sourceRow();
    const record = terminalMismatch.records[0]!;
    record.service_content = "與歷程不同";
    expect(() => projectSocialWorkRecordSnapshot({ row: terminalMismatch,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false }))
      .toThrow("INVALID_SOCIAL_WORK_RECORD_PROJECTION");
    expect(() => projectSocialWorkRecordSnapshot({ row: sourceRow({ draft_total: 1 }),
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false }))
      .toThrow("INVALID_SOCIAL_WORK_RECORD_PROJECTION");
  });

  it("requires database ordering by actual occurrence time, never creation time", () => {
    const row = sourceRow();
    const first = row.records[0]!;
    const older = structuredClone(first);
    older.record_key = "29700000-0000-4000-8000-000000000002";
    older.version_id = "29710000-0000-4000-8000-000000000004";
    older.occurred_at = "2026-09-01T01:00:00.000Z";
    older.created_at = "2026-09-02T01:30:00.000Z";
    const history = older.version_history;
    history[0]!.version_id = "29710000-0000-4000-8000-000000000003";
    history[0]!.occurred_at = older.occurred_at;
    history[0]!.created_at = "2026-09-02T01:20:00.000Z";
    history[1]!.version_id = older.version_id;
    history[1]!.occurred_at = older.occurred_at;
    history[1]!.created_at = older.created_at;
    row.records = [older, first];
    Object.assign(row, { record_total: 2, matching_total: 2,
      current_month_total: 2, signed_total: 2 });
    expect(() => projectSocialWorkRecordSnapshot({ row,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false }))
      .toThrow("INVALID_SOCIAL_WORK_RECORD_PROJECTION");
    row.records = [first, older];
    expect(projectSocialWorkRecordSnapshot({ row,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, demo: false })
      .records.map((item) => item.recordKey)).toEqual([recordKey, older.record_key]);
  });

  it("filters synthetic demo records without expanding its assigned-client set", () => {
    const snapshot = buildDemoSocialWorkRecordSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.records).toHaveLength(3);
    const selected = snapshot.records[1]!;
    const filtered = filterDemoSocialWorkRecordSnapshot(snapshot, {
      dateFrom: null,
      dateTo: null,
      clientId: selected.clientId,
      serviceType: selected.serviceType,
      authorUserId: selected.authorUserId,
    });
    expect(filtered.records.map((item) => item.recordKey)).toEqual([selected.recordKey]);
    expect(filtered.metrics.drafts + filtered.metrics.signed).toBe(1);
    expect(filtered.clientOptions).toEqual(snapshot.clientOptions);
  });

  it("strictly parses create and follow-up inputs and normalizes absent fields", () => {
    expect(parseCreateSocialWorkDraft({
      action: "create_draft", clientId,
      occurredAt: "2026-09-02T09:00:00+08:00", serviceType: " 家庭支持 ",
      serviceContent: "合成內容", serviceResult: "合成結果",
    }, idempotencyKey)).toMatchObject({
      serviceType: "家庭支持", occurredAt: "2026-09-02T01:00:00.000Z",
    });
    expect(() => parseCreateSocialWorkDraft({
      action: "create_draft", clientId,
      occurredAt: "2026-09-02T09:00:00+08:00", serviceType: "家庭支持",
      serviceContent: "內容", serviceResult: "結果", forged: true,
    }, idempotencyKey)).toThrow(/未通過驗證/u);
    expect(parseSocialWorkFollowUpMutation({
      action: "complete_follow_up", clientId, recordKey,
      serviceVersionId: signedVersionId, expectedSequence: 1,
      followUpOutcome: "完成合成追蹤",
    }, idempotencyKey)).toMatchObject({
      dueOn: null, followUpPlan: null, followUpOutcome: "完成合成追蹤",
      transitionReason: null,
    });
  });

  it("strictly correlates database and browser receipts", () => {
    expect(parseSocialWorkRecordOperationResult({
      operation_id: operationId,
      record_key: recordKey,
      version_id: signedVersionId,
      record_version: "2",
      record_state: "signed",
      committed_at: "2026-09-02T01:15:00Z",
      replayed: false,
    }, "sign")).toMatchObject({
      receiptKind: "record", action: "sign", recordVersion: 2,
    });
    const parsed = parseSocialWorkActionSuccess(successEnvelope(), {
      action: "sign", recordKey, expectedVersion: 1,
    }, 201);
    expect(parsed.data).toMatchObject({ receiptKind: "record", recordState: "signed" });
    expect(() => parseSocialWorkActionSuccess(successEnvelope({ recordVersion: 3 }), {
      action: "sign", recordKey, expectedVersion: 1,
    }, 201)).toThrow("MISMATCHED_SOCIAL_WORK_SUCCESS");
    expect(() => parseSocialWorkActionSuccess(successEnvelope(), {
      action: "sign", recordKey, expectedVersion: 1,
    }, 200)).toThrow("INVALID_SOCIAL_WORK_HTTP_STATUS");
    expect(() => parseSocialWorkRecordOperationResult({
      operation_id: operationId, record_key: recordKey,
      version_id: signedVersionId, record_version: 2, record_state: "signed",
      committed_at: "2026-09-02T01:15:00Z", replayed: false, narrative: "forbidden",
    }, "sign")).toThrow(/完成憑證/u);
  });
});
