import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { scoreAssessment } from "@/lib/assessments";
import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_STATUSES,
  EDUCATION_VALUES,
  SPMSQ_ITEM_IDS,
  SPMSQ_PREVIEW_STATUSES,
  SPMSQ_RULE_VERSION,
  type CreateSpmsqDraftInput,
  type SpmsqAnswers,
  type SpmsqAssessmentMutationInput,
  type SpmsqAssessmentOperationResult,
  type SpmsqEducationContext,
  type SpmsqTrialPreview,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const positiveInteger = z.number().int().positive().safe();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed) === value;
});
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const nullableInteger = z.union([
  z.number().int().min(0).max(10),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().min(0).max(10)),
]).nullable();

export const spmsqAnswerSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("answered"),
    value: z.enum(["correct", "incorrect"]),
  }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({
    state: z.literal("not_applicable"),
    reason: narrative(500),
  }).strict(),
]);

const answerShape = Object.fromEntries(
  SPMSQ_ITEM_IDS.map((id) => [id, spmsqAnswerSchema]),
) as Record<(typeof SPMSQ_ITEM_IDS)[number], typeof spmsqAnswerSchema>;

export const spmsqAnswersSchema = z.object(answerShape).strict();

export const spmsqEducationContextSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("answered"),
    value: z.enum(EDUCATION_VALUES),
  }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({
    state: z.literal("not_applicable"),
    reason: narrative(500),
  }).strict(),
]);

export const spmsqCulturalContextSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("recorded"), note: narrative(2000) }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({
    state: z.literal("not_applicable"),
    reason: narrative(500),
  }).strict(),
]);

const candidateBandSchema = z.object({
  key: z.string().trim().min(1).max(80),
  min: z.number().int().min(0).max(10),
  max: z.number().int().min(0).max(10),
}).strict();

export const spmsqRuleSnapshotSchema = z.object({
  version_id: z.literal(SPMSQ_RULE_VERSION),
  instrument: z.literal("spmsq"),
  rule_revision: z.literal(1),
  activation_status: z.literal("candidate_unactivated"),
  activated_at: z.null(),
  review_required: z.literal(true),
  formal_use_permitted: z.literal(false),
  item_ids: z.array(z.enum(SPMSQ_ITEM_IDS)).length(10),
  answer_weights: z.object({
    correct: z.literal(0),
    incorrect: z.literal(1),
  }).strict(),
  missing_policy: z.literal("no_preview_and_never_zero"),
  not_applicable_policy: z.literal("no_preview_and_never_zero"),
  education_adjustment: z.object({
    grade_school_or_less: z.literal(-1),
    middle_or_high_school: z.literal(0),
    beyond_high_school: z.literal(1),
    clamp_min: z.literal(0),
    clamp_max: z.literal(10),
  }).strict(),
  cultural_adjustment: z.object({
    status: z.literal("not_configured"),
    numeric_effect: z.literal(0),
    policy: z.literal(
      "context_is_preserved_but_never_changes_trial_preview",
    ),
  }).strict(),
  candidate_bands: z.array(candidateBandSchema).length(4),
  disclaimer: narrative(500),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value.item_ids) !== JSON.stringify(SPMSQ_ITEM_IDS)) {
    context.addIssue({
      code: "custom",
      path: ["item_ids"],
      message: "候選規則題號順序不一致。",
    });
  }
  const expectedBands = [
    ["reference_0_2_errors", 0, 2],
    ["mild_3_4_errors", 3, 4],
    ["moderate_5_7_errors", 5, 7],
    ["high_8_10_errors", 8, 10],
  ];
  if (value.candidate_bands.some((band, index) => {
    const expected = expectedBands[index]!;
    return band.key !== expected[0] || band.min !== expected[1] ||
      band.max !== expected[2];
  })) {
    context.addIssue({
      code: "custom",
      path: ["candidate_bands"],
      message: "候選規則區間不一致。",
    });
  }
});

const fields = {
  clientId: uuid,
  assessedOn: date,
  answers: spmsqAnswersSchema,
  educationContext: spmsqEducationContextSchema,
  culturalContext: spmsqCulturalContextSchema,
  ruleVersionId: z.literal(SPMSQ_RULE_VERSION),
};
const createSchema = z.object({ action: z.literal("create_draft") })
  .extend(fields).strict();
