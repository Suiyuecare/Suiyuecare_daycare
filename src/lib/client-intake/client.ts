import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { ZodError } from "zod";

export class IntakeResponseError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly requestId: string | null,
    readonly definiteNonCommit: boolean) {
    super(message);
    this.name = "IntakeResponseError";
  }
}

/** Only a validated rejection envelope with a non-retryable 4xx proves that
 * this request did not commit. A timeout, conflict or malformed reply does not. */
export function isDefiniteIntakeRejection(error: unknown) {
  return error instanceof IntakeResponseError && error.definiteNonCommit;
}

/** No browser persistence: intake identities, contacts and attachments never enter offline drafts. */
export async function intakeRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchWithTimeout(url, { cache: "no-store", ...init });
  let body: { status?: string; data?: unknown; requestId?: string; errors?: { code?: string; message?: string }[] };
  try { body = await response.json(); } catch { throw new Error("未收到完整回覆，結果尚未確認。請保留內容並重試。"); }
  if (!body || typeof body !== "object") throw new Error("回覆格式不完整，結果尚未確認。請保留內容並重試。");
  if (!response.ok || body.status !== "ok") {
    const requestId = typeof body.requestId === "string" && body.requestId.length > 0 ? body.requestId : null;
    const first = body.errors?.[0];
    const validRejection = body.status === "error" && body.data === null && requestId !== null &&
      Array.isArray(body.errors) && typeof first?.code === "string" && first.code.length > 0 &&
      typeof first.message === "string" && first.message.length > 0;
    const definiteNonCommit = !response.ok && response.status >= 400 && response.status < 500 &&
      ![408, 409, 425, 429].includes(response.status) && validRejection;
    const message = typeof first?.message === "string" ? first.message : "無法完成操作，請重試。";
    throw new IntakeResponseError(`${message}${requestId ? `（請求編號：${requestId}）` : ""}`,
      response.status, requestId, definiteNonCommit);
  }
  return body.data;
}
export function intakeErrorMessage(error: unknown) {
  if (error instanceof ZodError) return "回覆內容未通過核對，尚不能確認完成。請保留本次操作後重試，或聯絡管理員。";
  if (isClientFetchTimeoutError(error)) return "連線逾時，結果尚未確認。輸入內容已保留；請用同一次操作重試。";
  return error instanceof Error ? error.message : "操作未完成，請保留內容後重試。";
}
