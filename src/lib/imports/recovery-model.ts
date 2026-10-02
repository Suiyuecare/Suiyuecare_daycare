import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { CURRENT_MAPPING_VERSION, MAX_HTML_IMPORT_BYTES } from "./types";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().max(64).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u).refine(isStrictOffsetDateTime);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const importRecoveryModeSchema = z.enum(["general", "routine-intake"]);
export type ImportRecoveryMode = z.infer<typeof importRecoveryModeSchema>;

export const trustedRecoveryInputSchema = z.object({
  reservationId: uuid,
  originalOperationKey: z.string().min(1).max(200).refine(value => Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/u.test(value)),
  recoveryOperationKey: uuid,
}).strict();
export type TrustedRecoveryInput = z.infer<typeof trustedRecoveryInputSchema>;

/** The original immutable completion, never a client-promotion receipt. */
export const trustedRecoveryReceiptSchema = z.object({
  reservation_id: uuid, status: z.literal("completed"), staging_only: z.literal(true), formally_imported: z.literal(false),
  file_sha256: hash, content_fingerprint: hash, mapping_version: z.literal(CURRENT_MAPPING_VERSION), payload_sha256: hash,
  section_count: count, field_count: count, completed_at: timestamp, replayed: z.boolean(),
}).strict();

function micros(value: string): bigint | null {
  const match = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  return Number.isSafeInteger(millis) ? BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}
export function isRecoveryTimeOrdered(from: string, through: string): boolean {
  if (!timestamp.safeParse(from).success || !timestamp.safeParse(through).success) return false;
  const left = micros(from), right = micros(through);
  return left !== null && right !== null && left <= right;
}

/** A recovery attempt is separate from the original reservation. Reading an
 * expired queued attempt is useful evidence, not permission to resume it. */
export const trustedRecoveryEnvelopeSchema = z.object({
  schema_version: z.literal(1), recovery_id: uuid, recovery_operation_id: uuid, original_operation_id: uuid,
  reservation_id: uuid, organization_id: uuid, branch_id: uuid, actor_user_id: uuid, mode: importRecoveryModeSchema,
  file_sha256: hash,
  file_name: z.string().min(1).max(255).refine(value => /\.html?$/iu.test(value) && !/[\u0000-\u001f\u007f/\\]/u.test(value)),
  mime_type: z.enum(["text/html", "application/xhtml+xml"]), file_size_bytes: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES),
  mapping_version: z.literal(CURRENT_MAPPING_VERSION), created_at: timestamp, recovery_created_at: timestamp, expires_at: timestamp,
  status: z.enum(["queued", "completed"]), receipt: trustedRecoveryReceiptSchema.nullable(), replayed: z.boolean(),
  staging_only: z.literal(true), formally_imported: z.literal(false),
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Recovery proof is inconsistent" });
  const created = micros(value.created_at), recovery = micros(value.recovery_created_at), expires = micros(value.expires_at);
  if (created === null || recovery === null || expires === null) { invalid(); return; }
  if (value.recovery_operation_id === value.original_operation_id ||
      created > recovery || expires <= recovery || expires - recovery > BigInt(15 * 60 * 1_000_000) ||
      (value.mode === "routine-intake" && value.file_size_bytes > 4 * 1024 * 1024)) invalid();
  if (value.status === "queued") { if (value.receipt !== null) invalid(); }
  else if (!value.receipt || value.receipt.reservation_id !== value.reservation_id || value.receipt.file_sha256 !== value.file_sha256 ||
    value.receipt.mapping_version !== value.mapping_version || !isRecoveryTimeOrdered(value.created_at, value.receipt.completed_at)) invalid();
});
export type TrustedRecoveryEnvelope = z.infer<typeof trustedRecoveryEnvelopeSchema>;
