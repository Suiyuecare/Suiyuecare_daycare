import { z } from "zod";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseCaseServiceRecordApiEnvelope } from "@/lib/case-service-records/client-contract";
import { caseServiceRecordPayload } from "@/lib/case-service-records/parser";
import type { CaseServiceRecordMutationInput } from "@/lib/case-service-records/types";

export type RecordOperation = {
  input: CaseServiceRecordMutationInput;
  organizationId: string;
  branchId: string;
  actorUserId: string;
};

export class ConfirmedRecordFailure extends Error {}
export class UnknownRecordOutcome extends Error {}

export function recordMutationBody(input: CaseServiceRecordMutationInput) {
  const payload = caseServiceRecordPayload(input);
  if (input.action === "sign_record" || input.action === "correct_record") {
    return { action: input.action, ...payload };
  }
  const { reason, ...rest } = payload as Exclude<ReturnType<typeof caseServiceRecordPayload>,
    { expected_record_payload: unknown }>;
  return { action: input.action, ...rest, revision_reason: reason };
}

const safeMessages: Record<string, string> = {
  INVALID_CASE_SERVICE_RECORD_OPERATION: "欄位或版本基準未通過驗證，請檢查後再送出。",
  INVALID_JSON: "送出的資料格式無效，尚未保存。",
  AUTH_REQUIRED: "請重新登入後再操作。",
  CASE_SERVICE_RECORD_NOT_AUTHORIZED: "目前帳號沒有這項操作或個案的權限。",
  DEMO_READ_ONLY: "展示模式不可寫入正式資料。",
  AAL2_REQUIRED: "請完成 MFA；簽署與更正須於最近 15 分鐘重新驗證。",
  CASE_SERVICE_RECORD_VERSION_CONFLICT: "版本已變更，請更新快照並重新核對。",
  CASE_SERVICE_RECORD_IDEMPOTENCY_CONFLICT: "操作鍵與原請求不一致，請交由管理員核對。",
  CASE_SERVICE_RECORD_STATE_CONFLICT: "目前狀態或執行來源不允許此操作，請更新後核對。",
  REQUEST_TOO_LARGE: "內容超過大小限制，尚未保存。",
  SERVICE_NOT_CONFIGURED: "正式資料服務尚未配置，無法執行此操作。",
};
const statusCodes: Record<number, readonly string[]> = {
  400: ["INVALID_CASE_SERVICE_RECORD_OPERATION", "INVALID_JSON"],
  401: ["AUTH_REQUIRED"],
  403: ["CASE_SERVICE_RECORD_NOT_AUTHORIZED", "DEMO_READ_ONLY", "AAL2_REQUIRED"],
  409: ["CASE_SERVICE_RECORD_VERSION_CONFLICT", "CASE_SERVICE_RECORD_IDEMPOTENCY_CONFLICT",
    "CASE_SERVICE_RECORD_STATE_CONFLICT"],
  413: ["REQUEST_TOO_LARGE"], 503: ["SERVICE_NOT_CONFIGURED"],
};
const failureEnvelope = z.object({ requestId: z.uuid(), status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string(), message: z.string().max(500),
    field: z.string().max(120).optional() }).strict()).min(1).max(20) }).strict();

/** Never trust a 2xx alone or display an arbitrary server error/record payload. */
export async function sendRecordOperation(operation: RecordOperation) {
  const { input } = operation;
  const action = input.action === "save_record" ? input.mode :
    input.action === "sign_record" ? "sign" : "correct";
  let response: Response;
  let payload: unknown;
  try {
    response = await fetchWithTimeout("/api/case-service-records", {
      method: action === "create" ? "POST" : "PATCH", cache: "no-store",
      headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey,
        "x-case-service-record-operation": action }, body: JSON.stringify(recordMutationBody(input)),
    });
    payload = await response.json();
  } catch {
    throw new UnknownRecordOutcome("連線中斷、逾時或回覆格式不明；保存結果仍待核對。");
  }
  if (!response.ok) {
    const parsed = failureEnvelope.safeParse(payload);
    if (parsed.success && parsed.data.errors.every(({ code }) => statusCodes[response.status]?.includes(code))) {
      throw new ConfirmedRecordFailure(safeMessages[parsed.data.errors[0]!.code]!);
    }
    throw new UnknownRecordOutcome("回覆無法證明原操作已回滾；請保留相同內容與操作鍵核對。");
  }
  try {
    return parseCaseServiceRecordApiEnvelope(payload, response.status, input,
      operation.organizationId, operation.branchId, operation.actorUserId);
  } catch {
    throw new UnknownRecordOutcome("成功回覆與原操作證據無法完整核對；尚不可視為保存成功。");
  }
}
