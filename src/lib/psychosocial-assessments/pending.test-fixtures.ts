import type { TenantContext } from "@/lib/domain/types";
import { buildDemoPsychosocialAssessmentSnapshot } from "./demo";
import type { PsychosocialAssessmentListItem, PsychosocialAssessmentSnapshot } from "./types";
import type { PsychosocialInput } from "./pending";
import { parsePsychosocialActionSuccess } from "./parser";
export function psychosocialFixture() {
  const snapshot: PsychosocialAssessmentSnapshot = { ...buildDemoPsychosocialAssessmentSnapshot(), demo: false };
  const context: TenantContext = { organizationId: snapshot.organizationId, organizationName: "合成機構", branchId: snapshot.branchId, branchName: "合成分支",
    userId: "28280000-0000-4000-8000-000000000001", displayName: "合成社工", roles: ["case_manager_social_worker"],
    scopes: ["clients.read", "social_work_records.read", "social_work_records.manage", "social_work_records.sign"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
  const client = snapshot.items.find((item) => item.versionId === null)!;
  const signed = snapshot.items.find((item) => item.recordState === "signed")!;
  const first = signed.versionHistory[0]!;
  const draft: PsychosocialAssessmentListItem = { ...signed, ...first, versionHistory: [first], versionHistoryTotal: 1, versionHistoryTruncated: false };
  const draftSnapshot: PsychosocialAssessmentSnapshot = { ...snapshot, items: snapshot.items.map((item) => item.clientId === draft.clientId ? draft : item),
    metrics: { ...snapshot.metrics, drafts: snapshot.metrics.drafts + 1, completed: snapshot.metrics.completed - 1 } };
  const input: PsychosocialInput = { action: "create_draft", clientId: client.clientId, assessedOn: new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 10),
    reassessmentDueOn: "2200-01-01", dueBasis: "合成：人工會議安排", assessmentSummary: "合成：心理社會紀錄", formVersionReference: "manual-psychosocial-v1",
    dimensions: { family_relationships: { state: "missing", detail: null }, social_support: { state: "missing", detail: null }, social_participation: { state: "missing", detail: null },
      communication_context: { state: "missing", detail: null }, resource_access: { state: "not_applicable", detail: null } }, idempotencyKey: "28700000-0000-4000-8000-000000000091" };
  const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
  return { snapshot, context, scope, client, signed, draft, draftSnapshot, input };
}
export const capabilities = { canManage: true, canSign: true, hasRecentAal2: true };
export function psychosocialReceipt(input: PsychosocialInput, context: TenantContext, target?: PsychosocialAssessmentListItem, overrides: Record<string, unknown> = {}) {
  return { requestId: "28900000-0000-4000-8000-000000000099", status: "ok", errors: [], data: {
    action: input.action, operationId: "28700000-0000-4000-8000-000000000092", clientId: input.clientId,
    assessmentKey: "assessmentKey" in input ? input.assessmentKey : "28500000-0000-4000-8000-000000000091", versionId: "28600000-0000-4000-8000-000000000091",
    assessmentVersion: "expectedVersion" in input ? input.expectedVersion + 1 : 1,
    recordState: input.action === "sign" ? "signed" : input.action === "correct" ? "corrected" : "draft",
    assessedOn: input.action === "sign" ? target!.assessedOn : input.assessedOn, responsibleUserId: target?.responsibleUserId ?? context.userId,
    serviceStatusAtAssessment: target?.serviceStatusAtAssessment ?? "suspended", reassessmentDueOn: input.action === "sign" ? target!.reassessmentDueOn : input.reassessmentDueOn,
    formVersionReference: "manual-psychosocial-v1", committedAt: new Date().toISOString(), replayed: false, persisted: true, demo: false, ...overrides } };
}
export function psychosocialDenial(status = 403) {
  return { requestId: "28900000-0000-4000-8000-000000000099", status: "error", data: null,
    errors: [{ code: status === 409 ? "PSYCHOSOCIAL_VERSION_CONFLICT" : "PSYCHOSOCIAL_NOT_AUTHORIZED", message: "合成拒絕" }] };
}
export function psychosocialCommittedSnapshot(snapshot: PsychosocialAssessmentSnapshot, input: PsychosocialInput,
  result: ReturnType<typeof parsePsychosocialActionSuccess>["data"], source?: PsychosocialAssessmentListItem) {
  const original = source ?? snapshot.items.find((item) => item.clientId === input.clientId)!;
  const content = input.action === "sign" ? original : input;
  const history = { versionId: result.versionId, assessmentVersion: result.assessmentVersion, recordState: result.recordState,
    assessedOn: result.assessedOn, responsibleUserId: result.responsibleUserId, responsibleDisplayName: "合成社工", serviceStatusAtAssessment: result.serviceStatusAtAssessment,
    reassessmentDueOn: result.reassessmentDueOn, dueBasis: content.dueBasis!, dimensions: structuredClone(content.dimensions!), assessmentSummary: content.assessmentSummary!,
    formBasis: "manual_unstandardized" as const, formVersionReference: "manual-psychosocial-v1" as const, correctionReason: input.action === "correct" ? input.correctionReason : null,
    signedAt: result.recordState === "draft" ? null : result.committedAt, signerDisplayName: result.recordState === "draft" ? null : "合成社工", createdAt: result.committedAt };
  const item: PsychosocialAssessmentListItem = { ...original, ...history, assessmentKey: result.assessmentKey, reassessmentDue: false,
    versionHistory: [...(input.action === "create_draft" ? [] : original.versionHistory), history], versionHistoryTotal: result.assessmentVersion, versionHistoryTruncated: false };
  const items = snapshot.items.map((entry) => entry.clientId === item.clientId ? item : entry); const assessed = items.filter((entry) => entry.versionId !== null);
  const generatedAt = new Date(Math.max(Date.parse(result.committedAt), Date.parse(snapshot.generatedAt)) + 1).toISOString();
  return { ...snapshot, items, generatedAt, staleAfter: new Date(Date.parse(generatedAt) + 60000).toISOString(), metrics: {
    assessed: assessed.length, notAssessed: items.length - assessed.length, due: assessed.filter((entry) => entry.reassessmentDue).length,
    upcoming: assessed.filter((entry) => !entry.reassessmentDue).length, drafts: assessed.filter((entry) => entry.recordState === "draft").length,
    completed: assessed.filter((entry) => entry.recordState !== "draft").length } };
}
