import { describe, expect, it } from "vitest";

import { buildDemoFeedbackComplaintSnapshot } from "./demo";
import {
  parseFeedbackComplaintActionSuccess,
  parseFeedbackComplaintMutation,
  parseFeedbackComplaintReceipt,
} from "./parser";
import { projectFeedbackComplaintSnapshot } from "./projection";
import { parseFeedbackComplaintFilters } from "./query";

const organizationId = "56010000-0000-4000-8000-000000000001";
const branchId = "56020000-0000-4000-8000-000000000001";
const caseId = "56030000-0000-4000-8000-000000000001";
const eventId = "56040000-0000-4000-8000-000000000001";
const operationId = "56050000-0000-4000-8000-000000000001";
const ruleId = "56060000-0000-4000-8000-000000000001";
const key = "56070000-0000-4000-8000-000000000001";

const filters = parseFeedbackComplaintFilters(new URLSearchParams());

function sourceRow() {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: "2026-09-07T04:00:00Z",
    stale_after: "2026-09-07T04:05:00Z",
    items: [{
      id: caseId,
      case_number: "FC-20260907-A1B2C3D4",
      received_at: "2026-09-07T01:00:00Z",
      source: "family" as const,
      case_type: "safety" as const,
      reported_risk: "high" as const,
      effective_risk: "high" as const,
      status: "escalated" as const,
      due_at: "2026-09-09T01:00:00Z",
      overdue: false,
      escalation_reason: "high_risk" as const,
      assignee_membership_id: null,
      assignee_display_name: null,
      chain_version: 1,
      latest_event_at: "2026-09-07T01:00:01Z",
      reporter_name: "合成陳述人",
      reporter_contact: "feedback@example.invalid",
      subject: "合成主旨",
      description: "合成案件內容",
      sensitive_masked: false,
      timeline_total: 1,
      timeline_truncated: false,
      timeline: [{
        id: eventId,
        version: 1,
        event_type: "created" as const,
        occurred_at: "2026-09-07T01:00:00Z",
        resulting_status: "escalated" as const,
        risk_after: "high" as const,
        automatic_reason: "high_risk" as const,
        assignee_membership_id: null,
        assignee_display_name: null,
        corrected_event_id: null,
        note: null,
        sensitive_masked: false,
        actor_display_name: "合成受理人",
        committed_at: "2026-09-07T01:00:01Z",
      }],
    }],
    matching_total: 1,
    items_truncated: false,
    case_total: 1,
    high_risk_total: 1,
    in_progress_total: 1,
    overdue_total: 0,
    assignees: [],
    assignees_truncated: false,
    deadline_rules: [{
      id: ruleId,
      label: "合成家屬安全高風險規則",
      source: "family" as const,
      case_type: "safety" as const,
      risk: "high" as const,
      response_hours: 48,
      effective_from: "2026-01-01",
      effective_through: null,
    }],
    deadline_rule_status: "configured" as const,
    escalation_evaluation_status: "server_clock" as const,
    escalation_delivery_status: "not_configured" as const,
    export_status: "not_configured" as const,
    can_view_sensitive: true,
  };
}

