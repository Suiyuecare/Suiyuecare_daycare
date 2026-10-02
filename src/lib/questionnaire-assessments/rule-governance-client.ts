import { z } from "zod";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { getQuestionnaireForm } from "./forms";
import { parseRuleReviewHistory, parseRuleReviewReceipt, ruleReviewFormKeySchema, ruleReviewInputSchema,
  ruleReviewUuidSchema, type RuleReviewHistory, type RuleReviewInput, type RuleReviewReceipt } from "./rule-review-contract";
import { parseRuleRetirementHistory, parseRuleRetirementReceipt, ruleRetirementInputSchema,
  type RuleRetirementHistory, type RuleRetirementInput, type RuleRetirementReceipt } from "./rule-retirement-shared";
import type { QuestionnaireFormKey } from "./types";

export interface RuleGovernanceScope { organizationId: string; branchId: string; userId: string }
export interface RuleGovernanceCursor { createdAt: string; id: string }
export type RuleGovernanceErrorKind = "auth" | "forbidden" | "reauth" | "conflict" | "invalid" | "unconfirmed";
export class RuleGovernanceClientError extends Error {
  constructor(readonly kind: RuleGovernanceErrorKind, message: string) { super(message); this.name = "RuleGovernanceClientError"; }
}

const text = z.string().min(1).max(10000);
const identity = z.string().min(1).max(160);
const integer = z.number().int().min(-1000000).max(1000000);
const record = z.record(identity, z.string().max(2000));
const url = z.string().url().refine((value) => { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; });
const alert = z.object({ code: identity, level: z.enum(["info", "warning"]), message: text, requiresAcknowledgement: z.literal(true).optional() }).strict();
const classification = z.object({ key: identity, label: text, minInclusive: integer, maxInclusive: integer,
  interpretation: z.enum(["screening_only", "functional_description"]) }).strict();
const choice = z.object({ value: identity, label: text }).strict();
const question = z.object({ id: identity, prompt: text, helpText: text.optional(), choices: z.array(choice).min(1).max(100) }).strict();
const formSchema = z.object({ key: ruleReviewFormKeySchema, version: identity, title: text, instructions: text,
  sourceLabel: text, sourceUrl: url.optional(), scoreVersionId: identity, allowQualitativeNotes: z.boolean().optional(),
  contextFields: z.array(z.object({ key: identity, label: text, required: z.boolean().optional(), choices: z.array(choice).min(1).max(100) }).strict()).max(50).optional(),
  measurementFields: z.array(z.object({ key: identity, label: text }).strict()).max(50).optional(), questions: z.array(question).min(1).max(100) }).strict();
const answer = z.discriminatedUnion("state", [z.object({ state: z.literal("answered"), value: identity }).strict(),
  z.object({ state: z.literal("missing") }).strict(), z.object({ state: z.literal("not_applicable"), reason: text.optional() }).strict()]);
const manifestSchema = z.object({ schemaVersion: z.literal("questionnaire-rule-catalog.v1"), formKey: ruleReviewFormKeySchema,
  formVersion: identity, ruleVersion: identity, ruleRevision: z.number().int().min(1).max(1000000), form: formSchema,
  sourceSnapshot: z.array(z.object({ kind: z.enum(["questionnaire", "scoring"]), label: text, url: url.nullable() }).strict()).min(1).max(50),
  rules: z.object({ items: z.array(z.object({ id: identity, label: text, required: z.literal(true), allowNotApplicable: z.boolean(),
    choices: z.array(z.object({ value: identity, points: integer }).strict()).min(1).max(100) }).strict()).min(1).max(100),
  context: z.array(z.object({ id: identity, label: text, required: z.boolean(), choices: z.array(identity).min(1).max(100) }).strict()).max(50),
  scoreMin: integer, scoreMax: integer, scoreUnit: z.enum(["points", "errors"]), scoringPolicy: text, disclaimer: text,
  scoreTable: z.array(z.object({ rawScore: integer, context: record, adjustedScore: integer, classification, alerts: z.array(alert).max(100) }).strict()).min(1).max(2000),
  answerAlertTable: z.array(z.object({ questionId: identity, value: identity, alerts: z.array(alert).min(1).max(100) }).strict()).max(1000) }).strict(),
  testVectors: z.array(z.object({ id: identity, submission: z.object({ versionId: identity, answers: z.record(identity, answer), context: record.optional() }).strict(),
    expected: z.object({ status: z.enum(["complete", "incomplete", "invalid"]), rawScore: integer.nullable(), adjustedScore: integer.nullable(),
      classificationKey: identity.nullable() }).strict() }).strict()).max(1000) }).strict();
