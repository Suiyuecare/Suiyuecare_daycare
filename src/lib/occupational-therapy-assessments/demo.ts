import { projectOccupationalTherapyAssessmentSnapshot } from "./projection";
import type { OccupationalTherapyMeasurement } from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const THERAPIST_ID = "33330000-0000-4000-8000-000000000001";
const THERAPIST_NAME = "王職能治療師（合成）";

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

function stableMeasurements(): OccupationalTherapyMeasurement[] {
  return [
    { name: "坐姿活動持續時間", state: "numeric", value: "12.5", unit: "分鐘", reason: null },
    { name: "雙手操作情形", state: "text", value: "合成示例：可依口頭提示完成熟悉步驟。", unit: null, reason: null },
    { name: "非慣用手握力", state: "not_applicable", value: null, unit: null, reason: "合成示例：本次評估目的不包含此項。" },
  ];
}

function reviewMeasurements(): OccupationalTherapyMeasurement[] {
  return [
    { name: "桌面活動持續時間", state: "numeric", value: "8", unit: "分鐘", reason: null },
    { name: "穿衣步驟觀察", state: "text", value: "合成示例：需逐步口頭提示。", unit: null, reason: null },
    { name: "慣用手握力", state: "missing", value: null, unit: null, reason: "合成示例：當日未取得有效測量。" },
  ];
}

