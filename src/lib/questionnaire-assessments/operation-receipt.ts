import { z } from "zod";

import { questionnaireDraftSchema, questionnaireFormKeySchema, questionnaireReceiptSchema } from "./contract";
import { parseQuestionnaireMutation, type QuestionnaireMutationInput } from "./mutation-contract";
import type { QuestionnaireFormKey } from "./types";

const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
const instant = z.string().datetime({ offset: true }).refine((value) => /^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value));
const action = z.enum(["create", "revise"]);
const answer = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("answered"), value: z.string() }).strict(),
  z.object({ state: z.literal("not_applicable"), reason: z.string() }).strict(),
]);
const requestBase = z.object({
  action, client_id: uuid, form_key: questionnaireFormKeySchema,
  form_version: z.string().min(1).max(80), assessed_on: z.iso.date(),
  answers: z.record(z.string(), answer), context: z.record(z.string(), z.string()),
});
const requestSchema = z.discriminatedUnion("action", [
  requestBase.extend({ action: z.literal("create"), assessment_key: z.null(),
    previous_version_id: z.null(), expected_version: z.literal(0) }).strict(),
  requestBase.extend({ action: z.literal("revise"), assessment_key: uuid,
    previous_version_id: uuid, expected_version: z.number().int().min(1).max(1_000_000) }).strict(),
]);
const expectedSchema = z.object({
  organizationId: uuid, branchId: uuid, actorUserId: uuid, formKey: questionnaireFormKeySchema,
  clientId: uuid, action, idempotencyKey: uuid, nonce: uuid, request: z.unknown().optional(),
}).strict();
const base = z.object({
  schemaVersion: z.literal(1), organizationId: uuid, branchId: uuid, actorUserId: uuid,
  formKey: questionnaireFormKeySchema, clientId: uuid, action, idempotencyKey: uuid,
  nonce: uuid, verifiedAt: instant, demo: z.literal(false),
});
const receiptSchema = questionnaireReceiptSchema.extend({ clientId: uuid, assessmentKey: uuid,
  versionId: uuid, version: z.number().int().positive().max(1_000_000), committedAt: instant, replayed: z.literal(false) }).strict();
const draftSchema = questionnaireDraftSchema.extend({ assessmentKey: uuid, versionId: uuid,
  version: z.number().int().positive().max(1_000_000), createdAt: instant }).strict();
const proofSchema = z.discriminatedUnion("status", [
  base.extend({ status: z.literal("not_found"), persisted: z.literal(false),
    receipt: z.null(), request: z.null(), draft: z.null() }).strict(),
  base.extend({ status: z.literal("committed"), persisted: z.literal(true),
    receipt: receiptSchema, request: requestSchema, draft: draftSchema }).strict(),
]);

/** Admit bounded data descriptors before Zod/property access. This deliberately
 * does not execute accessors or admit sparse/cyclic/custom-prototype objects. */
function assertPlainJson(value: unknown): void {
  let nodes = 0, characters = 0;
  const ancestors = new WeakSet<object>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 16) throw new Error("Unsupported JSON structure.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      characters += item.length;
      if (item.length > 65_536 || characters > 2_097_152) throw new Error("Unsupported JSON structure.");
      return;
    }
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object") throw new Error("Unsupported JSON structure.");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new Error("Unsupported JSON structure.");
    }
    if (ancestors.has(item)) throw new Error("Unsupported JSON structure.");
    const keys = Reflect.ownKeys(item);
    if (keys.length > 10_001 || keys.some((key) => typeof key !== "string")) throw new Error("Unsupported JSON structure.");
    ancestors.add(item);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(item, "length");
        if (!length || !("value" in length) || !Number.isInteger(length.value) ||
          length.value < 0 || length.value > 10_000 || keys.length !== length.value + 1) {
          throw new Error("Unsupported JSON structure.");
        }
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Unsupported JSON structure.");
          visit(descriptor.value, depth + 1);
        }
      } else {
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("Unsupported JSON structure.");
          visit(descriptor.value, depth + 1);
        }
      }
    } finally { ancestors.delete(item); }
  }
  visit(value, 0);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function instantMicros(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new Error("Invalid timestamp precision.");
  const millis = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isSafeInteger(millis)) throw new Error("Invalid timestamp.");
  return BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function requestFromMutation(input: QuestionnaireMutationInput) {
  // The persisted request hash explicitly has all three target fields even
  // though the original create POST/RPC payload omits them.
  return {
    action: input.action, client_id: input.client_id, form_key: input.form_key,
    form_version: input.form_version, assessed_on: input.assessed_on,
    answers: input.answers, context: input.context,
    assessment_key: input.assessment_key ?? null,
    previous_version_id: input.previous_version_id ?? null,
    expected_version: input.expected_version ?? 0,
  };
}

