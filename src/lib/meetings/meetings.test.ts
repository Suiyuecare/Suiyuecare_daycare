import { describe, expect, it } from "vitest";

import {
  parseMeetingActionApiEnvelope,
  parseMeetingActionUpdateInput,
  parseMeetingMinuteApiEnvelope,
  parseMeetingMinuteInput,
} from "./parser";
import {
  filterMeetingManagementSnapshot,
  projectMeetingManagementSnapshot,
} from "./projection";

const ORG = "75000000-0000-4000-8000-000000000001";
const BRANCH = "75000000-0000-4000-8000-000000000002";
const MEETING = "75000000-0000-4000-8000-000000000003";
const MINUTE = "75000000-0000-4000-8000-000000000004";
const ACTION = "75000000-0000-4000-8000-000000000005";
const UPDATE = "75000000-0000-4000-8000-000000000006";
const KEY = "75000000-0000-4000-8000-000000000007";

function sourceRow() {
  return {
    organization_id: ORG,
    branch_id: BRANCH,
    generated_at: "2026-09-01T10:30:00+08:00",
    snapshot_date: "2026-09-01",
    staff_options: [{
      user_id: ORG, display_name: "會議主管", employee_code: "M-001",
      profile_kind: "staff", membership_scope: "branch",
    }],
    staff_total: 1,
    staff_truncated: false,
    meetings: [{
      minute_version_id: MINUTE,
      meeting_key: MEETING,
      minute_version: 1,
      previous_version_id: null,
      correction_reason: null,
      meeting_type: "機構自訂會議",
      title: "測試會議",
      starts_at: "2026-09-01T08:00:00+08:00",
      ends_at: "2026-09-01T09:00:00+08:00",
      staff_attendees: [{
        attendee_kind: "staff", user_id: ORG, display_name: "會議主管",
        profile_kind: "staff", membership_scope: "branch",
      }],
      external_attendees: [],
      agenda_items: [{ item_id: KEY, item_order: 1, topic: "議程" }],
      decisions: [],
      action_items: [{
        action_id: ACTION, item_order: 1, action: "完成追蹤",
        responsible_user_id: ORG, responsible_display_name: "會議主管",
        due_date: "2026-09-02", progress_status: "in_progress",
        latest_update_id: UPDATE, update_sequence: 1, progress_note: "處理中",
        progress_recorded_at: "2026-09-01T09:10:00+08:00",
        is_overdue: false, local_work_item: false,
        external_notification_sent: false,
      }],
      signed_at: "2026-09-01T09:05:00+08:00",
      signer_display_name: "會議主管",
      signer_role_keys: ["branch_supervisor"],
      signature_purpose: "會議紀錄簽署",
    }],
    meeting_total: 1,
    meeting_available_total: 1,
    meetings_truncated: false,
    correction_total: 0,
    action_total: 1,
    open_action_total: 1,
    overdue_action_total: 0,
    meeting_type_policy: "institution_owned_unconfigured",
    retention_policy: "institution_owned_unconfigured",
    escalation_policy: "institution_owned_unconfigured",
    notification_delivery: "none_not_sent",
  };
}

function project(row: unknown = sourceRow()) {
  return projectMeetingManagementSnapshot({
    row, expectedOrganizationId: ORG, expectedBranchId: BRANCH, demo: false,
  });
}

function minuteInput(correction = false) {
  return parseMeetingMinuteInput({
    meeting_key: correction ? MEETING : null,
    previous_version_id: correction ? MINUTE : null,
    correction_reason: correction ? "補充決議" : null,
    meeting_type: "機構自訂會議", title: "測試會議",
    starts_at: "2026-09-01T08:00:00+08:00",
    ends_at: "2026-09-01T09:00:00+08:00",
    staff_attendee_user_ids: [ORG], external_attendee_names: [],
    agenda_items: [{ item_id: KEY, item_order: 1, topic: "議程" }],
    decisions: [], action_items: [],
  }, KEY);
}

