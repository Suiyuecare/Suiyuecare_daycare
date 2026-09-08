import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { buildDemoHandHygieneSnapshot } from "./demo";
import {
  parseHandHygieneApiError,
  parseHandHygieneApiSuccess,
  parseHandHygieneCorrectionInput,
  parseHandHygieneDatabaseReceipt,
} from "./parser";
import { projectHandHygieneSnapshot } from "./projection";

const ORG = "66000000-0000-4000-8000-000000000001";
const BRANCH = "66000000-0000-4000-8000-000000000002";
const EVENT = "66000000-0000-4000-8000-000000000003";
const STAFF = "66000000-0000-4000-8000-000000000004";
const KEY = "66000000-0000-4000-8000-000000000005";
const REQUEST = "66000000-0000-4000-8000-000000000006";
const OPERATION = "66000000-0000-4000-8000-000000000007";
const CORRECTION = "66000000-0000-4000-8000-000000000008";
const filters = { dateFrom: null, dateTo: null, staffMembershipId: null,
  deviceCode: null, matchStatus: "all" as const, eventKind: "all" as const };

const source = {
  organization_id: ORG,
  branch_id: BRANCH,
  generated_at: "2026-09-02T04:00:00.000Z",
  events: [{
    event_id: EVENT,
    source_provider: "test-sensor",
    source_event_id: "EVT-001",
    device_code: "WASH-01",
    event_kind: "hygiene_performed",
    occurred_at: "2026-09-02T03:00:00.000Z",
    received_at: "2026-09-02T03:00:02.000Z",
    match_status: "matched",
    staff_membership_id: STAFF,
    staff_display_name: "測試員工",
    staff_employee_code: "T-001",
    correction_sequence: 0,
    correction_reason: null,
    corrected_by_display_name: null,
    corrected_at: null,
  }],
  event_total: 1,
  events_truncated: false,
  performed_event_total: 1,
  matched_performed_total: 1,
  observed_opportunity_event_total: 0,
  unmatched_total: 0,
  excluded_total: 0,
  denominator_total: null,
  attainment_rate: null,
  staff_options: [{ staff_membership_id: STAFF, display_name: "測試員工",
    employee_code: "T-001", is_current: true }],
  staff_total: 1,
  staff_truncated: false,
  device_options: [{ device_code: "WASH-01", event_count: 1 }],
  device_total: 1,
  devices_truncated: false,
  numerator_definition: "matched_distinct_hygiene_performed_events",
  denominator_policy_status: "not_configured",
  denominator_definition: null,
  source_integration_status: "database_contract_only",
  export_status: "not_configured",
};

function correctionInput() {
  return parseHandHygieneCorrectionInput({
    action: "correct_match",
    eventId: EVENT,
    expectedCorrectionSequence: 0,
    matchStatus: "matched",
    staffMembershipId: STAFF,
    reason: "確認設備事件的人員配對",
  }, KEY);
}

function receipt(replayed = false) {
  return {
    organization_id: ORG,
    branch_id: BRANCH,
    operation_id: OPERATION,
    event_id: EVENT,
    correction_id: CORRECTION,
    correction_sequence: 1,
    match_status: "matched",
    staff_membership_id: STAFF,
    corrected_at: "2026-09-02T04:00:00.000Z",
    replayed,
  };
}

