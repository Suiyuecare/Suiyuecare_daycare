import { ok, partial } from "@/lib/api/response";
import {
  CLIENT_TOCC_BATCH_MAX_BYTES,
  clientToccBatchDatabaseItems,
  parseClientToccBatchInput,
  parseClientToccBatchResults,
} from "@/lib/integrations/client-tocc";
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

function batchFailure(code: string | undefined) {
  if (code === "42501") {
    return databaseFailure(
      "CLIENT_TOCC_BATCH_NOT_AUTHORIZED",
      "目前角色、分支、個案指派或 AAL2 證據不允許執行 TOCC 批次。",
      403,
    );
  }
  if (code === "23505") {
    return databaseFailure(
      "CLIENT_TOCC_BATCH_IDEMPOTENCY_CONFLICT",
      "相同批次 UUID 冪等鍵曾用於不同內容。",
      409,
    );
  }
  if (["22023", "22007", "22P02", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_CLIENT_TOCC_BATCH",
      "TOCC 批次格式或項目數量不符合規則。",
      400,
    );
  }
  return databaseFailure(
    "CLIENT_TOCC_BATCH_SAVE_FAILED",
    "TOCC 批次未完整確認；請保留內容並以相同批次 UUID 鍵重試。",
    409,
  );
}

function itemMessage(code: string | undefined) {
  if (code === "forbidden") return "個案目前不在可寫入的有效指派範圍。";
  if (code === "idempotency_conflict") return "此項目 UUID 鍵已對應不同內容。";
  if (code === "retryable_conflict") return "資料暫時鎖定，可安全重試此項目。";
  if (code === "validation_failed") return "此項目的日期或狀態不符合正式規則。";
  return "此項目未確認完成，未回傳敏感錯誤內容。";
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_WRITE_DISABLED",
        "展示模式只提供合成資料檢視，TOCC 批次不會執行或持久化。",
        403,
      );
    }
    if (
      !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("health.write")
    ) {
      throw new IntegrationError(
        "CLIENT_TOCC_BATCH_NOT_AUTHORIZED",
        "目前角色沒有執行 TOCC 批次的權限。",
        403,
      );
    }
    await requireRecentAal2(actor);
    const input = parseClientToccBatchInput(
      await readJsonObject(request, CLIENT_TOCC_BATCH_MAX_BYTES),
      request.headers.get("idempotency-key"),
      new Date(),
    );

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式 TOCC 批次服務尚未設定。",
        503,
      );
    }
    const { data, error } = await supabase.rpc("record_client_tocc_batch", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_items: clientToccBatchDatabaseItems(input),
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw batchFailure(error.code);

    const items = parseClientToccBatchResults(data, input);
    const failed = items.filter((item) => item.status === "failed");
    const payload = {
      items,
      counts: {
        total: items.length,
        success: items.length - failed.length,
        failed: failed.length,
      },
      persisted: true as const,
      demo: false as const,
    };
    if (failed.length) {
      return partial(
        payload,
        failed.map((item) => ({
          code: `CLIENT_TOCC_ITEM_${item.error?.code.toUpperCase() ?? "FAILED"}`,
          message: itemMessage(item.error?.code),
          field: `items.${item.itemIndex - 1}`,
        })),
        207,
        requestId,
      );
    }
    return ok(
      payload,
      items.every((item) => item.batchReplayed) ? 200 : 201,
      requestId,
    );
  });
}

