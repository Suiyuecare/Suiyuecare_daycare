import { organizationProfileTaipeiDate } from "./date";
import {
  projectOrganizationProfileSnapshot,
  type OrganizationProfileSnapshotSourceRow,
} from "./projection";
import type { OrganizationProfileFilters } from "./types";

const IDS = {
  profile: "58000000-0000-4000-8000-000000000001",
  version1: "58000000-0000-4000-8000-000000000002",
  version2: "58000000-0000-4000-8000-000000000003",
  proposal1: "58000000-0000-4000-8000-000000000004",
  proposalKey: "58000000-0000-4000-8000-000000000005",
  source1: "58000000-0000-4000-8000-000000000006",
  source2: "58000000-0000-4000-8000-000000000007",
  service1: "58000000-0000-4000-8000-000000000008",
  service2: "58000000-0000-4000-8000-000000000009",
  rate1: "58000000-0000-4000-8000-000000000010",
  proposer: "58000000-0000-4000-8000-000000000011",
  approver: "58000000-0000-4000-8000-000000000012",
};

export function buildDemoOrganizationProfileSnapshot({
  organizationId, branchId, filters, now = new Date(),
}: {
  organizationId: string;
  branchId: string;
  filters: OrganizationProfileFilters;
  now?: Date;
}) {
  const snapshotDate = organizationProfileTaipeiDate(now);
  const year = Number(snapshotDate.slice(0, 4));
  const effectiveFrom = `${year - 1}-01-01`;
  const rateFrom = `${year}-01-01`;
  const rateTo = `${year}-12-31`;
  const approvedAt1 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const approvedAt2 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const proposedAt = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const serviceItems = [{ service_key: IDS.service1, name: "合成日間支持服務",
    description: "僅供介面驗收，不代表正式服務代碼。",
    taxonomy_status: "manual_unstandardized" as const }];
  const rateItems = [{ rate_key: IDS.rate1, label: "合成自費費目",
    amount_decimal_text: "001200.00", currency_code: "TWD",
    effective_from: rateFrom, effective_to: rateTo,
    taxonomy_status: "manual_unstandardized" as const }];
  const content = {
    effective_from: effectiveFrom, effective_to: null,
    permit_number: "SYNTHETIC-PERMIT-001",
    permit_issuing_authority: "合成主管單位",
    permit_issued_on: `${year - 1}-01-01`, permit_valid_through: null,
    permit_status_text: "人工註記：合成有效狀態",
    organization_type_text: "合成社區式日間照顧類型",
    service_items: serviceItems, rate_items: rateItems,
    approved_capacity: 30, capacity_unit_text: "合成人數單位",
    capacity_basis_text: "合成核定依據，不是正式許可資料。",
    contact_name: "合成聯絡窗口", contact_phone: "02-0000-0000",
    contact_email: "synthetic@example.invalid",
    contact_address: "合成地址（非真實地點）",
    change_reason: "合成版本資料調整",
    taxonomy_status: "manual_unstandardized" as const,
    attachment_pipeline_status: "not_configured" as const,
    content_hash: "b".repeat(64),
  };
  const row: OrganizationProfileSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId,
    generated_at: now.toISOString(), snapshot_date: snapshotDate,
    versions: [{ version_id: IDS.version2, profile_key: IDS.profile,
      version: 2, previous_version_id: IDS.version1,
      source_proposal_id: IDS.source2, ...content,
      approved_by: IDS.approver, approved_by_display_name: "合成獨立審核人",
      approved_at: approvedAt2 }],
    version_total: 1, versions_truncated: false,
    history: [
      { version_id: IDS.version2, profile_key: IDS.profile, version: 2,
        previous_version_id: IDS.version1, source_proposal_id: IDS.source2,
        effective_from: effectiveFrom, effective_to: null,
        content_hash: "b".repeat(64),
        approved_by_display_name: "合成獨立審核人", approved_at: approvedAt2,
        change_reason: "合成版本資料調整" },
      { version_id: IDS.version1, profile_key: IDS.profile, version: 1,
        previous_version_id: null, source_proposal_id: IDS.source1,
        effective_from: effectiveFrom, effective_to: null,
        content_hash: "a".repeat(64),
        approved_by_display_name: "合成第一審核人", approved_at: approvedAt1,
        change_reason: "合成初始版本" },
    ], history_total: 2, history_truncated: false,
    proposals: [{ proposal_id: IDS.proposal1, proposal_key: IDS.proposalKey,
      proposal_number: 3, action: "correct", profile_key: IDS.profile,
      base_version_id: IDS.version2, expected_base_version: 2,
      ...content, service_items: [...serviceItems, {
        service_key: IDS.service2, name: "合成新增服務",
        description: null, taxonomy_status: "manual_unstandardized" as const,
      }], content_hash: "c".repeat(64),
      change_reason: "合成待審異動",
      proposed_by: IDS.proposer, proposed_by_display_name: "合成提案人",
      proposed_at: proposedAt, status: "pending", decision_id: null,
      decision: null, decision_reason: null, decided_by: null,
      decided_by_display_name: null, decided_at: null, result_version_id: null }],
    proposal_total: 1, proposals_truncated: false,
    active_version_total: 1, pending_proposal_total: 1,
    expired_permit_total: 0, active_capacity: 30,
    official_taxonomy_status: "not_configured",
    manual_taxonomy_status: "manual_unstandardized",
    permit_expiry_reminder_status: "not_configured",
    attachment_pipeline_status: "not_configured", export_status: "disabled",
    regulator_sync_status: "disabled", offline_status: "disabled",
    recent_aal2_max_age_minutes: 15,
  };
  return projectOrganizationProfileSnapshot({ row,
    expectedOrganizationId: organizationId, expectedBranchId: branchId,
    filters, demo: true,
  });
}