describe("page-66 hand hygiene contracts", () => {
  it("keeps the synthetic formula transparent and unconfigured", () => {
    const snapshot = buildDemoHandHygieneSnapshot({
      organizationId: ORG, branchId: BRANCH, filters,
      now: new Date("2026-09-02T04:00:00.000Z"),
    });
    expect(snapshot.demo).toBe(true);
    expect(snapshot.denominatorPolicyStatus).toBe("not_configured");
    expect(snapshot.metrics.denominatorTotal).toBeNull();
    expect(snapshot.metrics.attainmentRate).toBeNull();
    expect(snapshot.sourceIntegrationStatus).toBe("database_contract_only");
  });

  it("projects a strict correlated snapshot", () => {
    const snapshot = projectHandHygieneSnapshot({ row: source,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
    expect(snapshot).toMatchObject({ eventTotal: 1, eventsTruncated: false,
      numeratorDefinition: "matched_distinct_hygiene_performed_events" });
    expect(snapshot.events[0]).toMatchObject({ eventId: EVENT,
      matchStatus: "matched", staffMembershipId: STAFF });
  });

  it.each([
    { ...source, branch_id: ORG },
    { ...source, attainment_rate: 100 },
    { ...source, matched_performed_total: 0 },
    { ...source, events: [...source.events, source.events[0]] },
    { ...source, events: [{ ...source.events[0], match_status: "unmatched" }] },
    { ...source, unexpected: "field" },
  ])("rejects forged, inconsistent or duplicate snapshot data %#", (row) => {
    expect(() => projectHandHygieneSnapshot({ row,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false }))
      .toThrow("INVALID_HAND_HYGIENE_SNAPSHOT");
  });

  it("requires staff exactly when the terminal state is matched", () => {
    expect(correctionInput()).toMatchObject({ matchStatus: "matched",
      staffMembershipId: STAFF, idempotencyKey: KEY });
    expect(() => parseHandHygieneCorrectionInput({
      action: "correct_match", eventId: EVENT, expectedCorrectionSequence: 0,
      matchStatus: "matched", staffMembershipId: null, reason: "無員工",
    }, KEY)).toThrow(IntegrationError);
    expect(() => parseHandHygieneCorrectionInput({
      action: "correct_match", eventId: EVENT, expectedCorrectionSequence: 0,
      matchStatus: "excluded", staffMembershipId: STAFF, reason: "不應有人員",
      unexpected: true,
    }, KEY)).toThrow(IntegrationError);
  });

  it("correlates the persisted receipt to tenant, event and next sequence", () => {
    const input = correctionInput();
    expect(parseHandHygieneDatabaseReceipt(receipt(), input, ORG, BRANCH))
      .toMatchObject({ eventId: EVENT, correctionSequence: 1, persisted: true });
    expect(() => parseHandHygieneDatabaseReceipt({ ...receipt(), branch_id: ORG },
      input, ORG, BRANCH)).toThrow(IntegrationError);
    expect(() => parseHandHygieneDatabaseReceipt({ ...receipt(), correction_sequence: 2 },
      input, ORG, BRANCH)).toThrow(IntegrationError);
  });

  it("requires HTTP 201 for a new receipt and 200 only for an exact replay", () => {
    const input = correctionInput();
    const payload = { requestId: REQUEST, status: "ok", data: {
      action: "correct_match", organizationId: ORG, branchId: BRANCH,
      operationId: OPERATION, eventId: EVENT, correctionId: CORRECTION,
      correctionSequence: 1, matchStatus: "matched", staffMembershipId: STAFF,
      correctedAt: "2026-09-02T04:00:00.000Z", replayed: false,
      persisted: true, demo: false,
    }, errors: [] };
    expect(parseHandHygieneApiSuccess(payload, input, ORG, BRANCH, 201).data)
      .toMatchObject({ eventId: EVENT, persisted: true });
    expect(() => parseHandHygieneApiSuccess(payload, input, ORG, BRANCH, 200))
      .toThrow("MISMATCHED_HAND_HYGIENE_SUCCESS");
    expect(parseHandHygieneApiSuccess({ ...payload,
      data: { ...payload.data, replayed: true } }, input, ORG, BRANCH, 200).data.replayed)
      .toBe(true);
  });

  it("accepts only a structured, bounded error envelope", () => {
    expect(parseHandHygieneApiError({ requestId: REQUEST, status: "error", data: null,
      errors: [{ code: "HAND_HYGIENE_CONFLICT", message: "請重新載入" }] }))
      .not.toBeNull();
    expect(parseHandHygieneApiError({ status: "error", errors: [{
      code: "bad code", message: "secret", detail: "private",
    }] })).toBeNull();
  });
});
