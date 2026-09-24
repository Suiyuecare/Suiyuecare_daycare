import { projectNsiNutritionScreeningSnapshot } from "./projection";
import {
  NSI_NUTRITION_ITEM_IDS,
  NSI_NUTRITION_OBSERVATION_LABELS,
  NSI_NUTRITION_RULE_VERSION,
  type NsiNutritionAnswers,
  type NsiNutritionRuleSnapshot,
} from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "12000000-0000-4000-8000-000000000012";
const AUTHOR_NAME = "林評估人員（合成）";

export const NSI_NUTRITION_DEMO_RULE_SNAPSHOT: NsiNutritionRuleSnapshot = {
  version_id: NSI_NUTRITION_RULE_VERSION,
  instrument: "manual_unstandardized_nutrition_observations",
  rule_revision: 1,
  activation_status: "candidate_unactivated",
  activated_at: null,
  governance_review_required: true,
  formal_use_permitted: false,
  field_ids: [...NSI_NUTRITION_ITEM_IDS],
  field_definitions: NSI_NUTRITION_ITEM_IDS.map((id) => ({
    id,
    label: NSI_NUTRITION_OBSERVATION_LABELS[id],
    data_kind: "manual_presence_observation" as const,
  })),
  answer_values: ["present", "absent"],
  completeness_policy: "all_fields_answered_for_non_clinical_count",
  present_count_policy: "count_present_only_when_complete_non_clinical",
  missing_policy: "no_count_and_never_zero",
  not_applicable_policy: "no_count_and_never_zero",
  formal_questionnaire_status: "not_configured",
  licensed_source_status: "not_configured",
  formal_weights_status: "not_configured",
  formal_scoring_status: "not_configured",
  formal_risk_classification_status: "not_configured",
  disclaimer: "Manual unstandardized nutrition observations only; this is not an approved NSI questionnaire, score, risk classification, diagnosis, signature, follow-up, referral, notification, or care decision.",
};

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

export function nutritionAnswersWithObservedCount(
  observedCount: number,
): NsiNutritionAnswers {
  let remaining = observedCount;
  return Object.fromEntries(NSI_NUTRITION_ITEM_IDS.map((id) => {
    const value = remaining > 0 ? "present" : "absent";
    if (remaining > 0) remaining -= 1;
    return [id, { state: "answered", value }];
  })) as unknown as NsiNutritionAnswers;
}

function incompleteAnswers(): NsiNutritionAnswers {
  return {
    ...nutritionAnswersWithObservedCount(2),
    nutrition_observation_04: { state: "missing" },
    nutrition_observation_06: {
      state: "not_applicable",
      reason: "合成示例：本次不適用此人工觀察欄位。",
    },
  };
}

