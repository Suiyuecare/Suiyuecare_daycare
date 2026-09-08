import { MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT } from "./parser";
import { projectMnaAssessmentSnapshot } from "./projection";
import { MNA_GOVERNANCE_VERSION } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "13000000-0000-4000-8000-000000000036";
const SIGNER_ID = "13000000-0000-4000-8000-000000000037";

function taipeiDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function daysFrom(now: Date, amount: number) {
  return taipeiDate(new Date(now.getTime() + amount * 86_400_000));
}

export function buildDemoMnaAssessmentSnapshot() {
  const now = new Date();
  const generatedAt = now.toISOString();
  const assessed = daysFrom(now, -21);
  const fullAssessed = daysFrom(now, -20);
  const prior = daysFrom(now, -60);
  const due = daysFrom(now, 40);
  const governanceHash = "a".repeat(64);
  const common = {
    author_user_id: AUTHOR_ID,
    author_display_name: "合成營養專業人員",
    service_status_at_assessment: "active" as const,
    governance_version_id: MNA_GOVERNANCE_VERSION,
    governance_snapshot: MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT,
    governance_snapshot_hash: governanceHash,
    source_form_version_reference: "SYNTHETIC-DEMO-NOT-MNA",
    signed_by_user_id: SIGNER_ID,
  };
  const versionOne = {
    version_id: "13100000-0000-4000-8000-000000000001",
    assessment_version: 1,
    record_state: "synthetic_demo_signed" as const,
    assessed_on: prior,
    full_assessment_on: prior,
    ...common,
    short_form_score: 9,
    short_form_risk: "at_risk" as const,
    full_score: 21.5,
    full_risk: "at_risk" as const,
    reassessment_due_on: due,
    reassessment_basis: "合成示例：由專業人員人工輸入的期限與依據，並非系統自動規則。",
    follow_up_status: "planned" as const,
    follow_up_plan: "合成示例：等待跨專業覆核的人工後續計畫。",
    follow_up_owner_display_name: "合成營養專業人員",
    signed_at: new Date(now.getTime() - 5_000_000).toISOString(),
    correction_of_version_id: null,
    correction_reason: null,
    content_hash: "b".repeat(64),
    created_at: new Date(now.getTime() - 5_000_000).toISOString(),
  };
  const versionTwo = {
    version_id: "13100000-0000-4000-8000-000000000002",
    assessment_version: 2,
    record_state: "synthetic_demo_corrected" as const,
    assessed_on: assessed,
    full_assessment_on: fullAssessed,
    ...common,
    short_form_score: 10,
    short_form_risk: "at_risk" as const,
    full_score: 22.5,
    full_risk: "at_risk" as const,
    reassessment_due_on: due,
    reassessment_basis: "合成示例：人工輸入的期限與依據，未套用自動複評規則。",
    follow_up_status: "in_progress" as const,
    follow_up_plan: "合成示例：專業人員人工建立的後續處置追蹤，不是系統建議。",
    follow_up_owner_display_name: "合成營養專業人員",
    signed_at: new Date(now.getTime() - 3_000_000).toISOString(),
    correction_of_version_id: versionOne.version_id,
    correction_reason: "合成示例：修正外部結果轉錄內容。",
    content_hash: "c".repeat(64),
    created_at: new Date(now.getTime() - 3_000_000).toISOString(),
  };
  const normal = {
    version_id: "13100000-0000-4000-8000-000000000003",
    assessment_version: 1,
    record_state: "synthetic_demo_signed" as const,
    assessed_on: assessed,
    full_assessment_on: null,
    ...common,
    short_form_score: 13,
    short_form_risk: "normal" as const,
    full_score: null,
    full_risk: null,
    reassessment_due_on: null,
    reassessment_basis: null,
    follow_up_status: "not_required" as const,
    follow_up_plan: null,
    follow_up_owner_display_name: null,
    signed_at: new Date(now.getTime() - 2_000_000).toISOString(),
    correction_of_version_id: null,
    correction_reason: null,
    content_hash: "d".repeat(64),
    created_at: new Date(now.getTime() - 2_000_000).toISOString(),
  };

  return projectMnaAssessmentSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: generatedAt,
      items: [
        {
          client_id: "12000000-0000-4000-8000-000000000001",
          client_display_name: "合成個案 A",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          assessment_key: "13200000-0000-4000-8000-000000000001",
          ...versionTwo,
          version_history: [versionTwo, versionOne],
          version_history_total: 2,
        },
        {
          client_id: "12000000-0000-4000-8000-000000000002",
          client_display_name: "合成個案 B",
          service_status: "suspended",
          admitted_on: prior,
          ended_on: null,
          version_id: null,
          assessment_key: null,
          assessment_version: null,
          record_state: null,
          assessed_on: null,
          full_assessment_on: null,
          author_user_id: null,
          author_display_name: null,
          service_status_at_assessment: null,
          short_form_score: null,
          short_form_risk: null,
          full_score: null,
          full_risk: null,
          reassessment_due_on: null,
          reassessment_basis: null,
          follow_up_status: null,
          follow_up_plan: null,
          follow_up_owner_display_name: null,
          governance_version_id: null,
          governance_snapshot: null,
          governance_snapshot_hash: null,
          source_form_version_reference: null,
          signed_at: null,
          signed_by_user_id: null,
          correction_of_version_id: null,
          correction_reason: null,
          content_hash: null,
          created_at: null,
          version_history: [],
          version_history_total: 0,
        },
        {
          client_id: "12000000-0000-4000-8000-000000000003",
          client_display_name: "合成個案 C",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          assessment_key: "13200000-0000-4000-8000-000000000002",
          ...normal,
          version_history: [normal],
          version_history_total: 1,
        },
      ],
      item_total: 3,
      matching_total: 3,
      items_truncated: false,
      not_assessed_total: 1,
      normal_total: 1,
      at_risk_total: 1,
      malnourished_total: 0,
      follow_up_pending_total: 1,
      client_options: [
        { client_id: "12000000-0000-4000-8000-000000000001", display_name: "合成個案 A", service_status: "active", admitted_on: prior, ended_on: null },
        { client_id: "12000000-0000-4000-8000-000000000002", display_name: "合成個案 B", service_status: "suspended", admitted_on: prior, ended_on: null },
        { client_id: "12000000-0000-4000-8000-000000000003", display_name: "合成個案 C", service_status: "active", admitted_on: prior, ended_on: null },
      ],
      client_total: 3,
      client_options_truncated: false,
      governance_version_id: MNA_GOVERNANCE_VERSION,
      license_status: "license_required_not_configured",
      questionnaire_content_status: "not_configured",
      scoring_algorithm_status: "not_configured",
      risk_classification_status: "not_configured",
      formal_draft_status: "blocked_license_not_configured",
      formal_sign_status: "blocked_license_not_configured",
      formal_correction_status: "blocked_license_not_configured",
      automatic_reassessment_status: "not_configured",
      automatic_follow_up_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      offline_sync_status: "not_configured",
      notification_status: "not_configured",
    },
  });
}
