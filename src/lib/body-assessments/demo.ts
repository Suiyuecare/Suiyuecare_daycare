import { projectBodyAssessmentSnapshot } from "./projection";
import type { BodyAssessmentFilters, BodyAssessmentVersion } from "./types";
export const BODY_DEMO_ORGANIZATION = "19000000-0000-4000-8000-000000000001";
export const BODY_DEMO_BRANCH = "19000000-0000-4000-8000-000000000002";
const clientId = "19000000-0000-4000-8000-000000000003";
export function buildDemoBodyAssessmentSnapshot(filters: BodyAssessmentFilters) {
  const now = new Date(); const earlier = new Date(now.getTime() - 3_600_000).toISOString();
  const original: BodyAssessmentVersion = { version_id: "19000000-0000-4000-8000-000000000004",
    assessment_key: "19000000-0000-4000-8000-000000000005", version: 1, previous_version_id: null,
    content_hash: "a".repeat(64), record_state: "draft", client_id: clientId, client_display_name: "合成示範個案甲",
    observed_at: earlier, observations: [
      { area: "left_arm", state: "abnormal", description: "合成示例：左前臂局部泛紅，範圍由工作人員描述。", reason: null, disposition: "合成示例：已由值班人員人工確認並安排後續觀察。" },
      { area: "back", state: "missing", description: null, reason: "合成示例：個案本次不願受評，保留待評。", disposition: null },
    ], instrument: "manual_nonstandard_body_observation_v1", reason: "合成展示初稿",
    actor_user_id: "19000000-0000-4000-8000-000000000006", actor_display_name: "合成示範工作人員",
    created_at: earlier, signed_at: null, signed_by: null, signer_role_keys: null,
    signature_purpose: null, signature_reauth_challenge_id: null };
  const signed: BodyAssessmentVersion = { ...original, version_id: "19000000-0000-4000-8000-000000000007",
    previous_version_id: original.version_id, version: 2, content_hash: "b".repeat(64), record_state: "signed",
    reason: "本人確認已核對所選部位的人工觀察與處置", created_at: now.toISOString(), signed_at: now.toISOString(),
    signed_by: original.actor_user_id, signer_role_keys: ["nurse"], signature_purpose: "人工身體觀察簽署",
    signature_reauth_challenge_id: "19000000-0000-4000-8000-000000000008" };
  const records = (!filters.clientId || filters.clientId === clientId) && (filters.state === "all" || filters.state === "signed")
    ? [{ ...signed, history: [original], history_total: 1 }] : [];
  return projectBodyAssessmentSnapshot({ row: { organization_id: BODY_DEMO_ORGANIZATION, branch_id: BODY_DEMO_BRANCH,
    generated_at: now.toISOString(), records, matching_total: records.length, records_truncated: false,
    clients: [{ client_id: clientId, display_name: original.client_display_name }], client_total: 1, clients_truncated: false,
    attachment_status: "not_configured" }, expectedOrganizationId: BODY_DEMO_ORGANIZATION,
    expectedBranchId: BODY_DEMO_BRANCH, filters, demo: true });
}
