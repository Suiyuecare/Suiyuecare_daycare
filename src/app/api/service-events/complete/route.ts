import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { parseServiceEventCompletion } from "@/lib/integrations/service-events";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceEventRpcRow = {
  operation_id: string;
  service_event_id: string;
  client_id: string;
  authorized_care_plan_id: string;
  client_service_plan_id: string;
  service_code: string;
  status: "completed";
  started_at: string;
  ended_at: string;
  signed_at: string;
  signed_by: string;
  signature_purpose: string;
  signature_reauth_challenge_id: string;
  content_hash: string;
  replayed: boolean;
};

function completionFailure(errorCode?: string) {
  if (errorCode === "42501") {
    return databaseFailure(
      "SERVICE_COMPLETION_NOT_AUTHORIZED",
      "目前角色、分支、個案範圍或近期雙因素驗證不允許完成並簽署服務。",
      403,
    );
  }
  if (errorCode === "23505") {
    return databaseFailure(
      "SERVICE_COMPLETION_IDEMPOTENCY_CONFLICT",
      "相同冪等鍵曾用於不同服務內容。請重新載入後再操作。",
      409,
    );
  }
  if (errorCode === "23514" || errorCode === "23503") {
    return databaseFailure(
      "SERVICE_COMPLETION_STATE_CONFLICT",
      "個案狀態或當日唯一有效的已簽署服務計畫／核定計畫不符合完成條件。",
      409,
    );
  }
  if (errorCode === "22023") {
    return databaseFailure(
      "SERVICE_COMPLETION_REJECTED",
      "服務代碼、起訖時間、結果或備註未通過資料庫驗證。",
      400,
    );
  }
  return databaseFailure(
    "SERVICE_COMPLETION_FAILED",
    "服務尚未確認完成；請保留畫面內容並以相同冪等鍵重試。",
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (
      !actor.demo &&
      (!actor.scopes.includes("services.write") ||
        !actor.scopes.includes("services.sign"))
    ) {
      throw new IntegrationError(
        "SERVICE_COMPLETION_NOT_AUTHORIZED",
        "目前角色必須同時具備服務登錄與服務簽署權限。",
        403,
      );
    }
    await requireRecentAal2(actor);

    const input = parseServiceEventCompletion(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
      new Date(),
      // Formal exact replay must remain observable after 24 hours. The
      // database checks its durable operation ledger before applying the
      // new-write window. Demo mode has no ledger, so it checks here.
      { enforceTimeWindow: actor.demo },
    );

    if (actor.demo) {
      return ok(
        {
          serviceEvent: {
            id: randomUUID(),
            clientId: input.clientId,
            serviceCode: input.serviceCode,
            status: "completed" as const,
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            signed: true,
            signaturePurpose: "完成服務與執行證據簽署",
            signatureReauthChallengeId: null,
          },
          replayed: false,
          persisted: false,
          demo: true,
        },
        200,
        requestId,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式服務紀錄後端尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("complete_service_event", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: input.clientId,
        p_service_code: input.serviceCode,
        p_started_at: input.startedAt,
        p_ended_at: input.endedAt,
        p_result: input.result,
        p_notes: input.notes,
        p_idempotency_key: input.idempotencyKey,
      })
      .maybeSingle<ServiceEventRpcRow>();

    if (error || !data) throw completionFailure(error?.code);

    return ok(
      {
        serviceEvent: {
          id: data.service_event_id,
          clientId: data.client_id,
          authorizedCarePlanId: data.authorized_care_plan_id,
          clientServicePlanId: data.client_service_plan_id,
          serviceCode: data.service_code,
          status: data.status,
          startedAt: data.started_at,
          endedAt: data.ended_at,
          signedAt: data.signed_at,
          signedBy: data.signed_by,
          signaturePurpose: data.signature_purpose,
          signatureReauthChallengeId: data.signature_reauth_challenge_id,
        },
        operationId: data.operation_id,
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      data.replayed ? 200 : 201,
      requestId,
    );
  });
}
