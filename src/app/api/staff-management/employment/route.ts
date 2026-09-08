import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  parseStaffEmploymentProposalInput,
  parseStaffProposalDecisionInput,
  parseStaffProposalDecisionReceipt,
  parseStaffProposalReceipt,
  STAFF_MANAGEMENT_ACTION_HEADER,
  STAFF_MANAGEMENT_DECISION_MAX_BYTES,
  STAFF_MANAGEMENT_PROPOSAL_MAX_BYTES,
} from "@/lib/staff-management/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGE_SCOPES = ["staff_management.read", "staff_management.manage",
  "staff_management.identity.read", "staff_management.employment.read",
  "staff_management.employment.manage"] as const;

function requireScopes(scopes: readonly string[], required: readonly string[],
  code: string, message: string) {
  if (!required.every((scope) => scopes.includes(scope))) {
    throw new IntegrationError(code, message, 403);
  }
}

function requireAction(request: Request, expected: "propose_employment" | "decide_employment") {
  if (request.headers.get(STAFF_MANAGEMENT_ACTION_HEADER) !== expected) {
    throw new IntegrationError("INVALID_STAFF_MANAGEMENT_ACTION",
      "缺少或不符合此員工作業的受治理動作標頭。", 400,
      STAFF_MANAGEMENT_ACTION_HEADER);
  }
}

function proposalFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure("STAFF_EMPLOYMENT_NOT_AUTHORIZED",
    "目前角色、機構、分支或聘僱欄位權限不允許建立提案。", 403);
  if (code === "55000") return databaseFailure("ONBOARDING_NOT_CONFIGURED",
    "組織候選／邀請來源與 Auth 帳號建立尚未設定，不能從全域人員名單建立員工。", 503);
  if (code === "23505") return databaseFailure("STAFF_MANAGEMENT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容。", 409);
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_EMPLOYMENT_VERSION_CONFLICT", "員工狀態或預期版本已改變，請重新載入。", 409);
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_MANAGEMENT_INPUT", "聘僱異動內容未通過驗證。", 400);
  return databaseFailure("STAFF_EMPLOYMENT_SAVE_UNCERTAIN",
    "提案結果尚未確認；請保留相同操作鍵重試。", 409);
}

function decisionFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure("STAFF_EMPLOYMENT_DECISION_NOT_AUTHORIZED",
    "審核人必須具聘僱欄位權限、近期雙重驗證，且不得審核自己的提案。", 403);
  if (code === "23505") return databaseFailure("STAFF_MANAGEMENT_IDEMPOTENCY_CONFLICT",
    "提案已決議，或相同審核操作鍵已用於不同內容。", 409);
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_EMPLOYMENT_DECISION_CONFLICT", "提案或員工版本已改變，請重新載入。", 409);
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_MANAGEMENT_INPUT", "審核內容未通過驗證。", 400);
  return databaseFailure("STAFF_EMPLOYMENT_DECISION_UNCERTAIN",
    "審核結果尚未確認；請保留相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireAction(request, "propose_employment");
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式只能檢視合成員工，不會建立聘僱提案。", 403);
    requireScopes(actor.scopes, MANAGE_SCOPES, "STAFF_EMPLOYMENT_NOT_AUTHORIZED",
      "目前工作範圍不允許管理聘僱資料。");
    // Authority and same-session step-up are established before employment
    // content, identity UUIDs, or reasons are read from the request body.
    await requireRecentAal2(actor);
    const input = parseStaffEmploymentProposalInput(
      await readJsonObject(request, STAFF_MANAGEMENT_PROPOSAL_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (input.proposalAction === "onboard") throw new IntegrationError(
      "ONBOARDING_NOT_CONFIGURED",
      "組織候選／邀請來源與 Auth 帳號建立尚未設定，不能從全域人員名單建立員工。", 503,
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式員工管理服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("submit_staff_management_proposal", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_action: input.proposalAction,
      p_proposal_key: input.proposalKey,
      p_target_membership_id: input.targetMembershipId,
      p_target_profile_id: input.targetProfileId,
      p_expected_membership_version: input.expectedMembershipVersion,
      p_target_membership_status: input.targetMembershipStatus,
      p_starts_on: input.startsOn, p_ends_on: input.endsOn,
      p_employment_type_text: input.employmentTypeText,
      p_job_title_text: input.jobTitleText,
      p_registration_status_text: input.registrationStatusText,
      p_termination_effective_on: null, p_change_reason: input.changeReason,
      p_idempotency_key: deterministicUuid("page59-staff-employment-proposal",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw proposalFailure(error?.code);
    const receipt = parseStaffProposalReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requireAction(request, "decide_employment");
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會送出聘僱審核決定。", 403);
    requireScopes(actor.scopes, [...MANAGE_SCOPES, "staff_management.approve"],
      "STAFF_EMPLOYMENT_DECISION_NOT_AUTHORIZED",
      "目前工作範圍不允許審核聘僱提案。");
    await requireRecentAal2(actor);
    const input = parseStaffProposalDecisionInput(
      await readJsonObject(request, STAFF_MANAGEMENT_DECISION_MAX_BYTES),
      request.headers.get("idempotency-key"), ["employment_change"],
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
      p_idempotency_key: deterministicUuid("page59-staff-employment-decision",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw decisionFailure(error?.code);
    const receipt = parseStaffProposalDecisionReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
