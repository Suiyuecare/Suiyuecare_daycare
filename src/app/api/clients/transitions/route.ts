import { ok } from "@/lib/api/response";
import {
  parseClientTransitionInput,
} from "@/lib/clients/lifecycle";
import type {
  ClientLifecycleStatus,
} from "@/lib/clients/types";
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

type TransitionRpcRow = {
  transition_id: string;
  client_id: string;
  from_status: ClientLifecycleStatus;
  to_status: ClientLifecycleStatus;
  resulting_row_version: number;
  replayed: boolean;
};

function transitionFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "CLIENT_TRANSITION_NOT_AUTHORIZED",
      "目前角色、資料範圍或重新驗證狀態不允許這項個案異動。",
      403,
    );
  }
  if (errorCode === "40001") {
    return databaseFailure(
      "CLIENT_VERSION_CONFLICT",
      "個案狀態已由其他工作人員更新；請重新載入後再建立異動。",
      409,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "CLIENT_TRANSITION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同的個案異動內容。",
      409,
    );
  }
  if (errorCode === "23514") {
    return databaseFailure(
      "CLIENT_TRANSITION_STATE_CONFLICT",
      "目前個案狀態、日期或既有歷程不允許這項異動；請重新載入確認。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "CLIENT_TRANSITION_REJECTED",
      "個案異動欄位未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "CLIENT_TRANSITION_FAILED",
    "異動未確認完成；請保留畫面內容並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_READ_ONLY",
        "展示模式只呈現合成歷程，不會建立正式個案異動。",
        403,
      );
    }
    if (!actor.scopes.includes("clients.manage")) {
      throw new IntegrationError(
        "CLIENT_TRANSITION_NOT_AUTHORIZED",
        "目前角色沒有管理個案生命週期的權限。",
        403,
      );
    }
    await requireRecentAal2(actor);

    const body = await readJsonObject(request, 32 * 1024);
    const input = parseClientTransitionInput(
      body,
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式個案資料服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("transition_client", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: input.clientId,
        p_event_kind: input.eventKind,
        p_effective_on: input.effectiveOn,
        p_reason: input.reason,
        p_handoff_note: input.handoffNote,
        p_expected_row_version: input.expectedRowVersion,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<TransitionRpcRow>();

    if (error || !data) throw transitionFailure(error?.code);

    return ok(
      {
        transition: {
          id: data.transition_id,
          clientId: data.client_id,
          eventKind: input.eventKind,
          effectiveOn: input.effectiveOn,
          fromStatus: data.from_status,
          toStatus: data.to_status,
          baseRowVersion: input.expectedRowVersion,
          resultingRowVersion: data.resulting_row_version,
        },
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      data.replayed ? 200 : 201,
      requestId,
    );
  });
}
