import { projectSpmsqAssessmentSnapshot } from "./projection";
import {
  SPMSQ_ITEM_IDS,
  SPMSQ_RULE_VERSION,
  type SpmsqAnswers,
  type SpmsqRuleSnapshot,
} from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "11000000-0000-4000-8000-000000000011";
const AUTHOR_NAME = "林評估人員（合成）";

export const SPMSQ_DEMO_RULE_SNAPSHOT: SpmsqRuleSnapshot = {
  version_id: SPMSQ_RULE_VERSION,
  instrument: "spmsq",
  rule_revision: 1,
  activation_status: "candidate_unactivated",
  activated_at: null,
  review_required: true,
  formal_use_permitted: false,
  item_ids: [...SPMSQ_ITEM_IDS],
  answer_weights: { correct: 0, incorrect: 1 },
  missing_policy: "no_preview_and_never_zero",
  not_applicable_policy: "no_preview_and_never_zero",
  education_adjustment: {
    grade_school_or_less: -1,
    middle_or_high_school: 0,
    beyond_high_school: 1,
    clamp_min: 0,
    clamp_max: 10,
  },
  cultural_adjustment: {
    status: "not_configured",
    numeric_effect: 0,
    policy: "context_is_preserved_but_never_changes_trial_preview",
  },
  candidate_bands: [
    { key: "reference_0_2_errors", min: 0, max: 2 },
    { key: "mild_3_4_errors", min: 3, max: 4 },
    { key: "moderate_5_7_errors", min: 5, max: 7 },
    { key: "high_8_10_errors", min: 8, max: 10 },
  ],
  disclaimer: "Candidate trial preview only; not a diagnosis, official result, signature, or care decision.",
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

function answeredAnswers(incorrect: readonly number[]): SpmsqAnswers {
  const incorrectSet = new Set(incorrect);
  return Object.fromEntries(SPMSQ_ITEM_IDS.map((id, index) => [
    id,
    { state: "answered", value: incorrectSet.has(index + 1)
      ? "incorrect" : "correct" },
  ])) as unknown as SpmsqAnswers;
}

function incompleteAnswers(): SpmsqAnswers {
  return {
    ...answeredAnswers([1, 2]),
    spmsq_04: { state: "missing" },
    spmsq_08: {
      state: "not_applicable",
      reason: "合成示例：本次尚無足夠語言脈絡判斷。",
    },
  };
}

export function buildDemoSpmsqAssessmentSnapshot() {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = daysFrom(now, -18);
  const generatedAt = now.toISOString();
  const ruleHash = "a".repeat(64);
  const answersV1 = answeredAnswers([1, 2]);
  const answersV2 = answeredAnswers([1, 2, 3]);
  const incomplete = incompleteAnswers();
  const commonV2 = {
    assessed_on: today,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: answersV2,
    education_context: {
      state: "answered" as const,
      value: "beyond_high_school" as const,
    },
    cultural_context: {
      state: "recorded" as const,
      note: "合成示例：以熟悉語言確認作答；此欄不改變候選試算。",
    },
    rule_version_id: SPMSQ_RULE_VERSION,
    rule_snapshot: SPMSQ_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "candidate_complete" as const,
    preview_raw_errors: 3,
    preview_adjusted_errors: 4,
    preview_band_key: "mild_3_4_errors",
  };
  const commonIncomplete = {
    assessed_on: prior,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: incomplete,
    education_context: { state: "missing" as const },
    cultural_context: {
      state: "recorded" as const,
      note: "合成示例：需補充文化與語言脈絡，且不進行數值調整。",
    },
    rule_version_id: SPMSQ_RULE_VERSION,
    rule_snapshot: SPMSQ_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "incomplete" as const,
    preview_raw_errors: null,
    preview_adjusted_errors: null,
    preview_band_key: null,
  };

  return projectSpmsqAssessmentSnapshot({
    expectedOrganizationId: ORGANIZATION_ID,
    expectedBranchId: BRANCH_ID,
    demo: true,
    row: {
      organization_id: ORGANIZATION_ID,
      branch_id: BRANCH_ID,
      generated_at: generatedAt,
      items: [
        {
          client_id: "11000000-0000-4000-8000-000000000001",
          client_display_name: "合成個案 A",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "11100000-0000-4000-8000-000000000002",
          assessment_key: "11200000-0000-4000-8000-000000000001",
          assessment_version: 2,
          record_state: "draft_preview",
          ...commonV2,
          created_at: generatedAt,
          version_history: [
            {
              version_id: "11100000-0000-4000-8000-000000000002",
              assessment_version: 2,
              record_state: "draft_preview",
              ...commonV2,
              created_at: generatedAt,
            },
            {
              version_id: "11100000-0000-4000-8000-000000000001",
              assessment_version: 1,
              record_state: "draft_preview",
              assessed_on: prior,
              author_user_id: AUTHOR_ID,
              author_display_name: AUTHOR_NAME,
              service_status_at_assessment: "active",
              answers: answersV1,
              education_context: {
                state: "answered",
                value: "middle_or_high_school",
              },
              cultural_context: { state: "missing" },
              rule_version_id: SPMSQ_RULE_VERSION,
              rule_snapshot: SPMSQ_DEMO_RULE_SNAPSHOT,
              rule_snapshot_hash: ruleHash,
              governance_status: "candidate_unactivated",
              preview_status: "candidate_complete",
              preview_raw_errors: 2,
              preview_adjusted_errors: 2,
              preview_band_key: "reference_0_2_errors",
              created_at: new Date(now.getTime() - 900_000).toISOString(),
            },
          ],
          version_history_total: 2,
        },
        {
          client_id: "11000000-0000-4000-8000-000000000002",
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
          education_context: null,
          cultural_context: null,
          rule_version_id: null,
          rule_snapshot: null,
          rule_snapshot_hash: null,
          governance_status: null,
          preview_status: null,
          preview_raw_errors: null,
          preview_adjusted_errors: null,
          preview_band_key: null,
          created_at: null,
          version_history: [],
          version_history_total: 0,
        },
        {
          client_id: "11000000-0000-4000-8000-000000000003",
          client_display_name: "合成個案 C",
          service_status: "active",
          admitted_on: prior,
          ended_on: null,
          version_id: "11100000-0000-4000-8000-000000000003",
          assessment_key: "11200000-0000-4000-8000-000000000002",
          assessment_version: 1,
          record_state: "draft_preview",
          ...commonIncomplete,
          created_at: new Date(now.getTime() - 1_800_000).toISOString(),
          version_history: [{
            version_id: "11100000-0000-4000-8000-000000000003",
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
        { client_id: "11000000-0000-4000-8000-000000000001", display_name: "合成個案 A", service_status: "active", admitted_on: prior, ended_on: null },
        { client_id: "11000000-0000-4000-8000-000000000002", display_name: "合成個案 B", service_status: "suspended", admitted_on: prior, ended_on: null },
        { client_id: "11000000-0000-4000-8000-000000000003", display_name: "合成個案 C", service_status: "active", admitted_on: prior, ended_on: null },
      ],
      client_total: 3,
      client_options_truncated: false,
      rule_version_id: SPMSQ_RULE_VERSION,
      rule_activation_status: "candidate_unactivated",
      formal_sign_status: "blocked_rule_not_activated",
      formal_score_status: "not_available",
      care_decision_status: "blocked",
      cultural_adjustment_status: "not_configured_context_only",
      attachment_status: "not_configured",
      export_status: "not_configured",
      offline_sync_status: "not_configured",
    },
  });
}
