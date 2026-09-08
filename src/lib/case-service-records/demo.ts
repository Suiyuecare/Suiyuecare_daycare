import { projectCaseServiceRecordSnapshot } from "./projection";
import type { CaseServiceRecordFilters, CaseServiceRecordState } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";
const SIGNER_ID = "44444444-4444-4444-8444-444444444444";

function taipeiDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function instant(date: string, time: string) {
  return new Date(`${date}T${time}+08:00`).toISOString();
}

type DemoSeed = {
  index: number;
  recordKey: string;
  clientId: string;
  clientName: string;
  date: string;
  started: string;
  ended: string;
  type: string;
  content: string;
  result: string;
  state: CaseServiceRecordState;
  executionReferenceId: string | null;
};

function makeRecord(seed: DemoSeed) {
  const versionId = (version: number) =>
    `50020000-0000-4000-8000-${String(seed.index * 10 + version).padStart(12, "0")}`;
  const startedAt = instant(seed.date, seed.started);
  const endedAt = instant(seed.date, seed.ended);
  const executionHash = seed.executionReferenceId === null ? null : String(seed.index + 3).repeat(64);
  const draft = {
    version_id: versionId(1),
    record_key: seed.recordKey,
    version: 1,
    previous_version_id: null,
    content_hash: String(seed.index + 1).repeat(64),
    record_state: "draft" as const,
    client_id: seed.clientId,
    client_display_name: seed.clientName,
    started_at: startedAt,
    ended_at: endedAt,
    service_type: seed.type,
    service_content: seed.content,
    service_result: seed.result,
    execution_reference_id: seed.executionReferenceId,
    execution_reference_status: seed.executionReferenceId === null ? "not_linked" as const :
      "linked_completed_event" as const,
    execution_reference_content_hash: executionHash,
    execution_reference_verification: seed.executionReferenceId === null ? "not_linked" as const :
      "verified_completed" as const,
    author_user_id: AUTHOR_ID,
    author_display_name: "合成照顧紀錄員",
    revision_reason: "合成示例：建立人工服務敘事草稿",
    correction_reason: null,
    signed_at: null,
    signed_by_user_id: null,
    signer_display_name: null,
    signer_role_keys: null,
    signature_purpose: null,
    signature_reauth_challenge_id: null,
    source_kind: "manual_local" as const,
    schema_kind: "manual_service_narrative_v1" as const,
    statutory_rule_status: "not_configured" as const,
    claim_eligibility_status: "not_configured" as const,
    created_at: instant(seed.date, seed.ended),
  };
  if (seed.state === "draft") return { ...draft, history: [draft], history_total: 1 };
  const signed = {
    ...draft,
    version_id: versionId(2),
    version: 2,
    previous_version_id: draft.version_id,
    content_hash: String(seed.index + 4).repeat(64),
    record_state: "signed" as const,
    revision_reason: null,
    signed_at: instant(seed.date, "15:10:00"),
    signed_by_user_id: SIGNER_ID,
    signer_display_name: "合成簽署人",
    signer_role_keys: ["branch_supervisor"],
    signature_purpose: "個案服務紀錄簽署",
    signature_reauth_challenge_id:
      `50030000-0000-4000-8000-${String(seed.index * 10 + 2).padStart(12, "0")}`,
    created_at: instant(seed.date, "15:10:00"),
  };
  if (seed.state === "signed") return { ...signed, history: [draft, signed], history_total: 2 };
  const corrected = {
    ...signed,
    version_id: versionId(3),
    version: 3,
    previous_version_id: signed.version_id,
    content_hash: String(seed.index + 6).repeat(64),
    record_state: "corrected" as const,
    service_result: `${seed.result}（合成更正版）`,
    correction_reason: "合成示例：依紙本原始紀錄修正人工服務結果。",
    signed_at: instant(seed.date, "15:30:00"),
    signature_purpose: "個案服務紀錄更正簽署",
    signature_reauth_challenge_id:
      `50030000-0000-4000-8000-${String(seed.index * 10 + 3).padStart(12, "0")}`,
    created_at: instant(seed.date, "15:30:00"),
  };
  return { ...corrected, history: [draft, signed, corrected], history_total: 3 };
}

