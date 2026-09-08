import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoInsulinAdministrationSnapshot } from "./demo";
import {
  correlateInsulinReceipt,
  parseInsulinApiError,
  parseInsulinApiSuccess,
  parseInsulinDatabaseReceipt,
  parseInsulinMutation,
} from "./parser";
import {
  projectInsulinAdministrationSnapshot,
  type InsulinAdministrationSnapshotSource,
} from "./projection";
import type { InsulinExecutionInput } from "./types";

const organizationId = "05100000-0000-4000-8000-000000000201";
const branchId = "05200000-0000-4000-8000-000000000201";
const planId = "05300000-0000-4000-8000-000000000201";
const clientId = "05400000-0000-4000-8000-000000000201";
const key = "05500000-0000-4000-8000-000000000201";
const scheduledFor = "2026-09-02T01:00:00.000Z";

const executeBody = {
  action: "execute" as const,
  administrationKey: null,
  previousEventId: null,
  expectedSequence: 0 as const,
  medicationPlanId: planId,
  scheduledFor: "2026-09-02T09:00:00+08:00",
  doseText: "12.5",
  doseUnit: "U",
  siteCode: "left_arm",
  siteText: "左上臂",
};
const input: InsulinExecutionInput = {
  ...executeBody,
  scheduledFor,
  siteCode: "LEFT_ARM",
  idempotencyKey: key,
};

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId,
    branch_id: branchId,
    operation_id: "05600000-0000-4000-8000-000000000201",
    operation_kind: "execute",
    administration_key: "05700000-0000-4000-8000-000000000201",
    event_id: "05800000-0000-4000-8000-000000000201",
    event_sequence: 1,
    previous_event_id: null,
    state: "pending_review",
    medication_plan_id: planId,
    governance_version_id: "05900000-0000-4000-8000-000000000201",
    scheduled_for: scheduledFor,
    executed_at: "2026-09-02T01:01:00.000Z",
    reviewed_at: null,
    content_hash: "a".repeat(64),
    qualification_status: "published",
    dose_rule_status: "published",
    late_entry_rule_status: "published",
    completion_status: "pending_independent_review",
    offline_status: "not_configured",
    replayed: false,
    committed_at: "2026-09-02T01:01:01.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<InsulinAdministrationSnapshotSource> = {}): InsulinAdministrationSnapshotSource {
  return {
    organization_id: organizationId,
    organization_name: "合成機構",
    branch_id: branchId,
    branch_name: "合成分支",
    generated_at: "2026-09-02T02:00:00.000Z",
    service_date: "2026-09-02",
    snapshot_token: "b".repeat(64),
    items: [], matching_total: 0, scheduled_total: 0,
    late_authorized_total: 0, pending_review_total: 0, completed_total: 0,
    late_exception_total: 0, items_truncated: false, client_options: [],
    governance_status: "not_configured", plan_designation_status: "not_configured",
    qualification_status: "not_configured", dose_rule_status: "not_configured",
    late_entry_rule_status: "not_configured", can_execute: false, can_review: false,
    can_authorize_late: false, offline_status: "not_configured",
    attachment_status: "not_configured", external_delivery_status: "not_configured",
    delivery_claim: "no_external_delivery_claim",
    ...overrides,
  };
}

const scheduledItem = {
  medication_plan_id: planId, medication_plan_version: 2,
  medication_plan_content_hash: "c".repeat(64), client_id: clientId,
  client_code: "SYN-I01", client_display_name: "合成個案甲",
  medication_name: "合成胰島素", ordered_dose_text: "12.5", dose_unit: "U",
  medication_route: "subcutaneous", scheduled_for: scheduledFor,
  event_id: null, administration_key: null, event_sequence: 0,
  previous_event_id: null, state: "scheduled" as const, event_kind: null,
  actual_dose_text: null, actual_dose_unit: null, site_code: null, site_text: null,
  executed_at: null, executor_user_id: null, executor_display_name: null,
  late_entry: false, late_reason: null, late_authorized_at: null,
  late_authorizer_user_id: null, late_authorizer_display_name: null,
  reviewed_at: null, reviewer_user_id: null, reviewer_display_name: null,
  content_hash: null, is_late: false, history: [],
};

