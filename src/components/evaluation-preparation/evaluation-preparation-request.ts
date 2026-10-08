import { z } from "zod";
import { CLIENT_WRITE_TIMEOUT_MS, fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  evaluationPreparationReceiptSchema,
  type EvaluationPreparationRequest,
  type EvaluationPreparationReceipt,
} from "@/lib/evaluation-preparation/contract";

export type EvaluationPreparationOperation = {
  input: EvaluationPreparationRequest;
  idempotencyKey: string;
  organizationId: string;
  branchId: string;
  actorUserId: string;
};

export class ConfirmedPreparationFailure extends Error {}
export class UnknownPreparationOutcome extends Error {}

const knownErrors: Record<string, string> = {
  INVALID_EVALUATION_PREPARATION: "欄位、負責人或內部覆核條件有誤；尚未保存。",
  EVALUATION_PREPARATION_NOT_AUTHORIZED: "目前帳號、分支或權限不允許保存。",
  EVALUATION_PREPARATION_VERSION_CONFLICT: "此項目已有新版本。請保留內容並重新載入後核對。",
  EVALUATION_PREPARATION_IDEMPOTENCY_CONFLICT: "操作識別碼與原請求不一致，請交由管理員核對。",
  AUTH_REQUIRED: "請重新登入後再操作。",
  AAL2_REQUIRED: "請完成此工作階段的身分確認。",
  DEMO_READ_ONLY: "展示環境不會保存正式資料。",
  SYNTHETIC_PREVIEW_READ_ONLY: "展示環境不會保存正式資料。",
  INVALID_JSON: "送出格式無效，尚未保存。",
  REQUEST_TOO_LARGE: "欄位內容超過大小限制，尚未保存。",
};
const statusCodes: Record<number, readonly string[]> = {
  400: ["INVALID_EVALUATION_PREPARATION", "INVALID_JSON"],
  401: ["AUTH_REQUIRED"],
  403: ["EVALUATION_PREPARATION_NOT_AUTHORIZED", "AAL2_REQUIRED", "DEMO_READ_ONLY", "SYNTHETIC_PREVIEW_READ_ONLY"],
  409: ["EVALUATION_PREPARATION_VERSION_CONFLICT", "EVALUATION_PREPARATION_IDEMPOTENCY_CONFLICT"],
  413: ["REQUEST_TOO_LARGE"],
};
const errorEnvelope = z.object({
  requestId: z.uuid(), status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string(), message: z.string().max(500), field: z.string().max(120).optional() }).strict()).min(1).max(20),
}).strict();
const successEnvelope = z.object({
  status: z.literal("ok"), data: evaluationPreparationReceiptSchema,
}).passthrough();

/** Unknown outcomes retain the exact request and idempotency key for retry. */
export async function sendEvaluationPreparationOperation(operation: EvaluationPreparationOperation): Promise<EvaluationPreparationReceipt> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort();
      reject(new UnknownPreparationOutcome("連線逾時，保存結果尚未確認；請用同一操作重試。"));
    }, CLIENT_WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let response: Response; let raw: unknown;
      try {
        response = await fetchWithTimeout("/api/evaluation-preparation", {
          method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal,
          headers: { "content-type": "application/json", "idempotency-key": operation.idempotencyKey },
          body: JSON.stringify({ ...operation.input, idempotency_key: operation.idempotencyKey }),
        });
        raw = await response.json();
      } catch { throw new UnknownPreparationOutcome("連線中斷或逾時，保存結果尚未確認；請用同一操作重試。"); }
      if (!response.ok) {
        const parsed = errorEnvelope.safeParse(raw);
        if (parsed.success && parsed.data.errors.every(({ code }) => statusCodes[response.status]?.includes(code))) {
          throw new ConfirmedPreparationFailure(knownErrors[parsed.data.errors[0]!.code]!);
        }
        throw new UnknownPreparationOutcome("回覆不能確認是否保存；請用同一操作重試。");
      }
      const parsed = successEnvelope.safeParse(raw);
      if (!parsed.success || ![200, 201].includes(response.status) ||
        parsed.data.data.organizationId !== operation.organizationId ||
        parsed.data.data.branchId !== operation.branchId ||
        parsed.data.data.actorUserId !== operation.actorUserId ||
        parsed.data.data.idempotencyKey !== operation.idempotencyKey ||
        parsed.data.data.result.itemCode !== operation.input.itemCode ||
        parsed.data.data.result.version !== operation.input.expectedVersion + 1) {
        throw new UnknownPreparationOutcome("保存回執無法核對；請用同一操作重試。");
      }
      return parsed.data.data;
    })()]);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
