import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoClientMasterSnapshot } from "@/lib/clients/master-demo";
import { canReadIntakeCompleteness, CHECK_KEYS, hasFreshReportTimestamp, snapshotSchema, type IntakeCompletenessSnapshot } from "./model";

export async function loadIntakeCompleteness(context: TenantContext, asOf: string): Promise<IntakeCompletenessSnapshot> {
  if (!canReadIntakeCompleteness(context)) throw new IntegrationError("INTAKE_REPORT_FORBIDDEN", "請由具有個案基本資料權限的收案負責人查看。", 403);
  if (context.demo) return snapshotSchema.parse({ organizationId: context.organizationId, branchId: context.branchId, asOf, generatedAt: new Date().toISOString(), rows: buildDemoClientMasterSnapshot().clients.map((client) => ({ clientId: client.id, clientCode: client.clientCode, displayName: client.displayName, clientStatus: "active", profileVersion: 0, checks: CHECK_KEYS.map((key) => ({ key, state: "unknown" })) })) });
  const db = await createServerSupabaseClient();
  if (!db) throw new IntegrationError("INTAKE_REPORT_UNAVAILABLE", "暫時無法核對收案資料，請稍後重試。", 503);
  const result = await db.rpc("intake_completeness_snapshot", { p_org: context.organizationId, p_branch: context.branchId, p_date: asOf })
    .abortSignal(AbortSignal.timeout(10_000)).then((response) => response, () => {
      throw new IntegrationError("INTAKE_REPORT_UNAVAILABLE", "收案核對連線逾時或中斷，請稍後重試。", 503);
    });
  if (result.error) throw new IntegrationError(result.error.code === "42501" ? "INTAKE_REPORT_FORBIDDEN" : "INTAKE_REPORT_UNAVAILABLE", result.error.code === "42501" ? "目前帳號無法核對此分支資料，請重新登入或聯絡主管。" : "暫時無法核對收案資料，沒有將未知資料算作完成。請稍後重試。", result.error.code === "42501" ? 403 : 503);
  const parsed = snapshotSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.organizationId !== context.organizationId || parsed.data.branchId !== context.branchId || parsed.data.asOf !== asOf || !hasFreshReportTimestamp(parsed.data.generatedAt)) throw new IntegrationError("INTAKE_REPORT_UNAVAILABLE", "本次資料範圍、時間或格式無法確認，請重新整理。", 503);
  return parsed.data;
}
