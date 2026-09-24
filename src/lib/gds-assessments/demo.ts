import { projectGdsAssessmentSnapshot } from "./projection";
import {
  GDS_ITEM_IDS,
  GDS_RULE_VERSION,
  GDS_SCORED_NO_ITEM_IDS,
  GDS_SCORED_YES_ITEM_IDS,
  type GdsAnswers,
  type GdsRuleSnapshot,
} from "./types";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "12000000-0000-4000-8000-000000000012";
const AUTHOR_NAME = "林評估人員（合成）";

export const GDS_DEMO_RULE_SNAPSHOT: GdsRuleSnapshot = {
  version_id: GDS_RULE_VERSION,
  instrument: "gds_15",
  rule_revision: 1,
  activation_status: "candidate_unactivated",
  activated_at: null,
  review_required: true,
  formal_use_permitted: false,
  item_ids: [...GDS_ITEM_IDS],
  answer_values: ["yes", "no"],
  scored_yes_item_ids: [...GDS_SCORED_YES_ITEM_IDS],
  scored_no_item_ids: [...GDS_SCORED_NO_ITEM_IDS],
  missing_policy: "no_preview_and_never_zero",
  not_applicable_policy: "no_preview_and_never_zero",
  strict_complete_required: true,
  candidate_bands: [
    { key: "reference_0_4", min: 0, max: 4 },
    { key: "elevated_5_8", min: 5, max: 8 },
    { key: "high_9_11", min: 9, max: 11 },
    { key: "very_high_12_15", min: 12, max: 15 },
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

export function candidateAnswers(points: number): GdsAnswers {
  const scoredYes = new Set<string>(GDS_SCORED_YES_ITEM_IDS);
  let remaining = points;
  return Object.fromEntries(GDS_ITEM_IDS.map((id) => {
    const pointAnswer = scoredYes.has(id) ? "yes" : "no";
    const zeroAnswer = pointAnswer === "yes" ? "no" : "yes";
    const value = remaining > 0 ? pointAnswer : zeroAnswer;
    if (remaining > 0) remaining -= 1;
    return [id, { state: "answered", value }];
  })) as unknown as GdsAnswers;
}

function incompleteAnswers(): GdsAnswers {
  return {
    ...candidateAnswers(4),
    gds_04: { state: "missing" },
    gds_12: {
      state: "not_applicable",
      reason: "合成示例：本次無法確認此題答案。",
    },
  };
}

export function buildDemoGdsAssessmentSnapshot() {
  const now = new Date();
  const today = taipeiDate(now);
  const prior = daysFrom(now, -18);
  const generatedAt = now.toISOString();
  const ruleHash = "b".repeat(64);
  const answersV1 = candidateAnswers(4);
  const answersV2 = candidateAnswers(5);
  const incomplete = incompleteAnswers();
  const commonV2 = {
    assessed_on: today,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: answersV2,
    rule_version_id: GDS_RULE_VERSION,
    rule_snapshot: GDS_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "candidate_complete" as const,
    preview_candidate_points: 5,
    preview_band_key: "elevated_5_8",
  };
  const commonIncomplete = {
    assessed_on: prior,
    author_user_id: AUTHOR_ID,
    author_display_name: AUTHOR_NAME,
    service_status_at_assessment: "active" as const,
    answers: incomplete,
    rule_version_id: GDS_RULE_VERSION,
    rule_snapshot: GDS_DEMO_RULE_SNAPSHOT,
    rule_snapshot_hash: ruleHash,
    governance_status: "candidate_unactivated" as const,
    preview_status: "incomplete" as const,
    preview_candidate_points: null,
    preview_band_key: null,
  };

  return projectGdsAssessmentSnapshot({
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
              rule_version_id: GDS_RULE_VERSION,
              rule_snapshot: GDS_DEMO_RULE_SNAPSHOT,
              rule_snapshot_hash: ruleHash,
              governance_status: "candidate_unactivated",
              preview_status: "candidate_complete",
              preview_candidate_points: 4,
              preview_band_key: "reference_0_4",
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
          preview_candidate_points: null,
          preview_band_key: null,
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
      rule_version_id: GDS_RULE_VERSION,
      rule_activation_status: "candidate_unactivated",
      formal_sign_status: "blocked_rule_not_activated",
      formal_score_status: "not_available",
      formal_risk_status: "not_available",
      care_decision_status: "blocked",
      attachment_status: "not_configured",
      export_status: "not_configured",
      offline_sync_status: "not_configured",
      notification_status: "not_configured",
    },
  });
}
