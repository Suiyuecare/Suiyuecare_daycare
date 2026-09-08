import { projectStaffSchedulingSnapshot } from "./projection";
import type { StaffSchedulingFilters } from "./types";

const IDS = {
  rule: "63000000-0000-4000-8000-000000000001",
  ruleSet: "63000000-0000-4000-8000-000000000002",
  staffA: "63000000-0000-4000-8000-000000000003",
  userA: "63000000-0000-4000-8000-000000000004",
  staffB: "63000000-0000-4000-8000-000000000005",
  userB: "63000000-0000-4000-8000-000000000006",
  scheduleA: "63000000-0000-4000-8000-000000000007",
  versionA: "63000000-0000-4000-8000-000000000008",
  scheduleB: "63000000-0000-4000-8000-000000000009",
  versionB: "63000000-0000-4000-8000-000000000010",
  creator: "63000000-0000-4000-8000-000000000011",
  certificate: "63000000-0000-4000-8000-000000000012",
  certificateKey: "63000000-0000-4000-8000-000000000013",
} as const;
const H = {
  rule: "1".repeat(64), ready: "2".repeat(64), conflict: "3".repeat(64),
};

export function buildDemoStaffSchedulingSourceRow({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: StaffSchedulingFilters;
  now?: Date;
}) {
  const generatedAt = now.toISOString();
  const startsA = `${filters.periodStart}T01:00:00.000Z`;
  const endsA = `${filters.periodStart}T05:00:00.000Z`;
  const startsB = `${filters.periodStart}T02:00:00.000Z`;
  const endsB = `${filters.periodStart}T06:00:00.000Z`;
  const allRecords = [
    {
      schedule_version_id: IDS.versionA, schedule_key: IDS.scheduleA, version: 1,
      previous_version_id: null, status: "draft_ready" as const, review_mode: null,
      rule_version_id: IDS.rule, staff_membership_id: IDS.staffA,
      staff_user_id: IDS.userA, staff_display_name: "示範員工甲",
      staff_employee_code: "DEMO-063-A", starts_at: startsA, ends_at: endsA,
      role_text: "合成照顧角色", service_need_text: "合成日照活動支援",
      facility_code: "DEMO_ROOM", vehicle_code: "DEMO_VAN",
      planned_clients: 4, conflict_count: 0, conflicts: [],
      qualification_evidence: [{ source_page: 72 as const,
        record_version_id: IDS.certificate, certificate_key: IDS.certificateKey,
        version: 1, certificate_type: "合成示範證照", validity_status: "active" as const,
        has_active_exception: false, snapshot_date: filters.periodStart }],
      qualification_projection: "page72_terminal" as const,
      revision_reason: "合成展示：建立可供獨立覆核的規則檢查草稿。",
      created_by: IDS.creator, creator_display_name: "示範建立人",
      created_at: generatedAt, reviewed_by: null, reviewer_display_name: null,
      reviewed_at: null, review_reason: null, content_hash: H.ready,
    },
    {
      schedule_version_id: IDS.versionB, schedule_key: IDS.scheduleB, version: 1,
      previous_version_id: null, status: "draft_conflicted" as const,
      review_mode: null, rule_version_id: IDS.rule,
      staff_membership_id: IDS.staffB, staff_user_id: IDS.userB,
      staff_display_name: "示範員工乙", staff_employee_code: "DEMO-063-B",
      starts_at: startsB, ends_at: endsB, role_text: "合成照顧角色",
      service_need_text: "合成接送支援", facility_code: "DEMO_ROOM",
      vehicle_code: "DEMO_VAN", planned_clients: 9, conflict_count: 1,
      conflicts: [{ domain: "qualification" as const,
        code: "terminal_certificate_evidence_missing" as const,
        message: "第 72 頁終端投影沒有符合此合成人工職務規則的證照證據。",
        required_certificate_type: "合成示範證照", source_page: 72 as const }],
      qualification_evidence: [], qualification_projection: "page72_terminal" as const,
      revision_reason: "合成展示：保留可解釋衝突，不會自動發布。",
      created_by: IDS.creator, creator_display_name: "示範建立人",
      created_at: generatedAt, reviewed_by: null, reviewer_display_name: null,
      reviewed_at: null, review_reason: null, content_hash: H.conflict,
    },
  ];
  const staffMatched = (record: typeof allRecords[number]) =>
    filters.staffMembershipId === null ||
    record.staff_membership_id === filters.staffMembershipId;
  const statusMatched = (record: typeof allRecords[number]) => filters.status === "all" ||
    filters.status === "ready" && record.status === "draft_ready" ||
    filters.status === "conflicted" && record.status === "draft_conflicted";
  const records = allRecords.filter((record) => staffMatched(record) && statusMatched(record));
  const historySource = allRecords.filter(staffMatched);
  const payload = {
    organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
    period_start: filters.periodStart, period_end: filters.periodEnd,
    records, record_total: records.length, records_truncated: false,
    ready_total: records.filter((record) => record.status === "draft_ready").length,
    conflicted_total: records.filter((record) => record.status === "draft_conflicted").length,
    published_total: 0, overridden_total: 0, rejected_total: 0,
    history: historySource.map((record) => ({
      schedule_version_id: record.schedule_version_id,
      schedule_key: record.schedule_key, version: record.version,
      previous_version_id: record.previous_version_id, status: record.status,
      review_mode: record.review_mode, rule_version_id: record.rule_version_id,
      conflict_count: record.conflict_count, content_hash: record.content_hash,
      created_at: record.created_at, creator_display_name: record.creator_display_name,
      reviewed_at: record.reviewed_at, reviewer_display_name: record.reviewer_display_name,
    })), history_total: historySource.length, history_truncated: false,
    staff_options: [{ staff_membership_id: IDS.staffA, staff_user_id: IDS.userA,
      display_name: "示範員工甲", employee_code: "DEMO-063-A" },
    { staff_membership_id: IDS.staffB, staff_user_id: IDS.userB,
      display_name: "示範員工乙", employee_code: "DEMO-063-B" }],
    staff_total: 2, staff_truncated: false,
    rule_configuration_status: "configured_manual_unstandardized" as const,
    rule_version: { rule_version_id: IDS.rule, rule_set_key: IDS.ruleSet, version: 1,
      effective_from: filters.periodStart, effective_to: filters.periodEnd,
      source_status: "manual_unstandardized" as const,
      rule_payload: {
        qualification_rules: [{ role_text: "合成照顧角色",
          required_certificate_type: "合成示範證照",
          taxonomy_status: "manual_unstandardized" as const }],
        work_rules: { max_shift_minutes: 480, min_rest_minutes: 600,
          source_status: "manual_unstandardized" as const },
        facilities: [{ facility_code: "DEMO_ROOM", name: "合成活動空間",
          capacity: 12, taxonomy_status: "manual_unstandardized" as const }],
        vehicles: [{ vehicle_code: "DEMO_VAN", name: "合成接送車",
          capacity: 8, taxonomy_status: "manual_unstandardized" as const }],
        branch_capacity: 20, source_status: "manual_unstandardized" as const,
      }, content_hash: H.rule },
    qualification_rule_status: "configured_manual_unstandardized" as const,
    work_time_rule_status: "configured_manual_unstandardized" as const,
    rest_rule_status: "configured_manual_unstandardized" as const,
    facility_rule_status: "configured_manual_unstandardized" as const,
    vehicle_rule_status: "configured_manual_unstandardized" as const,
    capacity_rule_status: "configured_manual_unstandardized" as const,
    qualification_projection: "page72_terminal" as const,
    decision_engine: "deterministic_rule_assisted" as const,
    ai_status: "not_used" as const, automatic_publish_status: "disabled" as const,
    export_status: "disabled" as const, offline_status: "disabled" as const,
  };
  return payload;
}

export function buildDemoStaffSchedulingSnapshot(args: {
  organizationId: string;
  branchId: string;
  filters: StaffSchedulingFilters;
  now?: Date;
}) {
  return projectStaffSchedulingSnapshot({ row: buildDemoStaffSchedulingSourceRow(args),
    expectedOrganizationId: args.organizationId, expectedBranchId: args.branchId,
    filters: args.filters, demo: true });
}
