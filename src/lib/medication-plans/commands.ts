import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  parseApproveMedicationPlanResult,
  parseCreateMedicationPlanDraftResult,
  parseStopMedicationPlanResult,
  parseSubmitMedicationPlanResult,
} from "./parser";
import type {
  CreateMedicationPlanDraftInput,
  MedicationPlanVersionActionInput,
  StopMedicationPlanInput,
} from "./types";

type RpcError = { code?: string } | null;

export function medicationPlanFailure(error: RpcError) {
  const code = error?.code;
  if (code === "42501") {
    return databaseFailure(
      "MEDICATION_PLAN_NOT_AUTHORIZED",
      "目前角色、分支、個案指派、雙人分工或重新驗證不允許這項操作。",
      403,
    );
  }
  if (code === "40001") {
    return databaseFailure(
      "MEDICATION_PLAN_VERSION_CONFLICT",
      "用藥計畫版本已改變；請重新載入後再操作。",
      409,
    );
  }
  if (code === "23P01") {
    return databaseFailure(
      "MEDICATION_PLAN_PERIOD_OVERLAP",
      "同一個案、藥物與給藥時點已有重疊的有效計畫。",
      409,
    );
  }
  if (code === "23505") {
    return databaseFailure(
      "MEDICATION_PLAN_CONFLICT",
      "相同冪等鍵曾用於不同內容，或此計畫已有新的流程結果。",
      409,
    );
  }
  if (["23514", "23503", "55000"].includes(code ?? "")) {
    return databaseFailure(
      "MEDICATION_PLAN_STATE_CONFLICT",
      "個案、計畫版本、生效期間或目前狀態已不符合操作條件。",
      409,
    );
  }
  if (["22023", "22003"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_MEDICATION_PLAN",
      "用藥計畫欄位、排程或生效期間未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "MEDICATION_PLAN_SAVE_FAILED",
    "用藥計畫尚未確認完成；請保留內容並以相同冪等鍵重試。",
  );
}

export function assertMedicationPlanManager(actor: TenantContext) {
  if (actor.demo) {
    throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只顯示合成資料；用藥計畫寫入已拒絕且不會保存。",
      403,
    );
  }
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("medications.read") ||
    !actor.scopes.includes("medications.manage")
  ) {
    throw new IntegrationError(
      "MEDICATION_PLAN_NOT_AUTHORIZED",
      "目前角色缺少個案讀取、用藥讀取或用藥計畫管理權限。",
      403,
    );
  }
}

async function formalClient() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式用藥計畫後端尚未設定。",
      503,
    );
  }
  return supabase;
}

export async function createMedicationPlanDraft(
  actor: TenantContext,
  input: CreateMedicationPlanDraftInput,
) {
  assertMedicationPlanManager(actor);
  const supabase = await formalClient();
  const { data, error } = await supabase
    .rpc("create_medication_plan_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: input.clientId,
      p_previous_plan_id: input.previousPlanId,
      p_medication_name: input.medicationName,
      p_dose: input.dose,
      p_dose_unit: input.doseUnit,
      p_route: input.route,
      p_schedule: input.schedule,
      p_high_risk: input.highRisk,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_idempotency_key: input.idempotencyKey,
    })
    .maybeSingle<Record<string, unknown>>();
  if (error || !data) throw medicationPlanFailure(error);
  return parseCreateMedicationPlanDraftResult(
    data,
    input.clientId,
    input.effectiveFrom,
  );
}

export async function submitMedicationPlan(
  actor: TenantContext,
  input: MedicationPlanVersionActionInput,
) {
  assertMedicationPlanManager(actor);
  const supabase = await formalClient();
  const { data, error } = await supabase
    .rpc("submit_medication_plan", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_medication_plan_id: input.medicationPlanId,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey,
    })
    .maybeSingle<Record<string, unknown>>();
  if (error || !data) throw medicationPlanFailure(error);
  return parseSubmitMedicationPlanResult(
    data,
    input.medicationPlanId,
    input.expectedRowVersion,
  );
}

export async function approveMedicationPlan(
  actor: TenantContext,
  input: MedicationPlanVersionActionInput,
) {
  assertMedicationPlanManager(actor);
  const supabase = await formalClient();
  const { data, error } = await supabase
    .rpc("approve_medication_plan", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_medication_plan_id: input.medicationPlanId,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey,
    })
    .maybeSingle<Record<string, unknown>>();
  if (error || !data) throw medicationPlanFailure(error);
  return parseApproveMedicationPlanResult(
    data,
    input.medicationPlanId,
    input.expectedRowVersion,
  );
}

export async function stopMedicationPlan(
  actor: TenantContext,
  input: StopMedicationPlanInput,
) {
  assertMedicationPlanManager(actor);
  const supabase = await formalClient();
  const { data, error } = await supabase
    .rpc("stop_medication_plan", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_medication_plan_id: input.medicationPlanId,
      p_expected_row_version: input.expectedRowVersion,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    })
    .maybeSingle<Record<string, unknown>>();
  if (error || !data) throw medicationPlanFailure(error);
  return parseStopMedicationPlanResult(
    data,
    input.medicationPlanId,
    input.expectedRowVersion,
  );
}
