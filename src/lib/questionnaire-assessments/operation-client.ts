import { z } from "zod";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { questionnaireFormKeySchema, questionnaireReceiptSchema } from "./contract";
import { parseQuestionnaireMutation } from "./mutation-contract";
import { parseQuestionnaireOperationReceipt, type QuestionnaireOperationReceiptExpected, type QuestionnaireOperationReceiptProof } from "./operation-receipt";
import type { QuestionnaireFormKey } from "./types";

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const instant = z.string().datetime({ offset: true }).refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value));
const receiptSchema = questionnaireReceiptSchema.extend({ clientId: uuid, assessmentKey: uuid, versionId: uuid,
  version: z.number().int().min(1).max(1_000_000), assessedOn: z.iso.date(), committedAt: instant }).strict();
const envelopeSchema = z.object({ requestId: uuid, status: z.literal("ok"), data: z.unknown(), errors: z.tuple([]) }).strict();
const errorSchema = z.object({ requestId: uuid, status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u), message: z.string().min(1).max(2000),
    field: z.string().min(1).max(200).optional() }).strict()).min(1).max(32) }).strict();
const knownRejections: Readonly<Record<number, readonly string[]>> = {
  400: ["QUESTIONNAIRE_INVALID", "INVALID_JSON"], 401: ["AUTH_REQUIRED"],
  403: ["QUESTIONNAIRE_NOT_AUTHORIZED", "DEMO_READ_ONLY"],
  409: ["BRANCH_CONTEXT_REQUIRED", "QUESTIONNAIRE_VERSION_CONFLICT", "QUESTIONNAIRE_IDEMPOTENCY_CONFLICT"],
  413: ["REQUEST_TOO_LARGE"],
};
export type QuestionnaireDraftWriteReceipt = z.infer<typeof receiptSchema>;
export type QuestionnaireOperationClientErrorCode = "INVALID_REQUEST" | "ABORTED" | "UNAVAILABLE" | "INVALID_RESPONSE" | "REJECTED";
/** Only safe transport metadata. Never retain provider text, request contents,
 * response bodies, raw validation errors or a cause carrying clinical data. */
export class QuestionnaireOperationClientError extends Error {
  constructor(readonly code: QuestionnaireOperationClientErrorCode, readonly status: number | null = null) {
    super(code === "ABORTED" ? "操作已取消，保存結果仍須確認。" : "原操作結果尚未完整確認，請保留原內容。" );
    this.name = "QuestionnaireOperationClientError";
  }
}

function assertPlainJson(value: unknown): void {
  let nodes = 0, characters = 0;
  const ancestors = new WeakSet<object>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 16) throw new Error("Unsupported JSON.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      characters += item.length;
      if (item.length > 65_536 || characters > 2_097_152) throw new Error("Unsupported JSON.");
      return;
    }
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error("Unsupported JSON.");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item), keys = Reflect.ownKeys(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("Unsupported JSON.");
    if (keys.length > 10_001 || keys.some(key => typeof key !== "string")) throw new Error("Unsupported JSON.");
    ancestors.add(item);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(item, "length");
        if (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > 10_000 || keys.length !== length.value + 1) throw new Error("Unsupported JSON.");
        for (let index = 0; index < length.value; index++) {
          const entry = Object.getOwnPropertyDescriptor(item, String(index));
          if (!entry || !entry.enumerable || !("value" in entry)) throw new Error("Unsupported JSON.");
          visit(entry.value, depth + 1);
        }
      } else {
        for (const key of keys) {
          characters += (key as string).length;
          if ((key as string).length > 65_536 || characters > 2_097_152) throw new Error("Unsupported JSON.");
          const entry = Object.getOwnPropertyDescriptor(item, key);
          if (!entry || !entry.enumerable || !("value" in entry)) throw new Error("Unsupported JSON.");
          visit(entry.value, depth + 1);
        }
      }
    } finally { ancestors.delete(item); }
  }
  visit(value, 0);
}

function readExpected(input: QuestionnaireOperationReceiptExpected): QuestionnaireOperationReceiptExpected {
  try {
    assertPlainJson(input);
    const expected = JSON.parse(JSON.stringify(input)) as QuestionnaireOperationReceiptExpected;
    if (expected.request === undefined) throw new Error("Original wire is required.");
    // Reuse the strict proof contract for preflight, including original request
    // normalization, rather than weakening it or inventing a browser policy.
    const { request: original, ...identity } = expected;
    parseQuestionnaireOperationReceipt({ ...identity, schemaVersion: 1, status: "not_found", verifiedAt: new Date().toISOString(),
      persisted: false, demo: false, receipt: null, request: null, draft: null }, { ...identity, request: original });
    return expected;
  } catch { throw new QuestionnaireOperationClientError("INVALID_REQUEST"); }
}

