import { z } from "zod";
import { CLIENT_WRITE_TIMEOUT_MS, fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseDataInventoryActionSuccess } from "@/lib/data-inventory/parser";
import type { DataInventoryMutation } from "@/lib/data-inventory/types";

export type InventoryOperation = {
  request: DataInventoryMutation; idempotencyKey: string;
  organizationId: string; branchId: string; actorUserId: string;
};
export class ConfirmedInventoryFailure extends Error {}
export class UnknownInventoryOutcome extends Error {}

const messages: Record<string, string> = {
  INVALID_DATA_INVENTORY: "盤點欄位、日期或原因未通過驗證，尚未保存。請檢查後再送出。",
  INVALID_JSON: "送出的資料格式無效，尚未保存。",
  AUTH_REQUIRED: "請重新登入後再操作。",
  DATA_INVENTORY_NOT_AUTHORIZED: "目前帳號、分支或盤點權限不允許這項操作。",
  DEMO_READ_ONLY: "合成展示模式為唯讀，不能保存或覆核。",
  SYNTHETIC_PREVIEW_READ_ONLY: "線上合成試用為唯讀，不能保存或覆核。",
  AAL2_REQUIRED: "請完成雙因素驗證；人工覆核須於最近 15 分鐘重新驗證。",
  DATA_INVENTORY_VERSION_CONFLICT: "盤點版本已改變。請保留內容、重新載入並核對最新版本。",
  DATA_INVENTORY_IDEMPOTENCY_CONFLICT: "操作識別碼與原請求不一致，請交由管理員核對。",
  BRANCH_CONTEXT_REQUIRED: "請選擇有效分支後，再核對原盤點操作。",
  REQUEST_TOO_LARGE: "盤點內容超過大小限制，尚未保存。",
};
const statusCodes: Record<number, readonly string[]> = {
  400: ["INVALID_DATA_INVENTORY", "INVALID_JSON"],
  401: ["AUTH_REQUIRED"],
  403: ["DATA_INVENTORY_NOT_AUTHORIZED", "DEMO_READ_ONLY", "SYNTHETIC_PREVIEW_READ_ONLY", "AAL2_REQUIRED"],
  409: ["DATA_INVENTORY_VERSION_CONFLICT", "DATA_INVENTORY_IDEMPOTENCY_CONFLICT", "BRANCH_CONTEXT_REQUIRED"],
  413: ["REQUEST_TOO_LARGE"],
};
const failureEnvelope = z.object({ requestId: z.uuid(), status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string(), message: z.string().max(500), field: z.string().max(120).optional() }).strict()).min(1).max(20) }).strict();

/** Bound both fetching and body parsing; unknown results keep the original payload and key for exact retry. */
export async function sendDataInventoryOperation(operation: InventoryOperation) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new UnknownInventoryOutcome("連線逾時，操作結果尚未確認；請以相同內容與識別碼重試。"));
    }, CLIENT_WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let response: Response; let payload: unknown;
      try {
        response = await fetchWithTimeout("/api/data-inventory", {
          method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal,
          headers: { "content-type": "application/json", "idempotency-key": operation.idempotencyKey },
          body: JSON.stringify({ ...operation.request, idempotency_key: operation.idempotencyKey }),
        });
        payload = await response.json();
      } catch {
        throw new UnknownInventoryOutcome("連線中斷、逾時或回覆格式不明；操作結果尚未確認，請以相同內容與識別碼重試。");
      }
      if (!response.ok) {
        const parsed = failureEnvelope.safeParse(payload);
        if (parsed.success && parsed.data.errors.every(({ code }) => statusCodes[response.status]?.includes(code))) {
          throw new ConfirmedInventoryFailure(messages[parsed.data.errors[0]!.code]!);
        }
        throw new UnknownInventoryOutcome("回覆尚不能證明操作已完成或回滾；請保留相同內容與識別碼重試。");
      }
      try { return parseDataInventoryActionSuccess(payload, operation, response.status); }
      catch { throw new UnknownInventoryOutcome("完成憑證與原操作無法核對；尚不可視為成功，請以相同內容與識別碼重試。"); }
    })()]);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
