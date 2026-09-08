import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  MEAL_DISCLOSURE_STATES, MEAL_KINDS, MEAL_TEXTURE_STATES,
  type MealMutationInput, type MealMutationReceipt,
} from "./types";

export const MEAL_MUTATION_MAX_BYTES = 64 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const clean = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const reference = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/u),
  label: clean(120),
}).strict();
const references = z.array(reference).max(50).superRefine((items, context) => {
  if (new Set(items.map((item) => item.code)).size !== items.length) {
    context.addIssue({ code: "custom", message: "代碼不得重複。" });
  }
});
const version = {
  previous_version_id: uuid.nullable(),
  expected_version: z.number().int().min(0).max(1_000_000),
};
const setRequirement = z.object({
  action: z.literal("set_requirement"), client_id: uuid,
  effective_from: calendarDate, ...version,
  texture_state: z.enum(MEAL_TEXTURE_STATES), texture_label: clean(120).nullable(),
  allergy_status: z.enum(MEAL_DISCLOSURE_STATES), allergens: references,
  contraindication_status: z.enum(MEAL_DISCLOSURE_STATES), contraindications: references,
  note: narrative(1_000).nullable(),
}).strict();
const savePlan = z.object({
  action: z.literal("save_plan"), service_date: calendarDate,
  meal_kind: z.enum(MEAL_KINDS), menu_title: clean(160), ingredients: references.min(1),
  extra_portions: z.number().int().min(0).max(100), ...version,
}).strict();
const completePlan = z.object({
  action: z.literal("complete_plan"), plan_version_id: uuid,
  expected_version: z.number().int().positive().max(1_000_000),
  resolutions: z.array(z.object({
    conflict_key: z.string().trim().regex(/^[a-f0-9]{64}$/u),
    disposition: z.enum(["verified_safe", "substituted", "excluded"]),
    note: narrative(1_000),
  }).strict()).max(500),
  actual_portions: z.array(z.object({
    client_id: uuid, portions: z.number().int().min(0).max(5),
  }).strict()).max(500),
  extra_actual_portions: z.number().int().min(0).max(100),
  variance_reason: narrative(1_000).nullable(),
}).strict();
const mutation = z.discriminatedUnion("action", [setRequirement, savePlan, completePlan]);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) &&
  Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
