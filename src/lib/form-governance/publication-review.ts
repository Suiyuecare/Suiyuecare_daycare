import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";
import { customDraftPayloadSchema } from "./custom-draft";

export const publicationReviewActionSchema = z.enum(["request", "approve", "withdraw", "return"]);
export const publicationReviewStatusSchema = z.enum(["pending", "approved", "withdrawn", "returned"]);
const reason = z.string().trim().min(5).max(1000).refine(value => !/[<>\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const publicationReviewInputSchema = z.object({
  action: publicationReviewActionSchema, formVersionId: z.uuid(), requestId: z.uuid().nullable(),
  baseRevision: z.number().int().positive().nullable(), reason: reason.nullable(),
}).strict().refine(value => (value.action === "request") === (value.requestId === null)
  && (value.action === "request") === (value.baseRevision !== null)
  && ["withdraw", "return"].includes(value.action) === (value.reason !== null));
export type PublicationReviewInput = z.infer<typeof publicationReviewInputSchema>;
export const publicationReviewEventSchema = z.object({
  id: z.uuid(), action: publicationReviewActionSchema, requestId: z.uuid(), formVersionId: z.uuid(),
  branchId: z.uuid(), actorId: z.uuid(), byCurrentUser: z.boolean(), reason: reason.nullable(),
  formContentHash: hash, createdAt: z.iso.datetime({ offset: true }),
}).strict().refine(value => ["withdraw", "return"].includes(value.action) === (value.reason !== null));
export type PublicationReviewEvent = z.infer<typeof publicationReviewEventSchema>;
const receiptSchema = z.object({ event: publicationReviewEventSchema, requestStatus: publicationReviewStatusSchema, replayed: z.boolean() }).strict();
const requestSchema = z.object({
  id: z.uuid(), formVersionId: z.uuid(), branchId: z.uuid(), branchName: z.string().min(1).max(240),
  baseRevision: z.number().int().positive(), previousRequestId: z.uuid().nullable(), status: publicationReviewStatusSchema,
  requestedAt: z.iso.datetime({ offset: true }), requesterId: z.uuid(), requestedByCurrentUser: z.boolean(),
  formContentHash: hash, payload: customDraftPayloadSchema, events: z.array(publicationReviewEventSchema).max(2),
}).strict();
const historySchema = z.object({
  formVersionId: z.uuid(), currentDraftRevision: z.number().int().positive(), currentStatus: z.enum(["draft", "published", "retired"]),
  currentDraft: customDraftPayloadSchema.nullable(), requests: z.array(requestSchema).max(100), total: z.number().int().nonnegative(), truncated: z.boolean(),
}).strict();
export type PublicationReviewHistory = z.infer<typeof historySchema>;
export type PublicationReviewRequest = PublicationReviewHistory["requests"][number];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function hasPublicationDraftChanges(current: unknown, frozen: unknown) {
  return JSON.stringify(canonical(current)) !== JSON.stringify(canonical(frozen));
}
const actionStatus = { request: "pending", approve: "approved", withdraw: "withdrawn", return: "returned" } as const;
function invalid() { return new IntegrationError("PUBLICATION_REVIEW_RESULT_INVALID", "操作結果尚未完整確認，請保留內容並以原操作重試。", 409); }
export function parsePublicationReviewInput(value: unknown, key: string | null) {
  const input = publicationReviewInputSchema.safeParse(value); const parsedKey = z.uuid().safeParse(key);
  if (!input.success || !parsedKey.success) throw new IntegrationError("INVALID_PUBLICATION_REVIEW", "請確認版本、操作與原因；撤回或退回至少需要五字說明。", 400);
  return { input: input.data, idempotencyKey: parsedKey.data };
}
export function parsePublicationReviewReceipt(value: unknown, expected: PublicationReviewInput, actorId?: string, branchId?: string) {
  const result = receiptSchema.safeParse(value);
  if (!result.success) throw invalid();
  const { event, replayed, requestStatus } = result.data;
  if (event.formVersionId !== expected.formVersionId || event.action !== expected.action || event.reason !== expected.reason
    || (expected.requestId !== null && event.requestId !== expected.requestId) || !event.byCurrentUser
    || (actorId && event.actorId !== actorId) || (branchId && event.branchId !== branchId)
    || (expected.action !== "request" || !replayed ? requestStatus !== actionStatus[expected.action] : false)) throw invalid();
  return result.data;
}
export function parsePublicationReviewHistory(value: unknown, versionId: string) {
  const result = historySchema.safeParse(value);
  if (!result.success) throw invalid();
  const history = result.data;
  if (history.formVersionId !== versionId || history.requests.length !== Math.min(history.total, 100)
    || history.truncated !== (history.total > 100) || new Set(history.requests.map(item => item.id)).size !== history.requests.length) throw invalid();
  const ids = new Set<string>();
  for (const [index, request] of history.requests.entries()) {
    if (request.formVersionId !== versionId || request.baseRevision > history.currentDraftRevision
      || (index > 0 && request.status === "pending") || !request.payload.effectiveFrom
      || (index > 0 && Date.parse(request.requestedAt) > Date.parse(history.requests[index - 1]!.requestedAt))) throw invalid();
    if (request.events.filter(event => event.action === "request").length !== 1
      || request.events.length !== (request.status === "pending" ? 1 : 2)
      || (index + 1 < history.requests.length && (request.previousRequestId !== history.requests[index + 1]!.id
        || request.baseRevision <= history.requests[index + 1]!.baseRevision))) throw invalid();
    for (const event of request.events) {
      if (ids.has(event.id) || event.formVersionId !== versionId || event.requestId !== request.id || event.formContentHash !== request.formContentHash
        || Date.parse(event.createdAt) < Date.parse(request.requestedAt)
        || (event.action === "request" && (event.actorId !== request.requesterId || event.byCurrentUser !== request.requestedByCurrentUser
          || event.branchId !== request.branchId || Date.parse(event.createdAt) !== Date.parse(request.requestedAt)))
        || (event.action === "withdraw" && event.actorId !== request.requesterId)
        || (["approve", "return"].includes(event.action) && event.actorId === request.requesterId)
        || (event.action !== "request" && actionStatus[event.action] !== request.status)) throw invalid();
      ids.add(event.id);
    }
  }
  const latest = history.requests[0];
  if ((history.currentDraft !== null) !== (history.currentStatus === "draft" && latest?.status !== "pending")
    || (latest?.status === "pending" && history.currentStatus !== "draft")
    || (latest?.status === "approved" && history.currentStatus === "draft")
    || (history.currentStatus !== "draft" && latest?.status !== "approved")
    || (history.currentDraft && latest && (history.currentDraft.formKey !== latest.payload.formKey
      || history.currentDraft.name !== latest.payload.name || history.currentDraft.category !== latest.payload.category))) throw invalid();
  return history;
}
export function parsePublicationReviewReadResponse(value: unknown, versionId: string) {
  const result = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: z.object({ history: historySchema, demo: z.literal(false) }).strict(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!result.success) throw invalid();
  return parsePublicationReviewHistory(result.data.data.history, versionId);
}
export function parsePublicationReviewWriteResponse(value: unknown, input: PublicationReviewInput, status: number) {
  const result = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: z.object({ receipt: receiptSchema, persisted: z.literal(true), demo: z.literal(false) }).strict(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!result.success) throw invalid();
  const receipt = parsePublicationReviewReceipt(result.data.data.receipt, input);
  if (status !== (receipt.replayed ? 200 : 201)) throw invalid();
  return receipt;
}
