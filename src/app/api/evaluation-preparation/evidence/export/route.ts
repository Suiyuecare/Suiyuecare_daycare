import { z } from "zod";
import { evaluationEvidenceReviewSchema, evaluationPreparationVersionSchema } from "@/lib/evaluation-preparation/contract";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, requireRecentAal2 } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bundleSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), bundleId: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/u), createdAt: z.iso.datetime({ offset: true }), formalSubmissionEnabled: z.literal(false),
  payload: z.object({ total: z.number().int().positive().max(2500), approved: z.number().int().positive().max(2500), items: z.array(z.object({ version: evaluationPreparationVersionSchema, review: evaluationEvidenceReviewSchema }).strict()).max(2500) }).strict(),
}).strict().refine((value) => value.payload.total === value.payload.approved && value.payload.items.length === value.payload.total && value.payload.items.every((item) => item.review.decision === "approved" && item.review.versionId === item.version.versionId));

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest(); await requireRecentAal2(actor);
    if (actor.demo || !actor.scopes.includes("audit.view") || !actor.roles.some((role) => ["organization_manager", "branch_supervisor", "branch_director"].includes(role))) throw new IntegrationError("EVIDENCE_NOT_AUTHORIZED", "這個帳號不能下載證據清冊。", 403);
    const query = new URL(request.url).searchParams;
    const id = z.uuid().safeParse(query.get("bundle"));
    if (!id.success || [...query.keys()].some((key) => key !== "bundle")) throw new IntegrationError("INVALID_BUNDLE", "請從已建立的證據清冊下載。", 400);
    const client = await createServerSupabaseClient(); if (!client) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "評鑑服務暫時不可用。", 503);
    const { data, error } = await client.rpc("evaluation_evidence_bundle_read", { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_bundle_id: id.data });
    const parsed = bundleSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.organizationId !== actor.organizationId || parsed.data.branchId !== actor.branchId || parsed.data.bundleId !== id.data) throw new IntegrationError("BUNDLE_UNAVAILABLE", "無法取得原清冊，尚未下載。", 503);
    return new Response(JSON.stringify(parsed.data), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="internal-evidence-${id.data}.json"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } });
  });
}
