import { ok } from "@/lib/api/response";
import { parseCustomDraftReceipt, parseCustomDraftSave } from "@/lib/form-governance/custom-draft";
import { authorizeCustomDraft, customDraftFailure, runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const { actor, supabase } = await authorizeCustomDraft(true);
    const input = parseCustomDraftSave(await readJsonObject(request, 64 * 1024), request.headers.get("idempotency-key"));
    const { data, error } = await runCustomDraftRpc(supabase.rpc("save_custom_form_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_form_version_id: input.formVersionId,
      p_base_revision: input.baseRevision,
      p_idempotency_key: input.idempotencyKey,
      p_payload: input.payload,
    }));
    if (error || !data) throw customDraftFailure(error?.code);
    const receipt = parseCustomDraftReceipt(data, input);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