export function buildDemoCaseServiceRecordSnapshot(filters: CaseServiceRecordFilters) {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = taipeiDate(new Date(now.getTime() - 86_400_000));
  const clients = [
    { client_id: "50010000-0000-4000-8000-000000000001", display_name: "日照個案甲" },
    { client_id: "50010000-0000-4000-8000-000000000002", display_name: "日照個案乙" },
  ];
  const rows = [
    makeRecord({ index: 1, recordKey: "50000000-0000-4000-8000-000000000001",
      clientId: clients[0]!.client_id, clientName: clients[0]!.display_name, date: today,
      started: "09:00:00", ended: "09:45:00", type: "生活支持",
      content: "合成示例：依當日安排提供生活支持並以人工文字記錄。",
      result: "合成示例：本次服務已依現場情況完成。", state: "signed",
      executionReferenceId: "50040000-0000-4000-8000-000000000001" }),
    makeRecord({ index: 2, recordKey: "50000000-0000-4000-8000-000000000002",
      clientId: clients[1]!.client_id, clientName: clients[1]!.display_name, date: today,
      started: "10:20:00", ended: "10:50:00", type: "活動陪伴",
      content: "合成示例：陪同個案參與室內活動，內容由紀錄員人工輸入。",
      result: "合成示例：完成草稿，尚未建立簽署證據。", state: "draft",
      executionReferenceId: null }),
    makeRecord({ index: 3, recordKey: "50000000-0000-4000-8000-000000000003",
      clientId: clients[0]!.client_id, clientName: clients[0]!.display_name, date: prior,
      started: "13:30:00", ended: "14:00:00", type: "日常支持",
      content: "合成示例：以人工敘事保存日常支持內容。",
      result: "合成示例：紙本核對後建立更正版。", state: "corrected",
      executionReferenceId: null }),
  ].filter((row) => {
    const date = taipeiDate(new Date(row.started_at));
    return (!filters.dateFrom || date >= filters.dateFrom) &&
      (!filters.dateTo || date <= filters.dateTo) &&
      (!filters.clientId || row.client_id === filters.clientId) &&
      (!filters.serviceType || row.service_type === filters.serviceType) &&
      (!filters.authorUserId || row.author_user_id === filters.authorUserId) &&
      (filters.recordState === "all" || row.record_state === filters.recordState);
  }).sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at) ||
    (left.client_id < right.client_id ? -1 : left.client_id > right.client_id ? 1 :
      left.record_key < right.record_key ? -1 : left.record_key > right.record_key ? 1 : 0));
  return projectCaseServiceRecordSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    filters,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: now.toISOString(),
      records: rows,
      matching_total: rows.length,
      records_truncated: false,
      service_total: rows.length,
      draft_total: rows.filter((row) => row.record_state === "draft").length,
      signed_total: rows.filter((row) => row.record_state === "signed").length,
      corrected_total: rows.filter((row) => row.record_state === "corrected").length,
      linked_execution_total: rows.filter((row) => row.execution_reference_id !== null).length,
      changed_execution_total: 0,
      clients,
      client_total: clients.length,
      clients_truncated: false,
      service_types: ["日常支持", "生活支持", "活動陪伴"],
      service_type_total: 3,
      service_types_truncated: false,
      authors: [{ user_id: AUTHOR_ID, display_name: "合成照顧紀錄員" }],
      author_total: 1,
      authors_truncated: false,
      schema_kind: "manual_service_narrative_v1",
      statutory_rule_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      notification_status: "not_configured",
      offline_status: "not_configured",
      claim_eligibility_status: "not_configured",
    },
  });
}
