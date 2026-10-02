import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute } from "@/lib/integrations/http";
import { loadNursingAssessmentSnapshot } from "@/lib/nursing-assessments/snapshot";
import { getNursingRecentAal2At } from "@/lib/nursing-assessments/reauth";
import { nursingReadAuthoritySignature, nursingReadUuid } from "@/lib/nursing-assessments/read-authority";
import { parseNursingSnapshotEnvelope } from "@/lib/nursing-assessments/snapshot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headersSchema = z.object({ organizationId: nursingReadUuid, branchId: nursingReadUuid, nonce: nursingReadUuid }).strict();

/** Read the existing audited RPC only. No mutation, write key, MFA challenge,
 * replay, or clinical persistence is admitted by this endpoint. */
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo || actor.assuranceLevel !== "aal2" ||
      !["clients.read", "nursing_assessments.read"].every((scope) => actor.scopes.includes(scope))) {
      throw new IntegrationError("NURSING_NOT_AUTHORIZED", "目前授權無法回查護理資料。", 403);
    }
    const parsed = headersSchema.safeParse({ organizationId: request.headers.get("x-organization-id"),
      branchId: request.headers.get("x-branch-id"), nonce: request.headers.get("x-nursing-read-nonce") });
    const contentLength = request.headers.get("content-length");
    if (!parsed.success || new URL(request.url).search || request.method !== "GET" || request.body !== null ||
      request.headers.has("idempotency-key") || request.headers.has("x-idempotency-key") ||
      request.headers.has("transfer-encoding") || contentLength !== null && contentLength !== "0") {
      throw new IntegrationError("INVALID_NURSING_READ_REQUEST", "請提供有效的資料回查識別。", 400);
    }
    if (parsed.data.organizationId !== actor.organizationId.toLowerCase() || parsed.data.branchId !== actor.branchId.toLowerCase()) {
      throw new IntegrationError("NURSING_NOT_AUTHORIZED", "回查範圍與目前登入範圍不符。", 403);
    }
    try {
      const nurse = actor.roles.includes("nurse"), canManage = nurse && actor.scopes.includes("nursing_assessments.manage"),
        canSign = nurse && actor.scopes.includes("nursing_assessments.sign");
      const [snapshot, recentAt] = await Promise.all([loadNursingAssessmentSnapshot(actor),
        canSign ? getNursingRecentAal2At(actor) : Promise.resolve(null)]);
      // getTenantContext supplies this same actual nursing proof. A discrepancy
      // means authority changed during the read, not permission to invent time.
      if ((actor.recentAal2At === null ? null : new Date(actor.recentAal2At).toISOString()) !== recentAt) {
        throw new Error("NURSING_READ_AUTHORITY_CHANGED");
      }
      const data = { schemaVersion: 1 as const, organizationId: parsed.data.organizationId, branchId: parsed.data.branchId,
        actorUserId: actor.userId.toLowerCase(), nonce: parsed.data.nonce, snapshot, demo: false as const,
        capabilities: { canManage, canSign, hasRecentAal2: canSign && recentAt !== null },
        authoritySignature: nursingReadAuthoritySignature(actor) };
      const validated = parseNursingSnapshotEnvelope({ requestId, status: "ok", errors: [], data },
        { organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId }, parsed.data.nonce, Date.now());
      return ok({ ...data, ...validated }, 200, requestId);
    } catch {
      throw new IntegrationError("NURSING_SNAPSHOT_READ_UNAVAILABLE", "尚未取得授權的最新資料；請保留原操作並稍後回查。", 503);
    }
  });
}
