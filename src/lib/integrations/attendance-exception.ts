import { z } from "zod";

import { parseServiceDate } from "@/lib/core-care/date";

import { IntegrationError } from "./errors";
import { assertIdempotencyKey, assertUuid } from "./security";

const requestSchema = z.object({
  client_id: z.uuid(),
  service_date: z.iso.date().refine((value) => parseServiceDate(value) === value),
  reason_code: z.enum(["refused", "device_failure", "emergency_transfer", "measurement_preexisting"]),
  reason_note: z.string().trim().max(500).optional(),
}).strict();

const decisionSchema = z.object({
  request_id: z.uuid(),
  decision: z.enum(["approve", "reject", "cancel"]),
  decision_note: z.string().trim().max(500).optional(),
  confirmed_arrival_at: z.iso.datetime({ offset: true }).optional(),
}).strict().refine((value) => value.decision !== "reject" || Boolean(value.decision_note), {
  path: ["decision_note"], message: "駁回時請填寫原因。",
}).refine((value) => value.decision === "approve" || !value.confirmed_arrival_at, {
  path: ["confirmed_arrival_at"], message: "只有核准補核簽到時可填寫到場時間。",
});

const receiptSchema = z.object({
  id: z.uuid(), client_id: z.uuid(), service_date: z.iso.date(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  replayed: z.boolean(),
  attendance_id: z.uuid().nullable().optional(),
}).passthrough().superRefine((value, context) => {
  if (value.status === "approved" && !value.attendance_id) {
    context.addIssue({ code: "custom", path: ["attendance_id"], message: "Approved exception requires formal attendance." });
  }
  if (value.status !== "approved" && value.attendance_id) {
    context.addIssue({ code: "custom", path: ["attendance_id"], message: "Only approved exception may have formal attendance." });
  }
});

export function parseExceptionRequest(value: unknown, headerKey: string | null) {
  const input = requestSchema.safeParse(value);
  if (!input.success) throw new IntegrationError("INVALID_ATTENDANCE_EXCEPTION", "請確認個案與未量測原因。", 400);
  return {
    ...input.data,
    reason_note: input.data.reason_note || null,
    idempotencyKey: assertUuid(assertIdempotencyKey(headerKey), "idempotency_key"),
  };
}

export function parseExceptionDecision(value: unknown, headerKey: string | null) {
  const input = decisionSchema.safeParse(value);
  if (!input.success) throw new IntegrationError("INVALID_ATTENDANCE_DECISION", "請確認覆核動作與原因。", 400);
  return {
    ...input.data,
    decision_note: input.data.decision_note || null,
    confirmed_arrival_at: input.data.confirmed_arrival_at || null,
    idempotencyKey: assertUuid(assertIdempotencyKey(headerKey), "idempotency_key"),
  };
}

export function parseExceptionQuery(url: string) {
  const params = new URL(url).searchParams;
  const date = params.get("date");
  if (!date || parseServiceDate(date) !== date) {
    throw new IntegrationError("INVALID_SERVICE_DATE", "請選擇有效的服務日期。", 400);
  }
  const rawClient = params.get("client");
  return { serviceDate: date, clientId: rawClient ? assertUuid(rawClient, "client") : null };
}

export function parseExceptionReceipt(value: unknown, expected: { clientId?: string; requestId?: string } = {}) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError("ATTENDANCE_EXCEPTION_UNCONFIRMED", "目前無法確認結果；請以同一操作重試。", 503);
  if ((expected.clientId && parsed.data.client_id !== expected.clientId) ||
    (expected.requestId && parsed.data.id !== expected.requestId)) {
    throw new IntegrationError("ATTENDANCE_EXCEPTION_UNCONFIRMED", "目前無法確認結果；請以同一操作重試。", 503);
  }
  return parsed.data;
}

export function exceptionDatabaseFailure(errorCode?: string) {
  if (errorCode === "DAA03") return new IntegrationError("ATTENDANCE_EXCEPTION_DATE_CHANGED", "日期已跨日；請切換到今天並重新送出。原日期沒有建立新簽到。", 409);
  if (errorCode === "DAA02") return new IntegrationError("ATTENDANCE_EXCEPTION_REVERIFY", "主任覆核前，請完成最近 15 分鐘的雙重驗證。", 403);
  if (errorCode === "42501") return new IntegrationError("ATTENDANCE_EXCEPTION_NOT_AUTHORIZED", "目前沒有這位個案或此分支的例外出勤權限。", 403);
  if (errorCode === "23505") return new IntegrationError("ATTENDANCE_EXCEPTION_DUPLICATE", "已有待審申請，或這次操作的內容與原申請不同。請重新核對。", 409);
  if (errorCode === "23514" || errorCode === "40001") return new IntegrationError("ATTENDANCE_EXCEPTION_CONFLICT", "個案出勤狀態已變更；請重新載入後核對。", 409);
  if (errorCode === "22023") return new IntegrationError("ATTENDANCE_EXCEPTION_INVALID", "個案、原因或覆核內容未通過檢查。", 400);
  return new IntegrationError("ATTENDANCE_EXCEPTION_UNCONFIRMED", "目前無法確認結果；請保留原操作並重試。", 503);
}
