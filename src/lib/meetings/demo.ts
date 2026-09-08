import { projectMeetingManagementSnapshot } from "./projection";

export function buildDemoMeetingManagementSnapshot(input: {
  organizationId: string;
  branchId: string;
}) {
  return projectMeetingManagementSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    demo: true,
    row: {
      organization_id: input.organizationId,
      branch_id: input.branchId,
      generated_at: "2026-09-01T10:30:00+08:00",
      snapshot_date: "2026-09-01",
      staff_options: [
        { user_id: "75111111-1111-4111-8111-111111111111", display_name: "林督導", employee_code: "SP-001", profile_kind: "staff", membership_scope: "branch" },
        { user_id: "75222222-2222-4222-8222-222222222222", display_name: "王社工", employee_code: "SW-002", profile_kind: "staff", membership_scope: "branch" },
        { user_id: "75333333-3333-4333-8333-333333333333", display_name: "李護理師", employee_code: "NU-003", profile_kind: "professional", membership_scope: "organization" },
      ],
      staff_total: 3,
      staff_truncated: false,
      meetings: [
        {
          minute_version_id: "75411111-1111-4111-8111-111111111112",
          meeting_key: "75411111-1111-4111-8111-111111111110",
          minute_version: 2,
          previous_version_id: "75411111-1111-4111-8111-111111111111",
          correction_reason: "補充第二項決議的執行證據。",
          meeting_type: "機構自訂／服務品質會議",
          title: "九月服務品質會議",
          starts_at: "2026-09-01T08:30:00+08:00",
          ends_at: "2026-09-01T09:30:00+08:00",
          staff_attendees: [
            { attendee_kind: "staff", user_id: "75111111-1111-4111-8111-111111111111", display_name: "林督導", profile_kind: "staff", membership_scope: "branch" },
            { attendee_kind: "staff", user_id: "75222222-2222-4222-8222-222222222222", display_name: "王社工", profile_kind: "staff", membership_scope: "branch" },
          ],
          external_attendees: [{ attendee_kind: "external", name: "外部督導（外部人員）" }],
          agenda_items: [
            { item_id: "75511111-1111-4111-8111-111111111111", item_order: 1, topic: "檢視八月異常事件改善進度" },
          ],
          decisions: [
            { decision_id: "75611111-1111-4111-8111-111111111111", item_order: 1, decision: "由社工完成改善紀錄彙整，並於下次會議回報。" },
          ],
          action_items: [
            {
              action_id: "75711111-1111-4111-8111-111111111111", item_order: 1,
              action: "完成改善紀錄彙整", responsible_user_id: "75222222-2222-4222-8222-222222222222",
              responsible_display_name: "王社工", due_date: "2026-08-31",
              progress_status: "in_progress", latest_update_id: "75811111-1111-4111-8111-111111111111",
              update_sequence: 1, progress_note: "已完成第一輪彙整。",
              progress_recorded_at: "2026-09-01T10:00:00+08:00", is_overdue: true,
              local_work_item: true, external_notification_sent: false,
            },
            {
              action_id: "75722222-2222-4222-8222-222222222222", item_order: 2,
              action: "核對附件清單", responsible_user_id: "75333333-3333-4333-8333-333333333333",
              responsible_display_name: "李護理師", due_date: "2026-09-05",
              progress_status: "completed", latest_update_id: "75822222-2222-4222-8222-222222222222",
              update_sequence: 2, progress_note: "附件已核對完成。",
              progress_recorded_at: "2026-09-01T09:50:00+08:00", is_overdue: false,
              local_work_item: false, external_notification_sent: false,
            },
          ],
          signed_at: "2026-09-01T09:35:00+08:00",
          signer_display_name: "林督導",
          signer_role_keys: ["branch_supervisor"],
          signature_purpose: "會議紀錄簽署",
        },
        {
          minute_version_id: "75422222-2222-4222-8222-222222222222",
          meeting_key: "75422222-2222-4222-8222-222222222220",
          minute_version: 1,
          previous_version_id: null,
          correction_reason: null,
          meeting_type: "機構自訂／例行行政會議",
          title: "八月底行政會議",
          starts_at: "2026-08-28T16:00:00+08:00",
          ends_at: "2026-08-28T17:00:00+08:00",
          staff_attendees: [
            { attendee_kind: "staff", user_id: "75111111-1111-4111-8111-111111111111", display_name: "林督導", profile_kind: "staff", membership_scope: "branch" },
          ],
          external_attendees: [],
          agenda_items: [{ item_id: "75522222-2222-4222-8222-222222222222", item_order: 1, topic: "九月排班提醒" }],
          decisions: [{ decision_id: "75622222-2222-4222-8222-222222222222", item_order: 1, decision: "各組依核定班表執行。" }],
          action_items: [],
          signed_at: "2026-08-28T17:05:00+08:00",
          signer_display_name: "林督導",
          signer_role_keys: ["branch_supervisor"],
          signature_purpose: "會議紀錄簽署",
        },
      ],
      meeting_total: 2,
      meeting_available_total: 2,
      meetings_truncated: false,
      correction_total: 1,
      action_total: 2,
      open_action_total: 1,
      overdue_action_total: 1,
      meeting_type_policy: "institution_owned_unconfigured",
      retention_policy: "institution_owned_unconfigured",
      escalation_policy: "institution_owned_unconfigured",
      notification_delivery: "none_not_sent",
    },
  });
}
