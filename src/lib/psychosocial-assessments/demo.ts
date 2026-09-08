import { projectPsychosocialAssessmentSnapshot } from "./projection";
import type { PsychosocialDimensions } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const RESPONSIBLE_ID = "28280000-0000-4000-8000-000000000001";

function taipeiDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function atTaipei(dateValue: string, time: string) {
  return new Date(`${dateValue}T${time}+08:00`).toISOString();
}

function daysFrom(now: Date, amount: number) {
  return taipeiDate(new Date(now.getTime() + amount * 86_400_000));
}

function dimensions(variant: "stable" | "needs_review"): PsychosocialDimensions {
  if (variant === "stable") {
    return {
      family_relationships: { state: "provided", detail: "合成示例：主要關係人維持固定聯繫。" },
      social_support: { state: "provided", detail: "合成示例：已有可聯絡的支持對象。" },
      social_participation: { state: "provided", detail: "合成示例：願意參與熟悉的小組活動。" },
      communication_context: { state: "provided", detail: "合成示例：偏好以簡短句子逐項確認。" },
      resource_access: { state: "not_applicable", detail: null },
    };
  }
  return {
    family_relationships: { state: "provided", detail: "合成示例：近期聯繫頻率有變化。" },
    social_support: { state: "missing", detail: null },
    social_participation: { state: "provided", detail: "合成示例：目前較少主動加入活動。" },
    communication_context: { state: "provided", detail: "合成示例：需要較充足的回應時間。" },
    resource_access: { state: "missing", detail: null },
  };
}

