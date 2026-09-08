import { describe, expect, it } from "vitest";

import { buildDemoReferralManagementSnapshot } from "./demo";
import {
  correlateReferralManagementReceipt,
  parseReferralManagementApiError,
  parseReferralManagementApiSuccess,
  parseReferralManagementDatabaseReceipt,
  parseReferralManagementMutation,
} from "./parser";
import { projectReferralManagementSnapshot } from "./projection";
import type { ReferralManagementFilters } from "./types";

const organizationId = "39000000-0000-4000-8000-000000000001";
const branchId = "39000000-0000-4000-8000-000000000002";
const clientId = "39000000-0000-4000-8000-000000000003";
const referralKey = "39000000-0000-4000-8000-000000000004";
const previousEventId = "39000000-0000-4000-8000-000000000005";
const key = "39000000-0000-4000-8000-000000000006";
const baseFilters: ReferralManagementFilters = {
  clientId: null,
  receivingUnitMode: "all",
  receivingUnitCode: null,
  status: "all",
  recentFrom: null,
  recentTo: null,
  query: "",
};

function create(unitState: "manual_unstandardized" | "missing" | "not_applicable") {
  return parseReferralManagementMutation({
    action: "create",
    clientId,
    receivingUnitState: unitState,
    receivingUnitCode: unitState === "manual_unstandardized" ? "DEMO-CLINIC" : null,
    receivingUnitName: unitState === "manual_unstandardized" ? "合成復健診所" : null,
    referralDate: "2026-09-02T09:00:00+08:00",
    referralReason: "合成轉介原因摘要",
  }, key);
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    operation_id: "39000000-0000-4000-8000-000000000007",
    operation_kind: "create",
    referral_key: referralKey,
    event_id: "39000000-0000-4000-8000-000000000008",
    event_sequence: 1,
    previous_event_id: null,
    event_kind: "created",
    referral_status: "draft",
    receiving_unit_state: "missing",
    notification_count: 1,
    notification_queue_status: "queued",
    notification_provider_status: "not_configured",
    external_delivery_status: "not_configured",
    delivery_claim: "no_external_delivery_claim",
    attachment_status: "not_configured",
    export_status: "not_configured",
    committed_at: "2026-09-02T01:01:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("Page 39 referral management contracts", () => {
  it("parses manual, missing and not-applicable receiving units without collapsing them", () => {
    expect(create("manual_unstandardized").receivingUnitCode).toBe("DEMO-CLINIC");
    expect(create("missing").receivingUnitState).toBe("missing");
    expect(create("not_applicable").receivingUnitState).toBe("not_applicable");
  });

  it("rejects mixed unit provenance and unconfigured attachment or delivery fields", () => {
    expect(() => parseReferralManagementMutation({
      action: "create",
      clientId,
      receivingUnitState: "missing",
      receivingUnitCode: "DEMO-CLINIC",
      receivingUnitName: "合成診所",
      referralDate: "2026-09-02T09:00:00+08:00",
      referralReason: "不得混用缺值與人工單位",
    }, key)).toThrow();
    expect(() => parseReferralManagementMutation({
      action: "create",
      clientId,
      receivingUnitState: "manual_unstandardized",
      receivingUnitCode: "DEMO-CLINIC",
      receivingUnitName: "合成診所",
      referralDate: "2026-09-02T09:00:00+08:00",
      referralReason: "不得夾帶未配置欄位",
      attachmentUrl: "https://example.invalid/file",
    }, key)).toThrow();
  });

  it("enforces strict linear action inputs and reasoned narrow correction", () => {
    const submit = parseReferralManagementMutation({
      action: "submit", referralKey, previousEventId, expectedSequence: 1,
    }, key);
    expect(submit.action).toBe("submit");
    expect(() => parseReferralManagementMutation({
      action: "respond", referralKey, previousEventId, expectedSequence: 2,
    }, key)).toThrow();
    expect(() => parseReferralManagementMutation({
      action: "correct", referralKey, previousEventId, expectedSequence: 5,
      correctsEventId: "39000000-0000-4000-8000-000000000009",
      entryContent: "更正後內容",
    }, key)).toThrow();
    expect(parseReferralManagementMutation({
      action: "correct", referralKey, previousEventId, expectedSequence: 5,
      correctsEventId: "39000000-0000-4000-8000-000000000009",
      entryContent: "更正後內容", correctionReason: "原摘要文字誤植",
    }, key).correctionReason).toBe("原摘要文字誤植");
  });

  it("accepts only strict database receipts with fail-closed provider boundaries", () => {
    const input = create("missing");
    const parsed = parseReferralManagementDatabaseReceipt(receipt());
    expect(correlateReferralManagementReceipt(
      parsed, input, organizationId, branchId,
    ).delivery_claim).toBe("no_external_delivery_claim");
    expect(() => parseReferralManagementDatabaseReceipt(receipt({
      external_delivery_status: "delivered",
    }))).toThrow();
    expect(() => correlateReferralManagementReceipt(
      parsed, input, clientId, branchId,
    )).toThrow();
  });

  it("correlates strict API success with tenant and new/replay HTTP status", () => {
    const input = create("missing");
    const data = receipt();
    const envelope = {
      requestId: "39000000-0000-4000-8000-000000000010",
      status: "ok",
      errors: [],
      data: {
        organizationId: data.organization_id,
        branchId: data.branch_id,
        operationId: data.operation_id,
        operationKind: data.operation_kind,
        referralKey: data.referral_key,
        eventId: data.event_id,
        eventSequence: data.event_sequence,
        previousEventId: data.previous_event_id,
        eventKind: data.event_kind,
        referralStatus: data.referral_status,
        receivingUnitState: data.receiving_unit_state,
        notificationCount: data.notification_count,
        notificationQueueStatus: data.notification_queue_status,
        notificationProviderStatus: data.notification_provider_status,
        externalDeliveryStatus: data.external_delivery_status,
        deliveryClaim: data.delivery_claim,
        attachmentStatus: data.attachment_status,
        exportStatus: data.export_status,
        committedAt: data.committed_at,
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
    };
    expect(parseReferralManagementApiSuccess(
      envelope, input, organizationId, branchId, 201,
    ).data.referralStatus).toBe("draft");
    expect(() => parseReferralManagementApiSuccess(
      envelope, input, organizationId, branchId, 200,
    )).toThrow();
  });

  it("rejects arbitrary structured error strings and control characters", () => {
    expect(parseReferralManagementApiError({
      requestId: "39000000-0000-4000-8000-000000000010",
      status: "error", data: null,
      errors: [{ code: "REFERRAL_CONFLICT", message: "請重新載入" }],
    })?.errors[0]?.code).toBe("REFERRAL_CONFLICT");
    expect(parseReferralManagementApiError({
      requestId: "39000000-0000-4000-8000-000000000010",
      status: "error", data: null,
      errors: [{ code: "unsafe-code", message: "任意字串" }],
    })).toBeNull();
    expect(parseReferralManagementApiError({
      requestId: "39000000-0000-4000-8000-000000000010",
      status: "error", data: null,
      errors: [{ code: "SAFE_CODE", message: "危險\n訊息" }],
    })).toBeNull();
  });

  it("filters synthetic demo by exact unit and keeps missing versus N/A metrics", () => {
    const missing = buildDemoReferralManagementSnapshot({
      organizationId, branchId,
      filters: { ...baseFilters, receivingUnitMode: "missing" },
    });
    const notApplicable = buildDemoReferralManagementSnapshot({
      organizationId, branchId,
      filters: { ...baseFilters, receivingUnitMode: "not_applicable" },
    });
    const exact = buildDemoReferralManagementSnapshot({
      organizationId, branchId,
      filters: { ...baseFilters, receivingUnitMode: "specific", receivingUnitCode: "DEMO-CLINIC" },
    });
    expect(missing.metrics.unitMissing).toBe(1);
    expect(missing.metrics.unitNotApplicable).toBe(0);
    expect(notApplicable.metrics.unitMissing).toBe(0);
    expect(notApplicable.metrics.unitNotApplicable).toBe(1);
    expect(exact.items.every((item) => item.receivingUnitCode === "DEMO-CLINIC")).toBe(true);
    expect(exact.demo).toBe(true);
  });

  it("fails projection on forged context, capabilities or aggregate totals", () => {
    const row = {
      organization_id: organizationId, organization_name: "合成機構",
      branch_id: branchId, branch_name: "合成分支",
      generated_at: "2026-09-02T01:00:00Z", snapshot_token: "a".repeat(64),
      items: [], matching_total: 0, draft_total: 0, submitted_total: 0,
      received_total: 0, responded_total: 0, closed_total: 0,
      unit_missing_total: 0, unit_not_applicable_total: 0, items_truncated: false,
      client_options: [], receiving_unit_options: [],
      can_create: false, can_submit: false, can_register_receipt: false,
      can_respond: false, can_close: false, can_correct: false,
      receiving_unit_directory_status: "not_configured", attachment_status: "not_configured",
      export_status: "not_configured", notification_queue_status: "queued",
      notification_provider_status: "not_configured", external_delivery_status: "not_configured",
      delivery_claim: "no_external_delivery_claim",
    };
    expect(projectReferralManagementSnapshot({
      row, expectedOrganizationId: organizationId, expectedBranchId: branchId,
      expectedCanCreate: false, expectedCanSubmit: false,
      expectedCanRegisterReceipt: false, expectedCanRespond: false,
      expectedCanClose: false, expectedCanCorrect: false, demo: false,
    }).metrics.matching).toBe(0);
    expect(() => projectReferralManagementSnapshot({
      row: { ...row, can_submit: true }, expectedOrganizationId: organizationId,
      expectedBranchId: branchId, expectedCanCreate: false, expectedCanSubmit: false,
      expectedCanRegisterReceipt: false, expectedCanRespond: false,
      expectedCanClose: false, expectedCanCorrect: false, demo: false,
    })).toThrow();
    expect(() => projectReferralManagementSnapshot({
      row: { ...row, matching_total: 1, draft_total: 0 },
      expectedOrganizationId: organizationId, expectedBranchId: branchId,
      expectedCanCreate: false, expectedCanSubmit: false,
      expectedCanRegisterReceipt: false, expectedCanRespond: false,
      expectedCanClose: false, expectedCanCorrect: false, demo: false,
    })).toThrow();
  });
});