async function send<T>(url: string, init: RequestInit, expectedStatus: 200 | 201, signal: AbortSignal | undefined,
  parse: (data: unknown) => T): Promise<T> {
  if (signal?.aborted) throw new QuestionnaireOperationClientError("ABORTED");
  const controller = new AbortController(), started = Date.now();
  const bounded = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timeout = () => new QuestionnaireOperationClientError(signal?.aborted ? "ABORTED" : "UNAVAILABLE");
  const active = () => { if (bounded.aborted || Date.now() - started >= CLIENT_WRITE_TIMEOUT_MS) throw timeout(); };
  const timer = setTimeout(() => controller.abort(), CLIENT_WRITE_TIMEOUT_MS);
  let removeAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(timeout());
    bounded.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => bounded.removeEventListener("abort", onAbort);
    if (bounded.aborted) onAbort();
  });
  try {
    const operation = (async () => {
      let response: Response;
      try { active(); response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", redirect: "error", signal: bounded }); }
      catch { throw timeout(); }
      active();
      let status: number;
      try { status = response.status; }
      catch { throw new QuestionnaireOperationClientError("INVALID_RESPONSE"); }
      const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
      let redirected: boolean;
      try { redirected = response.redirected; }
      catch { throw new QuestionnaireOperationClientError("INVALID_RESPONSE", safeStatus); }
      if (!Number.isInteger(status) || status < 100 || status > 599 || redirected !== false) {
        throw new QuestionnaireOperationClientError("INVALID_RESPONSE", safeStatus);
      }
      if (status !== expectedStatus && (expectedStatus === 200 || !Object.hasOwn(knownRejections, status))) {
        throw new QuestionnaireOperationClientError("UNAVAILABLE", status);
      }
      let raw: unknown;
      try { raw = await response.json(); active(); assertPlainJson(raw); }
      catch { active(); throw new QuestionnaireOperationClientError("INVALID_RESPONSE", status); }
      if (status !== expectedStatus) {
        try {
          const rejected = errorSchema.parse(raw);
          if (!rejected.errors.every(error => knownRejections[status]!.includes(error.code))) throw new Error("Unknown rejection.");
        } catch { throw new QuestionnaireOperationClientError("INVALID_RESPONSE", status); }
        throw new QuestionnaireOperationClientError("REJECTED", status);
      }
      try {
        const envelope = envelopeSchema.parse(raw), result = parse(envelope.data);
        active(); return result;
      } catch (error) {
        active();
        if (error instanceof QuestionnaireOperationClientError) throw error;
        throw new QuestionnaireOperationClientError("INVALID_RESPONSE", status);
      }
    })();
    return await Promise.race([operation, aborted]);
  } finally { clearTimeout(timer); removeAbort(); }
}

/** Header-only, bodyless lookup; original answers remain exclusively local for
 * correlation. The caller supplies its journal's nonce; never replace it. */
export async function readQuestionnaireOperationReceipt(expectedInput: QuestionnaireOperationReceiptExpected, signal?: AbortSignal): Promise<QuestionnaireOperationReceiptProof> {
  const expected = readExpected(expectedInput);
  return send("/api/questionnaire-assessments/receipt", { method: "GET", headers: { accept: "application/json",
    "x-organization-id": expected.organizationId, "x-branch-id": expected.branchId, "x-client-id": expected.clientId,
    "x-questionnaire-form-key": expected.formKey, "x-questionnaire-operation": expected.action,
    "idempotency-key": expected.idempotencyKey, "x-questionnaire-receipt-nonce": expected.nonce } }, 200, signal,
  data => parseQuestionnaireOperationReceipt(data, expected));
}

/** One explicit POST of the exact frozen bytes/key. The existing thin 201
 * receipt correlates target/date/version only; it does NOT prove tenant,
 * actor, original answers/hash or a current history read. Use the GET proof
 * for unresolved operations and a fresh exact history read before new work. */
export async function writeQuestionnaireDraft(body: string, idempotencyKey: string, formKey: QuestionnaireFormKey, signal?: AbortSignal): Promise<QuestionnaireDraftWriteReceipt> {
  let input: NonNullable<ReturnType<typeof parseQuestionnaireMutation>>;
  try {
    if (typeof body !== "string" || new TextEncoder().encode(body).byteLength > 65_536) throw new Error("Invalid wire.");
    uuid.parse(idempotencyKey); questionnaireFormKeySchema.parse(formKey);
    const raw: unknown = JSON.parse(body); assertPlainJson(raw);
    const parsed = parseQuestionnaireMutation(raw, idempotencyKey);
    if (!parsed || parsed.form_key !== formKey) throw new Error("Invalid wire.");
    input = parsed;
  } catch { throw new QuestionnaireOperationClientError("INVALID_REQUEST"); }
  return send(`/api/questionnaire-assessments?form_key=${formKey}`, { method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "idempotency-key": idempotencyKey }, body }, 201, signal, data => {
    const receipt = receiptSchema.parse(data);
    if (receipt.action !== input.action || receipt.clientId !== input.client_id || receipt.formKey !== input.form_key ||
      receipt.assessedOn !== input.assessed_on || receipt.version !== (input.expected_version ?? 0) + 1 ||
      input.action === "revise" && (receipt.assessmentKey !== input.assessment_key || receipt.versionId === input.previous_version_id)) {
      throw new Error("Uncorrelated draft target.");
    }
    // Accept old immutable replay receipts but not a future server instant.
    const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(receipt.committedAt)!;
    const micros = BigInt(Date.parse(`${match[1]}${match[3]}`)) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
    if (micros > BigInt(Date.now()) * BigInt(1000) + BigInt(60_000_000)) throw new Error("Future draft receipt.");
    return receipt;
  });
}
