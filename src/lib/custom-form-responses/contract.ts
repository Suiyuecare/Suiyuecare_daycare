import { z } from "zod";
import { customFormSchema, type CustomFormSchema } from "@/lib/form-governance/custom-draft";
import { IntegrationError } from "@/lib/integrations/errors";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((v) => {
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v && v >= "1900-01-01" && v <= "2200-12-31";
});
const plain = z.string().trim().min(1).max(500).refine((v) => !/[<>\u0000-\u001f\u007f]/u.test(v));
export const answerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("answered"), value: z.union([z.string().max(4000), z.number().finite(), z.boolean()]) }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("not_applicable"), reason: plain }).strict(),
]);
export type FormAnswer = z.infer<typeof answerSchema>;
export const answersSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u), answerSchema);
export type FormAnswers = z.infer<typeof answersSchema>;
export const responseInputSchema = z.object({
  action: z.enum(["save", "sign", "correct"]), formVersionId: z.uuid(), previousId: z.uuid().nullable(),
  baseRevision: z.number().int().positive().nullable(), serviceDate: date, answers: answersSchema.nullable(), reason: plain.nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.previousId === null) !== (v.baseRevision === null) || (v.action !== "save" && !v.previousId)) ctx.addIssue({ code: "custom", message: "缺少原紀錄版本" });
  if ((v.action === "save") !== (v.answers !== null) || (v.action === "correct") !== (v.reason !== null)) ctx.addIssue({ code: "custom", message: "動作與填答內容不一致" });
});
export type ResponseInput = z.infer<typeof responseInputSchema>;
export const signatureSchema = z.object({ signerId: z.uuid(), signedAt: z.iso.datetime({ offset: true }), challengeId: z.uuid(), roles: z.array(z.string()), aal: z.literal("aal2"), purpose: z.literal("本人確認此機構自訂表單填答") }).strict();
export const responseRecordSchema = z.object({
  id: z.uuid(), recordKey: z.uuid(), revision: z.number().int().positive(), previousId: z.uuid().nullable(), correctionSourceId: z.uuid().nullable(),
  clientId: z.uuid(), formVersionId: z.uuid(), serviceDate: date, status: z.enum(["draft", "signed"]), schema: customFormSchema,
  answers: answersSchema, reason: plain.nullable(), signatureEvidence: signatureSchema.nullable(), contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  actorId: z.uuid(), createdAt: z.iso.datetime({ offset: true }),
}).strict().refine((v) => (v.status === "signed") === (v.signatureEvidence !== null))
  .refine((v) => (v.revision === 1) === (v.previousId === null))
  .refine((v) => !v.signatureEvidence || (v.signatureEvidence.signerId === v.actorId && v.signatureEvidence.signedAt === v.createdAt));
export type ResponseRecord = z.infer<typeof responseRecordSchema>;
export const responseSnapshotSchema = z.object({
  clientId: z.uuid(), forms: z.array(z.object({ id: z.uuid(), name: z.string(), version: z.number().int().positive(), schema: customFormSchema, effectiveFrom: date, effectiveTo: date.nullable() }).strict()),
  records: z.array(responseRecordSchema).max(50), hasMore: z.boolean(), total: z.number().int().nonnegative(), generatedAt: z.iso.datetime({ offset: true }),
}).strict();
export type ResponseSnapshot = z.infer<typeof responseSnapshotSchema>;
export function parseResponseSnapshot(value: unknown, clientId: string) {
  const result = responseSnapshotSchema.safeParse(value);
  if (!result.success || result.data.clientId !== clientId || result.data.records.some((r) => r.clientId !== clientId)
    || new Set(result.data.records.map((r) => r.id)).size !== result.data.records.length || result.data.total < result.data.records.length) {
    throw new IntegrationError("CUSTOM_RESPONSE_INVALID", "表單資料未完整確認，請重新載入。", 503);
  }
  return result.data;
}
export function validateFormAnswers(schema: CustomFormSchema, answers: FormAnswers, complete: boolean) {
  const errors: string[] = [];
  const keys = new Set(schema.fields.map((f) => f.key));
  if (Object.keys(answers).some((k) => !keys.has(k))) errors.push("含不屬於此版本的欄位");
  for (const f of schema.fields) {
    const a = answers[f.key];
    if (!a || a.state !== "answered") {
      if (complete && f.required) errors.push(`${f.label}：必填，不可留白或選不適用`);
      if (a?.state === "not_applicable" && !plain.safeParse(a.reason).success) errors.push(`${f.label}：請填不適用原因`);
      continue;
    }
    const v = a.value;
    const valid = f.type === "text" ? typeof v === "string" && v.trim().length > 0 && v.length <= f.maxLength && !/[\u0000-\u001f\u007f]/u.test(v)
      : f.type === "number" ? typeof v === "number" && Number.isFinite(v) && v >= f.minimum && v <= f.maximum
        : f.type === "date" ? date.safeParse(v).success
          : f.type === "boolean" ? typeof v === "boolean" : typeof v === "string" && f.options.includes(v);
    if (!valid) errors.push(`${f.label}：格式或範圍不符`);
  }
  return errors;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(stable));
  if (value && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(Object.keys(value).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]));
  return JSON.stringify(value);
}
export function parseResponseReceipt(value: unknown, input: ResponseInput, clientId: string, actorId?: string,
  expectedPrevious?: ResponseRecord | null, expectedSchema?: CustomFormSchema) {
  const result = z.object({ record: responseRecordSchema, replayed: z.boolean() }).strict().safeParse(value);
  if (!result.success) throw new IntegrationError("CUSTOM_RESPONSE_UNCERTAIN", "儲存結果尚未確認，請以原操作重試。", 409);
  const r = result.data.record;
  if (r.clientId !== clientId || r.formVersionId !== input.formVersionId || r.serviceDate !== input.serviceDate
    || r.revision !== (input.baseRevision ?? 0) + 1 || r.previousId !== input.previousId
    || r.status !== (input.action === "sign" ? "signed" : "draft") || (actorId && r.actorId !== actorId)
    || (input.action === "save" && stable(r.answers) !== stable(input.answers))
    || (input.action === "correct" && (r.correctionSourceId !== input.previousId || r.reason !== input.reason))
    || validateFormAnswers(r.schema, r.answers, r.status === "signed").length > 0
    || (expectedSchema && stable(r.schema) !== stable(expectedSchema))
    || (expectedPrevious && (expectedPrevious.id !== input.previousId || expectedPrevious.revision !== input.baseRevision
      || expectedPrevious.clientId !== clientId || expectedPrevious.formVersionId !== input.formVersionId
      || expectedPrevious.serviceDate !== input.serviceDate || r.recordKey !== expectedPrevious.recordKey
      || stable(r.schema) !== stable(expectedPrevious.schema)
      || (input.action !== "save" && stable(r.answers) !== stable(expectedPrevious.answers))
      || (input.action !== "correct" && (r.reason !== expectedPrevious.reason || r.correctionSourceId !== expectedPrevious.correctionSourceId))))) {
    throw new IntegrationError("CUSTOM_RESPONSE_UNCERTAIN", "儲存回條與本次操作不一致，請保留內容並以原操作重試。", 409);
  }
  return result.data;
}
