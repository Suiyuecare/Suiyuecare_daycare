import { projectActivityManagementSnapshot } from "./projection";
import type { ActivityFilters, ActivityManagementSnapshot } from "./types";

const ids = {
  staff: ["30000000-0000-4000-8000-000000000030", "30000000-0000-4000-8000-000000000031"],
  clients: ["31000000-0000-4000-8000-000000000030", "31000000-0000-4000-8000-000000000031", "31000000-0000-4000-8000-000000000032"],
  activities: ["32000000-0000-4000-8000-000000000030", "32000000-0000-4000-8000-000000000031", "32000000-0000-4000-8000-000000000032", "32000000-0000-4000-8000-000000000033"],
};

function shifted(days: number, hour = 10) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
}

export function buildDemoActivitySnapshot(organizationId: string, branchId: string) {
  const generatedAt = new Date().toISOString();
  const clients = ["示範個案 林阿姨", "示範個案 王伯伯", "示範個案 陳女士"];
  const configurations = [
    { type: "健康促進", title: "晨間伸展活動", summary: "以坐姿伸展與呼吸練習開始一天。", location: "一樓活動區", start: shifted(1, 9), end: shifted(1, 10), responsible: 0, participants: [0, 1], status: "scheduled", reason: null },
    { type: "認知活動", title: "懷舊音樂同樂", summary: "使用熟悉旋律進行團體互動。", location: "二樓多功能室", start: shifted(0, 14), end: shifted(0, 15), responsible: 1, participants: [0, 2], status: "in_progress", reason: null },
    { type: "社交活動", title: "八月慶生會", summary: "當月慶生活動與團體分享。", location: "一樓餐廳", start: shifted(-7, 14), end: shifted(-7, 16), responsible: 0, participants: [0, 1, 2], status: "completed", reason: null },
    { type: "戶外活動", title: "社區公園散步", summary: "原訂戶外散步行程。", location: "鄰里公園", start: shifted(3, 9), end: shifted(3, 11), responsible: 1, participants: [1, 2], status: "cancelled", reason: "場地臨時封閉，活動取消。" },
  ] as const;
  const items = configurations.map((config, index) => {
    const scheduleId = `33000000-0000-4000-8000-00000000003${index}`;
    const firstStatusId = `34000000-0000-4000-8000-00000000003${index}`;
    const finalStatusId = index === 0 ? firstStatusId : `35000000-0000-4000-8000-00000000003${index}`;
    const participantRows = config.participants.map((clientIndex) => ({
      client_id: ids.clients[clientIndex]!, display_name: clients[clientIndex]!, client_status: "active",
    }));
    const statusHistory = index === 0 ? [{
      status_event_id: firstStatusId, sequence: 1, previous_status_event_id: null,
      from_status: null, to_status: "scheduled", transition_note: null,
      changer_display_name: "示範社工", changed_at: shifted(-10), reauthenticated: false,
    }] : [{
      status_event_id: finalStatusId, sequence: 2, previous_status_event_id: firstStatusId,
      from_status: "scheduled", to_status: config.status,
      transition_note: config.reason, changer_display_name: "示範社工",
      changed_at: shifted(index === 3 ? -1 : 0), reauthenticated: index === 3,
    }, {
      status_event_id: firstStatusId, sequence: 1, previous_status_event_id: null,
      from_status: null, to_status: "scheduled", transition_note: null,
      changer_display_name: "示範社工", changed_at: shifted(-10), reauthenticated: false,
    }];
    return {
      activity_id: ids.activities[index]!, schedule_version_id: scheduleId, schedule_version: 1,
      previous_schedule_version_id: null, revision_reason: null, activity_type: config.type,
      title: config.title, search_summary: config.summary, location: config.location,
      starts_at: config.start, ends_at: config.end, responsible_user_id: ids.staff[config.responsible]!,
      responsible_display_name: config.responsible === 0 ? "示範社工 陳員" : "示範照服督導 林員",
      capacity: 12, participants: participantRows, participant_count: participantRows.length,
      status_event_id: finalStatusId, status_sequence: index === 0 ? 1 : 2,
      previous_status_event_id: index === 0 ? null : firstStatusId,
      status: config.status, cancellation_reason: config.reason, created_at: shifted(-10),
      schedule_history_total: 1, schedule_history: [{ schedule_version_id: scheduleId, version: 1,
        previous_schedule_version_id: null, revision_reason: null, starts_at: config.start,
        ends_at: config.end, created_at: shifted(-10), creator_display_name: "示範社工" }],
      status_history_total: statusHistory.length, status_history: statusHistory,
    };
  });
  return projectActivityManagementSnapshot({ expectedOrganizationId: organizationId,
    expectedBranchId: branchId, demo: true, row: {
      organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
      items, matching_total: 4, items_truncated: false,
      upcoming_total: 1, scheduled_total: 1, in_progress_total: 1,
      completed_total: 1, cancelled_total: 1,
      staff_options: [
        { user_id: ids.staff[0], display_name: "示範社工 陳員", employee_code: "SW-001", membership_scope: "branch" },
        { user_id: ids.staff[1], display_name: "示範照服督導 林員", employee_code: "CW-002", membership_scope: "branch" },
      ], staff_total: 2, staff_truncated: false,
      client_options: ids.clients.map((client_id, index) => ({ client_id, display_name: clients[index]!, client_code: `DEMO-${index + 1}` })),
      client_total: 3, client_truncated: false,
      type_options: ["健康促進", "戶外活動", "社交活動", "認知活動"], type_total: 4, type_truncated: false,
      past_change_policy_status: "not_configured",
      cancellation_notification_policy: "institution_owned_not_configured",
      notification_delivery: "none_not_sent",
    } });
}

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function filterDemoActivitySnapshot(snapshot: ActivityManagementSnapshot, filters: ActivityFilters): ActivityManagementSnapshot {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  const items = snapshot.items.filter((item) =>
    (filters.dateFrom === null || taipeiDate(item.endsAt) >= filters.dateFrom) &&
    (filters.dateTo === null || taipeiDate(item.startsAt) <= filters.dateTo) &&
    (filters.activityType === null || item.activityType === filters.activityType) &&
    (filters.status === "all" || item.status === filters.status) &&
    (!query || [item.activityType, item.title, item.searchSummary, item.location]
      .some((value) => value.toLocaleLowerCase("zh-TW").includes(query)))
  );
  return { ...snapshot, items, matchingTotal: items.length, itemsTruncated: false,
    metrics: {
      upcoming: items.filter((item) => ["scheduled", "in_progress"].includes(item.status) && item.startsAt >= snapshot.generatedAt).length,
      scheduled: items.filter((item) => item.status === "scheduled").length,
      inProgress: items.filter((item) => item.status === "in_progress").length,
      completed: items.filter((item) => item.status === "completed").length,
      cancelled: items.filter((item) => item.status === "cancelled").length,
    } };
}
