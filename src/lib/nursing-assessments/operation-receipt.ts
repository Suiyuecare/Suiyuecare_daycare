import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { IntegrationError } from "@/lib/integrations/errors";
import { nursingRequestSchema, parseNursingReceipt } from "./parser";
import { nursingReadUuid } from "./read-authority";
import type { NursingReceipt, NursingRequest } from "./types";

const action = z.enum(["create_draft", "revise_draft", "sign", "correct"]);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const expectedSchema = z.object({ organizationId: nursingReadUuid, branchId: nursingReadUuid,
  userId: nursingReadUuid, clientId: nursingReadUuid, action, idempotencyKey: nursingReadUuid,
  nonce: nursingReadUuid, request: nursingRequestSchema.optional() }).strict();
const common = { schemaVersion: z.literal(1), organizationId: nursingReadUuid, branchId: nursingReadUuid,
  actorUserId: nursingReadUuid, clientId: nursingReadUuid, action, idempotencyKey: nursingReadUuid,
  nonce: nursingReadUuid, verifiedAt: timestamp, demo: z.literal(false) };
const proofSchema = z.discriminatedUnion("status", [
  z.object({ ...common, status: z.literal("committed"), persisted: z.literal(true),
    receipt: z.unknown().refine((value) => value !== undefined) }).strict(),
  z.object({ ...common, status: z.literal("not_found"), persisted: z.literal(false), receipt: z.null() }).strict(),
]);
const envelopeSchema = z.object({ requestId: nursingReadUuid, status: z.literal("ok"),
  errors: z.tuple([]), data: z.unknown() }).strict();

export type NursingOperationReceiptExpected = {
  organizationId: string; branchId: string; userId: string; clientId: string;
  action: NursingRequest["action"]; idempotencyKey: string; nonce: string; request?: NursingRequest;
};
type ProofCommon = { schemaVersion: 1; organizationId: string; branchId: string; actorUserId: string;
  clientId: string; action: NursingRequest["action"]; idempotencyKey: string; nonce: string; verifiedAt: string; demo: false };
export type NursingOperationReceiptProof = ProofCommon & (
  { status: "committed"; persisted: true; receipt: NursingReceipt } |
  { status: "not_found"; persisted: false; receipt: null }
);
function invalid(): never {
  throw new IntegrationError("NURSING_OPERATION_RECEIPT_INVALID", "原操作查證尚未核對完成；請保留原操作並重新查證。", 502);
}

/** Exact own-operation evidence, not a snapshot, a write replay, or proof of
 * failure. No browser journal state or new MFA is inferred by this parser. */
export function parseNursingOperationReceipt(value: unknown, expected: NursingOperationReceiptExpected,
  observedAt = Date.now()): NursingOperationReceiptProof {
  try {
    const input = expectedSchema.parse(expected), proof = proofSchema.parse(value);
    if (!Number.isFinite(observedAt) || Math.abs(Date.parse(proof.verifiedAt) - observedAt) > 60_000 ||
      proof.organizationId !== input.organizationId || proof.branchId !== input.branchId || proof.actorUserId !== input.userId ||
      proof.clientId !== input.clientId || proof.action !== input.action || proof.idempotencyKey !== input.idempotencyKey ||
      proof.nonce !== input.nonce || input.request && (input.request.action !== input.action || input.request.clientId !== input.clientId)) invalid();
    if (proof.status === "not_found") return proof;
    // The server has only the original stored request. The browser independently
    // supplies its complete frozen request and gets a second exact comparison.
    const raw = z.object({ request: nursingRequestSchema }).passthrough().parse(proof.receipt);
    const request = input.request ?? raw.request as NursingRequest;
    const receipt = parseNursingReceipt(proof.receipt, { request, organizationId: input.organizationId,
      branchId: input.branchId, actorUserId: input.userId, idempotencyKey: input.idempotencyKey });
    if (receipt.request.action !== input.action || receipt.request.clientId !== input.clientId || receipt.replayed ||
      Date.parse(receipt.result.createdAt) > Date.parse(proof.verifiedAt) ||
      (request.action !== "create_draft" && receipt.result.versionId === request.previousVersionId)) invalid();
    return { ...proof, receipt };
  } catch { return invalid(); }
}

export function parseNursingOperationReceiptEnvelope(raw: unknown, expected: NursingOperationReceiptExpected,
  observedAt = Date.now()): NursingOperationReceiptProof {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return invalid();
  return parseNursingOperationReceipt(envelope.data.data, expected, observedAt);
}
