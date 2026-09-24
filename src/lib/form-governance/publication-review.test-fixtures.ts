import type { PublicationReviewHistory, PublicationReviewInput, PublicationReviewRequest } from "./publication-review";
export const reviewIds = { version: "ac000000-0000-4000-8000-000000000001", request: "ac000000-0000-4000-8000-000000000002", actor: "ac000000-0000-4000-8000-000000000003", branch: "ac000000-0000-4000-8000-000000000004", event: "ac000000-0000-4000-8000-000000000005", other: "ac000000-0000-4000-8000-000000000006" };
export function reviewPayload() { return { formKey: "tenant.custom.review", name: "合成送審表單", category: "行政表單" as const, effectiveFrom: "2026-09-23", effectiveTo: null,
  schema: { builder: "tenant-custom.v1" as const, fields: [{ key: "note", label: "當時送審欄位", type: "text" as const, required: true, maxLength: 400 }] } }; }
export function reviewInput(action: PublicationReviewInput["action"] = "request"): PublicationReviewInput {
  return { action, formVersionId: reviewIds.version, requestId: action === "request" ? null : reviewIds.request, baseRevision: action === "request" ? 1 : null, reason: ["withdraw", "return"].includes(action) ? "合成修改原因說明" : null };
}
export function reviewRequest(own = true): PublicationReviewRequest { return {
  id: reviewIds.request, formVersionId: reviewIds.version, branchId: reviewIds.branch, branchName: "合成分支", baseRevision: 1, previousRequestId: null, status: "pending",
  requestedAt: "2026-09-22T08:00:00Z", requesterId: own ? reviewIds.actor : reviewIds.other, requestedByCurrentUser: own,
  formContentHash: "a".repeat(64), payload: reviewPayload(), events: [{ id: reviewIds.event, action: "request", requestId: reviewIds.request,
    formVersionId: reviewIds.version, branchId: reviewIds.branch, actorId: own ? reviewIds.actor : reviewIds.other, byCurrentUser: own,
    reason: null, formContentHash: "a".repeat(64), createdAt: "2026-09-22T08:00:00Z" }],
}; }
export function reviewHistory(requests: PublicationReviewRequest[] = []): PublicationReviewHistory { return {
  formVersionId: reviewIds.version, currentDraftRevision: requests.length ? requests[0]!.baseRevision : 1, currentStatus: "draft",
  currentDraft: requests[0]?.status === "pending" ? null : reviewPayload(), requests, total: requests.length, truncated: false,
}; }
export function reviewReceipt(action: PublicationReviewInput["action"] = "request", replayed = false) {
  const input = reviewInput(action);
  return { event: { ...reviewRequest().events[0]!, action, reason: input.reason }, requestStatus: ({ request: "pending", approve: "approved", withdraw: "withdrawn", return: "returned" } as const)[action], replayed };
}
export function reviewEnvelope(data: unknown) { return { requestId: reviewIds.other, status: "ok", data, errors: [] }; }
