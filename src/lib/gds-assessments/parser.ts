import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { scoreAssessment } from "@/lib/assessments";
import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_STATUSES,
  GDS_ITEM_IDS,
  GDS_PREVIEW_STATUSES,
  GDS_RULE_VERSION,
  GDS_SCORED_NO_ITEM_IDS,
  GDS_SCORED_YES_ITEM_IDS,
  type CreateGdsDraftInput,
  type GdsAnswers,
  type GdsAssessmentMutationInput,
  type GdsAssessmentOperationResult,
  type GdsRuleSnapshot,
  type GdsTrialPreview,
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
const nullablePoints = z.union([
  z.number().int().min(0).max(15),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().min(0).max(15)),
]).nullable();

export const gdsAnswerSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("answered"),
    value: z.enum(["yes", "no"]),
  }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({
    state: z.literal("not_applicable"),
    reason: narrative(500),
  }).strict(),
]);

const answerShape = Object.fromEntries(
  GDS_ITEM_IDS.map((id) => [id, gdsAnswerSchema]),
) as Record<(typeof GDS_ITEM_IDS)[number], typeof gdsAnswerSchema>;
export const gdsAnswersSchema = z.object(answerShape).strict();

const candidateBandSchema = z.object({
  key: z.string().trim().min(1).max(80),
  min: z.number().int().min(0).max(15),
  max: z.number().int().min(0).max(15),
}).strict();

export const gdsRuleSnapshotSchema = z.object({
  version_id: z.literal(GDS_RULE_VERSION),
  instrument: z.literal("gds_15"),
  rule_revision: z.literal(1),
  activation_status: z.literal("candidate_unactivated"),
  activated_at: z.null(),
  review_required: z.literal(true),
  formal_use_permitted: z.literal(false),
  item_ids: z.array(z.enum(GDS_ITEM_IDS)).length(15),
  answer_values: z.tuple([z.literal("yes"), z.literal("no")]),
  scored_yes_item_ids: z.array(z.enum(GDS_ITEM_IDS)).length(10),
  scored_no_item_ids: z.array(z.enum(GDS_ITEM_IDS)).length(5),
  missing_policy: z.literal("no_preview_and_never_zero"),
  not_applicable_policy: z.literal("no_preview_and_never_zero"),
  strict_complete_required: z.literal(true),
  candidate_bands: z.array(candidateBandSchema).length(4),
  disclaimer: narrative(500),
}).strict().superRefine((value, context) => {
  const equal = (left: readonly unknown[], right: readonly unknown[]) =>
    JSON.stringify(left) === JSON.stringify(right);
  const expectedBands = [
    ["reference_0_4", 0, 4],
    ["elevated_5_8", 5, 8],
    ["high_9_11", 9, 11],
    ["very_high_12_15", 12, 15],
  ] as const;
  if (!equal(value.item_ids, GDS_ITEM_IDS) ||
    !equal(value.scored_yes_item_ids, GDS_SCORED_YES_ITEM_IDS) ||
    !equal(value.scored_no_item_ids, GDS_SCORED_NO_ITEM_IDS) ||
    value.candidate_bands.some((band, index) => {
      const expected = expectedBands[index]!;
      return band.key !== expected[0] || band.min !== expected[1] ||
        band.max !== expected[2];
    })) {
    context.addIssue({
      code: "custom",
      path: ["candidate_bands"],
      message: "GDS 候選規則快照與受治理版本不一致。",
    });
  }
});

const fields = {
  clientId: uuid,
  assessedOn: date,
  answers: gdsAnswersSchema,
  ruleVersionId: z.literal(GDS_RULE_VERSION),
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
  rule_version_id: z.literal(GDS_RULE_VERSION),
  governance_status: z.literal("candidate_unactivated"),
  preview_status: z.enum(GDS_PREVIEW_STATUSES),
  preview_candidate_points: nullablePoints,
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
    ruleVersionId: z.literal(GDS_RULE_VERSION),
    governanceStatus: z.literal("candidate_unactivated"),
    previewStatus: z.enum(GDS_PREVIEW_STATUSES),
    previewCandidatePoints: nullablePoints,
    previewBandKey: z.string().trim().min(1).max(80).nullable(),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_GDS_ASSESSMENT", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function buildGdsTrialPreview(answers: GdsAnswers): GdsTrialPreview {
  if (Object.values(answers).some((answer) => answer.state !== "answered")) {
    return { status: "incomplete", candidatePoints: null, bandKey: null };
  }
  const result = scoreAssessment({ versionId: GDS_RULE_VERSION, answers });
  const score = result.score;
  if (result.status !== "complete" || score === null || score.raw === null ||
    score.adjusted === null || score.raw !== score.adjusted ||
    !result.classification) {
    throw new Error("GDS_CANDIDATE_RULE_DRIFT");
  }
  return {
    status: "candidate_complete",
    candidatePoints: score.raw,
    bandKey: result.classification.key,
  };
}

export function parseCreateGdsDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateGdsDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) invalid("個案、評估日期或十五題答案未通過驗證。");
  buildGdsTrialPreview(parsed.data.answers);
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseGdsAssessmentMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): GdsAssessmentMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema : null;
  if (!schema) invalid("不支援的 GDS 評估操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("評估內容、版本或簽署請求未通過驗證。");
  if (parsed.data.action === "revise_draft") {
    buildGdsTrialPreview(parsed.data.answers);
  }
  return ({
    ...parsed.data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  }) as GdsAssessmentMutationInput;
}

export function parseGdsOperationResult(
  value: unknown,
  action: GdsAssessmentOperationResult["action"],
): Omit<GdsAssessmentOperationResult, "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "GDS_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  const row = parsed.data;
  const aligned = row.preview_status === "candidate_complete"
    ? row.preview_candidate_points !== null && row.preview_band_key !== null
    : row.preview_candidate_points === null && row.preview_band_key === null;
  if (!aligned) {
    throw new IntegrationError(
      "GDS_RECEIPT_INVALID",
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
    previewCandidatePoints: row.preview_candidate_points,
    previewBandKey: row.preview_band_key,
    committedAt: row.committed_at,
    replayed: row.replayed,
  };
}

export type GdsActionExpectation = {
  action: GdsAssessmentOperationResult["action"];
  clientId: string;
  assessmentKey?: string;
  expectedVersion?: number;
};

export function parseGdsActionSuccess(
  value: unknown,
  expectation: GdsActionExpectation,
  httpStatus: number,
) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_GDS_SUCCESS");
  const data = parsed.data.data;
  if (data.action !== expectation.action || data.clientId !== expectation.clientId ||
    data.recordState !== "draft_preview" ||
    (expectation.assessmentKey !== undefined &&
      data.assessmentKey !== expectation.assessmentKey) ||
    (expectation.expectedVersion !== undefined &&
      data.assessmentVersion !== expectation.expectedVersion + 1) ||
    (expectation.action === "create_draft" && data.assessmentVersion !== 1) ||
    httpStatus !== (data.replayed ? 200 : 201)) {
    throw new Error("MISMATCHED_GDS_SUCCESS");
  }
  return parsed.data;
}

export function parseGdsActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseGdsRuleSnapshot(value: unknown): GdsRuleSnapshot {
  const parsed = gdsRuleSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_GDS_RULE_SNAPSHOT");
  return parsed.data;
}
