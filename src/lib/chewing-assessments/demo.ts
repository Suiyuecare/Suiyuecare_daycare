import { projectChewingAssessmentSnapshot } from "./projection";
import {
  CHEWING_ITEM_IDS,
  CHEWING_OBSERVATION_LABELS,
  CHEWING_RULE_VERSION,
  type ChewingAnswers,
  type ChewingRuleSnapshot,
} from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "12000000-0000-4000-8000-000000000012";
const AUTHOR_NAME = "林評估人員（合成）";

export const CHEWING_DEMO_RULE_SNAPSHOT: ChewingRuleSnapshot = {
  version_id: CHEWING_RULE_VERSION,
  instrument: "manual_unstandardized_chewing_observations",
  rule_revision: 1,
  activation_status: "candidate_unactivated",
  activated_at: null,
  governance_review_required: true,
  formal_use_permitted: false,
  field_ids: [...CHEWING_ITEM_IDS],
  field_definitions: CHEWING_ITEM_IDS.map((id) => ({
    id,
    label: CHEWING_OBSERVATION_LABELS[id],
    data_kind: "manual_presence_observation" as const,
  })),
  answer_values: ["present", "absent"],
  completeness_policy: "all_fields_answered_for_non_clinical_count",
  present_count_policy: "count_present_only_when_complete_non_clinical",
  missing_policy: "no_count_and_never_zero",
  not_applicable_policy: "no_count_and_never_zero",
  formal_tool_status: "not_configured",
  licensed_source_status: "not_configured",
  formal_weights_status: "not_configured",
  formal_scoring_status: "not_configured",
  formal_ability_classification_status: "not_configured",
  disclaimer: "Manual unstandardized chewing observations only. This is not an approved tool, score, ability classification, diagnosis, signature, referral, notification, or care decision.",
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

export function chewingAnswersWithObservedCount(
  observedCount: number,
): ChewingAnswers {
  let remaining = observedCount;
  return Object.fromEntries(CHEWING_ITEM_IDS.map((id) => {
    const value = remaining > 0 ? "present" : "absent";
    if (remaining > 0) remaining -= 1;
    return [id, { state: "answered", value }];
  })) as unknown as ChewingAnswers;
}

function incompleteAnswers(): ChewingAnswers {
  return {
    ...chewingAnswersWithObservedCount(2),
    chewing_observation_04: { state: "missing" },
    chewing_observation_06: {
      state: "not_applicable",
      reason: "合成示例：本次不適用此人工觀察欄位。",
    },
  };
}

export function buildDemoChewingAssessmentSnapshot() {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = daysFrom(now, -18);
  const generatedAt = now.toISOString();
  const ruleHash = "b".repeat(64);
  const contentHashV1 = "c".repeat(64);
  const contentHashV2 = "d".repeat(64);
  const contentHashIncomplete = "e".repeat(64);
  const answersV1 = chewingAnswersWithObservedCount(2);
  const answersV2 = chewingAnswersWithObservedCount(3);
  const incomplete = incompleteAnswers();
  const commonV2 = {
    assessed_on: today,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: answersV2,
    rule_version_id: CHEWING_RULE_VERSION,
    rule_snapshot: CHEWING_DEMO_RULE_SNAPSHOT,
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
    rule_version_id: CHEWING_RULE_VERSION,
    rule_snapshot: CHEWING_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "incomplete" as const,
    preview_observed_count: null,
    content_hash: contentHashIncomplete,
  };

  return projectChewingAssessmentSnapshot({
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
              rule_version_id: CHEWING_RULE_VERSION,
              rule_snapshot: CHEWING_DEMO_RULE_SNAPSHOT,
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
          client_id: "12000000-0000-4000-8000-000000000003",
          client_display_name: "合成個案 C",
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
        { client_id: "12000000-0000-4000-8000-000000000001", display_name: "合成個案 A", service_status: "active", admitted_on: prior, ended_on: null },
        { client_id: "12000000-0000-4000-8000-000000000002", display_name: "合成個案 B", service_status: "suspended", admitted_on: prior, ended_on: null },
        { client_id: "12000000-0000-4000-8000-000000000003", display_name: "合成個案 C", service_status: "active", admitted_on: prior, ended_on: null },
      ],
      client_total: 3,
      client_options_truncated: false,
      rule_version_id: CHEWING_RULE_VERSION,
      rule_activation_status: "candidate_unactivated",
      formal_sign_status: "blocked_rule_not_activated",
      formal_correction_status: "blocked_no_signed_record",
      formal_score_status: "not_available",
      formal_ability_classification_status: "not_available",
      diagnosis_status: "blocked",
      care_decision_status: "blocked",
      nutrition_referral_status: "not_configured",
      swallowing_referral_status: "not_configured",
      attachment_status: "not_configured",
      export_status: "not_configured",
      offline_sync_status: "not_configured",
      notification_status: "not_configured",
    },
  });
}
