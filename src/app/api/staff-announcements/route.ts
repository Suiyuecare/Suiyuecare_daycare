import { ok } from "@/lib/api/response";
import {
  parseStaffAnnouncementAction,
  parseStaffAnnouncementInput,
  parseStaffAnnouncementResult,
  STAFF_ANNOUNCEMENT_MAX_BYTES,
  staffAnnouncementRpc,
} from "@/lib/integrations/staff-announcements";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writeFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED",
    "目前角色、分支、員工受眾或近期 AAL2 不允許此公告操作。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_ANNOUNCEMENT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同公告內容。",
    409,
  );
  if (["40001", "23514"].includes(code ?? "")) return databaseFailure(
    "STAFF_ANNOUNCEMENT_VERSION_CONFLICT",
    "公告版本已變更；請重新載入目前版本後再操作。",
    409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_ANNOUNCEMENT",
    "公告欄位、受眾或發布／到期時間不符合規則。",
    400,
  );
  return databaseFailure(
    "STAFF_ANNOUNCEMENT_SAVE_FAILED",
    "公告操作未確認完成；請保留內容與相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Actor, demo and action-level authority are resolved before any body read.
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只提供合成公告檢視，不會寫入或假裝成功。",
      403,
    );
    const action = parseStaffAnnouncementAction(
      request.headers.get("x-announcement-action"),
    );
    if (!actor.scopes.includes("announcements.read")) throw new IntegrationError(
      "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED",
      "目前角色沒有公告讀取權限。",
      403,
    );
    if (
      action !== "read" &&
      !actor.scopes.includes("announcements.manage")
    ) throw new IntegrationError(
      "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED",
      "目前角色沒有公告版本管理權限。",
      403,
    );
    if (
      (action === "publish" || action === "withdraw") &&
      !actor.scopes.includes("announcements.publish")
    ) throw new IntegrationError(
      "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED",
      "目前角色沒有公告發布或撤回權限。",
      403,
    );
    if (action === "publish" || action === "withdraw") {
      await requireRecentAal2(actor);
    }
    const input = parseStaffAnnouncementInput(
      action,
      await readJsonObject(request, STAFF_ANNOUNCEMENT_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式公告資料服務尚未設定。",
      503,
    );
    const rpc = staffAnnouncementRpc(input);
    const { data, error } = await supabase.rpc(rpc.name, {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      ...rpc.args,
    });
    if (error) throw writeFailure(error.code);
    const result = parseStaffAnnouncementResult(data, input);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}
