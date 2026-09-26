import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute } from "@/lib/integrations/http";
import { loadPsychosocialAssessmentSnapshot } from "@/lib/psychosocial-assessments/snapshot";
import { parsePsychosocialReadFilters, parsePsychosocialSnapshotEnvelope } from "@/lib/psychosocial-assessments/snapshot-client";
import { socialWorkReadAuthoritySignature } from "@/lib/social-work-records/read-authority";
import { getSocialWorkRecentAal2At } from "@/lib/social-work-records/reauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.uuid().transform(value => value.toLowerCase());
const headerSchema = z.object({ organizationId: uuid, branchId: uuid, nonce: uuid }).strict();
/** Read-only recovery: original audited snapshot RPC; no mutation/replay,
 * authentication change, operation key or browser persistence. */
export async function GET(request: Request) {
 return handleIntegrationRoute(async requestId => {
  const actor = await authorizeStaffRequest();
  if (actor.demo || actor.assuranceLevel !== "aal2" || !["clients.read","social_work_records.read"].every(scope => actor.scopes.includes(scope))) {
   throw new IntegrationError("SOCIAL_WORK_NOT_AUTHORIZED", "目前授權無法回查社工資料。", 403);
  }
  const parsed = headerSchema.safeParse({ organizationId: request.headers.get("x-organization-id"),
   branchId: request.headers.get("x-branch-id"), nonce: request.headers.get("x-psychosocial-read-nonce") });
  if (!parsed.success || new URL(request.url).search || request.method !== "GET") throw new IntegrationError("INVALID_SOCIAL_WORK_READ_REQUEST", "請提供有效的資料回查識別。", 400);
  if (parsed.data.organizationId !== actor.organizationId.toLowerCase() || parsed.data.branchId !== actor.branchId.toLowerCase()) {
   throw new IntegrationError("SOCIAL_WORK_NOT_AUTHORIZED", "回查範圍與目前登入範圍不符。", 403);
  }
  let filters;
  try { filters = parsePsychosocialReadFilters(request.headers.get("x-psychosocial-read-filters")); }
  catch { throw new IntegrationError("INVALID_SOCIAL_WORK_READ_REQUEST", "請確認回查篩選條件。", 400); }
  try {
   const canManage = actor.scopes.includes("social_work_records.manage"), canSign = actor.scopes.includes("social_work_records.sign");
   const [snapshot, recentAt] = await Promise.all([loadPsychosocialAssessmentSnapshot(actor, filters), canSign ? getSocialWorkRecentAal2At(actor) : Promise.resolve(null)]);
   const data = { schemaVersion: 1 as const, organizationId: parsed.data.organizationId, branchId: parsed.data.branchId,
    actorUserId: actor.userId.toLowerCase(), nonce: parsed.data.nonce, filters, snapshot, demo: false as const,
    capabilities: { canManage, canSign, hasRecentAal2: recentAt !== null }, authoritySignature: socialWorkReadAuthoritySignature(actor) };
   const validated = parsePsychosocialSnapshotEnvelope({ requestId, status: "ok", errors: [], data }, { organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId }, filters, parsed.data.nonce, Date.now());
   return ok({ ...data, ...validated }, 200, requestId);
  } catch {
   throw new IntegrationError("SOCIAL_WORK_SNAPSHOT_READ_UNAVAILABLE", "尚未取得授權的最新資料；請保留原操作並稍後回查。", 503);
  }
 });
}
