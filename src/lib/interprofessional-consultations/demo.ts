import { projectInterprofessionalConsultationSnapshot } from "./projection";
import type { InterprofessionalConsultationFilters } from "./types";

const ids = {
  clients: ["37100000-0000-4000-8000-000000000001", "37100000-0000-4000-8000-000000000002"],
  staff: ["37200000-0000-4000-8000-000000000001", "37200000-0000-4000-8000-000000000002", "37200000-0000-4000-8000-000000000003"],
  keys: ["37300000-0000-4000-8000-000000000001", "37300000-0000-4000-8000-000000000002", "37300000-0000-4000-8000-000000000003", "37300000-0000-4000-8000-000000000004"],
};

function eventId(keyIndex: number, sequence: number) {
  return `37400000-0000-4000-8${keyIndex.toString().padStart(3, "0")}-${sequence.toString().padStart(12, "0")}`;
}
function iso(reference: number, days: number) {
  return new Date(reference + days * 86_400_000).toISOString();
}

export function buildDemoInterprofessionalConsultationSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: InterprofessionalConsultationFilters;
}) {
  const now = Date.now();
  const configs = [
    { client: 0, requester: 0, assignee: null, discipline: ["OT-MANUAL", "職能治療"], urgency: "soon", status: "unassigned", deadline: "dated", due: 2, summary: "請評估合成個案的日間活動參與與輔具需求。", history: ["created"] },
    { client: 1, requester: 0, assignee: 1, discipline: ["PT-MANUAL", "物理治療"], urgency: "urgent", status: "assigned", deadline: "dated", due: -1, summary: "請就合成步態觀察提供人工專業建議。", history: ["created", "assigned"] },
    { client: 0, requester: 2, assignee: 1, discipline: ["NUTRI-MANUAL", "營養"], urgency: "routine", status: "answered", deadline: "not_applicable", due: null, summary: "請檢視合成餐食紀錄並回覆後續觀察方向。", history: ["created", "reply", "supplement"] },
    { client: 1, requester: 0, assignee: 2, discipline: ["NURSE-MANUAL", "護理"], urgency: "routine", status: "closed", deadline: "missing", due: null, summary: "歷史移轉資料未帶入期限，與不適用分開顯示。", history: ["created", "reply", "closed"] },
  ] as const;
  const names = ["示範社工 陳員", "示範治療師 林員", "示範護理師 王員"];
  const clients = ["合成個案 晴女士", "合成個案 山先生"];
  const rows = configs.map((config, keyIndex) => {
    const requestedAt = iso(now, -5 - keyIndex);
    const history = [...config.history].map((kind, index) => {
      const sequence = index + 1;
      const eventKind = kind === "created" ? "created" : kind;
      const eventStatus = eventKind === "reply" || eventKind === "supplement" ? "answered"
        : eventKind === "closed" ? "closed"
          : config.assignee === null ? "unassigned" : "assigned";
      return {
        event_id: eventId(keyIndex, sequence), sequence, event_kind: eventKind,
        corrects_event_id: null,
        entry_content: eventKind === "created" || eventKind === "assigned" ? null
          : eventKind === "reply" ? "已完成合成資料檢視，建議持續由團隊人工追蹤。"
            : eventKind === "supplement" ? "補充：請於下次服務會議再次確認。" : "已由授權人員人工確認結案。",
        status: eventStatus,
        assignee_display_name: config.assignee === null ? null : names[config.assignee],
        occurred_at: iso(Date.parse(requestedAt), index),
        actor_display_name: eventKind === "created" ? names[config.requester] : names[config.assignee ?? config.requester],
        content_hash: String.fromCharCode(97 + keyIndex + index).repeat(64),
        notification_recipient_count: config.assignee === null ? 1 : 2,
      };
    }).sort((a, b) => b.sequence - a.sequence);
    const current = history[0]!;
    return {
      event_id: current.event_id, consultation_key: ids.keys[keyIndex]!,
      sequence: current.sequence,
      previous_event_id: current.sequence === 1 ? null : eventId(keyIndex, current.sequence - 1),
      corrects_event_id: null, event_kind: current.event_kind,
      client_id: ids.clients[config.client]!, client_display_name: clients[config.client]!,
      client_code: `DEMO-C${config.client + 1}`,
      requester_user_id: ids.staff[config.requester]!, requester_display_name: names[config.requester]!,
      assignee_user_id: config.assignee === null ? null : ids.staff[config.assignee]!,
      assignee_display_name: config.assignee === null ? null : names[config.assignee]!,
      assignment_state: config.assignee === null ? "unassigned" : "assigned",
      discipline_code: config.discipline[0], discipline_label: config.discipline[1],
      discipline_taxonomy_status: "manual_unstandardized",
      urgency: config.urgency, urgency_source: "manual", requested_at: requestedAt,
      deadline_state: config.deadline,
      due_at: config.due === null ? null : iso(Date.parse(requestedAt), 5 + config.due),
      problem_summary: config.summary, entry_content: current.entry_content,
      status: config.status, occurred_at: current.occurred_at,
      actor_display_name: current.actor_display_name, content_hash: current.content_hash,
      notification: {
        queue_status: "queued", delivery_claim: "queued_not_delivered",
        external_provider_status: "not_configured", recipient_count: current.notification_recipient_count,
      }, history,
    };
  });
  const query = input.filters.query.toLocaleLowerCase("zh-TW");
  const filtered = rows.filter((row) =>
    (input.filters.clientId === null || row.client_id === input.filters.clientId) &&
    (input.filters.requesterUserId === null || row.requester_user_id === input.filters.requesterUserId) &&
    (input.filters.assigneeMode === "all" ||
      (input.filters.assigneeMode === "assigned" && row.assignee_user_id !== null) ||
      (input.filters.assigneeMode === "unassigned" && row.assignee_user_id === null) ||
      (input.filters.assigneeMode === "specific" && row.assignee_user_id === input.filters.assigneeUserId)) &&
    (input.filters.disciplineCode === null || row.discipline_code === input.filters.disciplineCode) &&
    (input.filters.urgency === "all" || row.urgency === input.filters.urgency) &&
    (input.filters.status === "all" || row.status === input.filters.status) &&
    (input.filters.deadlineFilter === "all" ||
      input.filters.deadlineFilter === row.deadline_state ||
      (input.filters.deadlineFilter === "overdue" && row.deadline_state === "dated" &&
        row.due_at! < new Date(now).toISOString() && row.status !== "closed")) &&
    (input.filters.dueFrom === null || (row.due_at !== null && row.due_at.slice(0, 10) >= input.filters.dueFrom)) &&
    (input.filters.dueTo === null || (row.due_at !== null && row.due_at.slice(0, 10) <= input.filters.dueTo)) &&
    (!query || row.problem_summary.toLocaleLowerCase("zh-TW").includes(query))
  );
  const overdue = filtered.filter((row) => row.deadline_state === "dated" &&
    row.due_at! < new Date(now).toISOString() && row.status !== "closed").length;
  return projectInterprofessionalConsultationSnapshot({
    expectedOrganizationId: input.organizationId, expectedBranchId: input.branchId,
    expectedCanCreate: false, expectedCanAssign: false,
    expectedCanRespond: false, expectedCanCorrect: false,
    expectedCanClose: false, demo: true,
    row: {
      organization_id: input.organizationId, organization_name: "示範安心日照機構",
      branch_id: input.branchId, branch_name: "示範日照分支",
      generated_at: new Date(now).toISOString(), snapshot_token: "d".repeat(64), items: filtered,
      matching_total: filtered.length,
      unassigned_total: filtered.filter((row) => row.assignment_state === "unassigned").length,
      in_progress_total: filtered.filter((row) => ["assigned", "answered"].includes(row.status)).length,
      overdue_total: overdue, closed_total: filtered.filter((row) => row.status === "closed").length,
      deadline_missing_total: filtered.filter((row) => row.deadline_state === "missing").length,
      deadline_not_applicable_total: filtered.filter((row) => row.deadline_state === "not_applicable").length,
      items_truncated: false,
      client_options: ids.clients.map((clientId, index) => ({
        client_id: clientId, display_name: clients[index]!, client_code: `DEMO-C${index + 1}`,
      })),
      requester_options: ids.staff.map((userId, index) => ({ user_id: userId, display_name: names[index]! })),
      assignee_options: ids.staff.map((userId, index) => ({ user_id: userId, display_name: names[index]! })),
      discipline_options: configs.map((config) => ({
        code: config.discipline[0], label: config.discipline[1], taxonomy_status: "manual_unstandardized",
      })),
      can_create: false, can_assign: false, can_respond: false,
      can_correct: false, can_close: false,
      taxonomy_status: "manual_unstandardized", notification_queue_status: "queued",
      notification_delivery_claim: "queued_not_delivered", external_provider_status: "not_configured",
    },
  });
}
