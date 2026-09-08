import { projectReferralManagementSnapshot } from "./projection";
import type { ReferralManagementFilters, ReferralStatus } from "./types";

const ids = {
  clients: [
    "39100000-0000-4000-8000-000000000001",
    "39100000-0000-4000-8000-000000000002",
  ],
  staff: [
    "39200000-0000-4000-8000-000000000001",
    "39200000-0000-4000-8000-000000000002",
  ],
  keys: Array.from({ length: 6 }, (_, index) =>
    `39300000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
};

function eventId(keyIndex: number, sequence: number) {
  return `39400000-0000-4000-8${String(keyIndex).padStart(3, "0")}-${String(sequence).padStart(12, "0")}`;
}

function iso(reference: number, days: number) {
  return new Date(reference + days * 86_400_000).toISOString();
}

const statusForEvent: Record<string, ReferralStatus> = {
  created: "draft",
  submitted: "submitted",
  receipt_registered: "received",
  response_recorded: "responded",
  closed: "closed",
};

export function buildDemoReferralManagementSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: ReferralManagementFilters;
}) {
  const now = Date.now();
  const configs = [
    { client: 0, owner: 0, unitState: "missing", unit: null, reason: "合成草稿尚未填入接收單位。", history: ["created"] },
    { client: 1, owner: 0, unitState: "not_applicable", unit: null, reason: "合成移轉資料明確標示接收單位不適用。", history: ["created"] },
    { client: 0, owner: 1, unitState: "manual_unstandardized", unit: ["DEMO-CLINIC", "合成復健診所"], reason: "需要進一步復健專業評估。", history: ["created", "submitted"] },
    { client: 1, owner: 0, unitState: "manual_unstandardized", unit: ["DEMO-HOSPITAL", "合成地區醫院"], reason: "需要人工確認後續門診銜接。", history: ["created", "submitted", "receipt_registered"] },
    { client: 0, owner: 1, unitState: "manual_unstandardized", unit: ["DEMO-NUTRI", "合成營養服務單位"], reason: "需要外部營養評估回覆。", history: ["created", "submitted", "receipt_registered", "response_recorded"] },
    { client: 1, owner: 0, unitState: "manual_unstandardized", unit: ["DEMO-RESOURCE", "合成社區資源中心"], reason: "已完成人工轉介與回覆追蹤。", history: ["created", "submitted", "receipt_registered", "response_recorded", "closed"] },
  ] as const;
  const staffNames = ["示範社工甲", "示範個管乙"];
  const clientNames = ["合成個案甲", "合成個案乙"];
  const rows = configs.map((config, keyIndex) => {
    const referralDate = iso(now, -10 - keyIndex);
    const history = [...config.history].map((eventKind, index) => ({
      event_id: eventId(keyIndex, index + 1),
      sequence: index + 1,
      event_kind: eventKind,
      corrects_event_id: null,
      entry_content: eventKind === "created" ? null
        : eventKind === "submitted" ? "院內版本已凍結；不代表外部送達。"
          : eventKind === "receipt_registered" ? "由員工人工登記接收單位已收件，非 provider 回執。"
            : eventKind === "response_recorded" ? "已人工登錄合成回覆內容。"
              : "已由授權人員人工確認結案。",
      correction_reason: null,
      status: statusForEvent[eventKind]!,
      occurred_at: iso(Date.parse(referralDate), index + 1),
      actor_display_name: staffNames[config.owner]!,
      content_hash: String.fromCharCode(97 + ((keyIndex + index) % 6)).repeat(64),
      notification_recipient_count: 1,
    })).sort((a, b) => b.sequence - a.sequence);
    const current = history[0]!;
    return {
      event_id: current.event_id,
      referral_key: ids.keys[keyIndex]!,
      sequence: current.sequence,
      previous_event_id: current.sequence === 1 ? null : eventId(keyIndex, current.sequence - 1),
      corrects_event_id: null,
      event_kind: current.event_kind,
      client_id: ids.clients[config.client]!,
      client_display_name: clientNames[config.client]!,
      client_code: `DEMO-C${config.client + 1}`,
      owner_user_id: ids.staff[config.owner]!,
      owner_display_name: staffNames[config.owner]!,
      receiving_unit_state: config.unitState,
      receiving_unit_code: config.unit?.[0] ?? null,
      receiving_unit_name: config.unit?.[1] ?? null,
      receiving_unit_directory_status: "not_configured",
      referral_date: referralDate,
      referral_reason: config.reason,
      entry_content: current.entry_content,
      correction_reason: null,
      status: current.status,
      occurred_at: current.occurred_at,
      actor_display_name: current.actor_display_name,
      content_hash: current.content_hash,
      notification: {
        queue_status: "queued",
        delivery_claim: "no_external_delivery_claim",
        provider_status: "not_configured",
        recipient_count: 1,
      },
      history,
    };
  });
  const query = input.filters.query.toLocaleLowerCase("zh-TW");
  const filtered = rows.filter((row) =>
    (input.filters.clientId === null || row.client_id === input.filters.clientId) &&
    (input.filters.receivingUnitMode === "all" ||
      (input.filters.receivingUnitMode === "specific" &&
        row.receiving_unit_code === input.filters.receivingUnitCode) ||
      (input.filters.receivingUnitMode !== "specific" &&
        row.receiving_unit_state === input.filters.receivingUnitMode)) &&
    (input.filters.status === "all" || row.status === input.filters.status) &&
    (input.filters.recentFrom === null || row.occurred_at.slice(0, 10) >= input.filters.recentFrom) &&
    (input.filters.recentTo === null || row.occurred_at.slice(0, 10) <= input.filters.recentTo) &&
    (!query || row.referral_reason.toLocaleLowerCase("zh-TW").includes(query))
  );
  const unitOptions = configs.flatMap((config) => config.unit === null ? [] : [{
    code: config.unit[0], name: config.unit[1], directory_status: "not_configured" as const,
  }]);
  return projectReferralManagementSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    expectedCanCreate: false,
    expectedCanSubmit: false,
    expectedCanRegisterReceipt: false,
    expectedCanRespond: false,
    expectedCanClose: false,
    expectedCanCorrect: false,
    demo: true,
    row: {
      organization_id: input.organizationId,
      organization_name: "示範安心日照機構",
      branch_id: input.branchId,
      branch_name: "示範日照分支",
      generated_at: new Date(now).toISOString(),
      snapshot_token: "d".repeat(64),
      items: filtered,
      matching_total: filtered.length,
      draft_total: filtered.filter((row) => row.status === "draft").length,
      submitted_total: filtered.filter((row) => row.status === "submitted").length,
      received_total: filtered.filter((row) => row.status === "received").length,
      responded_total: filtered.filter((row) => row.status === "responded").length,
      closed_total: filtered.filter((row) => row.status === "closed").length,
      unit_missing_total: filtered.filter((row) => row.receiving_unit_state === "missing").length,
      unit_not_applicable_total: filtered.filter((row) => row.receiving_unit_state === "not_applicable").length,
      items_truncated: false,
      client_options: ids.clients.map((clientId, index) => ({
        client_id: clientId,
        display_name: clientNames[index]!,
        client_code: `DEMO-C${index + 1}`,
      })),
      receiving_unit_options: unitOptions,
      can_create: false,
      can_submit: false,
      can_register_receipt: false,
      can_respond: false,
      can_close: false,
      can_correct: false,
      receiving_unit_directory_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      notification_queue_status: "queued",
      notification_provider_status: "not_configured",
      external_delivery_status: "not_configured",
      delivery_claim: "no_external_delivery_claim",
    },
  });
}
