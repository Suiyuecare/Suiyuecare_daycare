import { z } from "zod";
import { ok } from "@/lib/api/response";
import { customDraftDocumentSchema } from "@/lib/form-governance/custom-draft";
import { authorizeCustomDraft, customDraftFailure, runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleIntegrationRoute(async (requestId) => {
    const { actor, supabase } = await authorizeCustomDraft(false);
    const id = z.uuid().safeParse((await context.params).id);
    if (!id.success) throw new IntegrationError("INVALID_CUSTOM_FORM_ID", "表單識別碼格式錯誤。", 400);
    const { data, error } = await runCustomDraftRpc(supabase.rpc("read_custom_form_draft", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_form_version_id: id.data,
    }));
    if (error || !data) throw customDraftFailure(error?.code);
    const parsed = customDraftDocumentSchema.safeParse(data);
    if (!parsed.success || parsed.data.formVersionId !== id.data) throw customDraftFailure();
    return ok({ draft: parsed.data, demo: false }, 200, requestId);
  });
}
