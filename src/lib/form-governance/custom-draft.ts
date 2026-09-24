import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

const plainText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[<>\u0000-\u001f\u007f]/u.test(value), "請使用純文字，不可包含標籤或控制字元");
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= "1900-01-01" && value <= "2200-12-31";
});
const baseField = { key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u)
  .refine((key) => !["constructor", "prototype"].includes(key), "此代碼為系統保留字"), label: plainText(120), required: z.boolean() };
const customFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...baseField, type: z.literal("text"), maxLength: z.number().int().min(1).max(4000) }).strict(),
  z.object({ ...baseField, type: z.literal("number"), minimum: z.number().min(-1e9).max(1e9), maximum: z.number().min(-1e9).max(1e9) }).strict(),
  z.object({ ...baseField, type: z.literal("date") }).strict(),
  z.object({ ...baseField, type: z.literal("boolean") }).strict(),
  z.object({ ...baseField, type: z.literal("select"), options: z.array(plainText(80)).min(2).max(20) }).strict(),
]);

export const customFormSchema = z.object({
  builder: z.literal("tenant-custom.v1"),
  fields: z.array(customFieldSchema).min(1).max(40),
}).strict().superRefine((value, context) => {
  const keys = new Set<string>();
  value.fields.forEach((field, index) => {
    if (keys.has(field.key)) context.addIssue({ code: "custom", path: ["fields", index, "key"], message: "欄位代碼不可重複" });
    keys.add(field.key);
    if (field.type === "number" && field.minimum > field.maximum) context.addIssue({ code: "custom", path: ["fields", index, "maximum"], message: "上限不可小於下限" });
    if (field.type === "select" && new Set(field.options).size !== field.options.length) context.addIssue({ code: "custom", path: ["fields", index, "options"], message: "選項不可重複" });
  });
});

export const customDraftPayloadSchema = z.object({
  formKey: z.string().regex(/^tenant\.custom\.[a-z][a-z0-9_]{1,59}$/u),
  name: plainText(120),
  category: z.enum(["照顧表單", "品質表單", "行政表單"]),
  effectiveFrom: calendarDate.nullable(),
  effectiveTo: calendarDate.nullable(),
  schema: customFormSchema,
}).strict().superRefine((value, context) => {
  if (value.effectiveTo && (!value.effectiveFrom || value.effectiveTo < value.effectiveFrom)) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "結束日需有起始日，且不可早於起始日" });
  }
});
export type CustomFormSchema = z.infer<typeof customFormSchema>;
export type CustomFormField = CustomFormSchema["fields"][number];
export type CustomDraftPayload = z.infer<typeof customDraftPayloadSchema>;
export const customDraftDocumentSchema = z.object({
  formVersionId: z.uuid(), definitionId: z.uuid(), revision: z.number().int().positive(),
  version: z.number().int().positive(), status: z.literal("draft"), payload: customDraftPayloadSchema,
}).strict();
export type CustomDraftDocument = z.infer<typeof customDraftDocumentSchema>;

const saveSchema = z.object({
  formVersionId: z.uuid().nullable(), baseRevision: z.number().int().positive().nullable(),
  payload: customDraftPayloadSchema,
}).strict().refine((value) => (value.formVersionId === null) === (value.baseRevision === null));

export function parseCustomDraftSave(value: unknown, key: string | null) {
  const idempotency = z.uuid().safeParse(key);
  if (!idempotency.success) throw new IntegrationError("IDEMPOTENCY_KEY_REQUIRED", "請提供有效的操作識別碼。", 400);
  const parsed = saveSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError("INVALID_CUSTOM_FORM_DRAFT", "草稿欄位、日期或代碼不完整；每張表單限 40 題且不支援計分公式。", 400,
    parsed.error.issues[0]?.path.join(".") || undefined);
  return { ...parsed.data, idempotencyKey: idempotency.data.toLowerCase() };
}

export const customDraftReceiptSchema = z.object({
  formVersionId: z.uuid(), definitionId: z.uuid(), revision: z.number().int().positive(),
  status: z.literal("draft"), replayed: z.boolean(),
}).strict();

export function parseCustomDraftReceipt(value: unknown, expected: { formVersionId: string | null; baseRevision: number | null }) {
  const result = customDraftReceiptSchema.safeParse(value);
  if (!result.success || (expected.formVersionId && result.data.formVersionId !== expected.formVersionId)
    || result.data.revision !== (expected.baseRevision ?? 0) + 1) {
    throw new IntegrationError("CUSTOM_FORM_RESULT_INVALID", "儲存結果尚未完整確認，請以原操作重試。", 409);
  }
  return result.data;
}

export function parseCustomDraftSaveResponse(value: unknown, expected: { formVersionId: string | null; baseRevision: number | null }, httpStatus: number) {
  const envelope = z.object({ requestId: z.uuid(), status: z.literal("ok"),
    data: z.object({ receipt: customDraftReceiptSchema, persisted: z.literal(true), demo: z.literal(false) }).strict(), errors: z.tuple([]),
  }).strict().safeParse(value);
  if (!envelope.success) throw new IntegrationError("CUSTOM_FORM_RESULT_INVALID", "儲存回覆尚未完整確認，請以原操作重試。", 409);
  const receipt = parseCustomDraftReceipt(envelope.data.data.receipt, expected);
  if (httpStatus !== (receipt.replayed ? 200 : 201)) throw new IntegrationError("CUSTOM_FORM_RESULT_INVALID", "儲存回覆狀態不一致，請以原操作重試。", 409);
  return receipt;
}

export function parseCustomDraftReadResponse(value: unknown, id: string) {
  const envelope = z.object({ requestId: z.uuid(), status: z.literal("ok"),
    data: z.object({ draft: customDraftDocumentSchema, demo: z.literal(false) }).strict(), errors: z.tuple([]),
  }).strict().safeParse(value);
  if (!envelope.success || envelope.data.data.draft.formVersionId !== id) throw new IntegrationError("CUSTOM_FORM_RESULT_INVALID", "草稿回覆未完整確認，請重新載入。", 409);
  return envelope.data.data.draft;
}

// Test answers stay in memory only. This bounded interpreter never evaluates
// code, diagnoses, scores, signs, or persists a care record.
export function testCustomForm(schemaValue: unknown, answers: Record<string, unknown>) {
  const parsed = customFormSchema.safeParse(schemaValue);
  if (!parsed.success) return { valid: false, checked: 0, errors: ["表單結構尚未通過驗證"], score: null };
  const errors: string[] = [];
  const allowed = new Set(parsed.data.fields.map((field) => field.key));
  if (Object.keys(answers).some((key) => !allowed.has(key))) errors.push("含有不屬於此版本的填答欄位");
  for (const field of parsed.data.fields) {
    const value = answers[field.key];
    const missing = value === undefined || value === null || value === "";
    if (missing) { if (field.required) errors.push(`${field.label}：尚未填寫`); continue; }
    let valid = false;
    switch (field.type) {
      case "text": valid = typeof value === "string" && value.trim().length > 0 && value.length <= field.maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value); break;
      case "number": valid = typeof value === "number" && Number.isFinite(value) && value >= field.minimum && value <= field.maximum; break;
      case "date": valid = calendarDate.safeParse(value).success; break;
      case "boolean": valid = typeof value === "boolean"; break;
      case "select": valid = typeof value === "string" && field.options.includes(value); break;
    }
    if (!valid) errors.push(`${field.label}：填答型別、選項或範圍不符`);
  }
  return { valid: errors.length === 0, checked: parsed.data.fields.length, errors, score: null };
}