export function buildDemoNsiNutritionScreeningSnapshot() {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = daysFrom(now, -18);
  const generatedAt = now.toISOString();
  const ruleHash = "b".repeat(64);
  const contentHashV1 = "c".repeat(64);
  const contentHashV2 = "d".repeat(64);
  const contentHashIncomplete = "e".repeat(64);
  const answersV1 = nutritionAnswersWithObservedCount(2);
  const answersV2 = nutritionAnswersWithObservedCount(3);
  const incomplete = incompleteAnswers();
  const commonV2 = {
    assessed_on: today,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: answersV2,
    rule_version_id: NSI_NUTRITION_RULE_VERSION,
    rule_snapshot: NSI_NUTRITION_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "candidate_complete" as const,
    preview_observed_count: 3,
    content_hash: contentHashV2,
  };
  const commonIncomplete = {
    assessed_on: prior,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: incomplete,
    rule_version_id: NSI_NUTRITION_RULE_VERSION,
    rule_snapshot: NSI_NUTRITION_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "incomplete" as const,
    preview_observed_count: null,
    content_hash: contentHashIncomplete,
  };

  return projectNsiNutritionScreeningSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: generatedAt,
      items: [
        {
          client_id: "a1111111-1111-4111-8111-111111111111",
          client_display_name: "陳O華（合成）",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "12100000-0000-4000-8000-000000000002",
          assessment_key: "12200000-0000-4000-8000-000000000001",
          assessment_version: 2,
          record_state: "draft_preview",
          ...commonV2,
          created_at: generatedAt,
          version_history: [
            {
              version_id: "12100000-0000-4000-8000-000000000002",
              assessment_version: 2,
              record_state: "draft_preview",
              ...commonV2,
              created_at: generatedAt,
            },
            {
              version_id: "12100000-0000-4000-8000-000000000001",
              assessment_version: 1,
              record_state: "draft_preview",
              assessed_on: prior,
              author_user_id: AUTHOR_ID,
              author_display_name: AUTHOR_NAME,
              service_status_at_assessment: "active",
              answers: answersV1,
              rule_version_id: NSI_NUTRITION_RULE_VERSION,
              rule_snapshot: NSI_NUTRITION_DEMO_RULE_SNAPSHOT,
              rule_snapshot_hash: ruleHash,
              governance_status: "candidate_unactivated",
              preview_status: "candidate_complete",
              preview_observed_count: 2,
              content_hash: contentHashV1,
              created_at: new Date(now.getTime() - 900_000).toISOString(),
            },
          ],
          version_history_total: 2,
        },
        {
          client_id: "a2222222-2222-4222-8222-222222222222",
          client_display_name: "林O英（合成）",
          service_status: "suspended",
          admitted_on: prior,
          ended_on: null,
          version_id: null,
          assessment_key: null,
          assessment_version: null,
          record_state: null,
          assessed_on: null,
          author_user_id: null,
          author_display_name: null,
          service_status_at_assessment: null,
          answers: null,
          rule_version_id: null,
          rule_snapshot: null,
          rule_snapshot_hash: null,
          governance_status: null,
          preview_status: null,
          preview_observed_count: null,
          content_hash: null,
          created_at: null,
          version_history: [],
          version_history_total: 0,
        },
        {
          client_id: "a3333333-3333-4333-8333-333333333333",
          client_display_name: "黃O生（合成）",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "12100000-0000-4000-8000-000000000003",
          assessment_key: "12200000-0000-4000-8000-000000000002",
          assessment_version: 1,
          record_state: "draft_preview",
          ...commonIncomplete,
          created_at: new Date(now.getTime() - 1_800_000).toISOString(),
          version_history: [{
            version_id: "12100000-0000-4000-8000-000000000003",
            assessment_version: 1,
            record_state: "draft_preview",
            ...commonIncomplete,
            created_at: new Date(now.getTime() - 1_800_000).toISOString(),
          }],
          version_history_total: 1,
        },
      ],
      item_total: 3,
      matching_total: 3,
      items_truncated: false,
      not_assessed_total: 1,
      candidate_complete_total: 1,
      incomplete_total: 1,
      draft_total: 2,
      client_options: [
        { client_id: "a1111111-1111-4111-8111-111111111111", display_name: "陳O華（合成）", service_status: "active", admitted_on: prior, ended_on: null },
        { client_id: "a2222222-2222-4222-8222-222222222222", display_name: "林O英（合成）", service_status: "suspended", admitted_on: prior, ended_on: null },
        { client_id: "a3333333-3333-4333-8333-333333333333", display_name: "黃O生（合成）", service_status: "active", admitted_on: prior, ended_on: null },
      ],
      client_total: 3,
      client_options_truncated: false,
      rule_version_id: NSI_NUTRITION_RULE_VERSION,
      rule_activation_status: "candidate_unactivated",
      formal_sign_status: "blocked_rule_not_activated",
      formal_score_status: "not_available",
      formal_risk_classification_status: "not_available",
      diagnosis_status: "blocked",
      care_decision_status: "blocked",
      nutrition_follow_up_status: "not_configured",
      nutrition_referral_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      offline_sync_status: "not_configured",
      notification_status: "not_configured",
    },
  });
}
