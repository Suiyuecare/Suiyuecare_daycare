import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { ZodError } from "zod";

/** No browser persistence: intake identities, contacts and attachments never enter offline drafts. */
export async function intakeRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchWithTimeout(url, { cache: "no-store", ...init });
  let body: { status?: string; data?: unknown; requestId?: string; errors?: { message?: string }[] };
  try { body = await response.json(); } catch { throw new Error("未收到完整回覆，結果尚未確認。請保留內容並重試。 "); }
  if (!response.ok || body.status !== "ok") throw new Error(`${body.errors?.[0]?.message ?? "無法完成操作，請重試。"}${body.requestId ? `（請求編號：${body.requestId}）` : ""}`);
  return body.data;
}
export function intakeErrorMessage(error: unknown) {
  if (error instanceof ZodError) return "回覆內容未通過核對，尚不能確認完成。請保留本次操作後重試，或聯絡管理員。";
  if (isClientFetchTimeoutError(error)) return "連線逾時，結果尚未確認。輸入內容已保留；請用同一次操作重試。";
  return error instanceof Error ? error.message : "操作未完成，請保留內容後重試。";
}
