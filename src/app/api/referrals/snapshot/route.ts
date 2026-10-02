import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute } from "@/lib/integrations/http";
import { loadReferralManagementSnapshot, ReferralManagementSnapshotError } from "@/lib/referral-management/snapshot";
import { normalizeReferralSnapshot } from "@/lib/referral-management/snapshot-contract";
import { parseReferralReadFilters } from "@/lib/referral-management/snapshot-client";
import { getReferralRecentAal2At } from "@/lib/referral-management/reauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.uuid().transform(value => value.toLowerCase());
const headerSchema = z.object({ organizationId: uuid, branchId: uuid, nonce: uuid }).strict();

/** Recovery read only. Uses the original audited snapshot RPC and never calls
 * mutation/replay, creates an operation key, or changes authentication/cookies. */
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式沒有正式轉介回查資料。", 403);
    if (!["clients.read", "referral_management.read"].every(scope => actor.scopes.includes(scope))) {
      throw new IntegrationError("REFERRAL_MANAGEMENT_NOT_AUTHORIZED", "目前授權無法讀取轉介資料。", 403);
    }
    const parsed = headerSchema.safeParse({ organizationId: request.headers.get("x-organization-id"),
      branchId: request.headers.get("x-branch-id"), nonce: request.headers.get("x-referral-read-nonce") });
    if (!parsed.success || new URL(request.url).search) throw new IntegrationError("INVALID_REFERRAL_READ_REQUEST", "請提供有效的轉介回查識別。", 400);
    if (parsed.data.organizationId !== actor.organizationId.toLowerCase() || parsed.data.branchId !== actor.branchId.toLowerCase()) {
      throw new IntegrationError("REFERRAL_MANAGEMENT_NOT_AUTHORIZED", "回查範圍與目前登入範圍不符。", 403);
    }
    let filters;
    try { filters = parseReferralReadFilters(request.headers.get("x-referral-read-filters")); }
    catch { throw new IntegrationError("INVALID_REFERRAL_READ_REQUEST", "請確認轉介篩選條件。", 400); }
    try {
      const source = await loadReferralManagementSnapshot(actor, filters, (await getReferralRecentAal2At(actor)) !== null);
      const snapshot = normalizeReferralSnapshot(source, actor);
      if (snapshot.demo) throw new ReferralManagementSnapshotError();
      return ok({ schemaVersion: 1, organizationId: parsed.data.organizationId, branchId: parsed.data.branchId,
        actorUserId: actor.userId.toLowerCase(), nonce: parsed.data.nonce, filters, snapshot, demo: false }, 200, requestId);
    } catch {
      throw new IntegrationError("REFERRAL_SNAPSHOT_READ_UNAVAILABLE", "尚未取得授權的最新轉介資料；請保留原操作並稍後回查。", 503);
    }
  });
}