export function buildDemoOccupationalTherapyAssessmentSnapshot() {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = daysFrom(now, -12);
  const overdue = daysFrom(now, -2);
  const upcoming = daysFrom(now, 30);
  const generatedAt = now.toISOString();
  const stable = stableMeasurements();
  const review = reviewMeasurements();
  const commonStable = {
    assessed_on: today,
    therapist_user_id: THERAPIST_ID,
    therapist_display_name: THERAPIST_NAME,
    service_status_at_assessment: "active" as const,
    reassessment_due_on: upcoming,
    due_basis: "人工排定：依合成跨專業會議紀錄於一個月後檢視。",
    measurements: stable,
    functional_observation: "合成示例：在熟悉環境中可依簡短提示完成桌面活動。",
    goals: "合成示例：維持熟悉活動參與，並逐步減少口頭提示。",
    recommendations: "合成示例：活動拆成短步驟並保留充分反應時間。",
    follow_up_plan: "合成示例：下次人工複評時比較活動持續時間與提示需求。",
    form_basis: "manual_unstandardized" as const,
    form_version_reference: "manual-occupational-therapy-v1" as const,
  };
  const commonReview = {
    assessed_on: prior,
    therapist_user_id: THERAPIST_ID,
    therapist_display_name: THERAPIST_NAME,
    service_status_at_assessment: "active" as const,
    reassessment_due_on: overdue,
    due_basis: "人工排定：依合成個案研討紀錄提前檢視。",
    measurements: review,
    functional_observation: "合成示例：目前需要較多逐步提示，缺值項目不視為零。",
    goals: "合成示例：在安全前提下完成兩個連續的熟悉步驟。",
    recommendations: "合成示例：保留視覺提示並由治療師人工追蹤反應。",
    follow_up_plan: "合成示例：補取得缺少的測量，並記錄提示方式差異。",
    form_basis: "manual_unstandardized" as const,
    form_version_reference: "manual-occupational-therapy-v1" as const,
  };

  return projectOccupationalTherapyAssessmentSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: generatedAt,
      items: [
        {
          client_id: "33000000-0000-4000-8000-000000000001",
          client_display_name: "合成個案 A",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "33100000-0000-4000-8000-000000000002",
          assessment_key: "33200000-0000-4000-8000-000000000001",
          assessment_version: 2,
          record_state: "signed",
          ...commonStable,
          reassessment_due: false,
          correction_reason: null,
          signed_at: atTaipei(today, "10:05:00"),
          signer_display_name: THERAPIST_NAME,
          created_at: atTaipei(today, "10:05:00"),
          version_history: [
            {
              version_id: "33100000-0000-4000-8000-000000000001",
              assessment_version: 1,
              record_state: "draft",
              ...commonStable,
              correction_reason: null,
              signed_at: null,
              signer_display_name: null,
              created_at: atTaipei(today, "10:00:00"),
            },
            {
              version_id: "33100000-0000-4000-8000-000000000002",
              assessment_version: 2,
              record_state: "signed",
              ...commonStable,
              correction_reason: null,
              signed_at: atTaipei(today, "10:05:00"),
              signer_display_name: THERAPIST_NAME,
              created_at: atTaipei(today, "10:05:00"),
            },
          ],
          version_history_total: 2,
        },
        {
          client_id: "33000000-0000-4000-8000-000000000002",
          client_display_name: "合成個案 B",
          service_status: "suspended",
          admitted_on: prior,
          ended_on: null,
          version_id: null,
          assessment_key: null,
          assessment_version: null,
          record_state: null,
          assessed_on: null,
          therapist_user_id: null,
          therapist_display_name: null,
          service_status_at_assessment: null,
          reassessment_due_on: null,
          reassessment_due: false,
          due_basis: null,
          measurements: null,
          functional_observation: null,
          goals: null,
          recommendations: null,
          follow_up_plan: null,
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
          client_id: "33000000-0000-4000-8000-000000000003",
          client_display_name: "合成個案 C",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "33100000-0000-4000-8000-000000000005",
          assessment_key: "33200000-0000-4000-8000-000000000002",
          assessment_version: 3,
          record_state: "corrected",
          ...commonReview,
          reassessment_due: true,
          correction_reason: "合成示例：修正人工觀察中的事實描述。",
          signed_at: atTaipei(prior, "15:20:00"),
          signer_display_name: THERAPIST_NAME,
          created_at: atTaipei(prior, "15:20:00"),
          version_history: [
            {
              version_id: "33100000-0000-4000-8000-000000000003",
              assessment_version: 1,
              record_state: "draft",
              ...commonReview,
              correction_reason: null,
              signed_at: null,
              signer_display_name: null,
              created_at: atTaipei(prior, "15:00:00"),
            },
            {
              version_id: "33100000-0000-4000-8000-000000000004",
              assessment_version: 2,
              record_state: "signed",
              ...commonReview,
              correction_reason: null,
              signed_at: atTaipei(prior, "15:10:00"),
              signer_display_name: THERAPIST_NAME,
              created_at: atTaipei(prior, "15:10:00"),
            },
            {
              version_id: "33100000-0000-4000-8000-000000000005",
              assessment_version: 3,
              record_state: "corrected",
              ...commonReview,
              correction_reason: "合成示例：修正人工觀察中的事實描述。",
              signed_at: atTaipei(prior, "15:20:00"),
              signer_display_name: THERAPIST_NAME,
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
        { client_id: "33000000-0000-4000-8000-000000000001", display_name: "合成個案 A", service_status: "active", admitted_on: prior, ended_on: null },
        { client_id: "33000000-0000-4000-8000-000000000002", display_name: "合成個案 B", service_status: "suspended", admitted_on: prior, ended_on: null },
        { client_id: "33000000-0000-4000-8000-000000000003", display_name: "合成個案 C", service_status: "active", admitted_on: prior, ended_on: null },
      ],
      client_total: 3,
      client_options_truncated: false,
      therapist_options: [{ user_id: THERAPIST_ID, display_name: THERAPIST_NAME }],
      therapist_total: 1,
      therapist_options_truncated: false,
      assessment_method_status: "manual_unstandardized_only",
      form_publication_status: "not_published_not_claimed",
      due_rule_status: "not_configured_manual_date_and_basis_only",
      formula_status: "not_configured",
      score_status: "not_configured",
      diagnosis_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      reminder_status: "not_configured",
      offline_sync_status: "not_configured",
    },
  });
}