const candidateSchema = z.object({ formKey: ruleReviewFormKeySchema, formVersion: identity, ruleVersion: identity,
  catalogHash: z.string().regex(/^[a-f0-9]{64}$/u), canonicalJson: z.string().min(1).max(2000000), manifest: manifestSchema,
  registered: z.boolean(), adoptionRequired: z.literal(true) }).strict();
export type RuleGovernanceCandidate = z.infer<typeof candidateSchema> & {
  metadata: { title: string; sourceLabel: string; sourceUrl: string | null; questionCount: number };
};
export type RuleGovernanceHistory = RuleReviewHistory & { candidate: RuleGovernanceCandidate };

const scopeSchema = z.object({ organizationId: ruleReviewUuidSchema, branchId: ruleReviewUuidSchema, userId: ruleReviewUuidSchema }).strict();
const cursorSchema = z.object({ createdAt: z.iso.datetime({ offset: true }).refine((value) => !/\.\d{7}/u.test(value)), id: ruleReviewUuidSchema }).strict();
const envelopeSchema = z.object({ requestId: ruleReviewUuidSchema, status: z.enum(["ok", "error"]),
  data: z.unknown().refine((value) => value !== undefined),
  errors: z.array(z.object({ code: z.string().min(1).max(160), message: z.string().max(10000), field: z.string().max(160).optional() }).strict()).max(20) }).strict();

function failure(kind: RuleGovernanceErrorKind, write: boolean): RuleGovernanceClientError {
  const messages: Record<RuleGovernanceErrorKind, string> = { auth: "請先登入後再操作。", forbidden: "目前帳號無法處理此分支的規則審核。",
    reauth: "這項操作需要重新確認身分，請完成驗證後再試。", conflict: "內容或待審狀態已變更，請重新載入確認。",
    invalid: "請檢查表單、日期、理由與操作識別碼。", unconfirmed: write
      ? "操作結果尚未確認；請保留原內容與相同操作識別碼重試。" : "審核清單尚未完整確認，請稍後重試。" };
  return new RuleGovernanceClientError(kind, messages[kind]);
}
function local<T>(parse: () => T): T { try { return parse(); } catch { throw failure("invalid", false); } }
function aborted(signal?: AbortSignal, write = false) { if (signal?.aborted) throw failure("unconfirmed", write); }

async function send(endpoint: string, init: RequestInit, write: boolean): Promise<unknown> {
  try {
    aborted(init.signal ?? undefined, write);
    const response = await fetchWithTimeout(endpoint, { ...init, cache: "no-store", credentials: "same-origin", redirect: "error" });
    let envelope: z.infer<typeof envelopeSchema> | null = null;
    const contentType = response.headers.get("content-type") ?? "";
    try {
      if (/^application\/json(?:\s*;|$)/iu.test(contentType)) {
        const raw = await response.text();
        if (new TextEncoder().encode(raw).length <= 2000000) {
          const parsed = envelopeSchema.safeParse(JSON.parse(raw));
          if (parsed.success) envelope = parsed.data;
        }
      }
    } catch { /* HTTP denials remain known even if their error body is malformed. */ }
    if (response.status !== (write ? 201 : 200)) {
      if (response.status === 401) throw failure("auth", write);
      if (response.status === 403) throw failure(envelope?.status === "error" && envelope.data === null &&
        envelope.errors.some(({ code }) => code === "AAL2_REQUIRED") ? "reauth" : "forbidden", write);
      if (response.status === 409) throw failure("conflict", write);
      if ([400, 413, 415, 422].includes(response.status)) throw failure("invalid", write);
      throw failure("unconfirmed", write);
    }
    if (!envelope || envelope.status !== "ok" || envelope.errors.length !== 0 || envelope.data === null ||
      !response.headers.get("cache-control")?.split(",").some((value) => value.trim().toLowerCase() === "no-store")) throw failure("unconfirmed", write);
    aborted(init.signal ?? undefined, write);
    return envelope.data;
  } catch (error) {
    if (error instanceof RuleGovernanceClientError) throw error;
    throw failure("unconfirmed", write);
  }
}

