import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  parseStaffProposalDecisionInput, parseStaffProposalDecisionReceipt,
  parseStaffProposalReceipt, parseStaffTerminationProposalInput,
  STAFF_MANAGEMENT_ACTION_HEADER,
  STAFF_MANAGEMENT_DECISION_MAX_BYTES, STAFF_MANAGEMENT_PROPOSAL_MAX_BYTES,
} from "@/lib/staff-management/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGE_SCOPES = ["staff_management.read", "staff_management.manage",
  "staff_management.identity.read", "staff_management.employment.read",
  "staff_management.termination.manage"] as const;

function requireAction(request: Request,
  expected: "propose_termination" | "decide_termination") {
  if (request.headers.get(STAFF_MANAGEMENT_ACTION_HEADER) !== expected) {
    throw new IntegrationError("INVALID_STAFF_MANAGEMENT_ACTION",
      "缺少或不符合此員工作業的受治理動作標頭。", 400,
      STAFF_MANAGEMENT_ACTION_HEADER);
  }
}

function requireScopes(scopes: readonly string[], approve = false) {
  const required = approve ? [...MANAGE_SCOPES, "staff_management.approve"] : MANAGE_SCOPES;
  if (!required.every((scope) => scopes.includes(scope))) throw new IntegrationError(
    approve ? "STAFF_TERMINATION_DECISION_NOT_AUTHORIZED" : "STAFF_TERMINATION_NOT_AUTHORIZED",
    "目前角色或欄位權限不允許離職停用作業。", 403,
  );
}

function failure(code: string | undefined, decision = false) {
  if (code === "42501") return databaseFailure(
    decision ? "STAFF_TERMINATION_DECISION_NOT_AUTHORIZED" : "STAFF_TERMINATION_NOT_AUTHORIZED",
    "離職停用必須具獨立權限與近期雙重驗證，審核人不得是提案人。", 403);
  if (code === "23505") return databaseFailure("STAFF_MANAGEMENT_IDEMPOTENCY_CONFLICT",
    "提案已決議，或相同操作鍵已用於不同內容。", 409);
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_TERMINATION_VERSION_CONFLICT", "員工狀態、離職日或預期版本已改變。", 409);
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_MANAGEMENT_INPUT", "離職停用內容未通過驗證。", 400);
  return databaseFailure("STAFF_TERMINATION_RESULT_UNCERTAIN",
    "離職停用結果尚未確認；請保留相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireAction(request, "propose_termination");
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會建立離職停用提案。", 403);
    requireScopes(actor.scopes); await requireRecentAal2(actor);
    const input = parseStaffTerminationProposalInput(
      await readJsonObject(request, STAFF_MANAGEMENT_PROPOSAL_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式員工管理服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("submit_staff_management_proposal", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_action: "terminate",
      p_proposal_key: input.proposalKey,
      p_target_membership_id: input.targetMembershipId,
      p_target_profile_id: input.targetProfileId,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_target_membership_status: "ended", p_starts_on: input.startsOn,
      p_ends_on: null, p_employment_type_text: null, p_job_title_text: null,
      p_registration_status_text: null,
      p_termination_effective_on: input.terminationEffectiveOn,
      p_change_reason: input.changeReason,
      p_idempotency_key: deterministicUuid("page59-staff-termination-proposal",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const receipt = parseStaffProposalReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireAction(request, "decide_termination");
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會送出離職停用審核。", 403);
    requireScopes(actor.scopes, true); await requireRecentAal2(actor);
    const input = parseStaffProposalDecisionInput(
      await readJsonObject(request, STAFF_MANAGEMENT_DECISION_MAX_BYTES),
      request.headers.get("idempotency-key"), ["terminate"],
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式員工管理服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("decide_staff_management_proposal", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_proposal_id: input.proposalId,
      p_expected_proposal_number: input.expectedProposalNumber,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_expected_content_hash: input.expectedContentHash,
      p_decision: input.decision, p_decision_reason: input.decisionReason,
      p_idempotency_key: deterministicUuid("page59-staff-termination-decision",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code, true);
    const receipt = parseStaffProposalDecisionReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
