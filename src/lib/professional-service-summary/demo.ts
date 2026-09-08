import { createHash } from "node:crypto";

import {
  projectProfessionalServiceSummary,
  type ProfessionalServiceSummarySourceRow,
} from "./projection";
import type {
  ProfessionalServiceSummaryFilters,
  ProfessionalSummarySourceKind,
} from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const clients = [
  { client_id: "42100000-0000-4000-8000-000000000001",
    display_name: "合成個案・晨光", service_status: "active" as const },
  { client_id: "42100000-0000-4000-8000-000000000002",
    display_name: "合成個案・青禾", service_status: "active" as const },
  { client_id: "42100000-0000-4000-8000-000000000003",
    display_name: "合成個案・安晴", service_status: "suspended" as const },
];

const configs = [
  ["occupational_therapy_assessment", 33, "configured", "manual_due_date_only"],
  ["physical_therapy_assessment", 34, "configured", "manual_due_date_only"],
  ["chewing_assessment", 35, "candidate_only", "not_configured"],
  ["mna_assessment", 36, "license_required_not_configured", "not_configured"],
  ["consultation", 37, "configured", "manual_deadline_or_explicit_missing_state"],
  ["case_conference", 38, "configured", "action_deadline_only"],
  ["referral", 39, "configured", "due_rule_not_configured"],
  ["physical_therapy_service", 40, "configured",
    "existing_records_only_frequency_not_configured"],
  ["occupational_therapy_service", 41, "configured",
    "existing_records_only_frequency_not_configured"],
] as const;

const pathBySource: Record<ProfessionalSummarySourceKind, string> = {
  occupational_therapy_assessment: "occupational-assessment",
  physical_therapy_assessment: "physical-assessment",
  chewing_assessment: "chewing",
  mna_assessment: "mna",
  consultation: "consultations",
  case_conference: "case-conferences",
  referral: "referrals",
  physical_therapy_service: "physical-services",
  occupational_therapy_service: "occupational-services",
};

function endOfMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5));
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}

