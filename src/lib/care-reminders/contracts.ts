import { z } from "zod";

const uuid = z.string().uuid();
const bounded = z.string().min(1).max(1000);
export const reminderSchema = z.object({
  id: uuid, batch_id: uuid, client_id: uuid, rule_id: bounded, rule_version: z.literal("cms-explicit-attention@1"),
  title: bounded, text: bounded, status: z.enum(["pending_review", "confirmed", "dismissed"]),
  source_changed: z.boolean(), source_kind: z.literal("trusted_staging"),
  imported_at: z.string(), reviewed_at: z.string().nullable(), reviewed_by: uuid.nullable(),
  source: z.object({ fieldId: bounded, sectionCode: bounded, label: bounded, parentPath: bounded,
    targetPath: bounded, mappingKey: bounded, sourceValue: bounded }).strict(),
}).strict();
export const reminderSnapshotSchema = z.object({
  client_id: uuid, client_version: z.number().int().positive(), reviewer: z.boolean(),
  generated_at: z.string(), formally_imported: z.literal(false),
  reminders: z.array(reminderSchema),
  sources: z.array(z.object({ id: uuid, completed_at: z.string(), file_name: bounded,
    payload_sha256: z.string().regex(/^[a-f0-9]{64}$/u), associated_client_id: uuid.nullable() }).strict()),
}).strict().superRefine((snapshot, context) => {
  if (!snapshot.reviewer && (snapshot.sources.length > 0 || snapshot.reminders.some((item) => item.status !== "confirmed"))) {
    context.addIssue({ code: "custom", message: "Unreviewed source data cannot enter a worker projection" });
  }
});
export type ReminderSnapshot = z.infer<typeof reminderSnapshotSchema>;
export const reminderMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), client_id: uuid, batch_id: uuid,
    client_version: z.number().int().positive(), payload_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    identity_confirmed: z.literal(true), reason: z.string().trim().min(5).max(1000), idempotency_key: uuid }).strict(),
  z.object({ action: z.enum(["confirm", "dismiss"]), client_id: uuid, reminder_id: uuid,
    reason: z.string().trim().min(5).max(1000), expected_status: z.enum(["pending_review", "confirmed"]),
    idempotency_key: uuid }).strict(),
]);
export type ReminderMutation = z.infer<typeof reminderMutationSchema>;
export const reminderReceiptSchema = z.object({ client_id: uuid, action: z.enum(["generate", "confirm", "dismiss"]),
  idempotency_key: uuid, replayed: z.boolean(), formally_imported: z.literal(false),
  affected: z.number().int().nonnegative() }).strict();
