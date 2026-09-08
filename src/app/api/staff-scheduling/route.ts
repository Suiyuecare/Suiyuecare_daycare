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
  parseDecideStaffScheduleInput,
  parseDecideStaffScheduleReceipt,
  parseSubmitStaffScheduleInput,
  parseSubmitStaffScheduleReceipt,
  STAFF_SCHEDULING_ACTION_HEADER,
  STAFF_SCHEDULING_DECISION_MAX_BYTES,
  STAFF_SCHEDULING_SUBMIT_MAX_BYTES,
} from "@/lib/staff-scheduling/parser";
import type { DecideStaffScheduleInput } from "@/lib/staff-scheduling/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_SCOPES = ["staff_scheduling.read", "staff_certificates.read"] as const;
const DECISIONS = {
  publish_schedule: "publish",
  override_schedule: "override",
  reject_schedule: "reject",
} as const satisfies Record<string, DecideStaffScheduleInput["decision"]>;

function requireScopes(scopes: readonly string[], required: readonly string[], message: string) {
  if (!required.every((scope) => scopes.includes(scope))) {
    throw new IntegrationError("STAFF_SCHEDULING_NOT_AUTHORIZED", message, 403);
  }
}

function requirePostAction(request: Request) {
  if (request.headers.get(STAFF_SCHEDULING_ACTION_HEADER) !== "submit_schedule") {
    throw new IntegrationError("INVALID_STAFF_SCHEDULING_ACTION",
      "缺少或不符合班表草稿的受治理動作標頭。", 400,
      STAFF_SCHEDULING_ACTION_HEADER);
  }
}

function requireDecisionAction(request: Request) {
  const header = request.headers.get(STAFF_SCHEDULING_ACTION_HEADER);
  if (!header || !(header in DECISIONS)) throw new IntegrationError(
    "INVALID_STAFF_SCHEDULING_ACTION", "缺少或不符合班表審核的受治理動作標頭。",
    400, STAFF_SCHEDULING_ACTION_HEADER,
  );
  return DECISIONS[header as keyof typeof DECISIONS];
}

function failure(code: string | undefined, decision = false) {
  if (code === "42501") return databaseFailure(
    decision ? "STAFF_SCHEDULING_DECISION_NOT_AUTHORIZED" :
      "STAFF_SCHEDULING_NOT_AUTHORIZED",
    decision ? "審核人須具獨立權限與近期雙重驗證，且不得審核自己的草稿。" :
      "目前角色、機構、分支或人員範圍不允許建立此班表草稿。", 403);
  if (code === "55000") return databaseFailure("STAFF_SCHEDULING_RULES_NOT_CONFIGURED",
    "所選期間的資格、工時、休息、場地、車輛或容量規則尚未完整發布，已停止排班。", 503);
  if (code === "23505") return databaseFailure("STAFF_SCHEDULING_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容。", 409);
  if (["23514", "23P01", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_SCHEDULING_VERSION_CONFLICT",
    "班表、規則或資格證據已改變，請重新載入後再操作。", 409);
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_SCHEDULING_INPUT", "班表內容未通過驗證。", 400);
  return databaseFailure("STAFF_SCHEDULING_RESULT_UNCERTAIN",
    "操作結果尚未確認；請保留相同操作鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    requirePostAction(request);
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式只能查看合成班表，不會建立資料。", 403);
    requireScopes(actor.scopes, [...BASE_SCOPES, "staff_scheduling.manage"],
      "目前工作範圍不允許建立或更正班表草稿。");
    // Establish authority and same-session step-up before parsing scheduling content.
    await requireRecentAal2(actor);
    const input = parseSubmitStaffScheduleInput(
      await readJsonObject(request, STAFF_SCHEDULING_SUBMIT_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式排班資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("submit_staff_schedule", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId, p_action: input.action,
      p_schedule_key: input.scheduleKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_version: input.expectedVersion,
      p_expected_content_hash: input.expectedContentHash,
      p_staff_membership_id: input.staffMembershipId,
      p_starts_at: input.startsAt, p_ends_at: input.endsAt,
      p_role_text: input.roleText, p_service_need_text: input.serviceNeedText,
      p_facility_code: input.facilityCode, p_vehicle_code: input.vehicleCode,
      p_planned_clients: input.plannedClients,
      p_revision_reason: input.revisionReason,
      p_idempotency_key: deterministicUuid("page63-staff-schedule-submit",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const receipt = parseSubmitStaffScheduleReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const requiredDecision = requireDecisionAction(request);
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
      "展示模式不會發布、覆核或駁回合成班表。", 403);
    const required = [...BASE_SCOPES, "staff_scheduling.approve",
      ...(requiredDecision === "override" ? ["staff_scheduling.override"] : [])];
    requireScopes(actor.scopes, required, "目前工作範圍不允許執行此班表審核。");
    await requireRecentAal2(actor);
    const input = parseDecideStaffScheduleInput(
      await readJsonObject(request, STAFF_SCHEDULING_DECISION_MAX_BYTES),
      request.headers.get("idempotency-key"), requiredDecision,
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED",
      "正式排班資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("decide_staff_schedule", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_schedule_version_id: input.scheduleVersionId,
      p_expected_schedule_key: input.expectedScheduleKey,
      p_expected_version: input.expectedVersion,
      p_expected_content_hash: input.expectedContentHash,
      p_expected_conflict_count: input.expectedConflictCount,
      p_decision: input.decision, p_reason: input.reason,
      p_idempotency_key: deterministicUuid("page63-staff-schedule-decision",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code, true);
    const receipt = parseDecideStaffScheduleReceipt(data, input,
      actor.organizationId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
