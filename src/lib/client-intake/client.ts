import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import { z, ZodError } from "zod";

export class IntakeRequestError extends Error {
  constructor(readonly status: number | null = null, readonly definitiveRejection = false) {
    super(definitiveRejection ? status === 401 || status === 403
      ? "登入或權限已變更，請重新登入後核對原操作。"
      : "本次操作未保存，請核對欄位與資料版本後再送出。"
      : "未收到完整回覆，結果尚未確認。請保留原操作與內容後重試。");
    this.name = "IntakeRequestError";
  }
}
const success = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: z.unknown(), errors: z.array(z.never()).length(0) }).strict();
const rejection = z.object({ requestId: z.uuid(), status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string().min(1), message: z.string().min(1), field: z.string().optional() }).strict()).min(1) }).strict();

/** One deadline covers fetch and JSON, including dependencies ignoring abort.
 * No provider text, credentials, automatic retries or browser persistence. */
export async function intakeRequest(url: string, init?: RequestInit): Promise<unknown> {
  const owner = init?.signal, controller = new AbortController();
  const cancel = () => controller.abort();
  owner?.addEventListener("abort", cancel, { once: true });
  let remove = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new IntakeRequestError());
    controller.signal.addEventListener("abort", onAbort, { once: true });
    remove = () => controller.signal.removeEventListener("abort", onAbort);
  });
  const timer = setTimeout(cancel, CLIENT_WRITE_TIMEOUT_MS);
  try {
    if (owner?.aborted) cancel();
    const work = (async () => {
      if (controller.signal.aborted) throw new IntakeRequestError();
      const response = await fetch(url, { cache: "no-store", ...init, credentials: "same-origin", redirect: "error", signal: controller.signal });
      if (controller.signal.aborted || response.redirected) throw new IntakeRequestError();
      const body: unknown = await response.json();
      if (controller.signal.aborted) throw new IntakeRequestError();
      if (!response.ok) throw new IntakeRequestError(response.status,
        [400, 401, 403, 409, 413, 415, 422].includes(response.status) && rejection.safeParse(body).success);
      const parsed = success.safeParse(body);
      if (response.status !== 200 || !parsed.success) throw new IntakeRequestError();
      return parsed.data.data;
    })();
    return await Promise.race([work, aborted]);
  } catch (error) { throw error instanceof IntakeRequestError ? error : new IntakeRequestError(); }
  finally { clearTimeout(timer); remove(); owner?.removeEventListener("abort", cancel); }
}
export function intakeErrorMessage(error: unknown) {
  if (error instanceof ZodError) return "回覆內容未通過核對，尚不能確認完成。請保留本次操作後重試，或聯絡管理員。";
  return error instanceof IntakeRequestError ? error.message : "操作結果尚未確認，請保留原操作與內容後重試。";
}
