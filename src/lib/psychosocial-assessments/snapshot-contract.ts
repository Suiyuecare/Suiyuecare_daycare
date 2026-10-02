import { projectPsychosocialAssessmentSnapshot } from "./projection";
import type { PsychosocialAssessmentSnapshot } from "./types";

function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`), snake(item)]));
  return value;
}

/** Reuse the production projection, never treat a rendered list as authority.
 * Unexposed option totals use only the minimum consistent truncation value;
 * they are not displayed, persisted, or used as business counts. */
export function normalizePsychosocialSnapshot(snapshot: PsychosocialAssessmentSnapshot,
  scope: { organizationId: string; branchId: string }) {
  const exactKeys = (value: unknown, names: readonly string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== names.length ||
      Object.keys(value).some((key) => !names.includes(key))) throw new Error("INVALID_PSYCHOSOCIAL_SNAPSHOT");
  };
  exactKeys(snapshot, ["organizationId", "branchId", "generatedAt", "staleAfter", "items", "itemTotal", "matchingTotal", "itemsTruncated", "metrics",
    "clientOptions", "clientOptionsTruncated", "responsibleOptions", "responsibleOptionsTruncated", "assessmentMethodStatus", "formPublicationStatus", "dueRuleStatus",
    "scoreStatus", "diagnosisStatus", "attachmentStatus", "exportStatus", "offlineSyncStatus", "demo"]);
  exactKeys(snapshot.metrics, ["assessed", "notAssessed", "due", "upcoming", "drafts", "completed"]);
  if (typeof snapshot.demo !== "boolean" || typeof snapshot.clientOptionsTruncated !== "boolean" || typeof snapshot.responsibleOptionsTruncated !== "boolean") throw new Error("INVALID_PSYCHOSOCIAL_SNAPSHOT");
  const items = snapshot.items.map((item) => {
    if (typeof item.versionHistoryTruncated !== "boolean") throw new Error("INVALID_PSYCHOSOCIAL_SNAPSHOT");
    const { versionHistoryTruncated: _flag, ...value } = item; void _flag; return snake(value);
  });
  const projected = projectPsychosocialAssessmentSnapshot({
    expectedOrganizationId: scope.organizationId, expectedBranchId: scope.branchId, demo: snapshot.demo,
    row: { organization_id: snapshot.organizationId, branch_id: snapshot.branchId, generated_at: snapshot.generatedAt,
      items, item_total: snapshot.itemTotal, matching_total: snapshot.matchingTotal,
      items_truncated: snapshot.itemsTruncated, assessed_total: snapshot.metrics.assessed,
      not_assessed_total: snapshot.metrics.notAssessed, due_total: snapshot.metrics.due,
      upcoming_total: snapshot.metrics.upcoming, draft_total: snapshot.metrics.drafts,
      completed_total: snapshot.metrics.completed, client_options: snake(snapshot.clientOptions),
      client_total: snapshot.clientOptions.length + Number(snapshot.clientOptionsTruncated),
      client_options_truncated: snapshot.clientOptionsTruncated, responsible_options: snake(snapshot.responsibleOptions),
      responsible_total: snapshot.responsibleOptions.length + Number(snapshot.responsibleOptionsTruncated),
      responsible_options_truncated: snapshot.responsibleOptionsTruncated,
      assessment_method_status: snapshot.assessmentMethodStatus, form_publication_status: snapshot.formPublicationStatus,
      due_rule_status: snapshot.dueRuleStatus, score_status: snapshot.scoreStatus, diagnosis_status: snapshot.diagnosisStatus,
      attachment_status: snapshot.attachmentStatus, export_status: snapshot.exportStatus, offline_sync_status: snapshot.offlineSyncStatus },
  });
  if (projected.staleAfter !== snapshot.staleAfter || new Set(projected.items.map((item) => item.clientId)).size !== projected.items.length ||
    new Set(projected.clientOptions.map((item) => item.clientId)).size !== projected.clientOptions.length ||
    projected.items.some((item, index) => item.versionHistoryTruncated !== snapshot.items[index]!.versionHistoryTruncated)) {
    throw new Error("INVALID_PSYCHOSOCIAL_SNAPSHOT");
  }
  return projected;
}
