import { projectBehaviorEventSnapshot } from "./projection";
import type { BehaviorEventFilters } from "./types";

const ORG = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function dateTaipei(value: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
function instant(date: string, time: string) { return new Date(`${date}T${time}+08:00`).toISOString(); }
const field = (state: "recorded" | "missing" | "not_applicable", text: string | null) => ({ state, text });

export function buildDemoBehaviorEventSnapshot(filters: BehaviorEventFilters) {
  const now = new Date(); const today = dateTaipei(now);
  const prior = dateTaipei(new Date(now.getTime() - 86_400_000));
  const rows = [
    { key: "20000000-0000-4000-8000-000000000001", client: "20010000-0000-4000-8000-000000000001",
      name: "日照個案甲", date: today, time: "09:10:00", type: "活動參與",
      state: "signed" as const, antecedent: field("recorded", "合成示例：團體活動開始並邀請個案加入。"),
      behavior: field("recorded", "合成示例：個案短暫提高音量並離開座位。"),
      intervention: field("recorded", "合成示例：工作人員口頭詢問意願並提供安靜座位。"),
      outcome: field("recorded", "合成示例：個案選擇休息，十分鐘後自行回到活動。") },
    { key: "20000000-0000-4000-8000-000000000002", client: "20010000-0000-4000-8000-000000000002",
      name: "日照個案乙", date: today, time: "08:40:00", type: "到站適應",
      state: "draft" as const, antecedent: field("missing", null),
      behavior: field("recorded", "合成示例：個案在入口停留並反覆查看門外。"),
      intervention: field("recorded", "合成示例：照服員陪同確認今日行程。"), outcome: field("missing", null) },
    { key: "20000000-0000-4000-8000-000000000003", client: "20010000-0000-4000-8000-000000000001",
      name: "日照個案甲", date: prior, time: "14:30:00", type: "休息時段",
      state: "voided" as const, antecedent: field("not_applicable", null),
      behavior: field("recorded", "合成示例：原紀錄對象選取錯誤。"),
      intervention: field("not_applicable", null), outcome: field("not_applicable", null) },
  ];
  const sourceEvents = rows.map((row, index) => {
    const occurred = instant(row.date, row.time);
    const versionId = (version: number) => `20020000-0000-4000-8000-${String((index + 1) * 10 + version).padStart(12, "0")}`;
    const common = {
      client_id: row.client, client_display_name: row.name, occurred_at: occurred, event_type: row.type,
      antecedent_state: row.antecedent.state, antecedent_text: row.antecedent.text,
      behavior_state: row.behavior.state, behavior_text: row.behavior.text,
      intervention_state: row.intervention.state, intervention_text: row.intervention.text,
      outcome_state: row.outcome.state, outcome_text: row.outcome.text,
      author_user_id: USER, author_display_name: "合成紀錄員",
    };
    const makeVersion = (version: number, state: "draft" | "signed" | "voided") => {
      const signed = state !== "draft";
      return { ...common, version_id: versionId(version), event_key: row.key, version,
        previous_version_id: version === 1 ? null : versionId(version - 1),
        content_hash: ((index + version + 1) % 10).toString().repeat(64), event_state: state,
        correction_reason: null,
        void_reason: state === "voided" ? "合成示例：確認原紀錄選錯個案，依法定流程作廢。" : null,
        signed_at: signed ? instant(row.date, row.time === "14:30:00" ? "14:40:00" : "09:30:00") : null,
        signed_by_user_id: signed ? USER : null, signer_display_name: signed ? "合成簽署員" : null,
        signer_role_keys: signed ? ["care_worker"] : null,
        signature_purpose: state === "signed" ? "行為與情緒事件簽署" :
          state === "voided" ? "行為與情緒事件作廢簽署" : null,
        signature_reauth_challenge_id: signed ? `20030000-0000-4000-8000-${String((index + 1) * 10 + version).padStart(12, "0")}` : null,
        created_at: signed ? instant(row.date, row.time === "14:30:00" ? "14:40:00" : "09:30:00") : occurred };
    };
    const history = row.state === "draft" ? [makeVersion(1, "draft")] : row.state === "signed" ?
      [makeVersion(1, "draft"), makeVersion(2, "signed")] :
      [makeVersion(1, "draft"), makeVersion(2, "signed"), makeVersion(3, "voided")];
    return { ...history.at(-1)!, history, history_total: history.length };
  }).filter((item) => {
    const date = dateTaipei(new Date(item.occurred_at));
    return (!filters.dateFrom || date >= filters.dateFrom) && (!filters.dateTo || date <= filters.dateTo) &&
      (!filters.clientId || item.client_id === filters.clientId) &&
      (!filters.eventType || item.event_type === filters.eventType) &&
      (filters.state === "all" || item.event_state === filters.state);
  }).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const missing = sourceEvents.filter((item) => [item.antecedent_state, item.behavior_state,
    item.intervention_state, item.outcome_state].includes("missing")).length;
  return projectBehaviorEventSnapshot({ expectedOrganizationId: ORG, expectedBranchId: BRANCH,
    filters, demo: true, row: { organization_id: ORG, branch_id: BRANCH,
      generated_at: now.toISOString(), events: sourceEvents, matching_total: sourceEvents.length,
      events_truncated: false, event_total: sourceEvents.length, missing_field_total: missing,
      draft_total: sourceEvents.filter(({ event_state }) => event_state === "draft").length,
      signed_total: sourceEvents.filter(({ event_state }) => event_state === "signed").length,
      voided_total: sourceEvents.filter(({ event_state }) => event_state === "voided").length,
      clients: [{ client_id: rows[0]!.client, display_name: rows[0]!.name },
        { client_id: rows[1]!.client, display_name: rows[1]!.name }], client_total: 2,
      clients_truncated: false, event_types: ["休息時段", "到站適應", "活動參與"],
      event_type_total: 3, event_types_truncated: false, attachment_status: "not_configured",
      notification_status: "not_configured", export_status: "not_configured", offline_status: "not_configured" } });
}