export function buildDemoPsychosocialAssessmentSnapshot() {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = daysFrom(now, -12);
  const overdue = daysFrom(now, -2);
  const upcoming = daysFrom(now, 30);
  const generatedAt = now.toISOString();
  const stableDimensions = dimensions("stable");
  const reviewDimensions = dimensions("needs_review");

  return projectPsychosocialAssessmentSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: generatedAt,
      items: [
        {
          client_id: "28000000-0000-4000-8000-000000000001",
          client_display_name: "合成個案 A",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "28100000-0000-4000-8000-000000000002",
          assessment_key: "28200000-0000-4000-8000-000000000001",
          assessment_version: 2,
          record_state: "signed",
          assessed_on: today,
          responsible_user_id: RESPONSIBLE_ID,
          responsible_display_name: "林社工（合成）",
          service_status_at_assessment: "active",
          reassessment_due_on: upcoming,
          reassessment_due: false,
          due_basis: "人工排定：依合成服務會議紀錄於一個月後檢視。",
          dimensions: stableDimensions,
          assessment_summary: "合成示例：本次以人工敘事整理家庭互動、支持與參與情形；不代表量表分數或診斷。",
          form_basis: "manual_unstandardized",
          form_version_reference: "manual-psychosocial-v1",
          correction_reason: null,
          signed_at: atTaipei(today, "10:05:00"),
          signer_display_name: "林社工（合成）",
          created_at: atTaipei(today, "10:05:00"),
          version_history: [
            {
              version_id: "28100000-0000-4000-8000-000000000001",
              assessment_version: 1,
              record_state: "draft",
              assessed_on: today,
              responsible_user_id: RESPONSIBLE_ID,
              responsible_display_name: "林社工（合成）",
              service_status_at_assessment: "active",
              reassessment_due_on: upcoming,
              due_basis: "人工排定：依合成服務會議紀錄於一個月後檢視。",
              dimensions: stableDimensions,
              assessment_summary: "合成示例：本次以人工敘事整理家庭互動、支持與參與情形；不代表量表分數或診斷。",
              form_basis: "manual_unstandardized",
              form_version_reference: "manual-psychosocial-v1",
              correction_reason: null,
              signed_at: null,
              signer_display_name: null,
              created_at: atTaipei(today, "10:00:00"),
            },
            {
              version_id: "28100000-0000-4000-8000-000000000002",
              assessment_version: 2,
              record_state: "signed",
              assessed_on: today,
              responsible_user_id: RESPONSIBLE_ID,
              responsible_display_name: "林社工（合成）",
              service_status_at_assessment: "active",
              reassessment_due_on: upcoming,
              due_basis: "人工排定：依合成服務會議紀錄於一個月後檢視。",
              dimensions: stableDimensions,
              assessment_summary: "合成示例：本次以人工敘事整理家庭互動、支持與參與情形；不代表量表分數或診斷。",
              form_basis: "manual_unstandardized",
              form_version_reference: "manual-psychosocial-v1",
              correction_reason: null,
              signed_at: atTaipei(today, "10:05:00"),
              signer_display_name: "林社工（合成）",
              created_at: atTaipei(today, "10:05:00"),
            },
          ],
          version_history_total: 2,
        },
        {
          client_id: "28000000-0000-4000-8000-000000000002",
          client_display_name: "合成個案 B",
          service_status: "suspended",
          admitted_on: prior,
          ended_on: null,
          version_id: null,
          assessment_key: null,
          assessment_version: null,
          record_state: null,
          assessed_on: null,
          responsible_user_id: null,
          responsible_display_name: null,
          service_status_at_assessment: null,
          reassessment_due_on: null,
          reassessment_due: false,
          due_basis: null,
          dimensions: null,
          assessment_summary: null,
          form_basis: null,
          form_version_reference: null,
          correction_reason: null,
          signed_at: null,
          signer_display_name: null,
          created_at: null,
          version_history: [],
          version_history_total: 0,
        },
        {
          client_id: "28000000-0000-4000-8000-000000000003",
          client_display_name: "合成個案 C",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "28100000-0000-4000-8000-000000000005",
          assessment_key: "28200000-0000-4000-8000-000000000002",
          assessment_version: 3,
          record_state: "corrected",
          assessed_on: prior,
          responsible_user_id: RESPONSIBLE_ID,
          responsible_display_name: "林社工（合成）",
          service_status_at_assessment: "active",
          reassessment_due_on: overdue,
          reassessment_due: true,
          due_basis: "人工排定：依合成個案研討紀錄提前檢視。",
          dimensions: reviewDimensions,
          assessment_summary: "合成示例：部分支持資訊尚待人工確認；此處只呈現已記錄、未知與不適用，不計分、不診斷。",
          form_basis: "manual_unstandardized",
          form_version_reference: "manual-psychosocial-v1",
          correction_reason: "合成示例：修正先前人工敘事中的事實描述。",
          signed_at: atTaipei(prior, "15:20:00"),
          signer_display_name: "林社工（合成）",
          created_at: atTaipei(prior, "15:20:00"),
          version_history: [
            {
              version_id: "28100000-0000-4000-8000-000000000003",
              assessment_version: 1,
              record_state: "draft",
              assessed_on: prior,
              responsible_user_id: RESPONSIBLE_ID,
              responsible_display_name: "林社工（合成）",
              service_status_at_assessment: "active",
              reassessment_due_on: overdue,
              due_basis: "人工排定：依合成個案研討紀錄提前檢視。",
              dimensions: reviewDimensions,
              assessment_summary: "合成示例：部分支持資訊尚待人工確認。",
              form_basis: "manual_unstandardized",
              form_version_reference: "manual-psychosocial-v1",
              correction_reason: null,
              signed_at: null,
              signer_display_name: null,
              created_at: atTaipei(prior, "15:00:00"),
            },
            {
              version_id: "28100000-0000-4000-8000-000000000004",
              assessment_version: 2,
              record_state: "signed",
              assessed_on: prior,
              responsible_user_id: RESPONSIBLE_ID,
              responsible_display_name: "林社工（合成）",
              service_status_at_assessment: "active",
              reassessment_due_on: overdue,
              due_basis: "人工排定：依合成個案研討紀錄提前檢視。",
              dimensions: reviewDimensions,
              assessment_summary: "合成示例：部分支持資訊尚待人工確認。",
              form_basis: "manual_unstandardized",
              form_version_reference: "manual-psychosocial-v1",
              correction_reason: null,
              signed_at: atTaipei(prior, "15:10:00"),
              signer_display_name: "林社工（合成）",
              created_at: atTaipei(prior, "15:10:00"),
            },
            {
              version_id: "28100000-0000-4000-8000-000000000005",
              assessment_version: 3,
              record_state: "corrected",
              assessed_on: prior,
              responsible_user_id: RESPONSIBLE_ID,
              responsible_display_name: "林社工（合成）",
              service_status_at_assessment: "active",
              reassessment_due_on: overdue,
              due_basis: "人工排定：依合成個案研討紀錄提前檢視。",
              dimensions: reviewDimensions,
              assessment_summary: "合成示例：部分支持資訊尚待人工確認；此處只呈現已記錄、未知與不適用，不計分、不診斷。",
              form_basis: "manual_unstandardized",
              form_version_reference: "manual-psychosocial-v1",
              correction_reason: "合成示例：修正先前人工敘事中的事實描述。",
              signed_at: atTaipei(prior, "15:20:00"),
              signer_display_name: "林社工（合成）",
              created_at: atTaipei(prior, "15:20:00"),
            },
          ],
          version_history_total: 3,
        },
      ],
      item_total: 3,
      matching_total: 3,
      items_truncated: false,
      assessed_total: 2,
      not_assessed_total: 1,
      due_total: 1,
      upcoming_total: 1,
      draft_total: 0,
      completed_total: 2,
      client_options: [
        { client_id: "28000000-0000-4000-8000-000000000001", display_name: "合成個案 A", service_status: "active", admitted_on: prior, ended_on: null },
        { client_id: "28000000-0000-4000-8000-000000000002", display_name: "合成個案 B", service_status: "suspended", admitted_on: prior, ended_on: null },
        { client_id: "28000000-0000-4000-8000-000000000003", display_name: "合成個案 C", service_status: "active", admitted_on: prior, ended_on: null },
      ],
      client_total: 3,
      client_options_truncated: false,
      responsible_options: [{
        user_id: RESPONSIBLE_ID,
        display_name: "林社工（合成）",
      }],
      responsible_total: 1,
      responsible_options_truncated: false,
      assessment_method_status: "manual_unstandardized_only",
      form_publication_status: "not_published_not_claimed",
      due_rule_status: "not_configured_manual_date_and_basis_only",
      score_status: "not_configured",
      diagnosis_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      offline_sync_status: "not_configured",
    },
  });
}
