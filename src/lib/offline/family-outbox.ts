import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { familyMessageReceiptSchema, familyMutationSchema } from "@/lib/family/workspace-schema";
import { careRequestHash } from "./care-outbox";
import type { OfflineDraft, OfflineDraftNamespace } from "./draft-store";

const commandSchema = familyMutationSchema.options[0];
const localPayload = z.object({ schema: z.literal(1), body: z.string().max(2000), state: z.enum(["local", "queued", "review"]), command: commandSchema.optional(), hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), message: z.string().max(300).optional() }).strict();
export type FamilyMessageDraft = OfflineDraft<z.infer<typeof localPayload>> & { kind: "family-message" };
export function isFamilyMessageDraft(draft: OfflineDraft): draft is FamilyMessageDraft {
  const value = localPayload.safeParse(draft.payload);
  return draft.kind === "family-message" && z.uuid().safeParse(draft.id).success && z.uuid().safeParse(draft.clientRef).success && Number.isInteger(draft.baseVersion) && draft.baseVersion >= 0 && value.success && (!value.data.command || value.data.command.clientId === draft.clientRef && value.data.command.idempotency_key === draft.id && value.data.command.expectedVersion === draft.baseVersion && value.data.command.body === value.data.body);
}
export async function queueFamilyMessage(draft: FamilyMessageDraft): Promise<FamilyMessageDraft> {
  const command = commandSchema.parse({ action: "message", clientId: draft.clientRef, idempotency_key: draft.id, expectedVersion: draft.baseVersion, body: draft.payload.body });
  return { ...draft, payload: { schema: 1, state: "queued", body: command.body, command, hash: await careRequestHash(command) } };
}
export type FamilySyncResult = { status: "saved" | "retry" | "review" | "revoked"; message: string };
/** No files, signatures, document URLs or automatic rewriting enter this queue. */
export async function synchronizeFamilyMessage(draft: FamilyMessageDraft, namespace: OfflineDraftNamespace, send: typeof fetchWithTimeout = fetchWithTimeout): Promise<FamilySyncResult> {
  if (!isFamilyMessageDraft(draft) || draft.payload.state !== "queued" || !draft.payload.command || !draft.payload.hash || !Number.isFinite(Date.parse(draft.createdAt)) || !Number.isFinite(Date.parse(draft.expiresAt)) || Date.parse(draft.createdAt) > Date.now() || Date.parse(draft.createdAt) < Date.now() - 86_400_000 || Date.parse(draft.expiresAt) <= Date.now() || Date.parse(draft.expiresAt) - Date.parse(draft.createdAt) > 86_400_000 || await careRequestHash(draft.payload.command) !== draft.payload.hash) return { status: "review", message: "草稿已過期或內容需核對，未自動送出。" };
  try {
    const response = await send("/api/family-portal", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-care-organization": namespace.organizationId, "x-care-branch": namespace.branchId, "x-care-user": namespace.userId }, body: JSON.stringify(draft.payload.command) }, 15_000);
    if (response.status === 401 || response.status === 403) return { status: "revoked", message: "授權已失效，已停止傳送。" };
    const parsed = z.object({ data: z.object({ receipt: familyMessageReceiptSchema }) }).safeParse(await response.json());
    if (response.status === 409 && parsed.success && parsed.data.data.receipt.status === "conflict") return { status: "review", message: "訊息有新版本；已交由機構人工核對，未重複送出。" };
    if (response.ok && parsed.success && parsed.data.data.receipt.status === "saved") return { status: "saved", message: "訊息已送出" };
    return { status: "retry", message: "結果尚未確認；原內容與操作保留，請重試。" };
  } catch { return { status: "retry", message: "連線中斷；原內容與操作保留，請重試。" }; }
}
