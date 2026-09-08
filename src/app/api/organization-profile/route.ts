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
  ORGANIZATION_PROFILE_DECISION_MAX_BYTES,
  ORGANIZATION_PROFILE_PROPOSAL_MAX_BYTES,
  parseOrganizationProfileDecisionInput,
  parseOrganizationProfileDecisionReceipt,
  parseOrganizationProfileProposalInput,
  parseOrganizationProfileProposalReceipt,
} from "@/lib/organization-profile/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELD_SCOPES = [
  "organization_profile.permit.manage",
  "organization_profile.services.manage",
  "organization_profile.rates.manage",
  "organization_profile.capacity.manage",
  "organization_profile.contact.manage",
] as const;

function hasAll(scopes: readonly string[], required: readonly string[]) {
  return required.every((scope) => scopes.includes(scope));
}

function proposalFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "ORGANIZATION_PROFILE_NOT_AUTHORIZED",
    "目前角色、機構、分支、欄位權限或近期雙重驗證不允許建立異動提案。", 403,
  );
  if (code === "23505") return databaseFailure(
    "ORGANIZATION_PROFILE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或提案識別已存在。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "ORGANIZATION_PROFILE_VERSION_CONFLICT",
    "機構資料基準版本或生效期間已改變；請重新載入後再提案。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_ORGANIZATION_PROFILE_INPUT",
    "許可、服務、費率、容量、聯絡或生效版本未通過驗證。", 400,
  );
  return databaseFailure("ORGANIZATION_PROFILE_SAVE_UNCERTAIN",
    "異動提案尚未確認完成；請保留相同操作鍵重試。", 409);
}

function decisionFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "ORGANIZATION_PROFILE_DECISION_NOT_AUTHORIZED",
    "審核人必須具備完整欄位權限、近期雙重驗證，且不得審核自己的提案。", 403,
  );
  if (code === "23505") return databaseFailure(
    "ORGANIZATION_PROFILE_IDEMPOTENCY_CONFLICT",
    "相同審核操作鍵已用於不同決定。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "ORGANIZATION_PROFILE_DECISION_CONFLICT",
    "提案已被處理、基準版本已改變，或生效期間與既有版本重疊。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_ORGANIZATION_PROFILE_DECISION",
    "待審版本、決定或理由未通過驗證。", 400,
  );
  return databaseFailure("ORGANIZATION_PROFILE_DECISION_UNCERTAIN",
    "審核結果尚未確認完成；請保留相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成機構資料，不會建立提案。", 403,
    );
    const required = ["organization_profile.read", "organization_profile.manage",
      ...FIELD_SCOPES];
    if (actor.assuranceLevel !== "aal2" || !hasAll(actor.scopes, required)) {
      throw new IntegrationError("ORGANIZATION_PROFILE_NOT_AUTHORIZED",
        "目前登入保證等級、工作範圍或欄位權限不允許建立異動提案。", 403);
    }
    // Permission and same-session reauthentication are verified before any
    // permit, rate, capacity, or contact content is parsed.
    await requireRecentAal2(actor);
    const input = parseOrganizationProfileProposalInput(
      await readJsonObject(request, ORGANIZATION_PROFILE_PROPOSAL_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式機構資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc(
      "submit_organization_profile_proposal", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_action: input.proposalAction,
        p_proposal_key: input.proposalKey,
        p_profile_key: input.profileKey,
        p_base_version_id: input.baseVersionId,
        p_expected_base_version: input.expectedBaseVersion,
        p_effective_from: input.content.effectiveFrom,
        p_effective_to: input.content.effectiveTo,
        p_permit_number: input.content.permitNumber,
        p_permit_issuing_authority: input.content.permitIssuingAuthority,
        p_permit_issued_on: input.content.permitIssuedOn,
        p_permit_valid_through: input.content.permitValidThrough,
        p_permit_status_text: input.content.permitStatusText,
        p_organization_type_text: input.content.organizationTypeText,
        p_service_items: input.content.serviceItems.map((item) => ({
          service_key: item.serviceKey, name: item.name,
          description: item.description, taxonomy_status: item.taxonomyStatus,
        })),
        p_rate_items: input.content.rateItems.map((item) => ({
          rate_key: item.rateKey, label: item.label,
          amount_decimal_text: item.amountDecimalText,
          currency_code: item.currencyCode,
          effective_from: item.effectiveFrom, effective_to: item.effectiveTo,
          taxonomy_status: item.taxonomyStatus,
        })),
        p_approved_capacity: input.content.approvedCapacity,
        p_capacity_unit_text: input.content.capacityUnitText,
        p_capacity_basis_text: input.content.capacityBasisText,
        p_contact_name: input.content.contactName,
        p_contact_phone: input.content.contactPhone,
        p_contact_email: input.content.contactEmail,
        p_contact_address: input.content.contactAddress,
        p_change_reason: input.content.changeReason,
        p_idempotency_key: deterministicUuid("page58-organization-profile-proposal",
          actor.organizationId, actor.userId, input.idempotencyKey),
      },
    ).maybeSingle();
    if (error || !data) throw proposalFailure(error?.code);
    const receipt = parseOrganizationProfileProposalReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成機構資料，不會送出審核決定。", 403,
    );
    const required = ["organization_profile.read", "organization_profile.approve",
      ...FIELD_SCOPES];
    if (actor.assuranceLevel !== "aal2" || !hasAll(actor.scopes, required)) {
      throw new IntegrationError("ORGANIZATION_PROFILE_DECISION_NOT_AUTHORIZED",
        "目前登入保證等級、工作範圍或欄位權限不允許審核異動提案。", 403);
    }
    // Approval authority is established before proposal decision content is read.
    await requireRecentAal2(actor);
    const input = parseOrganizationProfileDecisionInput(
      await readJsonObject(request, ORGANIZATION_PROFILE_DECISION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式機構資料審核服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc(
      "decide_organization_profile_proposal", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_proposal_id: input.proposalId,
        p_expected_proposal_number: input.expectedProposalNumber,
        p_expected_base_version: input.expectedBaseVersion,
        p_decision: input.decision,
        p_decision_reason: input.decisionReason,
        p_idempotency_key: deterministicUuid("page58-organization-profile-decision",
          actor.organizationId, actor.userId, input.idempotencyKey),
      },
    ).maybeSingle();
    if (error || !data) throw decisionFailure(error?.code);
    const receipt = parseOrganizationProfileDecisionReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
