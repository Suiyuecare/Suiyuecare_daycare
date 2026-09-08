import { projectClientServicePlanSnapshot } from "./projection";
import type { ClientServicePlanFilters } from "./types";

const ORG = "52110000-0000-4000-8000-000000000001";
const BRANCH = "52120000-0000-4000-8000-000000000001";
const CLIENT_A = "52130000-0000-4000-8000-000000000001";
const CLIENT_B = "52130000-0000-4000-8000-000000000002";
const STAFF_A = "52140000-0000-4000-8000-000000000001";
const STAFF_B = "52140000-0000-4000-8000-000000000002";
const AUTH_A = "52150000-0000-4000-8000-000000000001";
const AUTH_B = "52150000-0000-4000-8000-000000000002";

const provenance = { schema_version: 1 as const, source_system: "local" as const,
  capture_method: "staff_entry" as const, authority: "facility" as const,
  workflow: "page52_client_service_plan_v1" as const,
  legal_rule_status: "not_configured" as const,
  claim_eligibility_status: "blocked_not_configured" as const };
const goals = [{ goal_id: "52160000-0000-4000-8000-000000000001", item_order: 1,
  goal: "合成示例：維持日間活動參與。", target_outcome: "合成示例：依人工檢討結果調整支持。" }];
const services = [{ measure_id: "52170000-0000-4000-8000-000000000001", item_order: 1,
  goal_id: goals[0]!.goal_id, measure: "合成示例：提供結構化活動支持。",
  frequency: "合成示例：服務日由負責人依計畫執行。", responsible_user_id: STAFF_A,
  responsible_display_name: "合成個管員", qualification_status: "active_membership_only" as const }];

function version(input: { index: number; planKey: string; clientId: string; authorizationId: string;
  authorizationKey: string; version: number; previous: string | null;
  status: "draft" | "approved" | "signed" | "voided"; mapping?: "configured" | "needs_mapping";
  authorizationStatus?: "current" | "outdated" | "voided" | "period_mismatch" }) {
  const id = `52180000-0000-4000-8000-${String(input.index * 10 + input.version).padStart(12, "0")}`;
  const approved = input.status !== "draft";
  const signed = input.status === "signed" || input.status === "voided";
  const mapping = input.mapping ?? "configured";
  const rawGoals = mapping === "configured" ? goals : [{ legacy_goal_text: "合成舊格式目標，待人工映射" }];
  const rawServices = mapping === "configured" ? services : [{ legacy_service_text: "合成舊格式措施，待人工映射" }];
  return { schema_version: 1 as const, plan_id: id, plan_key: input.planKey,
    version: input.version, previous_version_id: input.previous, status: input.status,
    payload_hash: String((input.index + input.version) % 10).repeat(64), client_id: input.clientId,
    authorized_care_plan_id: input.authorizationId, authorized_content_hash: "a".repeat(64),
    authorized_plan_key: input.authorizationKey, authorized_version: 1,
    authorized_source_system: "central_html_import", authorized_source_record_id: `SYN-AUTH-${input.index}`,
    authorization_status: input.authorizationStatus ?? "current",
    operational_status: input.status === "signed" && (input.authorizationStatus ?? "current") === "current" ?
      "signed_current" as const : "not_executable" as const,
    effective_from: "2026-09-01", effective_to: "2026-12-31", review_due_on: "2026-10-31",
    responsible_user_id: STAFF_A, responsible_display_name: "合成個管員",
    source_system: "local", source_record_id: null, source_provenance: provenance,
    goals: rawGoals, planned_services: rawServices, content_mapping_status: mapping,
    unmapped_content: mapping === "needs_mapping" ? { goals: rawGoals, planned_services: rawServices } : null,
    reason: input.version === 1 ? "建立個案服務計畫合成草稿" :
      input.status === "approved" ? "合成核准：確認目標措施及負責人" : "合成簽署：確認核准版本內容",
    created_by: STAFF_A, created_by_display_name: "合成個管員",
    created_at: `2026-09-0${input.index + input.version}T02:00:00.000Z`,
    approved_by: approved ? STAFF_B : null, approved_by_display_name: approved ? "合成主管" : null,
    approved_at: approved ? `2026-09-0${input.index + input.version}T02:00:00.000Z` : null,
    signed_by: signed ? STAFF_A : null, signed_by_display_name: signed ? "合成個管員" : null,
    signed_at: signed ? `2026-09-0${input.index + input.version}T02:05:00.000Z` : null,
    signature_purpose: signed ? (input.status === "voided" ? "個案服務計畫作廢" : "個案服務計畫簽署") : null,
    reauth_challenge_id: signed ? `52190000-0000-4000-8000-${String(input.index * 10 + input.version).padStart(12, "0")}` : null };
}