describe("Page 56 feedback and complaint contracts", () => {
  it("accepts only the strict bounded query vocabulary", () => {
    const parsed = parseFeedbackComplaintFilters(new URLSearchParams(
      `from=2026-09-01&to=2026-09-07&source=family&type=safety&risk=high&assignee=${key.toUpperCase()}&status=overdue&q=%25_%E5%90%88%E6%88%90`,
    ));
    expect(parsed).toMatchObject({ receivedFrom: "2026-09-01",
      receivedTo: "2026-09-07", source: "family", caseType: "safety",
      risk: "high", assignee: key, status: "overdue", query: "%_合成" });
  });

  it.each([
    "status=all&status=closed",
    "unknown=value",
    "from=2026-09-08&to=2026-09-07",
    "assignee=not-a-uuid",
    `q=${"x".repeat(121)}`,
    "q=bad%00value",
  ])("rejects ambiguous or unsafe filters: %s", (query) => {
    expect(() => parseFeedbackComplaintFilters(new URLSearchParams(query)))
      .toThrowError(expect.objectContaining({ code: "INVALID_FEEDBACK_FILTER" }));
  });

  it("normalizes a create body and binds a UUID idempotency key", () => {
    expect(parseFeedbackComplaintMutation({
      action: "create", deadline_rule_id: ruleId,
      received_at: "2026-09-07T09:00:00+08:00",
      reporter_name: " 合成陳述人 ", reporter_contact: null,
      subject: " 合成主旨 ", description: "合成內容\n第二行",
    }, key)).toEqual({ action: "create", deadlineRuleId: ruleId,
      receivedAt: "2026-09-07T01:00:00.000Z", reporterName: "合成陳述人",
      reporterContact: null, subject: "合成主旨", description: "合成內容\n第二行",
      idempotencyKey: key });
  });

  it("rejects unknown mutation fields, stale-shape versions and missing keys", () => {
    expect(() => parseFeedbackComplaintMutation({ action: "progress", case_id: caseId,
      expected_version: 0, note: "合成進度", extra: true }, key)).toThrow();
    expect(() => parseFeedbackComplaintMutation({ action: "progress", case_id: caseId,
      expected_version: 1, note: "合成進度" }, null)).toThrow();
  });

  it("correlates immutable receipts to case, action and expected version", () => {
    const input = parseFeedbackComplaintMutation({ action: "progress", case_id: caseId,
      expected_version: 1, note: "合成進度" }, key);
    const row = { operation_id: operationId, action: "progress", case_id: caseId,
      case_number: "FC-20260907-A1B2C3D4", event_id: eventId, version: 2,
      status: "in_progress", effective_risk: "standard",
      due_at: "2026-09-09T01:00:00Z", committed_at: "2026-09-07T02:00:00Z",
      replayed: false };
    expect(parseFeedbackComplaintReceipt(row, input)).toMatchObject({
      operationId, caseId, version: 2, persisted: true, demo: false,
    });
    expect(() => parseFeedbackComplaintReceipt({ ...row, version: 3 }, input))
      .toThrowError(expect.objectContaining({ code: "FEEDBACK_RECEIPT_INVALID" }));
  });

  it("also rejects a client success envelope that does not match the attempt", () => {
    const input = parseFeedbackComplaintMutation({ action: "progress", case_id: caseId,
      expected_version: 1, note: "合成進度" }, key);
    const data = { operationId, action: "progress", caseId,
      caseNumber: "FC-20260907-A1B2C3D4", eventId, version: 2,
      status: "in_progress", effectiveRisk: "standard",
      dueAt: "2026-09-09T01:00:00Z", committedAt: "2026-09-07T02:00:00Z",
      replayed: false, persisted: true, demo: false };
    expect(parseFeedbackComplaintActionSuccess({ requestId: "req-1", status: "ok",
      data, errors: [] }, input).data).toMatchObject({ eventId, version: 2 });
    expect(() => parseFeedbackComplaintActionSuccess({ requestId: "req-1", status: "ok",
      data: { ...data, caseId: branchId }, errors: [] }, input)).toThrow();
  });

  it("fails closed when a snapshot leaks masked content or crosses tenant scope", () => {
    const valid = sourceRow();
    const maskedLeak = structuredClone(valid);
    maskedLeak.can_view_sensitive = false;
    maskedLeak.items[0].sensitive_masked = true;
    expect(() => projectFeedbackComplaintSnapshot({ row: maskedLeak,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, filters }))
      .toThrow();
    expect(() => projectFeedbackComplaintSnapshot({ row: valid,
      expectedOrganizationId: branchId, expectedBranchId: branchId, filters }))
      .toThrow();
    const falseDeadline = structuredClone(valid);
    falseDeadline.items[0].overdue = true;
    falseDeadline.overdue_total = 1;
    expect(() => projectFeedbackComplaintSnapshot({ row: falseDeadline,
      expectedOrganizationId: organizationId, expectedBranchId: branchId, filters }))
      .toThrow();
  });

  it("keeps demo data synthetic and applies the same filters", () => {
    const demo = buildDemoFeedbackComplaintSnapshot(parseFeedbackComplaintFilters(
      new URLSearchParams("status=overdue&q=FC-20260904"),
    ));
    expect(demo.demo).toBe(true);
    expect(demo.items).toHaveLength(1);
    expect(demo.items[0]).toMatchObject({ sensitiveMasked: true, overdue: true });
    expect(JSON.stringify(buildDemoFeedbackComplaintSnapshot(filters))).toMatch(/\.invalid/u);
  });
});
