import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { getTenantContext, hasRecentAal2 } from "@/lib/auth/context";
import { hasSupabaseConfiguration, isSyntheticPreviewMode } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  JUBO_PROFILE_REVIEW_PURPOSE,
  juboReviewPreviewSchema,
  juboReviewQueueSchema,
  juboReviewReceiptLookupSchema,
  juboReviewReceiptSchema,
  type JuboReviewRequest,
} from "./model";

const requiredScopes = [
  "clients.read", "clients.demographics.read", "clients.manage",
  "clients.view_all", "imports.approve",
] as const;
const managerRoles = ["organization_manager", "branch_supervisor", "branch_director"] as const;

export function juboReviewFeatureEnabled() {
  return process.env.JUBO_PROFILE_V2_REVIEW_ENABLED === "true";
}

export function canReviewJuboProfiles(actor: TenantContext | null) {
  return Boolean(actor && !actor.demo && actor.branchId &&
    actor.roles.some((role) => (managerRoles as readonly string[]).includes(role)) &&
    requiredScopes.every((scope) => actor.scopes.includes(scope)));
}

export async function authorizeJuboReviewScope() {
  if (!juboReviewFeatureEnabled() || isSyntheticPreviewMode() || !hasSupabaseConfiguration()) {
    throw new IntegrationError("JUBO_REVIEW_NOT_READY", "JUBO 個案覆核尚未開通，正式個案資料不會因此建立。", 503);
  }
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入公司帳號。", 401);
  if (!canReviewJuboProfiles(actor)) {
    throw new IntegrationError("JUBO_REVIEW_DENIED", "這項覆核需要機構管理與匯入核准權限。", 403);
  }
  return actor;
}

export async function authorizeJuboReview() {
  const actor = await authorizeJuboReviewScope();
  if (actor.assuranceLevel !== "aal2" || !(await hasRecentAal2())) {
    throw new IntegrationError("JUBO_REAUTH_REQUIRED", "請先完成最近 15 分鐘內的重新驗證，再返回此頁重新整理。", 403);
  }
  return actor;
}

function rpcError(error: { code?: string } | null): never {
  switch (error?.code) {
    case "42501":
      throw new IntegrationError("JUBO_REVIEW_DENIED", "目前權限、來源範圍或近期驗證未通過；請重新驗證並重新讀取。", 403);
    case "22023":
      throw new IntegrationError("JUBO_REVIEW_INVALID", "覆核資料或來源版本不一致，請重新讀取後逐欄核對。", 409);
    case "23505":
    case "40001":
      throw new IntegrationError("JUBO_REVIEW_CONFLICT", "此筆來源已有新的覆核或重複操作；請重新讀取狀態。", 409);
    default:
      throw new IntegrationError("JUBO_REVIEW_UNCERTAIN", "結果尚未確認，請先核對清單狀態，不要另開新一次核准。", 503);
  }
}

async function callJuboReviewRpc(name: string, args: Record<string, unknown>) {
  const client = await createServerSupabaseClient();
  if (!client) throw new IntegrationError("JUBO_REVIEW_NOT_READY", "正式資料連線尚未就緒。", 503);
  let result: Awaited<ReturnType<typeof client.rpc>>;
  try {
    result = await client.rpc(name, args);
  } catch {
    rpcError(null);
  }
  if (result.error || result.data == null) rpcError(result.error);
  return result.data as unknown;
}

export async function readJuboReviewQueue(actor: TenantContext) {
  const result = juboReviewQueueSchema.safeParse(await callJuboReviewRpc(
    "jubo_profile_mapping_v2_review_queue",
    { p_org: actor.organizationId, p_branch: actor.branchId },
  ));
  if (!result.success) {
    throw new IntegrationError("JUBO_REVIEW_RESPONSE_INVALID", "覆核清單未通過來源核對，請聯絡管理員。", 502);
  }
  return result.data;
}

export async function previewJuboProfile(actor: TenantContext, pairId: string, sourceRowId: string) {
  const result = juboReviewPreviewSchema.safeParse(await callJuboReviewRpc(
    "preview_jubo_profile_mapping_v2",
    { p_org: actor.organizationId, p_branch: actor.branchId,
      p_pair: pairId, p_source_row: sourceRowId, p_purpose: JUBO_PROFILE_REVIEW_PURPOSE },
  ));
  if (!result.success || result.data.pairId !== pairId || result.data.sourceRowId !== sourceRowId) {
    throw new IntegrationError("JUBO_REVIEW_RESPONSE_INVALID", "此筆預覽未通過來源與欄位核對，請重新讀取。", 502);
  }
  return result.data;
}

export async function reviewJuboProfile(actor: TenantContext, input: JuboReviewRequest) {
  const result = juboReviewReceiptSchema.safeParse(await callJuboReviewRpc(
    "review_jubo_profile_mapping_v2",
    { p_org: actor.organizationId, p_branch: actor.branchId,
      p_pair: input.pairId, p_source_row: input.sourceRowId,
      p_preview: input.previewId,
      p_expected_source_sha256: input.sourceRowSha256,
      p_expected_fingerprint: input.mappingReviewSha256,
      p_expected_preview_sha256: input.previewSha256,
      p_purpose: JUBO_PROFILE_REVIEW_PURPOSE,
      p_decision: input.decision, p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey },
  ));
  if (!result.success || result.data.decision !== input.decision) {
    throw new IntegrationError("JUBO_REVIEW_RESPONSE_INVALID", "覆核回執未通過核對；請先查清單狀態，不要重複核准。", 502);
  }
  return result.data;
}

export async function readJuboReviewReceipt(actor: TenantContext, input: JuboReviewRequest) {
  const result = juboReviewReceiptLookupSchema.safeParse(await callJuboReviewRpc(
    "jubo_profile_mapping_v2_review_receipt",
    { p_org: actor.organizationId, p_branch: actor.branchId,
      p_pair: input.pairId, p_source_row: input.sourceRowId,
      p_preview: input.previewId,
      p_expected_source_sha256: input.sourceRowSha256,
      p_expected_fingerprint: input.mappingReviewSha256,
      p_expected_preview_sha256: input.previewSha256,
      p_purpose: JUBO_PROFILE_REVIEW_PURPOSE,
      p_decision: input.decision, p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey },
  ));
  if (!result.success ||
    (result.data.status === "found" && result.data.receipt.decision !== input.decision)) {
    throw new IntegrationError("JUBO_REVIEW_RESPONSE_INVALID", "原操作回執未通過核對；請聯絡管理員。", 502);
  }
  return result.data;
}
