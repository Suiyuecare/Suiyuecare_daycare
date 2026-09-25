import { z } from "zod";

import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import {
  externalAssessmentResultInputSchema,
  parseExternalAssessmentResultReceipt,
  parseExternalAssessmentResultsSnapshot,
} from "@/lib/external-assessment-results/contract";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(code?: string) {
  if (code === "42501") return databaseFailure("EXTERNAL_ASSESSMENT_NOT_AUTHORIZED", "目前帳號或個案範圍不允許讀寫這筆結果。", 403);
  if (code === "23505") return databaseFailure("EXTERNAL_ASSESSMENT_IDEMPOTENCY_CONFLICT", "同一操作識別碼已用於不同內容；請重新載入後再登錄。", 409);
  if (code === "22023") return databaseFailure("INVALID_EXTERNAL_ASSESSMENT", "請檢查量表版本、日期、分數與必填欄位。", 400);
  if (code === "23514") return databaseFailure("EXTERNAL_ASSESSMENT_IMMUTABLE", "此筆歷程不可直接覆寫；請重新核對後新增正確紀錄。", 409);
  return databaseFailure("EXTERNAL_ASSESSMENT_UNAVAILABLE", "結果尚未確認儲存；請保留輸入並重試。", 503);
}

async function authorize(permission: "care_records.read" | "care_records.write") {
  const actor = await authorizeStaffRequest({ routinePermission: permission });
  if (actor.demo || !actor.scopes.includes("care_records.read") || !actor.scopes.includes(permission)) {
    throw new IntegrationError("EXTERNAL_ASSESSMENT_NOT_AUTHORIZED", "目前角色沒有外部量表結果的讀寫權限。", 403);
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式結果資料服務尚未設定。", 503);
  return { actor, supabase };
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const { actor, supabase } = await authorize("care_records.read");
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const query = z.object({ clientId: z.uuid() }).strict().safeParse(params);
    if (!query.success || [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) {
      throw new IntegrationError("INVALID_EXTERNAL_ASSESSMENT_QUERY", "請選擇有效個案。", 400);
    }
    const { data, error } = await supabase.rpc("read_external_assessment_results", {
      p_org: actor.organizationId,
      p_branch: actor.branchId,
      p_client: query.data.clientId,
    });
    if (error) throw failure(error.code);
    return ok({ snapshot: parseExternalAssessmentResultsSnapshot(data, query.data.clientId), demo: false }, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Authentication and routine read admission precede request-body parsing.
    await authorizeStaffRequest({ routinePermission: "care_records.read" });
    const body = await readJsonObject(request, 16 * 1024);
    const parsed = z.object({ clientId: z.uuid(), input: externalAssessmentResultInputSchema }).strict().safeParse(body);
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    if (!parsed.success || !key.success) throw new IntegrationError("INVALID_EXTERNAL_ASSESSMENT", "請檢查個案、操作識別碼與結果欄位。", 400);

    const { actor, supabase } = await authorize("care_records.write");
    const { data, error } = await supabase.rpc("write_external_assessment_result", {
      p_org: actor.organizationId,
      p_branch: actor.branchId,
      p_client: parsed.data.clientId,
      p_key: key.data,
      p_payload: parsed.data.input,
    });
    if (error) throw failure(error.code);
    const receipt = parseExternalAssessmentResultReceipt(data, parsed.data.input, parsed.data.clientId, actor.userId);
    return ok({ ...receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