export function buildDemoProfessionalServiceSummary(
  filters: ProfessionalServiceSummaryFilters,
) {
  const monthStart = `${filters.month}-01`;
  const monthEnd = endOfMonth(filters.month);
  const date = (day: number) =>
    `${filters.month}-${String(Math.min(day, Number(monthEnd.slice(8)))).padStart(2, "0")}`;
  const base = [
    { source_kind: "occupational_therapy_assessment",
      professional_kind: "occupational_therapy",
      professional_label: "職能治療", source_page: 33,
      source_page_title: "職能治療評估", client: clients[0]!,
      raw_status: "signed", summary_status: "completed",
      expectation_status: "configured_manual_due_date", expected_count: 1,
      completed_count: 1, pending_count: 0, overdue_count: 0,
      service_count: 0, latest_on: date(4), next_due_on: monthEnd,
      status_reason: "最近評估已簽署；複評日期為人工設定" },
    { source_kind: "physical_therapy_assessment",
      professional_kind: "physical_therapy",
      professional_label: "物理治療", source_page: 34,
      source_page_title: "物理治療評估", client: clients[1]!,
      raw_status: "draft", summary_status: "pending",
      expectation_status: "configured_manual_due_date", expected_count: 1,
      completed_count: 0, pending_count: 1, overdue_count: 0,
      service_count: 0, latest_on: date(8), next_due_on: monthEnd,
      status_reason: "評估草稿待簽署" },
    { source_kind: "consultation", professional_kind: "consultation",
      professional_label: "營養照會", source_page: 37,
      source_page_title: "跨專業照會", client: clients[0]!,
      raw_status: "assigned", summary_status: "overdue",
      expectation_status: "configured_manual_deadline", expected_count: 1,
      completed_count: 0, pending_count: 0, overdue_count: 1,
      service_count: 0, latest_on: date(6), next_due_on: date(7),
      status_reason: "照會已超過人工期限" },
    { source_kind: "case_conference", professional_kind: "case_conference",
      professional_label: "跨專業個案研討", source_page: 38,
      source_page_title: "個案研討會議", client: clients[2]!,
      raw_status: "signed", summary_status: "completed",
      expectation_status: "configured_action_deadlines", expected_count: 1,
      completed_count: 1, pending_count: 0, overdue_count: 0,
      service_count: 0, latest_on: date(12), next_due_on: null,
      status_reason: "會議紀錄與行動項目已完成" },
    { source_kind: "referral", professional_kind: "referral",
      professional_label: "轉介", source_page: 39,
      source_page_title: "轉介管理", client: clients[1]!,
      raw_status: "submitted", summary_status: "pending",
      expectation_status: "due_rule_not_configured", expected_count: 1,
      completed_count: 0, pending_count: 1, overdue_count: 0,
      service_count: 0, latest_on: date(11), next_due_on: null,
      status_reason: "轉介待處理；期限規則尚未設定" },
    { source_kind: "physical_therapy_service",
      professional_kind: "physical_therapy",
      professional_label: "物理治療", source_page: 40,
      source_page_title: "物理治療服務紀錄", client: clients[0]!,
      raw_status: "all_terminal", summary_status: "completed",
      expectation_status: "existing_records_only_frequency_not_configured",
      expected_count: 3, completed_count: 3, pending_count: 0,
      overdue_count: 0, service_count: 3, latest_on: date(15),
      next_due_on: null,
      status_reason: "本月既有服務紀錄均已簽署；服務頻率未設定" },
    { source_kind: "occupational_therapy_service",
      professional_kind: "occupational_therapy",
      professional_label: "職能治療", source_page: 41,
      source_page_title: "職能治療服務紀錄", client: clients[1]!,
      raw_status: "draft_present", summary_status: "pending",
      expectation_status: "existing_records_only_frequency_not_configured",
      expected_count: 2, completed_count: 1, pending_count: 1,
      overdue_count: 0, service_count: 2, latest_on: date(16),
      next_due_on: null,
      status_reason: "1 筆服務草稿待簽署；服務頻率未設定" },
    { source_kind: "chewing_assessment", professional_kind: "chewing",
      professional_label: "咀嚼能力", source_page: 35,
      source_page_title: "咀嚼能力評估", client: clients[2]!,
      raw_status: "candidate_complete", summary_status: "not_configured",
      expectation_status: "candidate_only_form_not_published",
      expected_count: 0, completed_count: 0, pending_count: 0,
      overdue_count: 0, service_count: 0, latest_on: date(9),
      next_due_on: null,
      status_reason: "僅保存未啟用候選規則的預覽；不計為正式完成" },
  ] as const;
  const items = base.map((value, index) => ({ value, index })).filter(({ value }) =>
    (filters.clientId === null || value.client.client_id === filters.clientId) &&
    (filters.professionalKind === "all" ||
      value.professional_kind === filters.professionalKind) &&
    (filters.status === "all" || value.summary_status === filters.status)
  ).map(({ value, index }) => ({
    item_id: `${value.source_kind}:42110000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    source_kind: value.source_kind,
    professional_kind: value.professional_kind,
    professional_label: value.professional_label,
    source_page: value.source_page,
    source_page_title: value.source_page_title,
    source_href: `/app/staff/professional-care/${pathBySource[value.source_kind]}?${
      new URLSearchParams({
        client: value.client.client_id,
        ...(value.source_kind.endsWith("_service")
          ? { from: monthStart, to: monthEnd } : {}),
      }).toString()
    }`,
    client_id: value.client.client_id,
    client_display_name: value.client.display_name,
    service_status: value.client.service_status,
    source_record_id: `42120000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    source_record_key: `42130000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    source_version: 1,
    raw_status: value.raw_status,
    summary_status: value.summary_status,
    expectation_status: value.expectation_status,
    expected_count: value.expected_count,
    completed_count: value.completed_count,
    pending_count: value.pending_count,
    overdue_count: value.overdue_count,
    service_count: value.service_count,
    latest_on: value.latest_on,
    next_due_on: value.next_due_on,
    status_reason: value.status_reason,
    source_hash: String(index + 1).repeat(64).slice(0, 64),
  }));
  const metrics = items.reduce((result, value) => ({
    expected: result.expected + value.expected_count,
    completed: result.completed + value.completed_count,
    pending: result.pending + value.pending_count,
    overdue: result.overdue + value.overdue_count,
    service_records: result.service_records + value.service_count,
    not_configured_items: result.not_configured_items +
      Number(value.summary_status === "not_configured"),
  }), { expected: 0, completed: 0, pending: 0, overdue: 0,
    service_records: 0, not_configured_items: 0 });
  // The demo route cannot persist server-side snapshots. Keep its synthetic
  // Demo snapshots are deterministic per filter set so the page and CSV
  // request do not pretend separately generated payloads are the same one.
  const generatedAt = new Date(`${monthEnd}T23:45:00+08:00`).toISOString();
  const payload: ProfessionalServiceSummarySourceRow["payload"] = {
    organization_id: organizationId,
    branch_id: branchId,
    generated_at: generatedAt,
    month: filters.month,
    month_start: monthStart,
    month_end: monthEnd,
    cutoff_on: monthEnd,
    items,
    item_count: items.length,
    item_total: items.length,
    items_truncated: false,
    metrics,
    client_options: clients,
    client_total: clients.length,
    client_options_truncated: false,
    source_configuration: configs.map((value) => ({
      source_kind: value[0], source_page: value[1],
      data_status: value[2], expectation_status: value[3],
    })),
    source_configuration_count: 9,
    configured_source_count: 7,
    not_configured_source_count: 2,
    expectation_coverage_status: "partial_authoritative_rows_only",
    missing_schedule_claim: "not_made",
    export_status: "immutable_snapshot_available",
    offline_status: "not_configured",
  };
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(payload)).digest("hex");
  const identityHash = createHash("sha256").update(JSON.stringify({
    month: filters.month,
    clientId: filters.clientId,
    professionalKind: filters.professionalKind,
    status: filters.status,
  })).digest("hex");
  const snapshotId = `${identityHash.slice(0, 8)}-${
    identityHash.slice(8, 12)
  }-4${identityHash.slice(13, 16)}-8${identityHash.slice(17, 20)}-${
    identityHash.slice(20, 32)
  }`;
  return projectProfessionalServiceSummary({
    expectedOrganizationId: organizationId,
    expectedBranchId: branchId,
    demo: true,
    row: {
      snapshot_id: snapshotId,
      snapshot_hash: snapshotHash,
      expires_at: new Date(
        new Date(generatedAt).getTime() + 15 * 60_000,
      ).toISOString(),
      payload,
    },
  });
}
