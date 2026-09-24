import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";

export const lifecycleActionSchema = z.enum(["clone", "request_retirement", "approve_retirement", "reject_retirement"]);
const reason = z.string().trim().min(5).max(1000).refine(value => !/[<>\u0000-\u001f\u007f]/u.test(value));
export const lifecycleInputSchema = z.object({ action: lifecycleActionSchema, formVersionId: z.uuid(), requestId: z.uuid().nullable(), reason }).strict()
  .refine(value => ["approve_retirement", "reject_retirement"].includes(value.action) === (value.requestId !== null));
export type LifecycleInput = z.infer<typeof lifecycleInputSchema>;
const day = z.iso.date();
export const lifecycleEventSchema = z.object({ id: z.uuid(), formVersionId: z.uuid(), branchId: z.uuid(), branchName: z.string().min(1).max(240), action: lifecycleActionSchema,
  requestId: z.uuid().nullable(), newVersionId: z.uuid().nullable(), actorId: z.uuid(), reason,
  effectiveThrough: day.nullable(), createdAt: z.iso.datetime({ offset: true }), byCurrentUser: z.boolean(),
}).strict().refine(value => (value.action === "clone") === (value.newVersionId !== null)
  && (value.action === "approve_retirement") === (value.effectiveThrough !== null)
  && ["approve_retirement", "reject_retirement"].includes(value.action) === (value.requestId !== null));
export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;
const receiptSchema = z.object({ event: lifecycleEventSchema, replayed: z.boolean() }).strict();
const historySchema = z.object({ formVersionId: z.uuid(), events: z.array(lifecycleEventSchema).max(100), total: z.number().int().nonnegative(), truncated: z.boolean() }).strict();
export type LifecycleHistory = z.infer<typeof historySchema>;

export function parseLifecycleInput(value: unknown, key: string | null) {
  const parsed = lifecycleInputSchema.safeParse(value); const parsedKey = z.uuid().safeParse(key);
  if (!parsed.success || !parsedKey.success) throw new IntegrationError("INVALID_FORM_LIFECYCLE", "請確認表單、操作及至少五字的原因。", 400);
  return { input: parsed.data, idempotencyKey: parsedKey.data };
}
function invalidResult() { return new IntegrationError("FORM_LIFECYCLE_RESULT_INVALID", "結果尚未完整確認，請保留視窗並以原操作重試。", 409); }
export function parseLifecycleReceipt(value: unknown, expected: LifecycleInput, actorId?: string, branchId?: string) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw invalidResult();
  const event = parsed.data.event;
  if (event.formVersionId !== expected.formVersionId || event.action !== expected.action || event.requestId !== expected.requestId
    || event.reason !== expected.reason || !event.byCurrentUser || (actorId && event.actorId !== actorId) || (branchId && event.branchId !== branchId)) throw invalidResult();
  return parsed.data;
}
export function parseLifecycleHistory(value: unknown, versionId: string) {
  const parsed = historySchema.safeParse(value);
  if (!parsed.success || parsed.data.formVersionId !== versionId || parsed.data.events.some(e => e.formVersionId !== versionId)
    || new Set(parsed.data.events.map(e => e.id)).size !== parsed.data.events.length || parsed.data.total < parsed.data.events.length
    || parsed.data.truncated !== (parsed.data.total > 100) || parsed.data.events.length !== Math.min(parsed.data.total, 100)) throw invalidResult();
  return parsed.data;
}
export function parseLifecycleWriteResponse(value: unknown, expected: LifecycleInput, status: number) {
  const envelope = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: z.object({ receipt: receiptSchema, persisted: z.literal(true), demo: z.literal(false) }).strict(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!envelope.success) throw invalidResult();
  const result = parseLifecycleReceipt(envelope.data.data.receipt, expected);
  if (status !== (result.replayed ? 200 : 201)) throw invalidResult();
  return result;
}
export function parseLifecycleReadResponse(value: unknown, versionId: string) {
  const envelope = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: z.object({ history: historySchema, demo: z.literal(false) }).strict(), errors: z.tuple([]) }).strict().safeParse(value);
  if (!envelope.success) throw invalidResult();
  return parseLifecycleHistory(envelope.data.data.history, versionId);
}
export function pendingRetirement(events: LifecycleEvent[]) {
  return events.find(e => e.action === "request_retirement" && !events.some(decision => decision.requestId === e.id));
}
