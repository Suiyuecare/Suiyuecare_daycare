import { describe, expect, it } from "vitest";

import { buildDemoCaseConferenceSnapshot } from "./demo";
import {
  parseCaseConferenceApiError,
  parseCaseConferenceApiSuccess,
  parseCaseConferenceDatabaseReceipt,
  parseCaseConferenceMutation,
} from "./parser";
import type { CaseConferenceFilters } from "./types";

const organizationId = "38100000-0000-4000-8000-000000000001";
const branchId = "38200000-0000-4000-8000-000000000001";
const clientId = "38400000-0000-4000-8000-000000000001";
const key = "38800000-0000-4000-8000-000000000001";
const filters: CaseConferenceFilters = {
  clientId: null, status: "all", responsibleUserId: null, actionStatus: "all",
  meetingFrom: null, meetingTo: null, query: "",
};
const body = {
  action: "create", clientId,
  meetingStartsAt: "2026-09-01T09:00:00+08:00",
  meetingEndsAt: "2026-09-01T10:00:00+08:00",
  problemStatement: "合成問題摘要",
  decisionSummary: "合成決議摘要",
  attendees: [{ userId: "38200000-0000-4000-8000-000000000001", attendanceStatus: "attended" }],
  actionItems: [{ actionId: "38600000-0000-4000-8000-000000000001", itemOrder: 1,
    actionText: "合成追蹤行動", responsibleUserId: "38200000-0000-4000-8000-000000000001",
    deadlineState: "missing", dueDate: null, actionStatus: "open" }],
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId, branch_id: branchId,
    operation_id: "38800000-0000-4000-8000-000000000002", operation_kind: "create",
    meeting_key: "38800000-0000-4000-8000-000000000003",
    version_id: "38800000-0000-4000-8000-000000000004", version: 1,
    previous_version_id: null, corrects_version_id: null, version_kind: "created",
    conference_status: "draft", signed_at: null, content_hash: "a".repeat(64),
    attachment_status: "not_configured", export_status: "not_configured",
    notification_status: "not_configured", external_delivery_status: "not_configured",
    delivery_claim: "no_external_delivery_claim", offline_status: "not_configured",
    committed_at: "2026-09-02T01:00:00Z", replayed: false, ...overrides,
  };
}

describe("Page 38 case conference contracts", () => {
  it("parses a strict create and preserves missing deadline separately", () => {
    const parsed = parseCaseConferenceMutation(body, key);
    expect(parsed).toMatchObject({ action: "create", clientId, idempotencyKey: key });
    expect(parsed.actionItems?.[0]).toMatchObject({ deadlineState: "missing", dueDate: null });
    expect(() => parseCaseConferenceMutation({ ...body, surprise: true }, key)).toThrow();
  });

  it("rejects deadline dates before the Taipei meeting date", () => {
    expect(() => parseCaseConferenceMutation({
      ...body,
      actionItems: [{ ...body.actionItems[0], deadlineState: "dated", dueDate: "2026-08-31" }],
    }, key)).toThrow();
  });

  it("separates missing and not-applicable in the synthetic snapshot", () => {
    const snapshot = buildDemoCaseConferenceSnapshot({ organizationId, branchId, filters });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.canManage).toBe(false);
    expect(snapshot.metrics.matching).toBe(4);
    expect(snapshot.metrics.deadlineMissing).toBe(1);
    expect(snapshot.metrics.deadlineNotApplicable).toBe(1);
    expect(snapshot.metrics.overdueAction).toBe(1);
    expect(snapshot.items.some((item) => item.history.length === 3 &&
      item.versionKind === "corrected")).toBe(true);
  });

  it("uses identical full-collection metrics after exact filters", () => {
    const all = buildDemoCaseConferenceSnapshot({ organizationId, branchId, filters });
    const responsible = all.staffOptions[2]!.userId;
    const filtered = buildDemoCaseConferenceSnapshot({ organizationId, branchId, filters: {
      ...filters, responsibleUserId: responsible, actionStatus: "open",
    } });
    expect(filtered.items.every((item) => item.actionItems.some((action) =>
      action.responsibleUserId === responsible && action.actionStatus === "open"))).toBe(true);
    expect(filtered.metrics.matching).toBe(filtered.items.length);
    expect(filtered.metrics.actionTotal).toBe(
      filtered.items.reduce((sum, item) => sum + item.actionItems.length, 0),
    );
  });

  it("requires a strict DB receipt and exact API correlation", () => {
    const input = parseCaseConferenceMutation(body, key);
    expect(parseCaseConferenceDatabaseReceipt(receipt()).replayed).toBe(false);
    const envelope = {
      requestId: "38800000-0000-4000-8000-000000000010", status: "ok", errors: [],
      data: {
        organizationId, branchId, operationId: receipt().operation_id,
        operationKind: "create", meetingKey: receipt().meeting_key,
        versionId: receipt().version_id, version: 1, previousVersionId: null,
        correctsVersionId: null, versionKind: "created", conferenceStatus: "draft",
        signedAt: null, contentHash: "a".repeat(64), attachmentStatus: "not_configured",
        exportStatus: "not_configured", notificationStatus: "not_configured",
        externalDeliveryStatus: "not_configured", deliveryClaim: "no_external_delivery_claim",
        offlineStatus: "not_configured", committedAt: "2026-09-02T01:00:00Z",
        replayed: false, persisted: true, demo: false,
      },
    };
    expect(parseCaseConferenceApiSuccess(envelope, input, organizationId, branchId, 201)
      .data.version).toBe(1);
    expect(() => parseCaseConferenceApiSuccess(envelope, input, branchId, branchId, 201))
      .toThrow();
    expect(() => parseCaseConferenceApiSuccess(envelope, input, organizationId, branchId, 200))
      .toThrow("INVALID_CASE_CONFERENCE_SUCCESS");
  });

  it("rejects forged delivery claims and unsafe errors", () => {
    expect(() => parseCaseConferenceDatabaseReceipt(receipt({
      external_delivery_status: "delivered",
    }))).toThrow();
    expect(parseCaseConferenceApiError({
      requestId: key, status: "error", data: null,
      errors: [{ code: "SAFE_ERROR", message: "安全錯誤" }],
    })?.errors[0]?.code).toBe("SAFE_ERROR");
    expect(parseCaseConferenceApiError({
      requestId: key, status: "error", data: null,
      errors: [{ code: "unsafe-error", message: "危險\n錯誤" }],
    })).toBeNull();
  });
});
