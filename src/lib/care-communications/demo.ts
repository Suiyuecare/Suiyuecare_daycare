import type { CareCommunicationFilters } from "./types";
import { projectCareCommunicationSnapshot } from "./projection";

const familyRecipient = {
  display_name: "合成主要聯絡人",
  profile_kind: "family" as const,
  relationship: "主要聯絡人",
  consent_document_version: "DEMO-MSG-2026-01",
  consent_scopes: ["messages.read"],
  consented_at: "2026-08-01T01:00:00.000Z",
  consent_expires_at: "2027-08-01T01:00:00.000Z",
};

const queuedEvent = (occurredAt: string) => ({
  event_kind: "queued" as const,
  channel: "family_pwa" as const,
  provider_worker_status: "not_configured" as const,
  family_consumer_status: "not_configured" as const,
  offline_consumer_status: "not_configured" as const,
  occurred_at: occurredAt,
});

const demoItems = [
  {
    author_user_id: "43a00000-0000-4000-8000-000000000001",
    version_id: "43b00000-0000-4000-8000-000000000002",
    communication_key: "43c00000-0000-4000-8000-000000000001",
    version: 2,
    previous_version_id: "43b00000-0000-4000-8000-000000000001",
    record_kind: "correction" as const,
    category: "care_communication" as const,
    direction: "staff_to_family" as const,
    client_id: "43d00000-0000-4000-8000-000000000001",
    client_display_name: "合成個案甲",
    client_code: "DEMO-C043-A",
    subject: "今日活動摘要（更正）",
    body: "上午完成室內步行活動；更正活動地點，尚未送達家屬端。",
    occurred_at: "2026-09-02T01:20:00.000Z",
    submitted_at: "2026-09-02T02:10:00.000Z",
    author_display_name: "範例社工",
    author_profile_kind: "staff" as const,
    correction_reason: "補充活動地點",
    attachment_state: "none" as const,
    recipient_count: 1,
    delivery_status: "queued" as const,
    read_status: "not_configured" as const,
    family_confirmation_status: "not_configured" as const,
    is_current: true,
    recipients: [familyRecipient],
    delivery_events: [queuedEvent("2026-09-02T02:10:00.000Z")],
  },
  {
    author_user_id: "43a00000-0000-4000-8000-000000000001",
    version_id: "43b00000-0000-4000-8000-000000000001",
    communication_key: "43c00000-0000-4000-8000-000000000001",
    version: 1,
    previous_version_id: null,
    record_kind: "original" as const,
    category: "care_communication" as const,
    direction: "staff_to_family" as const,
    client_id: "43d00000-0000-4000-8000-000000000001",
    client_display_name: "合成個案甲",
    client_code: "DEMO-C043-A",
    subject: "今日活動摘要",
    body: "上午完成戶外步行活動，尚未送達家屬端。",
    occurred_at: "2026-09-02T01:20:00.000Z",
    submitted_at: "2026-09-02T01:25:00.000Z",
    author_display_name: "範例社工",
    author_profile_kind: "staff" as const,
    correction_reason: null,
    attachment_state: "none" as const,
    recipient_count: 1,
    delivery_status: "queued" as const,
    read_status: "not_configured" as const,
    family_confirmation_status: "not_configured" as const,
    is_current: false,
    recipients: [familyRecipient],
    delivery_events: [queuedEvent("2026-09-02T01:25:00.000Z")],
  },
  {
    author_user_id: "43a00000-0000-4000-8000-000000000002",
    version_id: "43b00000-0000-4000-8000-000000000003",
    communication_key: "43c00000-0000-4000-8000-000000000002",
    version: 1,
    previous_version_id: null,
    record_kind: "original" as const,
    category: "care_communication" as const,
    direction: "staff_to_family" as const,
    client_id: "43d00000-0000-4000-8000-000000000001",
    client_display_name: "合成個案甲",
    client_code: "DEMO-C043-A",
    subject: "午餐與休息摘要",
    body: "午餐與午休均已完成；目前只建立系統內待送紀錄。",
    occurred_at: "2026-09-01T04:30:00.000Z",
    submitted_at: "2026-09-01T04:35:00.000Z",
    author_display_name: "範例護理師",
    author_profile_kind: "staff" as const,
    correction_reason: null,
    attachment_state: "none" as const,
    recipient_count: 1,
    delivery_status: "queued" as const,
    read_status: "not_configured" as const,
    family_confirmation_status: "not_configured" as const,
    is_current: true,
    recipients: [familyRecipient],
    delivery_events: [queuedEvent("2026-09-01T04:35:00.000Z")],
  },
];

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildDemoCareCommunicationSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: CareCommunicationFilters;
}) {
  const query = input.filters.query.trim().toLocaleLowerCase("zh-TW");
  const filtered = demoItems.filter((item) => {
    const date = taipeiDate(item.occurred_at);
    return (!input.filters.clientId || item.client_id === input.filters.clientId) &&
      (!input.filters.authorUserId ||
        item.author_user_id === input.filters.authorUserId) &&
      (!input.filters.dateFrom || date >= input.filters.dateFrom) &&
      (!input.filters.dateTo || date <= input.filters.dateTo) &&
      (input.filters.deliveryStatus === "all" ||
        item.delivery_status === input.filters.deliveryStatus) &&
      (input.filters.confirmationStatus === "all" ||
        item.family_confirmation_status === input.filters.confirmationStatus) &&
      (!query || `${item.subject} ${item.body} ${item.author_display_name}`
        .toLocaleLowerCase("zh-TW").includes(query));
  });
  const items = filtered.map((source) => {
    const { author_user_id: internalAuthorId, ...item } = source;
    void internalAuthorId;
    return item;
  });
  const generatedAt = "2026-09-02T03:00:00.000Z";
  return projectCareCommunicationSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    expectedCanManage: true,
    expectedCanCorrect: true,
    demo: true,
    row: {
      organization_id: input.organizationId,
      branch_id: input.branchId,
      generated_at: generatedAt,
      items,
      matching_total: items.length,
      thread_total: new Set(items.map((item) => item.communication_key)).size,
      correction_total: items.filter((item) => item.record_kind === "correction").length,
      queued_total: items.filter((item) => item.is_current).length,
      today_total: items.filter((item) =>
        taipeiDate(item.submitted_at) === taipeiDate(generatedAt)
      ).length,
      attachment_total: 0,
      items_truncated: false,
      client_options: [
        {
          client_id: "43d00000-0000-4000-8000-000000000001",
          display_name: "合成個案甲",
          client_code: "DEMO-C043-A",
          authorized_family_count: 1,
        },
        {
          client_id: "43d00000-0000-4000-8000-000000000002",
          display_name: "合成個案乙",
          client_code: "DEMO-C043-B",
          authorized_family_count: 0,
        },
      ],
      author_options: [
        {
          user_id: "43a00000-0000-4000-8000-000000000001",
          display_name: "範例社工",
        },
        {
          user_id: "43a00000-0000-4000-8000-000000000002",
          display_name: "範例護理師",
        },
      ],
      can_manage: true,
      can_correct: true,
      category_boundary: "care_communication_only",
      family_recipient_boundary: "active_messages_read_consent",
      attachment_pipeline_status: "not_configured",
      provider_worker_status: "not_configured",
      family_consumer_status: "not_configured",
      offline_consumer_status: "not_configured",
    },
  });
}
