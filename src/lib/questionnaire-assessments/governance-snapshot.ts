import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { questionnaireGovernanceSchema } from "./governance";

export async function loadQuestionnaireGovernance(context: TenantContext) {
  if (context.demo || !context.scopes.includes("forms.manage")) return null;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("questionnaire_rule_governance_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
  });
  const parsed = questionnaireGovernanceSchema.safeParse(data);
  return error || !parsed.success ? null : parsed.data;
}