function normalizeProofRequest(request: z.infer<typeof requestSchema>, key: string) {
  return parseQuestionnaireMutation({
    action: request.action, clientId: request.client_id, formKey: request.form_key,
    formVersion: request.form_version, assessedOn: request.assessed_on,
    answers: request.answers, context: request.context,
    ...(request.action === "revise" ? { assessmentKey: request.assessment_key,
      previousVersionId: request.previous_version_id, expectedVersion: request.expected_version } : {}),
  }, key);
}

export interface QuestionnaireOperationReceiptExpected {
  readonly organizationId: string;
  readonly branchId: string;
  readonly actorUserId: string;
  readonly formKey: QuestionnaireFormKey;
  readonly clientId: string;
  readonly action: "create" | "revise";
  readonly idempotencyKey: string;
  readonly nonce: string;
  /** The frozen original camel-case POST, not reconstructed editor answers. */
  readonly request?: unknown;
}
export type QuestionnaireOperationReceiptProof = z.infer<typeof proofSchema>;

export class QuestionnaireOperationReceiptError extends Error {
  constructor() {
    super("原評估操作的保存結果尚未核對完成。");
    this.name = "QuestionnaireOperationReceiptError";
  }
}

/** A precise historical receipt is not a current list snapshot, clinical
 * score, signature or authorization to perform another write. */
export function parseQuestionnaireOperationReceipt(
  value: unknown, expected: QuestionnaireOperationReceiptExpected, observedAt = Date.now(),
): QuestionnaireOperationReceiptProof {
  try {
    assertPlainJson(value); assertPlainJson(expected);
    const proof = proofSchema.parse(value), binding = expectedSchema.parse(expected);
    if (!Number.isSafeInteger(observedAt)) throw new Error("Invalid observation clock.");
    const verifiedMicros = instantMicros(proof.verifiedAt), observedMicros = BigInt(observedAt) * BigInt(1000);
    if (verifiedMicros - observedMicros > BigInt(60_000_000) || observedMicros - verifiedMicros > BigInt(60_000_000)) {
      throw new Error("Invalid receipt clock.");
    }
    for (const key of ["organizationId", "branchId", "actorUserId", "formKey", "clientId", "action", "idempotencyKey", "nonce"] as const) {
      if (proof[key] !== binding[key]) throw new Error("Invalid receipt scope.");
    }
    const original = binding.request === undefined ? null : parseQuestionnaireMutation(binding.request, binding.idempotencyKey);
    if (binding.request !== undefined && (!original || original.action !== binding.action ||
      original.client_id !== binding.clientId || original.form_key !== binding.formKey)) throw new Error("Invalid original request.");
    if (proof.status === "not_found") return proof;
    const { request, receipt, draft } = proof;
    const normalized = normalizeProofRequest(request, binding.idempotencyKey);
    if (!normalized || canonical(requestFromMutation(normalized)) !== canonical(request) ||
      (original && canonical(requestFromMutation(original)) !== canonical(request))) throw new Error("Invalid stored request.");
    if (request.action !== binding.action || request.client_id !== binding.clientId || request.form_key !== binding.formKey ||
      receipt.action !== binding.action || receipt.clientId !== binding.clientId || receipt.formKey !== binding.formKey ||
      receipt.assessedOn !== request.assessed_on || draft.assessedOn !== request.assessed_on ||
      draft.formVersion !== request.form_version || draft.assessmentKey !== receipt.assessmentKey ||
      draft.versionId !== receipt.versionId || draft.version !== receipt.version || draft.contentHash !== receipt.contentHash ||
      draft.createdAt !== receipt.committedAt || instantMicros(receipt.committedAt) > verifiedMicros ||
      canonical(draft.answers) !== canonical(request.answers) || canonical(draft.context) !== canonical(request.context)) {
      throw new Error("Invalid historical result.");
    }
    if (request.action === "create" ? receipt.version !== 1 :
      receipt.assessmentKey !== request.assessment_key || receipt.version !== request.expected_version + 1 ||
      receipt.versionId === request.previous_version_id) throw new Error("Invalid historical target.");
    return proof;
  } catch { throw new QuestionnaireOperationReceiptError(); }
}
