import type { ConsultantMessageFilters } from "./types";
import { projectConsultantMessageSnapshot } from "./projection";

const consultantA = {
  user_id: "76a00000-0000-4000-8000-000000000001",
  display_name: "範例職能顧問",
  employee_code: "DEMO-OT",
  profile_kind: "professional" as const,
  role_names: ["專業顧問"],
};
const consultantB = {
  user_id: "76a00000-0000-4000-8000-000000000002",
  display_name: "範例營養顧問",
  employee_code: "DEMO-NT",
  profile_kind: "professional" as const,
  role_names: ["營養顧問"],
};

const demoItems = [
  {
    message_id: "76b00000-0000-4000-8000-000000000001",
    category: "consultant" as const,
    subject: "活動輔具配置討論",
    body: "請於下次到點服務前確認合成個案的活動輔具配置建議。",
    occurred_at: "2026-09-02T01:20:00.000Z",
    published_at: "2026-09-02T01:22:00.000Z",
    author_display_name: "範例社工",
    author_profile_kind: "staff" as const,
    recipient_count: 1,
    read_count: 0,
    confirmed_count: 0,
    actor_is_recipient: false,
    actor_read_at: null,
    actor_confirmed_at: null,
    attachment_count: 0,
    recipients: [{ ...consultantA, read_at: null, confirmed_at: null }],
  },
  {
    message_id: "76b00000-0000-4000-8000-000000000002",
    category: "consultant" as const,
    subject: "九月餐食質地會議摘要",
    body: "顧問已確認本次合成會議摘要，正式附件管線仍未設定。",
    occurred_at: "2026-09-01T06:00:00.000Z",
    published_at: "2026-09-01T06:05:00.000Z",
    author_display_name: "範例護理師",
    author_profile_kind: "staff" as const,
    recipient_count: 1,
    read_count: 1,
    confirmed_count: 1,
    actor_is_recipient: false,
    actor_read_at: null,
    actor_confirmed_at: null,
    attachment_count: 0,
    recipients: [{
      ...consultantB,
      read_at: "2026-09-01T06:20:00.000Z",
      confirmed_at: "2026-09-01T06:25:00.000Z",
    }],
  },
];

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildDemoConsultantMessageSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: ConsultantMessageFilters;
}) {
  const query = input.filters.query.trim().toLocaleLowerCase("zh-TW");
  const items = demoItems.filter((item) => {
    const date = taipeiDate(item.occurred_at);
    const unread = item.read_count < item.recipient_count;
    const unconfirmed = item.confirmed_count < item.recipient_count;
    return (
      (!input.filters.consultantUserId || item.recipients.some(
        (recipient) => recipient.user_id === input.filters.consultantUserId,
      )) &&
      (!input.filters.dateFrom || date >= input.filters.dateFrom) &&
      (!input.filters.dateTo || date <= input.filters.dateTo) &&
      (input.filters.status === "all" ||
        (input.filters.status === "unread" && unread) ||
        (input.filters.status === "read" && !unread) ||
        (input.filters.status === "confirmed" && !unconfirmed) ||
        (input.filters.status === "unconfirmed" && unconfirmed)) &&
      (!query || `${item.subject} ${item.body} ${item.author_display_name}`
        .toLocaleLowerCase("zh-TW").includes(query))
    );
  });
  return projectConsultantMessageSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    expectedCanManage: true,
    demo: true,
    row: {
      organization_id: input.organizationId,
      branch_id: input.branchId,
      generated_at: "2026-09-02T02:00:00.000Z",
      items,
      message_total: items.length,
      unread_total: items.reduce(
        (sum, item) => sum + item.recipient_count - item.read_count,
        0,
      ),
      today_total: items.filter((item) =>
        taipeiDate(item.occurred_at) === "2026-09-02"
      ).length,
      attachment_total: 0,
      confirmation_pending_total: items.reduce(
        (sum, item) => sum + item.recipient_count - item.confirmed_count,
        0,
      ),
      items_truncated: false,
      can_manage: true,
      recipient_options: [consultantA, consultantB],
      category_boundary: "consultant_only",
      delivery_boundary: "in_app_only",
      attachment_pipeline_status: "not_configured",
      attachment_scan_status: "not_configured",
    },
  });
}
