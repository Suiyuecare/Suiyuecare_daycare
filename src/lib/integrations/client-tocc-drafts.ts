import { z } from "zod";

import { parseClientToccAssessmentFields, taipeiCalendarDate } from "@/lib/client-tocc/validation";
import type { ClientToccAssessmentFields } from "@/lib/client-tocc/types";

import { IntegrationError } from "./errors";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.uuid();

const draftBody = z.object({
  action: z.enum(["create", "revise"]),
  draft_key: uuid,
  previous_version_id: uuid.nullable(),
  expected_version: z.number().int().nonnegative(),
  expected_content_hash: hash.nullable(),
  client_id: uuid,
  assessment_date: z.string(),
  result_status: z.string(),
  symptom_summary: z.string().nullable(),
  risk_summary: z.string().nullable(),
  evidence_status: z.string(),
  action_status: z.string(),
}).strict();

const signBody = z.object({
  draft_key: uuid,
  expected_version_id: uuid,
  expected_version: z.number().int().positive(),
  expected_content_hash: hash,
}).strict();

const saveReceipt = z.object({
  draftKey: uuid,
  versionId: uuid,
  clientId: uuid,
  version: z.number().int().positive(),
  contentHash: hash,
  replayed: z.boolean(),
}).strict();

const signReceipt = z.object({
  draftKey: uuid,
  assessmentId: uuid,
  versionId: uuid,
  replayed: z.boolean(),
}).strict();

const draftRow = z.object({
  draft_key: uuid,
  version_id: uuid,
  client_id: uuid,
  version: z.number().int().positive(),
  content_hash: hash,
  assessment_date: z.string(),
  result_status: z.enum(["clear", "monitor", "action_required"]),
  symptom_summary: z.string().nullable(),
  risk_summary: z.string().nullable(),
  evidence_status: z.enum(["not_required", "pending", "verified", "rejected"]),
  action_status: z.enum(["none_required", "pending", "in_progress", "completed", "referred"]),
  created_at: z.string(),
  signed_assessment_id: uuid.nullable(),
}).strict();

export type ToccDraft = {
  draftKey: string;
  versionId: string;
  clientId: string;
  version: number;
  contentHash: string;
  assessmentDate: string;
  resultStatus: ClientToccAssessmentFields["resultStatus"];
  symptomSummary: string | null;
  riskSummary: string | null;
  evidenceStatus: ClientToccAssessmentFields["evidenceStatus"];
  actionStatus: ClientToccAssessmentFields["actionStatus"];
  createdAt: string;
  signedAssessmentId: string | null;
};

export function parseToccDraftSaveInput(value: unknown, key: string | null, now = new Date()) {
  const body = draftBody.safeParse(value);
  const idempotencyKey = uuid.safeParse(key);
  if (!body.success || !idempotencyKey.success) {
    throw new IntegrationError("INVALID_TOCC_DRAFT", "草稿內容或冪等鍵格式錯誤。", 400);
  }
  if (body.data.action === "create"
    ? body.data.expected_version !== 0 || body.data.previous_version_id !== null
      || body.data.expected_content_hash !== null
    : body.data.expected_version < 1 || body.data.previous_version_id === null
      || body.data.expected_content_hash === null) {
    throw new IntegrationError("INVALID_TOCC_DRAFT", "草稿版本條件錯誤。", 400);
  }
  const { action, draft_key, previous_version_id, expected_version,
    expected_content_hash, ...fields } = body.data;
  const assessment = parseClientToccAssessmentFields(fields, taipeiCalendarDate(now));
  return {
    action,
    draftKey: draft_key.toLowerCase(),
    previousVersionId: previous_version_id?.toLowerCase() ?? null,
    expectedVersion: expected_version,
    expectedContentHash: expected_content_hash,
    fields: assessment,
    idempotencyKey: idempotencyKey.data.toLowerCase(),
  };
}

export function toToccDraftPayload(input: ReturnType<typeof parseToccDraftSaveInput>) {
  return {
    client_id: input.fields.clientId,
    draft_key: input.draftKey,
    previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash,
    assessment_date: input.fields.assessmentDate,
    result_status: input.fields.resultStatus,
    symptom_summary: input.fields.symptomSummary,
    risk_summary: input.fields.riskSummary,
    evidence_status: input.fields.evidenceStatus,
    action_status: input.fields.actionStatus,
  };
}

export function parseToccDraftSignInput(value: unknown, key: string | null) {
  const body = signBody.safeParse(value);
  const idempotencyKey = uuid.safeParse(key);
  if (!body.success || !idempotencyKey.success) {
    throw new IntegrationError("INVALID_TOCC_DRAFT_SIGN", "簽署版本或冪等鍵格式錯誤。", 400);
  }
  return { ...body.data, idempotencyKey: idempotencyKey.data.toLowerCase() };
}

export function parseToccDraftSaveReceipt(value: unknown, input: ReturnType<typeof parseToccDraftSaveInput>) {
  const result = saveReceipt.safeParse(value);
  if (!result.success || result.data.draftKey.toLowerCase() !== input.draftKey
    || result.data.clientId.toLowerCase() !== input.fields.clientId
    || result.data.version !== input.expectedVersion + 1) {
    throw new IntegrationError("TOCC_DRAFT_RESULT_INVALID", "草稿結果未確認，請保留內容與冪等鍵重試。", 409);
  }
  return result.data;
}

export function parseToccDraftSignReceipt(value: unknown, input: ReturnType<typeof parseToccDraftSignInput>) {
  const result = signReceipt.safeParse(value);
  if (!result.success || result.data.draftKey.toLowerCase() !== input.draft_key.toLowerCase()
    || result.data.versionId.toLowerCase() !== input.expected_version_id.toLowerCase()) {
    throw new IntegrationError("TOCC_DRAFT_SIGN_RESULT_INVALID", "簽署結果未確認，請保留冪等鍵重試。", 409);
  }
  return result.data;
}

export function parseToccDraftRows(value: unknown): ToccDraft[] {
  const rows = z.array(draftRow).max(101).safeParse(value);
  if (!rows.success) {
    throw new IntegrationError("TOCC_DRAFT_SNAPSHOT_INVALID", "TOCC 草稿快照無法確認。", 503);
  }
  return rows.data.map((row) => ({
    draftKey: row.draft_key.toLowerCase(),
    versionId: row.version_id.toLowerCase(),
    clientId: row.client_id.toLowerCase(),
    version: row.version,
    contentHash: row.content_hash,
    assessmentDate: row.assessment_date,
    resultStatus: row.result_status,
    symptomSummary: row.symptom_summary,
    riskSummary: row.risk_summary,
    evidenceStatus: row.evidence_status,
    actionStatus: row.action_status,
    createdAt: row.created_at,
    signedAssessmentId: row.signed_assessment_id?.toLowerCase() ?? null,
  }));
}
