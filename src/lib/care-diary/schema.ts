import { z } from "zod";

const observed = <T extends z.ZodType>(value: T) => z.discriminatedUnion("state", [
  z.object({ state: z.literal("observed"), value }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
  z.object({ state: z.literal("not_applicable") }).strict(),
]);

export const diaryObservationsSchema = z.object({
  meal: observed(z.enum(["none", "quarter", "half", "three_quarters", "all"])),
  water: observed(z.number().int().min(0).max(5000)),
  toileting: observed(z.enum(["independent", "assisted", "not_needed", "concern"])),
  activity: observed(z.enum(["participated", "partial", "declined", "resting"])),
}).strict();

export const careDiaryDataSchema = z.object({
  shift: z.enum(["morning", "afternoon", "full_day"]),
  care_item: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).default(""),
  abnormal: z.boolean(),
  follow_up: z.string().trim().max(1000).optional(),
  observations: diaryObservationsSchema.optional(),
}).strict();

export type CareDiaryFields = z.infer<typeof careDiaryDataSchema>;
export type DiaryObservations = z.infer<typeof diaryObservationsSchema>;
export const diaryActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), base_version: z.number().int().positive(), data: careDiaryDataSchema, idempotency_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("submit"), base_version: z.number().int().positive(), idempotency_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("sign"), base_version: z.number().int().positive(), confirmed: z.literal(true), idempotency_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("correct"), base_version: z.number().int().positive(), reason: z.string().trim().min(1).max(1000), idempotency_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("reopen"), base_version: z.number().int().positive(), reason: z.string().trim().min(1).max(1000), idempotency_key: z.string().optional() }).strict(),
]);

export const diaryRecordSchema = z.object({
  id: z.uuid(), record_key: z.uuid(), version: z.number().int().positive(),
  client_id: z.uuid(), status: z.enum(["draft", "submitted", "signed", "corrected"]),
  occurred_at: z.string(), fields: careDiaryDataSchema, previous_version_id: z.uuid().nullable(),
  correction_reason: z.string().nullable(), signed_at: z.string().nullable(), signed_by: z.uuid().nullable(),
  content_hash: z.string().nullable(), created_by: z.uuid(), created_at: z.string(),
  correction_source_id: z.uuid().nullable().default(null),
}).superRefine((record, context) => {
  const signed = record.status === "signed" || record.status === "corrected";
  if (signed ? !record.signed_at || !record.signed_by || !/^[a-f0-9]{64}$/.test(record.content_hash ?? "")
    : record.signed_at !== null || record.signed_by !== null || record.content_hash !== null) {
    context.addIssue({ code: "custom", message: "日誌簽署回覆與狀態不一致" });
  }
  if (record.status === "corrected" && !record.correction_source_id) context.addIssue({ code: "custom", message: "更正日誌缺少原簽署來源" });
});
export type DiaryRecord = z.infer<typeof diaryRecordSchema>;

export function observationsFromForm(form: FormData): DiaryObservations {
  const get = (key: string) => String(form.get(key) ?? "unknown");
  const entry = (key: string) => {
    const state = get(`${key}_state`);
    if (state !== "observed") return { state };
    const raw = get(key);
    // Empty/whitespace is missing, never a measured zero. Native required does
    // not protect programmatic submission or restoration from an offline draft.
    const value = key === "water" ? raw.trim() === "" ? Number.NaN : Number(raw) : raw;
    return { state, value };
  };
  return diaryObservationsSchema.parse({ meal: entry("meal"), water: entry("water"), toileting: entry("toileting"), activity: entry("activity") });
}
