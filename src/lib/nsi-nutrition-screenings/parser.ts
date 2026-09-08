import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_SERVICE_STATUSES,
  NSI_NUTRITION_ITEM_IDS,
  NSI_NUTRITION_OBSERVATION_LABELS,
  NSI_NUTRITION_PREVIEW_STATUSES,
  NSI_NUTRITION_RULE_VERSION,
  type CreateNsiNutritionDraftInput,
  type NsiNutritionAnswers,
  type NsiNutritionScreeningMutationInput,
  type NsiNutritionScreeningOperationResult,
  type NsiNutritionRuleSnapshot,
  type NsiNutritionTrialPreview,
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
const nullableObservedCount = z.union([
  z.number().int().min(0).max(6),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().min(0).max(6)),
]).nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

export const nsiNutritionAnswerSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("answered"),
    value: z.enum(["present", "absent"]),
  }).strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({
    state: z.literal("not_applicable"),
    reason: narrative(500),
  }).strict(),
]);

const answerShape = Object.fromEntries(
  NSI_NUTRITION_ITEM_IDS.map((id) => [id, nsiNutritionAnswerSchema]),
) as Record<(typeof NSI_NUTRITION_ITEM_IDS)[number], typeof nsiNutritionAnswerSchema>;
export const nsiNutritionAnswersSchema = z.object(answerShape).strict();

const fieldDefinitionSchema = z.object({
  id: z.enum(NSI_NUTRITION_ITEM_IDS),
  label: narrative(200),
  data_kind: z.literal("manual_presence_observation"),
}).strict();

export const nsiNutritionRuleSnapshotSchema = z.object({
  version_id: z.literal(NSI_NUTRITION_RULE_VERSION),
  instrument: z.literal("manual_unstandardized_nutrition_observations"),
  rule_revision: z.literal(1),
  activation_status: z.literal("candidate_unactivated"),
  activated_at: z.null(),
  governance_review_required: z.literal(true),
  formal_use_permitted: z.literal(false),
  field_ids: z.array(z.enum(NSI_NUTRITION_ITEM_IDS)).length(6),
  field_definitions: z.array(fieldDefinitionSchema).length(6),
  answer_values: z.tuple([z.literal("present"), z.literal("absent")]),
  completeness_policy: z.literal("all_fields_answered_for_non_clinical_count"),
  present_count_policy: z.literal(
    "count_present_only_when_complete_non_clinical",
  ),
  missing_policy: z.literal("no_count_and_never_zero"),
  not_applicable_policy: z.literal("no_count_and_never_zero"),
  formal_questionnaire_status: z.literal("not_configured"),
  licensed_source_status: z.literal("not_configured"),
  formal_weights_status: z.literal("not_configured"),
  formal_scoring_status: z.literal("not_configured"),
  formal_risk_classification_status: z.literal("not_configured"),
  disclaimer: narrative(500),
}).strict().superRefine((value, context) => {
  const equal = (left: readonly unknown[], right: readonly unknown[]) =>
    JSON.stringify(left) === JSON.stringify(right);
  const expectedDefinitions = NSI_NUTRITION_ITEM_IDS.map((id) => ({
    id,
    label: NSI_NUTRITION_OBSERVATION_LABELS[id],
    data_kind: "manual_presence_observation" as const,
  }));
  if (!equal(value.field_ids, NSI_NUTRITION_ITEM_IDS) ||
    !equal(value.field_definitions, expectedDefinitions)) {
    context.addIssue({
      code: "custom",
      path: ["field_definitions"],
      message: "人工營養觀察候選欄位快照與受治理版本不一致。",
    });
  }
});

