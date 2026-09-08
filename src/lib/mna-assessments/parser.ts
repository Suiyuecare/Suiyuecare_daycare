import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  MNA_FORM_VARIANTS,
  MNA_GOVERNANCE_VERSION,
  type CreateMnaAssessmentInput,
  type MnaAssessmentMutationInput,
  type MnaGovernanceSnapshot,
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
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

const sourceLinks = z.tuple([
  z.literal("https://www.mna-elderly.com/mna-forms"),
  z.literal("https://eprovide.mapi-trust.org/instruments/mini-nutritional-assessment3"),
  z.literal("https://eprovide.mapi-trust.org/instruments/mini-nutritional-assessment2"),
]);

export const mnaGovernanceSnapshotSchema = z.object({
  version_id: z.literal(MNA_GOVERNANCE_VERSION),
  instrument_family_reference: z.literal("MNA"),
  short_form_reference: z.literal("MNA-SF Revision 2009"),
  full_form_reference: z.literal("Long MNA amended 2023"),
  target_locale: z.literal("zh-TW"),
  activation_status: z.literal("license_required_not_configured"),
  formal_use_permitted: z.literal(false),
  official_item_text_embedded: z.literal(false),
  official_answer_options_embedded: z.literal(false),
  official_scoring_formula_embedded: z.literal(false),
  license_agreement_reference: z.null(),
  electronic_implementation_approval_reference: z.null(),
  screenshot_review_reference: z.null(),
  questionnaire_content_status: z.literal("not_configured"),
  scoring_algorithm_status: z.literal("not_configured"),
  risk_classification_status: z.literal("not_configured"),
  automatic_reassessment_rule_status: z.literal("not_configured"),
  automatic_follow_up_rule_status: z.literal("not_configured"),
  source_links: sourceLinks,
  disclaimer: narrative(1000),
}).strict();

export const MNA_UNCONFIGURED_GOVERNANCE_SNAPSHOT: MnaGovernanceSnapshot = {
  version_id: MNA_GOVERNANCE_VERSION,
  instrument_family_reference: "MNA",
  short_form_reference: "MNA-SF Revision 2009",
  full_form_reference: "Long MNA amended 2023",
  target_locale: "zh-TW",
  activation_status: "license_required_not_configured",
  formal_use_permitted: false,
  official_item_text_embedded: false,
  official_answer_options_embedded: false,
  official_scoring_formula_embedded: false,
  license_agreement_reference: null,
  electronic_implementation_approval_reference: null,
  screenshot_review_reference: null,
  questionnaire_content_status: "not_configured",
  scoring_algorithm_status: "not_configured",
  risk_classification_status: "not_configured",
  automatic_reassessment_rule_status: "not_configured",
  automatic_follow_up_rule_status: "not_configured",
  source_links: [
    "https://www.mna-elderly.com/mna-forms",
    "https://eprovide.mapi-trust.org/instruments/mini-nutritional-assessment3",
    "https://eprovide.mapi-trust.org/instruments/mini-nutritional-assessment2",
  ],
  disclaimer: "The MNA questionnaire, answer options, scoring algorithm, risk classification and electronic implementation are not licensed or configured in this system. No official item content is embedded and all formal assessment actions are blocked.",
};

const createSchema = z.object({
  action: z.literal("create_draft"),
  clientId: uuid,
  assessedOn: date,
  formVariant: z.enum(MNA_FORM_VARIANTS),
  governanceVersionId: z.literal(MNA_GOVERNANCE_VERSION),
}).strict();

const reviseSchema = z.object({
  action: z.literal("revise_draft"),
  clientId: uuid,
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
  assessedOn: date,
  formVariant: z.enum(MNA_FORM_VARIANTS),
  governanceVersionId: z.literal(MNA_GOVERNANCE_VERSION),
}).strict();

const signSchema = z.object({
  action: z.literal("sign"),
  clientId: uuid,
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
}).strict();

const correctSchema = z.object({
  action: z.literal("correct"),
  clientId: uuid,
  assessmentKey: uuid,
  previousVersionId: uuid,
  expectedVersion: positiveInteger,
  correctionReason: narrative(1000),
}).strict();

const errorDetailSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,119}$/u),
  message: z.string().trim().min(1).max(1000),
  field: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/u)
    .optional(),
}).strict();
const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(errorDetailSchema).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_MNA_ASSESSMENT", message, 400, field);
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function parseCreateMnaAssessment(
  body: unknown,
  idempotencyKey: string | null,
): CreateMnaAssessmentInput {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    invalid("MNA 表單種類、評估日期或治理版本未通過驗證。");
  }
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseMnaAssessmentMutation(
  body: unknown,
  idempotencyKey: string | null,
): MnaAssessmentMutationInput {
  const parsed = z.discriminatedUnion("action", [
    reviseSchema, signSchema, correctSchema,
  ]).safeParse(body);
  if (!parsed.success) {
    invalid("MNA 操作、預期版本或更正理由未通過驗證。");
  }
  return { ...parsed.data, idempotencyKey: parseIdempotencyKey(idempotencyKey) };
}

export function parseMnaActionError(payload: unknown) {
  const parsed = apiErrorSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

