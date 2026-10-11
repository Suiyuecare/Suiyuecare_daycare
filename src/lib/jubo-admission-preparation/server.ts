import "server-only";
import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { admissionPreparationReceiptSchema, admissionPreparationSnapshotSchema, type AdmissionPreparationInput } from "./contract";

function canPrepare(actor: TenantContext) {
  return !actor.demo && !!actor.branchId && actor.roles.some(role =>
    ["organization_manager", "branch_supervisor", "branch_director"].includes(role)) &&
    ["clients.read", "clients.demographics.read", "clients.manage"].every(scope => actor.scopes.includes(scope));
}
export async function authorizeAdmissionPreparation() {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  if (!canPrepare(actor)) throw new IntegrationError("ADMISSION_PREPARATION_DENIED", "請由本分支收案負責人核對。", 403);
  return actor;
}
export function admissionPreparationDatabaseError(code?: string): never {
  if (code === "42501") throw new IntegrationError("ADMISSION_PREPARATION_DENIED", "需本分支授權、近期驗證；覆核須由另一位主任完成。", 403);
  if (["23505", "40001"].includes(code ?? "")) throw new IntegrationError("ADMISSION_PREPARATION_CONFLICT", "資料或核對版本已更新，請重新載入；尚未覆寫原紀錄。", 409);
  if (["22023", "23514", "22007", "22008"].includes(code ?? "")) throw new IntegrationError("ADMISSION_PREPARATION_INVALID", "請核對收案日、資格期間及文件識別。", 400);
  throw new IntegrationError("ADMISSION_PREPARATION_UNKNOWN", "尚未確認結果，請保留本次內容並重試同一次操作。", 503);
}
export async function loadJuboAdmissionPreparation(actor: TenantContext, clientId: string) {
  if (!canPrepare(actor)) return null;
  if (!z.uuid().safeParse(clientId).success) throw new IntegrationError("INVALID_CLIENT", "請重新選擇個案。", 400);
  const db = await createServerSupabaseClient();
  if (!db) admissionPreparationDatabaseError();
  const { data, error } = await db.rpc("jubo_admission_preparation_snapshot", {
    p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId,
  });
  if (error?.code === "42501") return null;
  const parsed = admissionPreparationSnapshotSchema.safeParse(data);
  if (error || !parsed.success || parsed.data.clientId !== clientId) admissionPreparationDatabaseError(error?.code);
  return parsed.data;
}
export async function mutateAdmissionPreparation(actor: TenantContext, input: AdmissionPreparationInput, key: string) {
  const db = await createServerSupabaseClient();
  if (!db) admissionPreparationDatabaseError();
  const base = { p_org: actor.organizationId, p_branch: actor.branchId, p_client: input.clientId, p_reason: input.reason, p_idempotency_key: key };
  const { data, error } = input.action === "propose"
    ? await db.rpc("propose_jubo_pending_admission", { ...base, p_admitted_on: input.admittedOn,
      p_eligibility_reference: input.eligibilityReference, p_eligibility_sha256: input.eligibilitySha256,
      p_eligibility_from: input.eligibilityFrom, p_eligibility_to: input.eligibilityTo,
      p_agreement_reference: input.agreementReference, p_agreement_sha256: input.agreementSha256,
      p_expected_client_row_version: input.clientRowVersion })
    : await db.rpc("review_jubo_pending_admission", { ...base, p_proposal: input.proposalId,
      p_expected_sha256: input.expectedSha256, p_decision: input.decision });
  const parsed = admissionPreparationReceiptSchema.safeParse(data);
  if (error || !parsed.success || (input.action === "propose" ? !("proposalId" in parsed.data)
    : !("reviewId" in parsed.data) || parsed.data.decision !== input.decision)) admissionPreparationDatabaseError(error?.code);
  return parsed.data;
}
