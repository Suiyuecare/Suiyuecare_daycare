import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseAttendanceSuccess } from "@/lib/core-care/attendance-client";
import { parseDiaryWriteReceipt, parseVitalWriteReceipt } from "@/lib/core-care/write-receipts";
import type { OfflineDraft, OfflineDraftKind, OfflineDraftNamespace } from "./draft-store";

export const OFFLINE_CARE_LABELS: Record<OfflineDraftKind, string> = {
  "care-note": "照顧日誌", "vital-sign": "量測", attendance: "出勤",
};
export const OFFLINE_CARE_ENDPOINTS: Record<OfflineDraftKind, string> = {
  "care-note": "/api/records", "vital-sign": "/api/measurements", attendance: "/api/attendance",
};
export type CareLocalPayload = {
  schema: 1;
  serviceDate: string;
  formValues: Record<string, string>;
  state: "local" | "queued" | "review";
  request?: { body: Record<string, unknown>; hash: string };
  message?: string;
};
export type CareLocalDraft = OfflineDraft<CareLocalPayload>;
const payloadSchema = z.object({
  schema: z.literal(1), serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  formValues: z.record(z.string().max(80), z.string().max(4000)),
  state: z.enum(["local", "queued", "review"]),
  request: z.object({ body: z.record(z.string(), z.unknown()), hash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().optional(),
  message: z.string().max(300).optional(),
}).strict();

export function isCareLocalDraft(draft: OfflineDraft): draft is CareLocalDraft {
  return ["care-note", "vital-sign", "attendance"].includes(draft.kind) && draft.baseVersion === 0 &&
    z.string().uuid().safeParse(draft.id).success && z.string().uuid().safeParse(draft.clientRef).success &&
    payloadSchema.safeParse(draft.payload).success;
}

export async function careRequestHash(body: Record<string, unknown>) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

function validRequest(draft: CareLocalDraft) {
  const body = draft.payload.request?.body;
  if (!body || body.client_id !== draft.clientRef) return false;
  const keys = Object.keys(body);
  if (draft.kind === "care-note") return body.page_slug === "staff/daily-care/care-diary" &&
    keys.every((key) => ["client_id", "page_slug", "occurred_at", "data"].includes(key));
  if (draft.kind === "vital-sign") return typeof body.values === "object" && body.values !== null &&
    keys.every((key) => ["client_id", "measured_at", "values"].includes(key));
  return ["check_in", "check_out", "leave", "absent"].includes(String(body.event_kind)) &&
    keys.every((key) => ["client_id", "event_kind", "occurred_at", "reason"].includes(key));
}

export type CareSyncResult = { status: "saved" | "retry" | "review"; message: string };

/** Only explicit queued NEW-record commands can sync. Never sign or overwrite. */
export async function synchronizeCareDraft(draft: CareLocalDraft,
  send: typeof fetchWithTimeout = fetchWithTimeout, namespace?: OfflineDraftNamespace): Promise<CareSyncResult> {
  if (!isCareLocalDraft(draft) || draft.payload.state !== "queued" ||
      Date.parse(draft.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(draft.expiresAt)) ||
      !Number.isFinite(Date.parse(draft.createdAt)) || Date.parse(draft.createdAt) > Date.now() ||
      Date.parse(draft.createdAt) < Date.now() - 86_400_000 ||
      Date.parse(draft.expiresAt) - Date.parse(draft.createdAt) > 86_400_000 || !validRequest(draft)) {
    return { status: "review", message: "草稿已過期或內容需確認，未自動送出。" };
  }
  const request = draft.payload.request!;
  if (await careRequestHash(request.body) !== request.hash) {
    return { status: "review", message: "草稿內容驗證失敗，未送出；請重新確認。" };
  }
  try {
    const response = await send(OFFLINE_CARE_ENDPOINTS[draft.kind], {
      method: "POST", cache: "no-store", headers: {
        "Content-Type": "application/json", "Idempotency-Key": draft.id,
        ...(namespace ? { "X-Care-Organization": namespace.organizationId, "X-Care-Branch": namespace.branchId, "X-Care-User": namespace.userId } : {}),
      }, body: JSON.stringify(request.body),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return {
        status: "review", message: "請先確認登入與操作授權，再以原草稿重試。",
      };
      if ([400, 409, 422].includes(response.status)) return {
        status: "review", message: "時間、欄位或既有紀錄需確認；草稿已保留，未覆寫其他紀錄。",
      };
      return { status: "retry", message: "尚未取得儲存確認，會使用同一筆操作重試。" };
    }
    const raw: unknown = await response.json();
    if (draft.kind === "care-note") parseDiaryWriteReceipt(raw, response.status, false);
    else if (draft.kind === "vital-sign") parseVitalWriteReceipt(raw, response.status, false,
      request.body.values as Parameters<typeof parseVitalWriteReceipt>[3]);
    else {
      const result = parseAttendanceSuccess(raw, response.status, {
        clientId: draft.clientRef,
        eventKind: request.body.event_kind as "check_in" | "check_out" | "absent" | "leave",
        occurredAt: String(request.body.occurred_at),
      });
      if (result.data.demo || !result.data.persisted) throw new Error("NOT_PERSISTED");
    }
    return { status: "saved", message: draft.kind === "care-note" ? "日誌草稿已儲存，仍待提交與簽署。" : `${OFFLINE_CARE_LABELS[draft.kind]}已確認儲存。` };
  } catch {
    return { status: "retry", message: "連線中斷或回覆不完整；原草稿仍保留，未標示完成。" };
  }
}
