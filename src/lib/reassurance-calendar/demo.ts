import { projectReassuranceCalendarSnapshot } from "./projection";
import type {
  ReassuranceCalendarFilters,
  ReassuranceCalendarSnapshot,
} from "./types";

const ids = {
  staff: ["44000000-0000-4000-8000-000000000001", "44000000-0000-4000-8000-000000000002"],
  clients: ["44100000-0000-4000-8000-000000000001", "44100000-0000-4000-8000-000000000002"],
  events: ["44200000-0000-4000-8000-000000000001", "44200000-0000-4000-8000-000000000002", "44200000-0000-4000-8000-000000000003", "44200000-0000-4000-8000-000000000004"],
};

function taipeiDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function at(month: string, day: number, hour: number) {
  const value = `${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+08:00`;
  return new Date(value).toISOString();
}

function historyRow(input: {
  versionId: string; version: number; previousVersionId: string | null;
  recordKind: "original" | "revision" | "cancellation";
  reason: string | null; status: "scheduled" | "cancelled"; publishedAt: string;
}) {
  return {
    version_id: input.versionId, version: input.version,
    previous_version_id: input.previousVersionId,
    record_kind: input.recordKind, reason: input.reason, status: input.status,
    published_at: input.publishedAt, publisher_display_name: "示範社工 陳員",
    content_hash: (input.version === 1 ? "a" : input.recordKind === "cancellation" ? "c" : "b").repeat(64),
  };
}

export function buildDemoReassuranceCalendarSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: ReassuranceCalendarFilters;
}): ReassuranceCalendarSnapshot {
  const generatedAt = new Date().toISOString();
  const currentTaipei = taipeiDate(generatedAt);
  const todayDay = currentTaipei.startsWith(input.filters.month)
    ? Number(currentTaipei.slice(8, 10)) : 8;
  const maxDay = new Date(Date.UTC(
    Number(input.filters.month.slice(0, 4)), Number(input.filters.month.slice(5, 7)), 0,
  )).getUTCDate();
  const days = [Math.min(todayDay, maxDay), Math.min(todayDay + 2, maxDay),
    Math.min(todayDay + 5, maxDay), Math.max(1, todayDay - 3)];
  const originalIds = ids.events.map((_, index) =>
    `44300000-0000-4000-8000-00000000000${index + 1}`);
  const currentIds = [originalIds[0]!,
    "44400000-0000-4000-8000-000000000002",
    originalIds[2]!, "44400000-0000-4000-8000-000000000004"];
  const configs = [
    { category: "care", title: "日間照顧回診提醒", summary: "提醒攜帶合成個案的門診摘要。", location: "示範日照中心", day: days[0]!, start: 10, end: 11, responsible: 0, audience: "selected_clients", clients: [0], status: "scheduled", version: 1, kind: "original", reason: null },
    { category: "activity", title: "懷舊音樂活動", summary: "已調整為下午的團體活動。", location: "二樓多功能室", day: days[1]!, start: 14, end: 15, responsible: 1, audience: "all_branch_clients", clients: [], status: "scheduled", version: 2, kind: "revision", reason: "配合場地調整時段。" },
    { category: "transport", title: "下午接送行程", summary: "依當日核准路線接送。", location: "一樓接送區", day: days[2]!, start: 16, end: 17, responsible: 1, audience: "selected_clients", clients: [0, 1], status: "scheduled", version: 1, kind: "original", reason: null },
    { category: "appointment", title: "家屬照顧討論", summary: "原訂家屬照顧討論。", location: "諮詢室", day: days[3]!, start: 11, end: 12, responsible: 0, audience: "selected_clients", clients: [1], status: "cancelled", version: 2, kind: "cancellation", reason: "家屬另約時間，保留取消歷程。" },
  ] as const;
  const allItems = configs.map((config, index) => {
    const targetRows = config.audience === "all_branch_clients" ? [{
      target_kind: "branch", target_id: input.branchId,
      display_name: "示範分支／全部服務對象",
    }] : config.clients.map((clientIndex) => ({
      target_kind: "client", target_id: ids.clients[clientIndex]!,
      display_name: clientIndex === 0 ? "示範個案 林阿姨" : "示範個案 王伯伯",
      client_code: `DEMO-${clientIndex + 1}`,
    }));
    const publishedAt = at(input.filters.month, Math.max(1, config.day - 4), 9);
    const history = config.version === 1 ? [historyRow({
      versionId: currentIds[index]!, version: 1, previousVersionId: null,
      recordKind: "original", reason: null, status: "scheduled", publishedAt,
    })] : [historyRow({
      versionId: currentIds[index]!, version: 2,
      previousVersionId: originalIds[index]!, recordKind: config.kind,
      reason: config.reason, status: config.status, publishedAt,
    }), historyRow({
      versionId: originalIds[index]!, version: 1, previousVersionId: null,
      recordKind: "original", reason: null, status: "scheduled",
      publishedAt: at(input.filters.month, Math.max(1, config.day - 7), 9),
    })];
    return {
      version_id: currentIds[index]!, event_key: ids.events[index]!,
      version: config.version, previous_version_id: config.version === 1 ? null : originalIds[index]!,
      record_kind: config.kind, revision_reason: config.reason,
      category: config.category, title: config.title, summary: config.summary,
      starts_at: at(input.filters.month, config.day, config.start),
      ends_at: at(input.filters.month, config.day, config.end), location: config.location,
      audience_kind: config.audience, audience: targetRows,
      responsible_user_id: ids.staff[config.responsible]!,
      responsible_display_name: config.responsible === 0 ? "示範社工 陳員" : "示範照服督導 林員",
      status: config.status, cancellation_reason: config.status === "cancelled" ? config.reason : null,
      publication_state: "published", publisher_display_name: "示範社工 陳員",
      published_at: publishedAt, signature_status: "not_configured",
      notification_status: "not_configured", notification_delivery: "none_not_sent",
      history,
    };
  });
  const query = input.filters.query.trim().toLocaleLowerCase("zh-TW");
  const actualToday = currentTaipei;
  const items = allItems.filter((item) =>
    (input.filters.category === null || item.category === input.filters.category) &&
    (input.filters.status === "all" || item.status === input.filters.status) &&
    (!input.filters.todayOnly || (
      taipeiDate(item.starts_at) <= actualToday && taipeiDate(item.ends_at) >= actualToday
    )) &&
    (!query || [item.title, item.summary, item.location]
      .some((value) => value.toLocaleLowerCase("zh-TW").includes(query)))
  );
  const scheduled = items.filter((item) => item.status === "scheduled").length;
  const cancelled = items.filter((item) => item.status === "cancelled").length;
  const today = items.filter((item) =>
    taipeiDate(item.starts_at) <= actualToday && taipeiDate(item.ends_at) >= actualToday).length;
  const upcoming = items.filter((item) =>
    item.status === "scheduled" && item.starts_at >= generatedAt).length;
  return projectReassuranceCalendarSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    expectedMonth: input.filters.month,
    expectedCanManage: false, expectedCanCancel: false, demo: true,
    row: {
      organization_id: input.organizationId,
      organization_name: "示範安心日照機構",
      branch_id: input.branchId, branch_name: "示範日照分支",
      generated_at: generatedAt, snapshot_token: "d".repeat(64),
      month_start: `${input.filters.month}-01`, items,
      matching_total: items.length, scheduled_total: scheduled,
      cancelled_total: cancelled, today_total: today, upcoming_total: upcoming,
      items_truncated: false,
      category_options: ["activity", "appointment", "care", "transport"],
      staff_options: [
        { user_id: ids.staff[0]!, display_name: "示範社工 陳員" },
        { user_id: ids.staff[1]!, display_name: "示範照服督導 林員" },
      ],
      client_options: [
        { client_id: ids.clients[0]!, display_name: "示範個案 林阿姨", client_code: "DEMO-1" },
        { client_id: ids.clients[1]!, display_name: "示範個案 王伯伯", client_code: "DEMO-2" },
      ],
      can_manage: false, can_cancel: false,
      publication_boundary: "published_versions_only",
      signature_status: "not_configured", notification_status: "not_configured",
      notification_delivery: "none_not_sent",
    },
  });
}
