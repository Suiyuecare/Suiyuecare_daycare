import { projectCaseConferenceSnapshot } from "./projection";
import type {
  CaseConferenceActionStatus,
  CaseConferenceDeadlineState,
  CaseConferenceFilters,
  CaseConferenceStatus,
  CaseConferenceVersionKind,
} from "./types";

const ids = {
  clients: [
    "38100000-0000-4000-8000-000000000001",
    "38100000-0000-4000-8000-000000000002",
  ],
  staff: [
    "38200000-0000-4000-8000-000000000001",
    "38200000-0000-4000-8000-000000000002",
    "38200000-0000-4000-8000-000000000003",
  ],
  memberships: [
    "38300000-0000-4000-8000-000000000001",
    "38300000-0000-4000-8000-000000000002",
    "38300000-0000-4000-8000-000000000003",
  ],
  keys: Array.from({ length: 4 }, (_, index) =>
    `38400000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
};

const staffNames = ["示範社工甲", "示範護理乙", "示範治療師丙"];
const staffRoles = [
  ["case_manager_social_worker"], ["nurse"], ["professional"],
] as const;
const clientNames = ["合成個案甲", "合成個案乙"];

function versionId(keyIndex: number, version: number) {
  return `38500000-0000-4000-8${String(keyIndex).padStart(3, "0")}-${String(version).padStart(12, "0")}`;
}

function actionId(keyIndex: number, itemOrder: number) {
  return `38600000-0000-4000-8${String(keyIndex).padStart(3, "0")}-${String(itemOrder).padStart(12, "0")}`;
}

function iso(reference: number, days: number, hours = 0) {
  return new Date(reference + days * 86_400_000 + hours * 3_600_000).toISOString();
}

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function attendee(userIndex: number, attendanceStatus: "attended" | "remote" | "absent" | "excused") {
  return {
    user_id: ids.staff[userIndex]!,
    membership_id: ids.memberships[userIndex]!,
    display_name: staffNames[userIndex]!,
    role_keys: [...staffRoles[userIndex]!],
    attendance_status: attendanceStatus,
  };
}

function action(input: {
  keyIndex: number;
  itemOrder: number;
  responsible: number;
  actionText: string;
  deadlineState: CaseConferenceDeadlineState;
  dueDate: string | null;
  actionStatus: CaseConferenceActionStatus;
  snapshotDate: string;
}) {
  return {
    action_id: actionId(input.keyIndex, input.itemOrder),
    item_order: input.itemOrder,
    action_text: input.actionText,
    responsible_user_id: ids.staff[input.responsible]!,
    responsible_membership_id: ids.memberships[input.responsible]!,
    responsible_display_name: staffNames[input.responsible]!,
    deadline_state: input.deadlineState,
    due_date: input.dueDate,
    action_status: input.actionStatus,
    is_overdue: input.deadlineState === "dated" && input.dueDate !== null &&
      input.dueDate < input.snapshotDate && input.actionStatus === "open",
  };
}

type VersionConfig = {
  kind: CaseConferenceVersionKind;
  problem: string;
  decision: string;
  correctionReason?: string;
};

export function buildDemoCaseConferenceSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: CaseConferenceFilters;
}) {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const snapshotDate = taipeiDate(generatedAt);
  const configs: readonly {
    client: number;
    startDay: number;
    versions: readonly VersionConfig[];
    attendees: readonly ReturnType<typeof attendee>[];
    actions: readonly ReturnType<typeof action>[];
  }[] = [
    {
      client: 0,
      startDay: -2,
      versions: [{
        kind: "created", problem: "近期活動參與意願降低，需跨專業討論。",
        decision: "先建立草稿，待團隊會議確認後續措施。",
      }],
      attendees: [attendee(0, "attended"), attendee(1, "excused")],
      actions: [action({
        keyIndex: 0, itemOrder: 1, responsible: 0,
        actionText: "補充近兩週活動觀察紀錄。", deadlineState: "missing",
        dueDate: null, actionStatus: "open", snapshotDate,
      })],
    },
    {
      client: 1,
      startDay: -4,
      versions: [
        { kind: "created", problem: "午餐進食速度改變，需確認照顧策略。", decision: "初步討論飲食觀察方式。" },
        { kind: "revised", problem: "午餐進食速度與咀嚼表現改變，需共同確認。", decision: "修訂草稿並補入專業觀察，尚未簽署。" },
      ],
      attendees: [attendee(0, "attended"), attendee(2, "remote")],
      actions: [action({
        keyIndex: 1, itemOrder: 1, responsible: 2,
        actionText: "完成合成咀嚼觀察摘要。", deadlineState: "not_applicable",
        dueDate: null, actionStatus: "open", snapshotDate,
      })],
    },
    {
      client: 0,
      startDay: -12,
      versions: [
        { kind: "created", problem: "移位安全需跨專業檢視。", decision: "草擬移位支持措施。" },
        { kind: "signed", problem: "移位安全需跨專業檢視。", decision: "採雙人協助並於一週後人工檢討。" },
      ],
      attendees: [attendee(0, "attended"), attendee(1, "attended"), attendee(2, "remote")],
      actions: [
        action({
          keyIndex: 2, itemOrder: 1, responsible: 2,
          actionText: "示範安全移位流程並回報觀察。", deadlineState: "dated",
          dueDate: taipeiDate(iso(now, -3)), actionStatus: "open", snapshotDate,
        }),
        action({
          keyIndex: 2, itemOrder: 2, responsible: 1,
          actionText: "確認照顧提示已更新。", deadlineState: "dated",
          dueDate: taipeiDate(iso(now, -2)), actionStatus: "completed", snapshotDate,
        }),
      ],
    },
    {
      client: 1,
      startDay: -18,
      versions: [
        { kind: "created", problem: "返家前情緒波動需研討。", decision: "草擬一致性支持方式。" },
        { kind: "signed", problem: "返家前情緒波動需研討。", decision: "安排固定返家提示與安靜轉換時段。" },
        {
          kind: "corrected", problem: "返家前情緒波動需研討。",
          decision: "更正為固定返家提示，並由照顧團隊人工記錄反應。",
          correctionReason: "原決議漏列人工觀察責任。",
        },
      ],
      attendees: [attendee(0, "attended"), attendee(1, "absent"), attendee(2, "attended")],
      actions: [action({
        keyIndex: 3, itemOrder: 1, responsible: 0,
        actionText: "每次返家前記錄合成觀察結果。", deadlineState: "dated",
        dueDate: taipeiDate(iso(now, 5)), actionStatus: "open", snapshotDate,
      })],
    },
  ];

  const rows = configs.map((config, keyIndex) => {
    const meetingStartsAt = iso(now, config.startDay);
    const meetingEndsAt = iso(now, config.startDay, 1);
    const entries = config.versions.map((version, index) => {
      const number = index + 1;
      const signed = version.kind === "signed" || version.kind === "corrected";
      const occurredAt = signed
        ? iso(Date.parse(meetingEndsAt), 0, number)
        : iso(Date.parse(meetingStartsAt), -1 + index);
      return {
        version_id: versionId(keyIndex, number),
        version: number,
        previous_version_id: number === 1 ? null : versionId(keyIndex, number - 1),
        corrects_version_id: version.kind === "corrected" ? versionId(keyIndex, number - 1) : null,
        version_kind: version.kind,
        status: (signed ? "signed" : "draft") as CaseConferenceStatus,
        meeting_starts_at: meetingStartsAt,
        meeting_ends_at: meetingEndsAt,
        problem_statement: version.problem,
        decision_summary: version.decision,
        attendees: config.attendees,
        action_items: config.actions,
        correction_reason: version.correctionReason ?? null,
        occurred_at: occurredAt,
        author_display_name: staffNames[0]!,
        signed_at: signed ? occurredAt : null,
        signer_display_name: signed ? staffNames[0]! : null,
        signer_role_keys: signed ? [...staffRoles[0]] : [],
        signature_purpose: signed ? "個案研討會議紀錄簽署" as const : null,
        content_hash: String.fromCharCode(97 + ((keyIndex + index) % 6)).repeat(64),
      };
    }).sort((a, b) => b.version - a.version);
    const current = entries[0]!;
    return {
      ...current,
      meeting_key: ids.keys[keyIndex]!,
      client_id: ids.clients[config.client]!,
      client_display_name: clientNames[config.client]!,
      client_code: `DEMO-C${config.client + 1}`,
      history: entries,
    };
  }).sort((a, b) => Date.parse(b.meeting_starts_at) - Date.parse(a.meeting_starts_at));

  const query = input.filters.query.toLocaleLowerCase("zh-TW");
  const filtered = rows.filter((row) => {
    const matchesAction = input.filters.actionStatus === "all" || row.action_items.some((item) =>
      input.filters.actionStatus === "overdue"
        ? item.is_overdue : item.action_status === input.filters.actionStatus);
    return (input.filters.clientId === null || row.client_id === input.filters.clientId) &&
      (input.filters.status === "all" || row.status === input.filters.status) &&
      (input.filters.responsibleUserId === null || row.action_items.some((item) =>
        item.responsible_user_id === input.filters.responsibleUserId)) &&
      matchesAction &&
      (input.filters.meetingFrom === null ||
        taipeiDate(row.meeting_starts_at) >= input.filters.meetingFrom) &&
      (input.filters.meetingTo === null ||
        taipeiDate(row.meeting_starts_at) <= input.filters.meetingTo) &&
      (!query || `${row.problem_statement} ${row.decision_summary}`
        .toLocaleLowerCase("zh-TW").includes(query));
  });
  const actions = filtered.flatMap((row) => row.action_items);
  return projectCaseConferenceSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    expectedCanManage: false,
    expectedCanSign: false,
    expectedCanCorrect: false,
    demo: true,
    row: {
      organization_id: input.organizationId,
      organization_name: "示範安心日照機構",
      branch_id: input.branchId,
      branch_name: "示範日照分支",
      generated_at: generatedAt,
      snapshot_date: snapshotDate,
      snapshot_token: "d".repeat(64),
      items: filtered,
      matching_total: filtered.length,
      draft_total: filtered.filter((row) => row.status === "draft").length,
      signed_total: filtered.filter((row) => row.status === "signed").length,
      corrected_total: filtered.filter((row) => row.version_kind === "corrected").length,
      action_total: actions.length,
      open_action_total: actions.filter((item) => item.action_status === "open").length,
      overdue_action_total: actions.filter((item) => item.is_overdue).length,
      deadline_missing_total: actions.filter((item) => item.deadline_state === "missing").length,
      deadline_not_applicable_total: actions.filter((item) =>
        item.deadline_state === "not_applicable").length,
      items_truncated: false,
      client_options: ids.clients.map((clientId, index) => ({
        client_id: clientId,
        display_name: clientNames[index]!,
        client_code: `DEMO-C${index + 1}`,
      })),
      staff_options: ids.staff.map((userId, index) => ({
        user_id: userId,
        display_name: staffNames[index]!,
        role_keys: [...staffRoles[index]!],
      })),
      can_manage: false,
      can_sign: false,
      can_correct: false,
      attachment_status: "not_configured",
      export_status: "not_configured",
      notification_status: "not_configured",
      external_delivery_status: "not_configured",
      delivery_claim: "no_external_delivery_claim",
      offline_status: "not_configured",
    },
  });
}
