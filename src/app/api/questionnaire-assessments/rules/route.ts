import { z } from "zod";
import { ok } from "@/lib/api/response";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { getQuestionnaireForm } from "@/lib/questionnaire-assessments/forms";
import { questionnaireGovernanceSchema } from "@/lib/questionnaire-assessments/governance";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(write: boolean) {
  const actor = await authorizeStaffRequest();
  if (actor.demo || !actor.scopes.includes("forms.manage")) throw new IntegrationError("RULE_NOT_AUTHORIZED", "沒有規則發布權限。", 403);
  if (write && actor.assuranceLevel !== "aal2") throw new IntegrationError("REAUTH_REQUIRED", "發布規則前請完成近期驗證。", 403);
  return actor;
}
export async function GET() {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize(false);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "規則服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("questionnaire_rule_governance_snapshot", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
    });
    const parsed = questionnaireGovernanceSchema.safeParse(data);
    if (error || !parsed.success) throw databaseFailure("RULE_READ_FAILED", "規則暫時無法載入。");
    return ok(parsed.data, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize(true);
    const raw = await readJsonObject(request, 4096);
    const key = z.string().uuid().safeParse(request.headers.get("idempotency-key"));
    const parsed = z.discriminatedUnion("action", [
      z.object({ action: z.literal("request"), formKey: z.string(), formVersion: z.string().max(80),
        effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), evidenceReference: z.string().trim().min(1).max(300) }).strict(),
      z.object({ action: z.literal("approve"), publicationId: z.string().uuid() }).strict(),
    ]).safeParse(raw);
    if (!key.success || !parsed.success) throw new IntegrationError("RULE_INVALID", "請核對發布資料。", 400);
    const input = parsed.data;
    if (input.action === "request") {
      const form = getQuestionnaireForm(input.formKey as QuestionnaireFormKey);
      if (!form || form.version !== input.formVersion || (input.effectiveTo && input.effectiveTo < input.effectiveFrom)) {
        throw new IntegrationError("RULE_INVALID", "表單版本或生效期間無效。", 400);
      }
    }
    const payload = input.action === "approve" ? { action: input.action, publication_id: input.publicationId }
      : { action: input.action, form_key: input.formKey, form_version: input.formVersion,
        effective_from: input.effectiveFrom, ...(input.effectiveTo ? { effective_to: input.effectiveTo } : {}), evidence_reference: input.evidenceReference };
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "規則服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("publish_questionnaire_rule", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_payload: payload, p_idempotency_key: key.data,
    });
    if (error || !data) {
      if (error?.code === "42501") throw databaseFailure("RULE_NOT_AUTHORIZED", "需要另一位有權限的覆核者與近期驗證。", 403);
      if (["23505", "23P01", "55000"].includes(error?.code ?? "")) throw databaseFailure("RULE_CONFLICT", "版本已發布、期間重疊或操作識別碼衝突，請重新載入。", 409);
      if (["22023", "23514"].includes(error?.code ?? "")) throw databaseFailure("RULE_INVALID", "發布資料不符合規則。", 400);
      throw databaseFailure("RULE_WRITE_UNKNOWN", "發布結果尚未確認；請保留畫面並重試同一次操作。");
    }
    return ok(data, 201, requestId);
  });
}
