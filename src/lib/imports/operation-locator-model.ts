import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { importRecoveryModeSchema, isRecoveryTimeOrdered, trustedRecoveryReceiptSchema } from "./recovery-model";
import { CURRENT_MAPPING_VERSION, MAX_HTML_IMPORT_BYTES } from "./types";

/** Keep the original spelling: this key is input to the actor-scoped namespace. */
export const originalOperationKeySchema = z.string().min(1).max(200)
  .refine(value => Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/u.test(value));
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const timestamp = z.string().max(64).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u).refine(isStrictOffsetDateTime);
function micros(value: string): bigint | null {
  const match = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  return Number.isSafeInteger(millis) ? BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}

/** This is a source staging observation, never an attached repository batch. */
export const trustedUploadOperationEnvelopeSchema = z.object({
  schema_version: z.literal(1), original_operation_id: uuid, reservation_id: uuid,
  organization_id: uuid, branch_id: uuid, actor_user_id: uuid, mode: importRecoveryModeSchema,
  file_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  file_name: z.string().min(1).max(255).refine(value => /\.html?$/iu.test(value) && !/[\u0000-\u001f\u007f/\\]/u.test(value)),
  mime_type: z.enum(["text/html", "application/xhtml+xml"]),
  file_size_bytes: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES),
  mapping_version: z.literal(CURRENT_MAPPING_VERSION), created_at: timestamp, expires_at: timestamp,
  status: z.enum(["queued", "completed"]), receipt: trustedRecoveryReceiptSchema.nullable(),
  staging_only: z.literal(true), formally_imported: z.literal(false),
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Upload operation proof is inconsistent" });
  const now = new Date().toISOString();
  // Preserve microsecond comparisons and original timestamp spelling. The
  // observed window can be expired; it never grants authority to resume work.
  const created = micros(value.created_at), expires = micros(value.expires_at);
  if (created === null || expires === null) { invalid(); return; }
  if (!isRecoveryTimeOrdered(value.created_at, now) ||
      expires <= created || expires - created > BigInt(15 * 60 * 1_000_000) ||
      (value.mode === "routine-intake" && value.file_size_bytes > 4 * 1024 * 1024)) invalid();
  if (value.status === "queued") {
    if (value.receipt !== null) invalid();
  } else if (!value.receipt || value.receipt.reservation_id !== value.reservation_id ||
    value.receipt.file_sha256 !== value.file_sha256 || value.receipt.mapping_version !== value.mapping_version ||
    value.receipt.replayed || !isRecoveryTimeOrdered(value.created_at, value.receipt.completed_at) ||
    !isRecoveryTimeOrdered(value.receipt.completed_at, now)) invalid();
});
export type TrustedUploadOperationEnvelope = z.infer<typeof trustedUploadOperationEnvelopeSchema>;

export const uploadOperationLocatorResultSchema = z.union([
  z.object({ found: z.literal(false), operation: z.null() }).strict(),
  z.object({ found: z.literal(true), operation: trustedUploadOperationEnvelopeSchema }).strict(),
]);
export type UploadOperationLocatorResult = z.infer<typeof uploadOperationLocatorResultSchema>;
