import { TAIPEI_ABCD_TEMPLATE, taipeiFields, type TaipeiField, type TaipeiForm } from "./catalog";
import type { TaipeiAnswer, TaipeiAnswers, TaipeiDraftMutation, TaipeiDraftSnapshot } from "./types";
import { IntegrationError } from "@/lib/integrations/errors";
import { workflowSchema } from "./workflow";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = /^[a-f0-9]{64}$/u;
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
function invalid(field?: string): never { throw new IntegrationError("INVALID_TAIPEI_ABCD_DRAFT", "欄位、表別、版本或資料狀態未通過驗證，請檢查後再儲存。", 400, field); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function validValue(field: TaipeiField, value: unknown) {
  if (field.kind === "number") return typeof value === "number" && Number.isFinite(value) && value >= (field.min ?? 0) && value <= (field.max ?? Infinity);
  if (field.kind === "multi") return Array.isArray(value) && value.length > 0 && value.length <= (field.options?.length ?? 0) && new Set(value).size === value.length && value.every(x => typeof x === "string" && field.options?.includes(x));
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 4000 || control.test(value)) return false;
  if (field.kind === "choice") return field.options?.includes(value) ?? false;
  if (field.kind === "date") { const date = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2200-12-31"; }
  return true;
}
export function parseTaipeiAnswers(form: TaipeiForm, input: unknown): TaipeiAnswers {
  if (!object(input)) invalid("answers");
  const fields = new Map(taipeiFields(form).map(f => [f.key, f])); const result: TaipeiAnswers = {};
  for (const [key, candidate] of Object.entries(input)) {
    const field = fields.get(key);
    if (!field || !object(candidate) || Object.keys(candidate).sort().join() !== "reason,state,value") invalid(key);
    const { state, value, reason } = candidate;
    if (!["recorded", "unconfirmed", "missing", "not_applicable"].includes(String(state))) invalid(key);
    if (state === "recorded" || state === "unconfirmed") {
      if (!validValue(field, value) || reason !== null || (state === "unconfirmed" && !field.prefillAllowed)) invalid(key);
    } else if (value !== null || (state === "not_applicable" && (typeof reason !== "string" || !reason.trim())) ||
      (reason !== null && (typeof reason !== "string" || !reason.trim() || reason !== reason.trim() || reason.length > 1000 || control.test(reason)))) invalid(key);
    result[key] = { state, value, reason } as TaipeiAnswer;
  }
  return result;
}
export function parseTaipeiIdentity(parameters: URLSearchParams) {
  const allowed = ["client", "form", "year", "month"];
  if ([...parameters.keys()].some(k => !allowed.includes(k)) || allowed.some(k => parameters.getAll(k).length > 1)) invalid();
  const clientId = parameters.get("client"); const form = parameters.get("form"); const year = Number(parameters.get("year")); const month = Number(parameters.get("month"));
  if (!clientId || !uuid.test(clientId) || !["A", "B", "C"].includes(form ?? "") || year !== 115 || !Number.isInteger(month) ||
    (form === "C" ? month < 1 || month > 12 : month !== 0)) invalid();
  return { clientId: clientId.toLowerCase(), form: form as TaipeiForm, usageYear: 115 as const, month };
}
export function parseTaipeiMutation(input: unknown, header: string | null): TaipeiDraftMutation {
  const keys = ["client_id", "form", "usage_year", "month", "template_key", "source_revision", "source_sha256", "expected_version", "expected_content_hash", "answers", "idempotency_key"];
  if (!object(input) || Object.keys(input).sort().join() !== keys.sort().join()) invalid();
  parseTaipeiIdentity(new URLSearchParams({ client: String(input.client_id), form: String(input.form), year: String(input.usage_year), month: String(input.month) }));
  if (input.template_key !== TAIPEI_ABCD_TEMPLATE.key || input.source_revision !== "114.11" || input.source_sha256 !== TAIPEI_ABCD_TEMPLATE.sourceSha256 ||
    typeof input.idempotency_key !== "string" || !uuid.test(input.idempotency_key) || input.idempotency_key !== header ||
    !Number.isInteger(input.expected_version) || Number(input.expected_version) < 0 || Number(input.expected_version) > 100000 ||
    (input.expected_version === 0 ? input.expected_content_hash !== null : typeof input.expected_content_hash !== "string" || !hash.test(input.expected_content_hash))) invalid();
  return { ...input, answers: parseTaipeiAnswers(input.form as TaipeiForm, input.answers) } as TaipeiDraftMutation;
}
export function validateTaipeiSnapshot(value: unknown, expected: { organizationId: string; branchId: string; clientId: string; form: TaipeiForm; usageYear: 115; month: number }): TaipeiDraftSnapshot {
  if (!object(value) || Object.entries(expected).some(([k, v]) => value[k] !== v) || !Array.isArray(value.history) || typeof value.canEdit !== "boolean") throw new Error("TAIPEI_ABCD_RECEIPT_MISMATCH");
  if (value.workflow !== undefined) workflowSchema.parse(value.workflow);
  for (const key of ["canSubmit", "canReview", "canCorrect", "canExport"]) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error("TAIPEI_ABCD_RECEIPT_MISMATCH");
  if (value.latest !== null) {
    const row = value.latest;
    if (!object(row) || Object.entries(expected).some(([k, v]) => row[k] !== v) || row.state !== "draft" || row.publicationStatus !== "pending_approval" ||
      typeof row.id !== "string" || !uuid.test(row.id) || !Number.isInteger(row.version) || Number(row.version) < 1 || typeof row.contentHash !== "string" || !hash.test(row.contentHash)) throw new Error("TAIPEI_ABCD_RECEIPT_MISMATCH");
    parseTaipeiAnswers(expected.form, row.answers);
  }
  return value as unknown as TaipeiDraftSnapshot;
}
