import { projectAbnormalEventSnapshot } from "./projection";
import type { AbnormalEventFilters, AbnormalEventSnapshot } from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const clientId = "27000000-0000-4000-8000-000000000101";
const responsibleA = "27000000-0000-4000-8000-000000000401";
const responsibleB = "27000000-0000-4000-8000-000000000402";
const userA = "27000000-0000-4000-8000-000000000501";
const userB = "27000000-0000-4000-8000-000000000502";

function ago(hours: number) { return new Date(Date.now() - hours * 3_600_000).toISOString(); }
function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function buildDemoAbnormalEventSnapshot(): AbnormalEventSnapshot {
  const generatedAt = new Date().toISOString();
  const today = taipeiDate(generatedAt);
  const clientOccurred = ago(30);
  const clientReported = ago(29.8);
  const facilityOccurred = ago(30);
  const facilityReported = ago(29.5);
  const manualAt = ago(28);
  const improvementAt = ago(20);
  const visitorOccurred = ago(72);
  const visitorReported = ago(71.5);
  const closedAt = ago(48);
  const facilityCommitted = ago(19.8);
  const closedCommitted = ago(47.8);
  const overdueDate = addDays(today, -1);
  const futureDate = addDays(today, 2);
  const extendedDate = addDays(today, 3);

  return projectAbnormalEventSnapshot({ expectedOrganizationId: organizationId,
    expectedBranchId: branchId, demo: true, row: {
      organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
      items: [
        {
          incident_id: "27000000-0000-4000-8000-000000000201",
          affected_target_kind: "client", affected_client_id: clientId,
          affected_target_label: "陳美芳", occurred_at: clientOccurred, reported_at: clientReported,
          location: "日照活動區", event_type: "機構人工輸入：動線異常",
          event_summary: "工作人員依現場事實記錄異常情形，系統未判定事件重大性。",
          immediate_action: "先確認現場安全並通知當班主管人工評估。", major_state: "major",
          late_entry_reason: null, initial_responsible_membership_id: responsibleA,
          initial_responsible_user_id: userA, initial_responsible_display_name: "李護理師",
          current_responsible_membership_id: responsibleA, current_responsible_user_id: userA,
          current_responsible_display_name: "李護理師", initial_improvement_due_date: overdueDate,
          current_improvement_due_date: overdueDate, reporter_display_name: "王照服員",
          handling_status: "reported", chain_version: 0, last_activity_at: clientReported,
          timeline_total: 0, timeline_truncated: false, timeline: [],
        },
        {
          incident_id: "27000000-0000-4000-8000-000000000202",
          affected_target_kind: "facility", affected_client_id: null,
          affected_target_label: "一樓無障礙廁所", occurred_at: facilityOccurred,
          reported_at: facilityReported, location: "一樓無障礙廁所", event_type: "設備異常",
          event_summary: "扶手固定處出現鬆動，依機構流程留下人工事實紀錄。",
          immediate_action: "暫停使用該區域並放置提醒標示。", major_state: "unclassified",
          late_entry_reason: null,
          initial_responsible_membership_id: responsibleA, initial_responsible_user_id: userA,
          initial_responsible_display_name: "李護理師", current_responsible_membership_id: responsibleB,
          current_responsible_user_id: userB, current_responsible_display_name: "周督導",
          initial_improvement_due_date: futureDate, current_improvement_due_date: extendedDate,
          reporter_display_name: "王照服員", handling_status: "in_progress", chain_version: 2,
          last_activity_at: facilityCommitted, timeline_total: 2, timeline_truncated: false,
          timeline: [
            { entry_id: "27000000-0000-4000-8000-000000000301", sequence_number: 1,
              entry_type: "manual_notification", occurred_at: manualAt, entry_text: null,
              notification_target: "當班主管", notification_method: "電話（人工紀錄）",
              notification_result: "承辦人記錄已完成口頭說明；本紀錄不代表系統送達。",
              responsible_membership_id: null, responsible_user_id: null,
              responsible_display_name: null, due_date_action: null, due_date_value: null,
              effective_due_date: futureDate, closure_outcome: null, closure_reason: null,
              committer_display_name: "王照服員", committed_at: ago(27.8) },
            { entry_id: "27000000-0000-4000-8000-000000000302", sequence_number: 2,
              entry_type: "improvement", occurred_at: improvementAt,
              entry_text: "已建立維修單並由主管接續追蹤。", notification_target: null,
              notification_method: null, notification_result: null,
              responsible_membership_id: responsibleB, responsible_user_id: userB,
              responsible_display_name: "周督導", due_date_action: "replace",
              due_date_value: extendedDate, effective_due_date: extendedDate,
              closure_outcome: null, closure_reason: null, committer_display_name: "周督導",
              committed_at: facilityCommitted },
          ],
        },
        {
          incident_id: "27000000-0000-4000-8000-000000000203",
          affected_target_kind: "visitor", affected_client_id: null,
          affected_target_label: "訪客（接待簿代碼 V-17）", occurred_at: visitorOccurred,
          reported_at: visitorReported, location: "入口接待區", event_type: "訪客動線異常",
          event_summary: "訪客誤入工作區，依事實留下紀錄。",
          immediate_action: "由工作人員引導返回接待區。", major_state: "not_major",
          late_entry_reason: null,
          initial_responsible_membership_id: responsibleB, initial_responsible_user_id: userB,
          initial_responsible_display_name: "周督導", current_responsible_membership_id: responsibleB,
          current_responsible_user_id: userB, current_responsible_display_name: "周督導",
          initial_improvement_due_date: overdueDate, current_improvement_due_date: overdueDate,
          reporter_display_name: "周督導", handling_status: "closed", chain_version: 1,
          last_activity_at: closedCommitted, timeline_total: 1, timeline_truncated: false,
          timeline: [{ entry_id: "27000000-0000-4000-8000-000000000303", sequence_number: 1,
            entry_type: "closure", occurred_at: closedAt, entry_text: null,
            notification_target: null, notification_method: null, notification_result: null,
            responsible_membership_id: null, responsible_user_id: null,
            responsible_display_name: null, due_date_action: null, due_date_value: null,
            effective_due_date: overdueDate,
            closure_outcome: "接待動線標示已調整並完成現場確認。",
            closure_reason: "主管確認改善證據完整後結案。", committer_display_name: "周督導",
            committed_at: closedCommitted }],
        },
      ],
      item_total: 3, matching_total: 3, major_total: 1,
      awaiting_improvement_total: 2, overdue_total: 1, closed_total: 1,
      items_truncated: false,
      client_options: [{ client_id: clientId, display_name: "陳美芳", client_status: "active",
        admitted_on: "2025-01-10", ended_on: null, can_report: true }],
      client_options_available_total: 1, client_options_truncated: false,
      responsible_options: [
        { membership_id: responsibleA, user_id: userA, display_name: "李護理師", membership_scope: "branch" },
        { membership_id: responsibleB, user_id: userB, display_name: "周督導", membership_scope: "branch" },
      ],
      responsible_options_available_total: 2, responsible_options_truncated: false,
      event_type_options: ["機構人工輸入：動線異常", "設備異常", "訪客動線異常"],
      event_type_options_available_total: 3, event_type_options_truncated: false,
      event_taxonomy_status: "not_configured", major_criteria_status: "not_configured",
      legal_reporting_status: "not_configured", delivery_integration_status: "not_implemented",
    } });
}

export function filterDemoAbnormalEventSnapshot(
  snapshot: AbnormalEventSnapshot, filters: AbnormalEventFilters,
): AbnormalEventSnapshot {
  const generatedDate = taipeiDate(snapshot.generatedAt);
  const items = snapshot.items.filter((item) => {
    const eventDate = taipeiDate(item.occurredAt);
    return (!filters.dateFrom || eventDate >= filters.dateFrom) &&
      (!filters.dateTo || eventDate <= filters.dateTo) &&
      (!filters.eventType || item.eventType === filters.eventType) &&
      (filters.affectedTargetKind === "all" || item.affectedTargetKind === filters.affectedTargetKind) &&
      (filters.handlingStatus === "all" || item.handlingStatus === filters.handlingStatus);
  });
  return { ...snapshot, items, itemTotal: items.length, matchingTotal: items.length,
    itemsTruncated: false, metrics: {
      major: items.filter((item) => item.majorState === "major").length,
      awaitingImprovement: items.filter((item) => item.handlingStatus !== "closed").length,
      overdue: items.filter((item) => item.handlingStatus !== "closed" &&
        item.currentImprovementDueDate < generatedDate).length,
      closed: items.filter((item) => item.handlingStatus === "closed").length,
    } };
}
