import { buildDemoFormGovernanceSnapshot } from "./demo";
import { parsePublicationReviewHistory, type PublicationReviewHistory, type PublicationReviewRequest } from "./publication-review";
import type { CustomDraftPayload, CustomFormField } from "./custom-draft";
import type { FormGovernanceVersion } from "./types";

/** Static synthetic read-only data for the existing three demo versions only.
 * Never a fallback for live data, API authorization, or persisted receipts. */
export function buildDemoPublicationReview(version: FormGovernanceVersion): PublicationReviewHistory | null {
  const known = buildDemoFormGovernanceSnapshot().versions.find(item => item.id === version.id && item.formKey === "tenant.custom.care_diary");
  if (!known || version.formKey !== known.formKey || version.name !== known.name) return null;
  const fields: CustomFormField[] = [
    { key: "service_date", label: "合成服務日期", type: "date", required: true },
    { key: "participated", label: "合成活動參與確認", type: "boolean", required: true },
    { key: "observation", label: "合成照顧觀察", type: "text", required: false, maxLength: 400 },
    { key: "participation", label: "合成參與程度", type: "select", required: true, options: ["自行參與", "需協助", "本次未參與"] },
  ];
  const payload: CustomDraftPayload = { formKey: known.formKey, name: known.name, category: "照顧表單", effectiveFrom: known.effectiveFrom, effectiveTo: known.effectiveTo,
    schema: { builder: "tenant-custom.v1", fields: fields.slice(0, known.schemaFieldCount) } };
  const requests: PublicationReviewRequest[] = [];
  if (known.publication) {
    const evidence = known.publication;
    const actor = "82500000-0000-4000-8000-000000000001", other = "82500000-0000-4000-8000-000000000002";
    const request: PublicationReviewRequest = {
      id: evidence.id, formVersionId: known.id, branchId: "22222222-2222-4222-8222-222222222222", branchName: "合成展示分支",
      baseRevision: 1, previousRequestId: null, status: evidence.status, requestedAt: evidence.requestedAt,
      requesterId: evidence.requestedByCurrentUser ? actor : other, requestedByCurrentUser: evidence.requestedByCurrentUser,
      formContentHash: known.contentHash ?? "d".repeat(64), payload, events: [],
    };
    request.events.push({ id: evidence.id.replace(/^822/, "823"), action: "request", requestId: request.id, formVersionId: known.id,
      branchId: request.branchId, actorId: request.requesterId, byCurrentUser: request.requestedByCurrentUser, reason: null,
      formContentHash: request.formContentHash, createdAt: request.requestedAt });
    if (evidence.status === "approved") request.events.push({ ...request.events[0]!, id: evidence.id.replace(/^822/, "824"), action: "approve",
      actorId: evidence.approvedByCurrentUser ? actor : other, byCurrentUser: evidence.approvedByCurrentUser, createdAt: evidence.approvedAt! });
    requests.push(request);
  }
  return parsePublicationReviewHistory({ formVersionId: known.id, currentDraftRevision: 1, currentStatus: known.status,
    currentDraft: known.status === "draft" && !known.publication ? payload : null, requests, total: requests.length, truncated: false }, known.id);
}