// The server canonicalizes JSON once. Verify its exact byte representation,
// sorted object keys and manifest, rather than duplicate its canonicalizer.
function canonicalKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(canonicalKeys);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return keys.every((key, index) => index === 0 || keys[index - 1]! < key) && Object.values(value).every(canonicalKeys);
  }
  return true;
}
function nativeInstants(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(nativeInstants); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["createdAt", "requestedAt", "activatedAt", "committedAt", "generatedAt"].includes(key)) {
      cursorSchema.shape.createdAt.parse(item);
    } else nativeInstants(item);
  }
}
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = Object.entries(left).filter(([, value]) => value !== undefined);
  const b = Object.entries(right).filter(([, value]) => value !== undefined);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && equalJson(value, (right as Record<string, unknown>)[key]));
}
async function candidate(value: unknown, history: RuleReviewHistory, formKey: QuestionnaireFormKey, signal?: AbortSignal): Promise<RuleGovernanceCandidate> {
  const checked = candidateSchema.parse(value);
  const manifest = checked.manifest;
  const form = getQuestionnaireForm(formKey);
  const canonical = JSON.parse(checked.canonicalJson) as unknown;
  if (!form || checked.formKey !== formKey || manifest.formKey !== formKey || manifest.form.key !== formKey ||
    checked.formVersion !== form.version || manifest.formVersion !== checked.formVersion || manifest.form.version !== checked.formVersion ||
    checked.ruleVersion !== form.scoreVersionId || manifest.ruleVersion !== checked.ruleVersion || manifest.form.scoreVersionId !== checked.ruleVersion ||
    !equalJson(manifest.form, form) || manifest.sourceSnapshot.filter(({ kind }) => kind === "questionnaire").length !== 1 ||
    !manifest.sourceSnapshot.some((entry) => entry.kind === "questionnaire" && entry.label === form.sourceLabel && entry.url === (form.sourceUrl ?? null)) ||
    !canonicalKeys(canonical) || JSON.stringify(canonical) !== checked.canonicalJson || JSON.stringify(value && (value as { manifest: unknown }).manifest) !== checked.canonicalJson ||
    JSON.stringify(canonical) !== JSON.stringify(value && (value as { manifest: unknown }).manifest)) throw new Error("Invalid candidate manifest binding");
  const registered = history.catalogs.filter(({ catalogHash }) => catalogHash === checked.catalogHash);
  if (checked.registered !== (registered.length === 1) || registered.some((entry) => entry.formVersion !== checked.formVersion ||
    entry.ruleVersion !== checked.ruleVersion || entry.ruleRevision !== manifest.ruleRevision)) throw new Error("Invalid candidate registration");
  const questionIds = manifest.form.questions.map(({ id }) => id);
  if (new Set(questionIds).size !== questionIds.length || manifest.rules.items.length !== questionIds.length ||
    new Set(manifest.rules.items.map(({ id }) => id)).size !== questionIds.length || manifest.rules.items.some((item) => {
      const prompt = manifest.form.questions.find(({ id }) => id === item.id);
      return !prompt || new Set(prompt.choices.map(({ value }) => value)).size !== prompt.choices.length ||
        item.choices.length !== prompt.choices.length || new Set(item.choices.map(({ value }) => value)).size !== item.choices.length ||
        item.choices.some(({ value }) => !prompt.choices.some((choice) => choice.value === value));
    })) throw new Error("Invalid candidate question binding");
  aborted(signal);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(checked.canonicalJson));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  aborted(signal);
  if (fingerprint !== checked.catalogHash) throw new Error("Invalid candidate hash");
  return { ...checked, metadata: { title: manifest.form.title, sourceLabel: manifest.form.sourceLabel,
    sourceUrl: manifest.form.sourceUrl ?? null, questionCount: manifest.form.questions.length } };
}

