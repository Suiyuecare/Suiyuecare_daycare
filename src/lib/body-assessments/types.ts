export const BODY_AREAS = ["head", "neck", "chest", "abdomen", "back", "left_arm", "right_arm", "left_leg", "right_leg", "other"] as const;
export const BODY_AREA_LABELS: Record<(typeof BODY_AREAS)[number], string> = {
  head: "頭部", neck: "頸部", chest: "胸部", abdomen: "腹部", back: "背部",
  left_arm: "左上肢", right_arm: "右上肢", left_leg: "左下肢", right_leg: "右下肢", other: "其他部位（於描述註明）",
};
export const BODY_OBSERVATION_STATES = ["normal", "abnormal", "missing", "not_applicable"] as const;
export const BODY_RECORD_STATES = ["draft", "signed", "corrected"] as const;
export const BODY_STATE_LABELS = { normal: "正常", abnormal: "異常", missing: "未評估／缺值", not_applicable: "不適用" };
export type BodyObservation = {
  area: (typeof BODY_AREAS)[number]; state: (typeof BODY_OBSERVATION_STATES)[number];
  description: string | null; reason: string | null; disposition: string | null;
};
export type BodyAssessmentFilters = { clientId: string | null; state: (typeof BODY_RECORD_STATES)[number] | "all" };
export type BodyAssessmentVersion = {
  version_id: string; assessment_key: string; version: number; previous_version_id: string | null;
  content_hash: string; record_state: (typeof BODY_RECORD_STATES)[number]; client_id: string;
  client_display_name: string; observed_at: string; observations: BodyObservation[];
  instrument: "manual_nonstandard_body_observation_v1"; reason: string;
  actor_user_id: string; actor_display_name: string; created_at: string;
  signed_at: string | null; signed_by: string | null; signer_role_keys: string[] | null;
  signature_purpose: string | null; signature_reauth_challenge_id: string | null;
};
export type BodyAssessmentRecord = BodyAssessmentVersion & { history: BodyAssessmentVersion[]; historyTotal: number; historyTruncated: boolean };
export type BodyAssessmentSnapshot = {
  organizationId: string; branchId: string; generatedAt: string; staleAfter: string;
  filters: BodyAssessmentFilters; records: BodyAssessmentRecord[]; matchingTotal: number;
  recordsTruncated: boolean; clients: { clientId: string; displayName: string }[];
  clientsTruncated: boolean; clientTotal: number; attachmentStatus: "not_configured"; demo: boolean;
};
