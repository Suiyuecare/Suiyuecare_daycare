import { z } from "zod";

import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { IntegrationError } from "@/lib/integrations/errors";
import { STAFF_ANNOUNCEMENT_ACTIONS } from "@/lib/integrations/staff-announcements";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(isStrictOffsetDateTime)
  .transform((value) => new Date(value).toISOString());
const action = z.enum(STAFF_ANNOUNCEMENT_ACTIONS);
const requestSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid,
  action, idempotencyKey: uuid, nonce: uuid }).strict();
const evidenceSchema = z.object({ announcementKey: uuid, versionId: uuid,
  version: z.number().int().positive().safe(), sourceVersionId: uuid.nullable(),
  releaseVersionId: uuid.nullable(), effectiveAt: timestamp.nullable(), recordedAt: timestamp }).strict();
const common = { schemaVersion: z.literal(1), organizationId: uuid, branchId: uuid,
  actorUserId: uuid, action, idempotencyKey: uuid, nonce: uuid, verifiedAt: timestamp,
  demo: z.literal(false) };
const receiptSchema = z.discriminatedUnion("status", [
  z.object({ ...common, status: z.literal("committed"), persisted: z.literal(true), evidence: evidenceSchema }).strict(),
  z.object({ ...common, status: z.literal("not_found"), persisted: z.literal(false), evidence: z.null() }).strict(),
]);
const envelopeSchema = z.object({ requestId: uuid, status: z.literal("ok"),
  data: z.unknown(), errors: z.array(z.never()).length(0) }).strict();

export type StaffAnnouncementReceiptRequest = z.input<typeof requestSchema>;
export type ReceiptRequest = StaffAnnouncementReceiptRequest;
export type StaffAnnouncementReceiptEvidence = z.output<typeof evidenceSchema>;
export type StaffAnnouncementReceipt = z.output<typeof receiptSchema>;

function invalid(): never {
  throw new IntegrationError("STAFF_ANNOUNCEMENT_RECEIPT_INVALID",
    "公告操作查證尚未核對完成；請保留原操作並重新查證。", 409);
}

/** Exact original-operation evidence, never a current-list or absence proof.
 * Both database JSON and API data pass this same bounded parser. */
export function parseStaffAnnouncementReceipt(value: unknown, request: StaffAnnouncementReceiptRequest): StaffAnnouncementReceipt {
  const expected = requestSchema.safeParse(request); const parsed = receiptSchema.safeParse(value);
  if (!expected.success || !parsed.success) invalid();
  const proof = parsed.data; const input = expected.data;
  if (proof.organizationId !== input.organizationId || proof.branchId !== input.branchId ||
    proof.actorUserId !== input.userId || proof.action !== input.action ||
    proof.idempotencyKey !== input.idempotencyKey || proof.nonce !== input.nonce) invalid();
  if (proof.status === "not_found") return proof;
  const evidence = proof.evidence;
  if (Date.parse(evidence.recordedAt) > Date.parse(proof.verifiedAt) ||
    evidence.effectiveAt !== null && Date.parse(evidence.effectiveAt) > Date.parse(proof.verifiedAt)) invalid();
  // An existing read may precede the operation's recordedAt. Do not invent a
  // commit timestamp or require effectiveAt >= recordedAt for this history.
  if (proof.action === "draft" && (evidence.releaseVersionId !== null ||
      (evidence.version === 1) !== (evidence.sourceVersionId === null) || evidence.sourceVersionId === evidence.versionId) ||
    proof.action === "publish" && (evidence.version < 2 || evidence.sourceVersionId === null ||
      evidence.sourceVersionId === evidence.versionId || evidence.releaseVersionId !== evidence.versionId) ||
    proof.action === "withdraw" && (evidence.version < 2 || evidence.sourceVersionId === null || evidence.releaseVersionId === null ||
      evidence.sourceVersionId === evidence.versionId || evidence.releaseVersionId === evidence.versionId || evidence.effectiveAt === null) ||
    proof.action === "read" && (evidence.sourceVersionId !== evidence.versionId ||
      evidence.releaseVersionId !== evidence.versionId || evidence.effectiveAt === null)) invalid();
  return proof;
}

export function parseStaffAnnouncementReceiptEnvelope(raw: unknown, request: StaffAnnouncementReceiptRequest) {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) invalid();
  return { requestId: envelope.data.requestId, data: parseStaffAnnouncementReceipt(envelope.data.data, request) };
}