const reviseSchema = z.object({
  action: z.literal("revise_draft"),
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).extend(fields).strict();
const signSchema = z.object({
  action: z.literal("sign"),
  clientId: uuid,
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).strict();

const operationRowSchema = z.object({
  operation_id: uuid,
  client_id: uuid,
  assessment_key: uuid,
  version_id: uuid,
  assessment_version: z.union([
    positiveInteger,
    z.string().regex(/^[1-9]\d*$/u).transform(Number).pipe(positiveInteger),
  ]),
  record_state: z.literal("draft_preview"),
  assessed_on: date,
  author_user_id: uuid,
  service_status_at_assessment: z.enum(CLIENT_SERVICE_STATUSES),
  rule_version_id: z.literal(SPMSQ_RULE_VERSION),
  governance_status: z.literal("candidate_unactivated"),
  preview_status: z.enum(SPMSQ_PREVIEW_STATUSES),
  preview_raw_errors: nullableInteger,
  preview_adjusted_errors: nullableInteger,
  preview_band_key: z.string().trim().min(1).max(80).nullable(),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: z.string().trim().min(1).max(500),
  field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u)
    .optional(),
}).strict();
const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(errorDetailSchema).min(1).max(10),
}).strict();
const successSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    action: z.enum(["create_draft", "revise_draft"]),
    operationId: uuid,
    clientId: uuid,
    assessmentKey: uuid,
    versionId: uuid,
    assessmentVersion: positiveInteger,
    recordState: z.literal("draft_preview"),
    assessedOn: date,
    authorUserId: uuid,
    serviceStatusAtAssessment: z.enum(CLIENT_SERVICE_STATUSES),
    ruleVersionId: z.literal(SPMSQ_RULE_VERSION),
    governanceStatus: z.literal("candidate_unactivated"),
    previewStatus: z.enum(SPMSQ_PREVIEW_STATUSES),
    previewRawErrors: nullableInteger,
    previewAdjustedErrors: nullableInteger,
    previewBandKey: z.string().trim().min(1).max(80).nullable(),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_SPMSQ_ASSESSMENT", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function buildSpmsqTrialPreview(
  answers: SpmsqAnswers,
  educationContext: SpmsqEducationContext,
): SpmsqTrialPreview {
  if (
    Object.values(answers).some((answer) => answer.state !== "answered") ||
    educationContext.state !== "answered"
  ) {
    return {
      status: "incomplete",
      rawErrors: null,
      adjustedErrors: null,
      bandKey: null,
    };
  }
  const result = scoreAssessment({
    versionId: SPMSQ_RULE_VERSION,
    answers,
    context: { education_adjustment: educationContext.value },
  });
  const score = result.score;
  if (
    result.status !== "complete" || score === null || score.raw === null ||
    score.adjusted === null || !result.classification
  ) {
    throw new Error("SPMSQ_CANDIDATE_RULE_DRIFT");
  }
  return {
    status: "candidate_complete",
    rawErrors: score.raw,
    adjustedErrors: score.adjusted,
    bandKey: result.classification.key,
  };
}

export function parseCreateSpmsqDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateSpmsqDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    invalid("個案、評估日、十題答案、教育脈絡或文化脈絡未通過驗證。");
  }
  buildSpmsqTrialPreview(parsed.data.answers, parsed.data.educationContext);
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseSpmsqAssessmentMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): SpmsqAssessmentMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema : null;
  if (!schema) invalid("不支援的 SPMSQ 評估操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("評估內容、版本或正式簽署資料未通過驗證。");
  if (parsed.data.action === "revise_draft") {
    buildSpmsqTrialPreview(
      parsed.data.answers,
      parsed.data.educationContext,
    );
  }
  return {
    ...parsed.data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  } as SpmsqAssessmentMutationInput;
}

export function parseSpmsqOperationResult(
  value: unknown,
  action: SpmsqAssessmentOperationResult["action"],
): Omit<SpmsqAssessmentOperationResult, "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "SPMSQ_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  const row = parsed.data;
  const previewAligned = row.preview_status === "candidate_complete"
    ? row.preview_raw_errors !== null && row.preview_adjusted_errors !== null &&
      row.preview_band_key !== null
    : row.preview_raw_errors === null && row.preview_adjusted_errors === null &&
      row.preview_band_key === null;
  if (!previewAligned) {
    throw new IntegrationError(
      "SPMSQ_RECEIPT_INVALID",
      "候選試算憑證不一致；畫面不會把操作當作成功。",
      502,
    );
  }
  return {
    action,
    operationId: row.operation_id,
    clientId: row.client_id,
    assessmentKey: row.assessment_key,
    versionId: row.version_id,
    assessmentVersion: row.assessment_version,
    recordState: row.record_state,
    assessedOn: row.assessed_on,
    authorUserId: row.author_user_id,
    serviceStatusAtAssessment: row.service_status_at_assessment,
    ruleVersionId: row.rule_version_id,
    governanceStatus: row.governance_status,
    previewStatus: row.preview_status,
    previewRawErrors: row.preview_raw_errors,
    previewAdjustedErrors: row.preview_adjusted_errors,
    previewBandKey: row.preview_band_key,
    committedAt: row.committed_at,
    replayed: row.replayed,
  };
}

export type SpmsqActionExpectation = {
  action: SpmsqAssessmentOperationResult["action"];
  clientId: string;
  assessmentKey?: string;
  expectedVersion?: number;
};

export function parseSpmsqActionSuccess(
  value: unknown,
  expectation: SpmsqActionExpectation,
  httpStatus: number,
) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_SPMSQ_SUCCESS");
  const data = parsed.data.data;
  if (
    data.action !== expectation.action || data.clientId !== expectation.clientId ||
    data.recordState !== "draft_preview" ||
    (expectation.assessmentKey !== undefined &&
      data.assessmentKey !== expectation.assessmentKey) ||
    (expectation.expectedVersion !== undefined &&
      data.assessmentVersion !== expectation.expectedVersion + 1) ||
    (expectation.action === "create_draft" && data.assessmentVersion !== 1) ||
    httpStatus !== (data.replayed ? 200 : 201)
  ) throw new Error("MISMATCHED_SPMSQ_SUCCESS");
  return parsed.data;
}

export function parseSpmsqActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