describe("Page 5 insulin parser and projection", () => {
  it("normalizes exact decimal execution and site code", () => {
    expect(parseInsulinMutation(executeBody, key)).toEqual(input);
  });

  it("separates on-time and supervisor-authorized execution chains", () => {
    expect(() => parseInsulinMutation({
      ...executeBody, expectedSequence: 1,
    }, key)).toThrow(IntegrationError);
    expect(parseInsulinMutation({
      ...executeBody, expectedSequence: 1,
      administrationKey: "05700000-0000-4000-8000-000000000201",
      previousEventId: "05800000-0000-4000-8000-000000000201",
    }, key)).toMatchObject({ expectedSequence: 1 });
  });

  it("rejects ambiguous decimals, extra fields and short late reasons", () => {
    expect(() => parseInsulinMutation({ ...executeBody, doseText: "012.50" }, key))
      .toThrow(IntegrationError);
    expect(() => parseInsulinMutation({ ...executeBody, clientTime: scheduledFor }, key))
      .toThrow(IntegrationError);
    expect(() => parseInsulinMutation({ action: "authorize_late", medicationPlanId: planId,
      scheduledFor, lateReason: "x" }, key)).toThrow(IntegrationError);
  });

  it("accepts a strict independent-review chain", () => {
    expect(parseInsulinMutation({ action: "review",
      administrationKey: "05700000-0000-4000-8000-000000000201",
      previousEventId: "05800000-0000-4000-8000-000000000201",
      expectedSequence: 1 }, key)).toMatchObject({ action: "review", expectedSequence: 1 });
  });

  it("correlates strict database receipts to actor tenant and request", () => {
    expect(correlateInsulinReceipt(
      parseInsulinDatabaseReceipt(receipt()), input, organizationId, branchId,
    )).toMatchObject({ event_sequence: 1, state: "pending_review" });
    expect(() => correlateInsulinReceipt(
      parseInsulinDatabaseReceipt(receipt({ organization_id: clientId })),
      input, organizationId, branchId,
    )).toThrow(IntegrationError);
  });

  it("rejects forged completion or future commit receipts", () => {
    expect(() => correlateInsulinReceipt(
      parseInsulinDatabaseReceipt(receipt({ state: "completed",
        completion_status: "completed", reviewed_at: "2026-09-02T01:02:00.000Z" })),
      input, organizationId, branchId,
    )).toThrow(IntegrationError);
    expect(() => correlateInsulinReceipt(
      parseInsulinDatabaseReceipt(receipt({ committed_at: "2026-09-02T01:00:59.000Z" })),
      input, organizationId, branchId,
    )).toThrow(IntegrationError);
  });

  it("requires 201 for new and 200 only for exact replay", () => {
    const envelope = { requestId: "05a00000-0000-4000-8000-000000000201",
      status: "ok", errors: [], data: {
        organizationId, branchId, operationId: receipt().operation_id,
        operationKind: "execute", administrationKey: receipt().administration_key,
        eventId: receipt().event_id, eventSequence: 1, previousEventId: null,
        state: "pending_review", medicationPlanId: planId,
        governanceVersionId: receipt().governance_version_id, scheduledFor,
        executedAt: receipt().executed_at, reviewedAt: null,
        contentHash: "a".repeat(64), qualificationStatus: "published",
        doseRuleStatus: "published", lateEntryRuleStatus: "published",
        completionStatus: "pending_independent_review", offlineStatus: "not_configured",
        committedAt: receipt().committed_at, replayed: false, persisted: true, demo: false,
      } };
    expect(parseInsulinApiSuccess(envelope, input, organizationId, branchId, 201).data.persisted)
      .toBe(true);
    expect(() => parseInsulinApiSuccess(envelope, input, organizationId, branchId, 200))
      .toThrow("INVALID_INSULIN_SUCCESS");
  });

  it("accepts only safe structured API errors", () => {
    expect(parseInsulinApiError({ requestId: "05a00000-0000-4000-8000-000000000201",
      status: "error", data: null, errors: [{ code: "INSULIN_NOT_AUTHORIZED",
        message: "目前不允許" }] })).not.toBeNull();
    expect(parseInsulinApiError({ requestId: "05a00000-0000-4000-8000-000000000201",
      status: "error", data: null, errors: [{ code: "bad-code",
        message: "偽造\n訊息" }] })).toBeNull();
  });

  it("projects explicit not-configured production state", () => {
    const projected = projectInsulinAdministrationSnapshot(source());
    expect(projected).toMatchObject({ governanceStatus: "not_configured",
      qualificationStatus: "not_configured", canExecute: false, items: [] });
  });

  it("projects a configured scheduled Page-8 slot", () => {
    const projected = projectInsulinAdministrationSnapshot(source({
      items: [scheduledItem], matching_total: 1, scheduled_total: 1,
      client_options: [{ client_id: clientId, client_code: "SYN-I01",
        display_name: "合成個案甲" }], governance_status: "published",
      plan_designation_status: "published", qualification_status: "published",
      dose_rule_status: "published", late_entry_rule_status: "published",
      can_execute: true,
    }));
    expect(projected.items[0]).toMatchObject({ state: "scheduled",
      orderedDoseText: "12.5", medicationPlanVersion: 2 });
    expect(projected.metrics).toMatchObject({ matching: 1, scheduled: 1 });
  });

  it("accepts later slots on the same Taipei service day and rejects cross-day slots", () => {
    const configured = {
      governance_status: "published" as const,
      plan_designation_status: "published" as const,
      qualification_status: "published" as const,
      dose_rule_status: "published" as const,
      late_entry_rule_status: "published" as const,
      matching_total: 1,
      scheduled_total: 1,
    };
    expect(projectInsulinAdministrationSnapshot(source({
      ...configured,
      items: [{ ...scheduledItem, scheduled_for: "2026-09-02T09:00:00.000Z" }],
    })).items[0]?.scheduledFor).toBe("2026-09-02T09:00:00.000Z");
    expect(() => projectInsulinAdministrationSnapshot(source({
      ...configured,
      items: [{ ...scheduledItem, scheduled_for: "2026-09-02T16:00:00.000Z" }],
    }))).toThrow("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
  });

  it("rejects rows or capabilities when governance is not configured", () => {
    expect(() => projectInsulinAdministrationSnapshot(source({
      items: [scheduledItem], matching_total: 1, scheduled_total: 1,
    }))).toThrow("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
    expect(() => projectInsulinAdministrationSnapshot(source({ can_execute: true })))
      .toThrow("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
  });

  it("rejects mismatched metrics and forged scheduled evidence", () => {
    expect(() => projectInsulinAdministrationSnapshot(source({
      governance_status: "published", plan_designation_status: "published",
      qualification_status: "published", dose_rule_status: "published",
      late_entry_rule_status: "published", matching_total: 1,
    }))).toThrow("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
    expect(() => projectInsulinAdministrationSnapshot(source({
      governance_status: "published", plan_designation_status: "published",
      qualification_status: "published", dose_rule_status: "published",
      late_entry_rule_status: "published", items: [{ ...scheduledItem,
        executor_user_id: "05b00000-0000-4000-8000-000000000201" }],
      matching_total: 1, scheduled_total: 1,
    }))).toThrow("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
  });

  it("rejects a truncated or unlinked immutable event history", () => {
    const latest = {
      event_id: "05c00000-0000-4000-8000-000000000201",
      event_sequence: 2,
      previous_event_id: "05d00000-0000-4000-8000-000000000201",
      event_kind: "reviewed" as const,
      state: "completed" as const,
      occurred_at: "2026-09-02T01:02:00.000Z",
      actor_display_name: "合成覆核護理師",
      content_hash: "d".repeat(64),
    };
    expect(() => projectInsulinAdministrationSnapshot(source({
      governance_status: "published", plan_designation_status: "published",
      qualification_status: "published", dose_rule_status: "published",
      late_entry_rule_status: "published", matching_total: 1, completed_total: 1,
      items: [{ ...scheduledItem, state: "completed", event_id: latest.event_id,
        administration_key: "05e00000-0000-4000-8000-000000000201",
        event_sequence: 2, previous_event_id: latest.previous_event_id,
        event_kind: "reviewed", actual_dose_text: "12.5", actual_dose_unit: "U",
        site_code: "LEFT_ARM", site_text: "左上臂",
        executed_at: "2026-09-02T01:01:00.000Z",
        executor_user_id: "05f00000-0000-4000-8000-000000000201",
        executor_display_name: "合成執行護理師",
        reviewed_at: latest.occurred_at,
        reviewer_user_id: "05f00000-0000-4000-8000-000000000202",
        reviewer_display_name: latest.actor_display_name,
        content_hash: latest.content_hash, history: [latest] }],
    }))).toThrow("INVALID_INSULIN_ADMINISTRATION_SNAPSHOT");
  });

  it("keeps synthetic demo read-only while showing the full example flow", () => {
    const demo = buildDemoInsulinAdministrationSnapshot({
      serviceDate: "2026-09-02", shift: "all", clientId: null, state: "all",
    });
    expect(demo.demo).toBe(true);
    expect(demo.items.map((item) => item.state)).toEqual([
      "scheduled", "pending_review", "completed",
    ]);
    expect(demo).toMatchObject({ governanceStatus: "not_configured",
      canExecute: false, canReview: false, canAuthorizeLate: false });
  });
});
