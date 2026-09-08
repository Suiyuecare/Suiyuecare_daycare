import { projectStaffTrainingSnapshot, type StaffTrainingSnapshotSourceRow } from "./projection";
import {
  staffTrainingDecimalToScaledInteger,
  staffTrainingScaledIntegerToDecimal,
} from "./decimal";
import type { StaffTrainingFilters } from "./types";

const STAFF_A = "71040000-0000-4000-8000-000000000101";
const STAFF_B = "71040000-0000-4000-8000-000000000102";

export function buildDemoStaffTrainingSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: StaffTrainingFilters;
}) {
  const generatedAt = "2026-09-01T04:00:00.000Z";
  const allRecords: StaffTrainingSnapshotSourceRow["records"] = [
    {
      record_version_id: "71071000-0000-4000-8000-000000000001",
      training_key: "71070000-0000-4000-8000-000000000001", version: 2,
      previous_version_id: "71071000-0000-4000-8000-000000000002",
      record_status: "active", correction_reason: "依核發證明更正積分",
      staff_membership_id: STAFF_A, staff_user_id: "71010000-0000-4000-8000-000000000101",
      staff_display_name: "陳怡安", staff_employee_code: "D-017",
      course_title: "日照服務品質與溝通", training_date: "2020-09-10",
      starts_at: "2020-09-10T01:00:00.000Z", ends_at: "2020-09-10T03:00:00.000Z",
      course_type: "照顧品質", hours: "2.0000", credits: "50.0000",
      provider_name: "示範辦理單位", evidence_status: "missing" as const,
      credit_expires_on: "2026-09-10", is_expiring: true,
      recorded_by: "71010000-0000-4000-8000-000000000102",
      recorded_by_display_name: "示範主管", recorded_at: "2026-08-31T02:00:00.000Z",
      content_hash: "a".repeat(64),
    },
    {
      record_version_id: "71071000-0000-4000-8000-000000000003",
      training_key: "71070000-0000-4000-8000-000000000002", version: 1,
      previous_version_id: null, record_status: "active", correction_reason: null,
      staff_membership_id: STAFF_B, staff_user_id: "71010000-0000-4000-8000-000000000102",
      staff_display_name: "林志明", staff_employee_code: "D-021",
      course_title: "機構內部演練", training_date: "2026-08-20",
      starts_at: "2026-08-20T01:00:00.000Z", ends_at: "2026-08-20T04:00:00.000Z",
      course_type: "內部訓練", hours: "3.0000", credits: null,
      provider_name: "示範日照中心", evidence_status: "not_applicable" as const,
      credit_expires_on: null, is_expiring: null,
      recorded_by: "71010000-0000-4000-8000-000000000102",
      recorded_by_display_name: "示範主管", recorded_at: "2026-08-20T05:00:00.000Z",
      content_hash: "b".repeat(64),
    },
  ];
  const query = input.filters.query.toLocaleLowerCase("zh-TW");
  const records = allRecords.filter((record) => {
    const haystack = `${record.staff_display_name} ${record.staff_employee_code} ` +
      `${record.course_title} ${record.course_type} ${record.provider_name}`;
    return (input.filters.dateFrom === null || record.training_date >= input.filters.dateFrom) &&
      (input.filters.dateTo === null || record.training_date <= input.filters.dateTo) &&
      (input.filters.staffMembershipId === null ||
        record.staff_membership_id === input.filters.staffMembershipId) &&
      (input.filters.courseType === null || record.course_type === input.filters.courseType) &&
      (!query || haystack.toLocaleLowerCase("zh-TW").includes(query)) &&
      (input.filters.status === "all" ||
        (input.filters.status === "active" && record.record_status === "active") ||
        (input.filters.status === "voided" && record.record_status === "voided") ||
        (input.filters.status === "missing_evidence" &&
          record.record_status === "active" && record.evidence_status === "missing") ||
        (input.filters.status === "expiring" &&
          record.record_status === "active" && record.is_expiring === true));
  }).sort((left, right) => right.starts_at.localeCompare(left.starts_at));
  const progress = [
    { staff_membership_id: STAFF_A, staff_user_id: "71010000-0000-4000-8000-000000000101",
      display_name: "陳怡安", employee_code: "D-017", active_record_count: 1,
      known_credits: "50.0000", missing_credit_count: 0,
      required_credits: "120.0000", credit_gap: "70.0000",
      progress_status: "incomplete" as const, window_start: "2020-09-01",
      window_end: "2026-09-01", rule_version: 3 },
    { staff_membership_id: STAFF_B, staff_user_id: "71010000-0000-4000-8000-000000000102",
      display_name: "林志明", employee_code: "D-021", active_record_count: 1,
      known_credits: "0.0000", missing_credit_count: 1,
      required_credits: "120.0000", credit_gap: null,
      progress_status: "indeterminate" as const, window_start: "2020-09-01",
      window_end: "2026-09-01", rule_version: 3 },
  ].filter((item) => input.filters.staffMembershipId === null ||
    item.staff_membership_id === input.filters.staffMembershipId);
  const credits = records.flatMap((record) => record.credits === null ? [] : [record.credits]);
  const row: StaffTrainingSnapshotSourceRow = {
    organization_id: input.organizationId, branch_id: input.branchId,
    generated_at: generatedAt, snapshot_date: "2026-09-01",
    policy_status: "published", rule_version_id: "71092000-0000-4000-8000-000000000003",
    rule_version: 3, rule_effective_from: "2026-09-01", rule_effective_to: null,
    window_years: 6, required_credits: "120.0000", expiry_notice_days: 30,
    records, record_total: records.length, records_truncated: false,
    hours_total: staffTrainingScaledIntegerToDecimal(records.reduce((sum, record) =>
      sum + staffTrainingDecimalToScaledInteger(record.hours), BigInt(0))),
    credits_total: credits.length === 0 ? null :
      staffTrainingScaledIntegerToDecimal(credits.reduce((sum, value) =>
        sum + staffTrainingDecimalToScaledInteger(value), BigInt(0))),
    credited_record_total: credits.length,
    missing_credit_total: records.filter((record) => record.credits === null).length,
    missing_evidence_total: records.filter((record) =>
      record.record_status === "active" && record.evidence_status === "missing").length,
    expiring_total: records.filter((record) =>
      record.record_status === "active" && record.is_expiring === true).length,
    staff_options: [
      { staff_membership_id: STAFF_A, staff_user_id: "71010000-0000-4000-8000-000000000101",
        display_name: "陳怡安", employee_code: "D-017", is_current: true },
      { staff_membership_id: STAFF_B, staff_user_id: "71010000-0000-4000-8000-000000000102",
        display_name: "林志明", employee_code: "D-021", is_current: true },
    ], staff_total: 2, staff_truncated: false,
    course_type_options: [
      { course_type: "內部訓練", record_count: 1 },
      { course_type: "照顧品質", record_count: 1 },
    ], course_type_total: 2, course_types_truncated: false,
    staff_progress: progress, progress_total: progress.length, progress_truncated: false,
    gap_staff_total: progress.filter((item) => item.progress_status === "incomplete").length,
    indeterminate_staff_total: progress.filter((item) =>
      item.progress_status === "indeterminate").length,
    pending_rule_proposals: [{
      proposal_id: "71091000-0000-4000-8000-000000000001",
      effective_from: "2027-01-01", effective_to: null, window_years: 4,
      required_credits: "80.0000", expiry_notice_days: 45,
      proposed_by: "71010000-0000-4000-8000-000000000102",
      proposer_display_name: "示範主管", proposed_at: "2026-08-31T03:00:00.000Z",
      content_hash: "c".repeat(64),
    }], pending_rule_proposal_total: 1, pending_rule_proposals_truncated: false,
    attachment_pipeline_status: "not_configured", attachment_scan_status: "not_configured",
    external_reporting: "not_implemented",
    progress_scope: "published_rule_window_all_course_types",
  };
  return projectStaffTrainingSnapshot({ row, expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId, filters: input.filters, demo: true });
}