const fields = {
  clientId: uuid,
  assessedOn: date,
  answers: nsiNutritionAnswersSchema,
  ruleVersionId: z.literal(NSI_NUTRITION_RULE_VERSION),
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
  rule_version_id: z.literal(NSI_NUTRITION_RULE_VERSION),
  governance_status: z.literal("candidate_unactivated"),
  preview_status: z.enum(NSI_NUTRITION_PREVIEW_STATUSES),
  preview_observed_count: nullableObservedCount,
  content_hash: hash,
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
    ruleVersionId: z.literal(NSI_NUTRITION_RULE_VERSION),
    governanceStatus: z.literal("candidate_unactivated"),
    previewStatus: z.enum(NSI_NUTRITION_PREVIEW_STATUSES),
    previewObservedCount: nullableObservedCount,
    contentHash: hash,
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.tuple([]),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_NSI_NUTRITION_SCREENING", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function buildNsiNutritionTrialPreview(answers: NsiNutritionAnswers): NsiNutritionTrialPreview {
  if (Object.values(answers).some((answer) => answer.state !== "answered")) {
    return { status: "incomplete", observedCount: null };
  }
  const observedCount = Object.values(answers).filter(
    (answer) => answer.state === "answered" && answer.value === "present",
  ).length;
  return {
    status: "candidate_complete",
    observedCount,
  };
}

export function parseCreateNsiNutritionDraft(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateNsiNutritionDraftInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) invalid("個案、觀察日期或六項人工營養觀察未通過驗證。");
  buildNsiNutritionTrialPreview(parsed.data.answers);
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseNsiNutritionScreeningMutation(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): NsiNutritionScreeningMutationInput {
  const schema = body.action === "revise_draft" ? reviseSchema
    : body.action === "sign" ? signSchema : null;
  if (!schema) invalid("不支援的人工營養觀察操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("評估內容、版本或簽署請求未通過驗證。");
  if (parsed.data.action === "revise_draft") {
    buildNsiNutritionTrialPreview(parsed.data.answers);
  }
  return ({
    ...parsed.data,
    idempotencyKey: parseIdempotencyKey(idempotencyKey),
  }) as NsiNutritionScreeningMutationInput;
}

export function parseNsiNutritionOperationResult(
  value: unknown,
  action: NsiNutritionScreeningOperationResult["action"],
): Omit<NsiNutritionScreeningOperationResult, "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "NSI_NUTRITION_RECEIPT_INVALID",
      "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
      502,
    );
  }
  const row = parsed.data;
  const aligned = row.preview_status === "candidate_complete"
    ? row.preview_observed_count !== null
    : row.preview_observed_count === null;
  if (!aligned) {
    throw new IntegrationError(
      "NSI_NUTRITION_RECEIPT_INVALID",
      "人工觀察重播憑證不一致；畫面不會把操作當作成功。",
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
    previewObservedCount: row.preview_observed_count,
    contentHash: row.content_hash,
    committedAt: row.committed_at,
    replayed: row.replayed,
  };
}

export type NsiNutritionActionExpectation = {
  action: NsiNutritionScreeningOperationResult["action"];
  clientId: string;
  assessmentKey?: string;
  expectedVersion?: number;
};

export function parseNsiNutritionActionSuccess(
  value: unknown,
  expectation: NsiNutritionActionExpectation,
  httpStatus: number,
) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_NSI_NUTRITION_SUCCESS");
  const data = parsed.data.data;
  if (data.action !== expectation.action || data.clientId !== expectation.clientId ||
    data.recordState !== "draft_preview" ||
    (expectation.assessmentKey !== undefined &&
      data.assessmentKey !== expectation.assessmentKey) ||
    (expectation.expectedVersion !== undefined &&
      data.assessmentVersion !== expectation.expectedVersion + 1) ||
    (expectation.action === "create_draft" && data.assessmentVersion !== 1) ||
    httpStatus !== (data.replayed ? 200 : 201)) {
    throw new Error("MISMATCHED_NSI_NUTRITION_SUCCESS");
  }
  return parsed.data;
}

export function parseNsiNutritionActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseNsiNutritionRuleSnapshot(value: unknown): NsiNutritionRuleSnapshot {
  const parsed = nsiNutritionRuleSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_NSI_NUTRITION_RULE_SNAPSHOT");
  return parsed.data;
}