describe("meeting snapshot projection", () => {
  it("accepts a coherent frozen snapshot and filters with strict calendar dates", () => {
    const snapshot = project();
    expect(snapshot.meetings).toHaveLength(1);
    expect(filterMeetingManagementSnapshot(snapshot, {
      query: "測試", meetingType: "all", status: "open", date: "2026-09-01",
    }).meetings).toHaveLength(1);
    expect(() => filterMeetingManagementSnapshot(snapshot, {
      query: "", meetingType: "all", status: "all", date: "2026-02-31",
    })).toThrow("INVALID_MEETING_MANAGEMENT_PROJECTION");
  });

  it.each([
    ["signed before meeting end", (row: ReturnType<typeof sourceRow>) => {
      row.meetings[0]!.signed_at = "2026-09-01T08:59:00+08:00";
    }],
    ["signed after snapshot", (row: ReturnType<typeof sourceRow>) => {
      row.meetings[0]!.signed_at = "2026-09-01T10:31:00+08:00";
    }],
    ["progress before signature", (row: ReturnType<typeof sourceRow>) => {
      row.meetings[0]!.action_items[0]!.progress_recorded_at = "2026-09-01T09:04:00+08:00";
    }],
    ["progress after snapshot", (row: ReturnType<typeof sourceRow>) => {
      row.meetings[0]!.action_items[0]!.progress_recorded_at = "2026-09-01T10:31:00+08:00";
    }],
    ["impossible due date", (row: ReturnType<typeof sourceRow>) => {
      row.meetings[0]!.action_items[0]!.due_date = "2026-02-31";
    }],
    ["stale aggregate", (row: ReturnType<typeof sourceRow>) => {
      row.open_action_total = 0;
    }],
  ])("fails closed for %s", (_label, mutate) => {
    const row = sourceRow();
    mutate(row);
    expect(() => project(row)).toThrow("INVALID_MEETING_MANAGEMENT_PROJECTION");
  });
});

describe("meeting receipt correlation", () => {
  it("requires a correction receipt to name the exact previous version", () => {
    const input = minuteInput(true);
    const goodReceipt = {
      minuteVersionId: UPDATE, meetingKey: MEETING, minuteVersion: 2,
      previousVersionId: MINUTE, signedAt: "2026-09-01T09:05:00+08:00",
      replayed: false, persisted: true, demo: false,
    };
    const envelope = { requestId: KEY, status: "ok", data: {
      receipt: goodReceipt, persisted: true, demo: false,
    }, errors: [] };
    expect(parseMeetingMinuteApiEnvelope(envelope, input, 201).receipt.previousVersionId)
      .toBe(MINUTE);
    expect(() => parseMeetingMinuteApiEnvelope(envelope, input, 200))
      .toThrow("HTTP 狀態");
    expect(() => parseMeetingMinuteApiEnvelope({
      ...envelope, data: { ...envelope.data, receipt: {
        ...goodReceipt, previousVersionId: null,
      } },
    }, input, 201)).toThrow("會議簽署結果無法與送出內容核對");
    expect(() => parseMeetingMinuteApiEnvelope({
      ...envelope, data: { ...envelope.data, receipt: {
        ...goodReceipt, signedAt: "2026-09-01T08:59:59+08:00",
      } },
    }, input, 201)).toThrow("會議簽署結果無法與送出內容核對");
  });

  it("requires action meeting, minute and optimistic base to match exactly", () => {
    const input = parseMeetingActionUpdateInput({
      meeting_key: MEETING, minute_version_id: MINUTE, action_id: ACTION,
      expected_previous_update_id: UPDATE, progress_status: "completed",
      progress_note: "完成",
    }, KEY);
    const receipt = {
      actionUpdateId: ORG, meetingKey: MEETING, minuteVersionId: MINUTE,
      actionId: ACTION, previousUpdateId: UPDATE, updateSequence: 2,
      progressStatus: "completed", recordedAt: "2026-09-01T10:00:00+08:00",
      replayed: false, persisted: true, demo: false,
    };
    const envelope = { requestId: KEY, status: "ok", data: {
      receipt, persisted: true, demo: false,
    }, errors: [] };
    expect(parseMeetingActionApiEnvelope(envelope, input, 201).receipt.meetingKey)
      .toBe(MEETING);
    expect(() => parseMeetingActionApiEnvelope(envelope, input, 200))
      .toThrow("HTTP 狀態");
    for (const malicious of [
      null,
      7,
      { ...receipt, meetingKey: BRANCH },
      { ...receipt, previousUpdateId: null },
      { ...receipt, unexpected: "secret" },
    ]) expect(() => parseMeetingActionApiEnvelope({
      ...envelope, data: { ...envelope.data, receipt: malicious },
    }, input, 201)).toThrow();
  });

  it("rejects null, primitive and extra-field minute receipts without TypeError", () => {
    const input = minuteInput();
    for (const receipt of [null, "saved", { unexpected: true }]) {
      expect(() => parseMeetingMinuteApiEnvelope({
        requestId: KEY, status: "ok", data: {
          receipt, persisted: true, demo: false,
        }, errors: [],
      }, input, 201)).toThrow("會議簽署回應未確認保存");
    }
  });
});
