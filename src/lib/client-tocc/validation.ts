import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CLIENT_TOCC_ACTION_STATUSES,
  CLIENT_TOCC_EVIDENCE_STATUSES,
  CLIENT_TOCC_RESULT_STATUSES,
  type ClientToccAssessmentFields,
} from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

const summarySchema = z
  .string()
  .trim()
  .max(1_000, "摘要不得超過 1000 字。")
  .refine(
    (value) => !CONTROL_CHARACTER_PATTERN.test(value),
    "摘要不得包含控制字元。",
  )
  .nullable()
  .optional()
  .transform((value) => value || null);

const assessmentBodySchema = z
  .object({
    client_id: z.uuid("個案識別碼格式錯誤。"),
    assessment_date: z.string(),
    result_status: z.enum(CLIENT_TOCC_RESULT_STATUSES),
    symptom_summary: summarySchema,
    risk_summary: summarySchema,
    evidence_status: z.enum(CLIENT_TOCC_EVIDENCE_STATUSES),
    action_status: z.enum(CLIENT_TOCC_ACTION_STATUSES),
  })
  .strict();

export function taipeiCalendarDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

export function calculateToccValidThrough(assessmentDate: string) {
  if (!isCalendarDate(assessmentDate)) {
    throw new Error("INVALID_TOCC_CALENDAR_DATE");
  }
  const [year, month, day] = assessmentDate.split("-").map(Number);
  const lastDayOfDestinationMonth = new Date(
    Date.UTC(year!, month! + 1, 0),
  ).getUTCDate();
  const target = new Date(
    Date.UTC(year!, month!, Math.min(day!, lastDayOfDestinationMonth)),
  );
  return [
    target.getUTCFullYear().toString().padStart(4, "0"),
    (target.getUTCMonth() + 1).toString().padStart(2, "0"),
    target.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function addCalendarDays(value: string, days: number) {
  if (!isCalendarDate(value) || !Number.isInteger(days)) {
    throw new Error("INVALID_TOCC_CALENDAR_DATE");
  }
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year!, month! - 1, day! + days));
  return [
    target.getUTCFullYear().toString().padStart(4, "0"),
    (target.getUTCMonth() + 1).toString().padStart(2, "0"),
    target.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function parseClientToccAssessmentFields(
  value: unknown,
  todayTaipei = taipeiCalendarDate(),
): ClientToccAssessmentFields {
  const parsed = assessmentBodySchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_CLIENT_TOCC",
      issue?.message || "TOCC 評估欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }

  if (
    !isCalendarDate(parsed.data.assessment_date) ||
    !isCalendarDate(todayTaipei) ||
    parsed.data.assessment_date > todayTaipei
  ) {
    throw new IntegrationError(
      "INVALID_CLIENT_TOCC",
      "評估日必須是 Asia/Taipei 今日或更早的有效日期。",
      400,
      "assessment_date",
    );
  }

  if (
    parsed.data.result_status !== "clear" &&
    !parsed.data.symptom_summary &&
    !parsed.data.risk_summary
  ) {
    throw new IntegrationError(
      "INVALID_CLIENT_TOCC",
      "追蹤或需處置結果至少要填寫症狀或風險摘要。",
      400,
      "symptom_summary",
    );
  }
  if (
    parsed.data.result_status === "action_required" &&
    parsed.data.action_status === "none_required"
  ) {
    throw new IntegrationError(
      "INVALID_CLIENT_TOCC",
      "需處置結果不能選擇無需處置。",
      400,
      "action_status",
    );
  }

  return {
    clientId: parsed.data.client_id.toLowerCase(),
    assessmentDate: parsed.data.assessment_date,
    resultStatus: parsed.data.result_status,
    symptomSummary: parsed.data.symptom_summary,
    riskSummary: parsed.data.risk_summary,
    evidenceStatus: parsed.data.evidence_status,
    actionStatus: parsed.data.action_status,
  };
}

export function toClientToccDatabaseItem(
  value: ClientToccAssessmentFields,
  idempotencyKey: string,
) {
  return {
    client_id: value.clientId,
    assessment_date: value.assessmentDate,
    result_status: value.resultStatus,
    symptom_summary: value.symptomSummary,
    risk_summary: value.riskSummary,
    evidence_status: value.evidenceStatus,
    action_status: value.actionStatus,
    idempotency_key: idempotencyKey,
  };
}