const receipt = z.object({
  operation_id: uuid, action: z.enum(["set_requirement", "save_plan", "complete_plan"]),
  entity_type: z.enum(["requirement", "plan"]), entity_id: uuid, stable_key: uuid,
  version: z.number().int().positive(), status: z.enum(["recorded", "review", "prepared"]),
  client_id: uuid.nullable(), service_date: calendarDate.nullable(),
  meal_kind: z.enum(MEAL_KINDS).nullable(), attendance_count: z.number().int().nonnegative().nullable(),
  conflict_count: z.number().int().nonnegative().nullable(),
  planned_portion_total: z.number().int().nonnegative().nullable(),
  actual_portion_total: z.number().int().nonnegative().nullable(),
  committed_at: timestamp, replayed: z.boolean(),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_MEAL_OPERATION", message, 400);
}

export function parseMealMutation(value: unknown, idempotencyHeader: string | null): MealMutationInput {
  const parsed = mutation.safeParse(value);
  const key = uuid.safeParse(idempotencyHeader);
  if (!parsed.success || !key.success) invalid("餐食操作內容或冪等鍵無效。");
  const body = parsed.data;
  if (body.action !== "complete_plan" &&
    ((body.previous_version_id === null) !== (body.expected_version === 0))) {
    invalid("前版識別與預期版本不一致。");
  }
  if (body.action === "set_requirement") {
    if ((body.texture_state === "recorded") !== (body.texture_label !== null) ||
      (body.allergy_status === "recorded") !== (body.allergens.length > 0) ||
      (body.contraindication_status === "recorded") !== (body.contraindications.length > 0)) {
      invalid("質地、過敏或禁忌狀態與內容不一致。");
    }
    return { action: body.action, clientId: body.client_id,
      previousVersionId: body.previous_version_id, expectedVersion: body.expected_version,
      effectiveFrom: body.effective_from, textureState: body.texture_state,
      textureLabel: body.texture_label, allergyStatus: body.allergy_status,
      allergens: body.allergens, contraindicationStatus: body.contraindication_status,
      contraindications: body.contraindications, note: body.note, idempotencyKey: key.data };
  }
  if (body.action === "save_plan") return { action: body.action,
    previousVersionId: body.previous_version_id, expectedVersion: body.expected_version,
    serviceDate: body.service_date, mealKind: body.meal_kind, menuTitle: body.menu_title,
    ingredients: body.ingredients, extraPortions: body.extra_portions,
    idempotencyKey: key.data };
  if (new Set(body.resolutions.map((item) => item.conflict_key)).size !== body.resolutions.length ||
    new Set(body.actual_portions.map((item) => item.client_id)).size !== body.actual_portions.length) {
    invalid("衝突或個案份數不得重複。");
  }
  return { action: body.action, planVersionId: body.plan_version_id,
    expectedVersion: body.expected_version, resolutions: body.resolutions.map((item) => ({
      conflictKey: item.conflict_key, disposition: item.disposition, note: item.note,
    })), actualPortions: body.actual_portions.map((item) => ({
      clientId: item.client_id, portions: item.portions,
    })), extraActualPortions: body.extra_actual_portions,
    varianceReason: body.variance_reason, idempotencyKey: key.data };
}

export function mealMutationPayload(input: MealMutationInput) {
  if (input.action === "set_requirement") return {
    client_id: input.clientId, previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion, effective_from: input.effectiveFrom,
    texture_state: input.textureState, texture_label: input.textureLabel,
    allergy_status: input.allergyStatus, allergens: input.allergens,
    contraindication_status: input.contraindicationStatus,
    contraindications: input.contraindications, note: input.note,
  };
  if (input.action === "save_plan") return {
    previous_version_id: input.previousVersionId, expected_version: input.expectedVersion,
    service_date: input.serviceDate, meal_kind: input.mealKind,
    menu_title: input.menuTitle, ingredients: input.ingredients,
    extra_portions: input.extraPortions,
  };
  return { plan_version_id: input.planVersionId, expected_version: input.expectedVersion,
    resolutions: input.resolutions.map((item) => ({ conflict_key: item.conflictKey,
      disposition: item.disposition, note: item.note })),
    actual_portions: input.actualPortions.map((item) => ({ client_id: item.clientId,
      portions: item.portions })), extra_actual_portions: input.extraActualPortions,
    variance_reason: input.varianceReason };
}

export function parseMealMutationReceipt(value: unknown, input: MealMutationInput): MealMutationReceipt {
  const parsed = receipt.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "MEAL_RECEIPT_INVALID", "餐食操作回執不完整；請保留相同操作鍵核對。", 502,
  );
  const row = parsed.data;
  const expectedEntity = input.action === "set_requirement" ? "requirement" : "plan";
  if (row.action !== input.action || row.entity_type !== expectedEntity ||
    row.version !== input.expectedVersion + 1 ||
    (input.action === "set_requirement" && (row.client_id !== input.clientId ||
      row.status !== "recorded")) ||
    (input.action === "save_plan" && (row.service_date !== input.serviceDate ||
      row.meal_kind !== input.mealKind || row.status !== "review")) ||
    (input.action === "complete_plan" && (row.entity_id === input.planVersionId ||
      row.status !== "prepared"))) {
    throw new IntegrationError("MEAL_RECEIPT_INVALID",
      "餐食操作回執與送出內容不一致；請重新載入。", 502);
  }
  return { operationId: row.operation_id, action: row.action,
    entityType: row.entity_type, entityId: row.entity_id, stableKey: row.stable_key,
    version: row.version, status: row.status, clientId: row.client_id,
    serviceDate: row.service_date, mealKind: row.meal_kind,
    attendanceCount: row.attendance_count, conflictCount: row.conflict_count,
    plannedPortionTotal: row.planned_portion_total,
    actualPortionTotal: row.actual_portion_total, committedAt: row.committed_at,
    replayed: row.replayed, persisted: true, demo: false };
}