export function buildDemoClientServicePlanSnapshot(filters: ClientServicePlanFilters) {
  const keyA = "52200000-0000-4000-8000-000000000001";
  const a1 = version({ index: 1, planKey: keyA, clientId: CLIENT_A, authorizationId: AUTH_A,
    authorizationKey: "52210000-0000-4000-8000-000000000001", version: 1, previous: null, status: "draft" });
  const a2 = version({ index: 1, planKey: keyA, clientId: CLIENT_A, authorizationId: AUTH_A,
    authorizationKey: "52210000-0000-4000-8000-000000000001", version: 2,
    previous: a1.plan_id, status: "approved" });
  const a3 = version({ index: 1, planKey: keyA, clientId: CLIENT_A, authorizationId: AUTH_A,
    authorizationKey: "52210000-0000-4000-8000-000000000001", version: 3,
    previous: a2.plan_id, status: "signed" });
  const keyB = "52200000-0000-4000-8000-000000000002";
  const b1 = version({ index: 2, planKey: keyB, clientId: CLIENT_B, authorizationId: AUTH_B,
    authorizationKey: "52210000-0000-4000-8000-000000000002", version: 1,
    previous: null, status: "draft", mapping: "needs_mapping", authorizationStatus: "outdated" });
  const candidates = [{ ...a3, client_display_name: "日照個案甲", client_code: "SYN-PLAN-001",
    published_plan_id: a3.plan_id, published_version: a3.version,
    published_payload_hash: a3.payload_hash, published_status: "signed" as const,
    stream_operational_status: "signed_current" as const,
    history: [a1, a2, a3], history_total: 3 },
  { ...b1, client_display_name: "日照個案乙", client_code: "SYN-PLAN-002",
    published_plan_id: null, published_version: null, published_payload_hash: null,
    published_status: null, stream_operational_status: "not_executable" as const,
    history: [b1], history_total: 1 }];
  const needle = filters.query?.toLocaleLowerCase("zh-Hant-TW") ?? null;
  const plans = candidates.filter((item) => (!filters.clientId || item.client_id === filters.clientId) &&
    (filters.status === "all" || item.status === filters.status ||
      (filters.status === "needs_mapping" && item.content_mapping_status === "needs_mapping") ||
      (filters.status === "authorization_outdated" && item.authorization_status !== "current") ||
      (filters.status === "review_due" && item.review_due_on <= filters.asOf && item.status !== "voided")) &&
    (!needle || item.client_display_name.toLocaleLowerCase("zh-Hant-TW").includes(needle) ||
      item.client_code.toLowerCase().includes(needle) || item.plan_key.includes(needle)));
  return projectClientServicePlanSnapshot({ expectedOrganizationId: ORG, expectedBranchId: BRANCH,
    filters, demo: true, row: { organization_id: ORG, branch_id: BRANCH,
      generated_at: new Date().toISOString(), as_of: filters.asOf, plans,
      matching_total: plans.length, plans_truncated: false,
      history_returned_total: plans.reduce((total, item) => total + item.history.length, 0),
      history_maximum: 500, history_truncated: false, plan_total: plans.length,
      draft_total: plans.filter((item) => item.status === "draft").length,
      approved_total: plans.filter((item) => item.status === "approved").length,
      signed_total: plans.filter((item) => item.status === "signed").length,
      voided_total: plans.filter((item) => item.status === "voided").length,
      review_due_total: plans.filter((item) => item.status !== "voided" && item.review_due_on <= filters.asOf).length,
      needs_mapping_total: plans.filter((item) => item.content_mapping_status === "needs_mapping").length,
      outdated_authorization_total: plans.filter((item) => item.authorization_status !== "current").length,
      executable_total: plans.filter((item) => item.stream_operational_status === "signed_current").length,
      clients: [{ client_id: CLIENT_A, display_name: "日照個案甲", client_code: "SYN-PLAN-001",
        service_status: "active", can_manage: true },
      { client_id: CLIENT_B, display_name: "日照個案乙", client_code: "SYN-PLAN-002",
        service_status: "active", can_manage: true }], client_total: 2, clients_truncated: false,
      staff: [{ user_id: STAFF_A, display_name: "合成個管員", qualification_status: "active_membership_only" },
        { user_id: STAFF_B, display_name: "合成主管", qualification_status: "active_membership_only" }],
      staff_total: 2, staff_truncated: false,
      authorizations: [{ authorized_care_plan_id: AUTH_A, client_id: CLIENT_A,
        plan_key: "52210000-0000-4000-8000-000000000001", version: 1,
        content_hash: "a".repeat(64), effective_from: "2026-09-01", effective_to: "2026-12-31",
        source_system: "central_html_import", source_record_id: "SYN-AUTH-1", status: "current" },
      { authorized_care_plan_id: AUTH_B, client_id: CLIENT_B,
        plan_key: "52210000-0000-4000-8000-000000000002", version: 1,
        content_hash: "a".repeat(64), effective_from: "2026-09-01", effective_to: "2026-12-31",
        source_system: "central_html_import", source_record_id: "SYN-AUTH-2", status: "current" }],
      authorization_total: 2, authorizations_truncated: false,
      official_qualification_rule_status: "not_configured", legal_rule_status: "not_configured",
      claim_eligibility_status: "blocked_not_configured",
      claim_eligibility_reason: "official_service_codes_rates_and_qualification_rules_not_configured",
      offline_status: "not_configured", export_status: "not_configured" } });
}