export async function readRuleReview(scope: RuleGovernanceScope, formKey: QuestionnaireFormKey,
  before?: RuleGovernanceCursor | null, signal?: AbortSignal): Promise<RuleGovernanceHistory> {
  const authoritative = local(() => scopeSchema.parse(scope));
  const form = local(() => ruleReviewFormKeySchema.parse(formKey));
  const cursor = local(() => before ? cursorSchema.parse(before) : null);
  const query = new URLSearchParams({ form_key: form });
  if (cursor) { query.set("before_created_at", cursor.createdAt); query.set("before_id", cursor.id); }
  const data = await send(`/api/questionnaire-rule-reviews?${query}`, { method: "GET", signal }, false);
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid review data");
    const { candidate: proposal, ...rest } = data as Record<string, unknown>;
    nativeInstants(rest);
    const history = parseRuleReviewHistory(rest, authoritative, form, cursor);
    return { ...history, candidate: await candidate(proposal, history, form, signal) };
  } catch { throw failure("unconfirmed", false); }
}

export async function readRuleRetirement(scope: RuleGovernanceScope, activationId: string,
  before?: RuleGovernanceCursor | null, signal?: AbortSignal): Promise<RuleRetirementHistory> {
  const authoritative = local(() => scopeSchema.parse(scope));
  const activation = local(() => ruleReviewUuidSchema.parse(activationId));
  const cursor = local(() => before ? cursorSchema.parse(before) : null);
  const query = new URLSearchParams({ activation_id: activation });
  if (cursor) { query.set("before_created_at", cursor.createdAt); query.set("before_id", cursor.id); }
  const data = await send(`/api/questionnaire-rule-retirements?${query}`, { method: "GET", signal }, false);
  try { return parseRuleRetirementHistory(data, authoritative, activation, cursor); }
  catch { throw failure("unconfirmed", false); }
}

export function writeRuleGovernance(scope: RuleGovernanceScope, kind: "review", input: RuleReviewInput, operationId: string, signal?: AbortSignal): Promise<RuleReviewReceipt>;
export function writeRuleGovernance(scope: RuleGovernanceScope, kind: "retirement", input: RuleRetirementInput, operationId: string, signal?: AbortSignal): Promise<RuleRetirementReceipt>;
export function writeRuleGovernance(scope: RuleGovernanceScope, kind: "review" | "retirement", input: RuleReviewInput | RuleRetirementInput,
  operationId: string, signal?: AbortSignal): Promise<RuleReviewReceipt | RuleRetirementReceipt>;
export async function writeRuleGovernance(scope: RuleGovernanceScope, kind: "review" | "retirement", input: RuleReviewInput | RuleRetirementInput,
  operationId: string, signal?: AbortSignal): Promise<RuleReviewReceipt | RuleRetirementReceipt> {
  const authoritative = local(() => scopeSchema.parse(scope));
  const key = local(() => ruleReviewUuidSchema.parse(operationId));
  if (kind !== "review" && kind !== "retirement") throw failure("invalid", true);
  const submitted = local(() => kind === "review" ? ruleReviewInputSchema.parse(input) : ruleRetirementInputSchema.parse(input));
  const endpoint = kind === "review" ? "/api/questionnaire-rule-reviews" : "/api/questionnaire-rule-retirements";
  const data = await send(endpoint, { method: "POST", signal, headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(submitted) }, true);
  try {
    nativeInstants(data);
    return kind === "review" ? parseRuleReviewReceipt(data, authoritative, submitted as RuleReviewInput, key)
      : parseRuleRetirementReceipt(data, authoritative, submitted as RuleRetirementInput, key);
  } catch { throw failure("unconfirmed", true); }
}
