import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImportError } from "./errors";
import type { ImportActor } from "./types";

export type EvidenceClient = { rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }> };
const evidenceSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), actorUserId: z.uuid(),
  verifiedAt: z.string().max(64).refine(isStrictOffsetDateTime) }).strict();
const actorSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), userId: z.uuid(),
  assuranceLevel: z.literal("aal2"), recentAal2At: z.string().nullable() }).strict();
const authorizationSchema = evidenceSchema.omit({ verifiedAt: true }).extend({
  assuranceLevel: z.literal("aal2"), verifiedAt: z.string().max(64).refine(isStrictOffsetDateTime).nullable(),
}).strict();

async function boundedEvidence(client: EvidenceClient, name: string, args: Record<string, string>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  try {
    const result = await Promise.race([
      Promise.resolve(client.rpc(name, args)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ImportError(
        "IMPORT_AUTH_TIMEOUT", "權限確認逾時，請稍後重試。", 503)), 10_000); }),
    ]);
    if (performance.now() - started >= 10_000) throw new ImportError("IMPORT_AUTH_TIMEOUT", "權限確認逾時，請稍後重試。", 503);
    return result;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function isFresh(verifiedAt: string) {
  const age = Date.now() - Date.parse(verifiedAt);
  return Number.isFinite(age) && age >= 0 && age <= 15 * 60_000;
}

/** Uses the request's user JWT and current database authorization on every call.
 * A prior TenantContext or a caller-supplied timestamp never proves authority. */
export async function revalidateGeneralImportActor(actor: ImportActor,
  permission: "read" | "write" | "approve" = "read", suppliedClient?: EvidenceClient): Promise<ImportActor> {
  const captured = actorSchema.safeParse(actor);
  if (!captured.success || !["read", "write", "approve"].includes(permission))
    throw new ImportError("IMPORT_PERMISSION_DENIED", "您沒有執行此匯入操作的權限。", 403);
  const client = suppliedClient ?? await createServerSupabaseClient();
  if (!client) throw new ImportError("IMPORT_AUTH_NOT_CONFIGURED", "正式匯入授權尚未設定，系統已停止操作。", 503);
  let result: Awaited<ReturnType<EvidenceClient["rpc"]>>;
  try {
    result = await boundedEvidence(client, "general_import_repository_authorize", {
      p_org: captured.data.organizationId, p_branch: captured.data.branchId, p_action: permission,
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("IMPORT_AUTH_UNAVAILABLE", "目前無法確認權限，請稍後重試。", 503);
  }
  if (result.error) {
    const denied = typeof result.error === "object" && result.error !== null && "code" in result.error &&
      result.error.code === "42501";
    throw new ImportError(denied ? "IMPORT_PERMISSION_DENIED" : "IMPORT_AUTH_UNAVAILABLE",
      denied ? "您沒有執行此匯入操作的權限。" : "目前無法確認權限，請稍後重試。", denied ? 403 : 503);
  }
  const parsed = authorizationSchema.safeParse(result.data);
  if (!parsed.success) throw new ImportError("IMPORT_AUTH_INVALID_RECEIPT", "權限確認回覆無效，系統已停止操作。", 502);
  const proof = parsed.data;
  if (proof.organizationId !== captured.data.organizationId || proof.branchId !== captured.data.branchId ||
      proof.actorUserId !== captured.data.userId || (permission === "read" ? proof.verifiedAt !== null : !proof.verifiedAt || !isFresh(proof.verifiedAt)))
    throw new ImportError("IMPORT_PERMISSION_DENIED", "您的權限或驗證已失效，請重新登入後重試。", 403);
  return { ...captured.data, recentAal2At: proof.verifiedAt === null ? null : new Date(proof.verifiedAt).toISOString() };
}

/** General import evidence is not nursing evidence or a synthetic current time.
 * The RPC rechecks the actual session, immutable challenge and live scope. */
export async function getGeneralImportRecentAal2At(actor: TenantContext, suppliedClient?: EvidenceClient): Promise<string | null> {
  if (actor.demo || actor.assuranceLevel !== "aal2" || !actor.branchId || !actor.scopes.includes("imports.manage")) return null;
  const expected = evidenceSchema.omit({ verifiedAt: true }).safeParse({ organizationId: actor.organizationId,
    branchId: actor.branchId, actorUserId: actor.userId });
  if (!expected.success) return null;
  try {
    const client = suppliedClient ?? await createServerSupabaseClient();
    if (!client) return null;
    const { data, error } = await boundedEvidence(client, "general_import_recent_aal2_evidence", { p_org: expected.data.organizationId, p_branch: expected.data.branchId });
    const parsed = evidenceSchema.safeParse(data);
    if (error || !parsed.success) return null;
    const proof = parsed.data;
    if (proof.organizationId !== expected.data.organizationId || proof.branchId !== expected.data.branchId || proof.actorUserId !== expected.data.actorUserId ||
        !isFresh(proof.verifiedAt)) return null;
    return new Date(proof.verifiedAt).toISOString();
  } catch { return null; }
}
