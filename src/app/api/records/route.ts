import { ok } from "@/lib/api/response";
import { z } from "zod";
import { diaryRecordSchema } from "@/lib/care-diary/schema";
import { assertOfflineCareScope } from "@/lib/offline/scope";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import {
  parseRecordDraft,
  recordKeyFor,
} from "@/lib/integrations/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (!actor.demo && !actor.scopes.includes("care_records.read")) throw new IntegrationError("DIARY_NOT_AUTHORIZED", "目前沒有查閱照顧日誌的權限。", 403);
    const clientId = z.uuid().safeParse(new URL(request.url).searchParams.get("client"));
    if (!clientId.success) throw new IntegrationError("INVALID_CLIENT", "請先選擇個案。", 400);
    if (actor.demo) return ok({ records: [], history: [], demo: true, persisted: false }, 200, requestId);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "目前無法讀取正式日誌，請稍後重試。", 503);
    const { data, error } = await supabase.rpc("care_diary_snapshot", { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_client_id: clientId.data });
    if (error) throw databaseFailure("DIARY_READ_FAILED", "無法讀取日誌，或目前沒有此個案的查閱權限。", error.code === "42501" ? 403 : 503);
    const parsed = z.object({ records: z.array(diaryRecordSchema), history: z.array(z.object({ id: z.uuid(), record_key: z.uuid(), version: z.number().int(), status: z.string(), previous_version_id: z.uuid().nullable(), correction_reason: z.string().nullable(), created_at: z.string(), signed_at: z.string().nullable(), signed_by: z.uuid().nullable(), content_hash: z.string().nullable() })) }).safeParse(data);
    if (!parsed.success || parsed.data.records.some((record) => record.client_id !== clientId.data)
      || parsed.data.history.some((entry) => !parsed.data.records.some((record) => record.record_key === entry.record_key))) {
      throw databaseFailure("DIARY_READ_FAILED", "日誌回覆不完整或與目前個案不一致，請稍後重試。", 503);
    }
    return ok({ ...parsed.data, demo: false, persisted: true }, 200, requestId);
  });
}

type CareDiaryDraftRpcRow = {
  id: string;
  version: number;
  status: string;
  replayed: boolean;
};

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    assertOfflineCareScope(request, actor);
    if (!actor.demo && !actor.scopes.includes("care_records.write")) {
      throw new IntegrationError(
        "RECORD_DRAFT_NOT_AUTHORIZED",
        "目前角色沒有建立照顧草稿的權限。",
        403,
      );
    }
    const body = await readJsonObject(request);
    const draft = parseRecordDraft(
      body,
      request.headers.get("idempotency-key"),
    );
    const recordKey = recordKeyFor(
      actor.organizationId,
      actor.userId,
      draft.idempotencyKey,
    );

    if (actor.demo) {
      return ok(
        {
          record: {
            id: recordKey,
            version: 1,
            status: "draft",
          },
          page: { slug: draft.page.slug, title: draft.page.title },
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
        "正式資料服務尚未設定。",
        503,
      );
    }

    const { data, error } = await supabase
      .rpc("record_care_diary_quick_draft", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: draft.clientId,
        p_occurred_at: draft.occurredAt,
        p_fields: draft.data,
        p_idempotency_key: recordKey,
      })
      .maybeSingle<CareDiaryDraftRpcRow>();

    if (error || !data) {
      const unauthorized = error?.code === "42501";
      const conflict = error?.code === "23505";
      const invalid = ["22023", "23514"].includes(error?.code ?? "");
      throw databaseFailure(
        unauthorized
          ? "RECORD_DRAFT_NOT_AUTHORIZED"
          : conflict
            ? "IDEMPOTENCY_CONFLICT"
            : invalid
              ? "RECORD_DRAFT_REJECTED"
              : "RECORD_SAVE_FAILED",
        unauthorized
          ? "目前角色、資料範圍或個案狀態不允許建立照顧草稿。"
          : conflict
            ? "此冪等鍵已用於不同的草稿內容。"
            : invalid
              ? "照顧草稿欄位、時間或個案生命週期未通過驗證。"
              : "草稿未確認儲存；請保留內容並以相同冪等鍵重試。",
        unauthorized ? 403 : invalid ? 422 : 409,
      );
    }

    return ok(
      {
        record: {
          id: data.id,
          version: data.version,
          status: data.status,
        },
        page: { slug: draft.page.slug, title: draft.page.title },
        replayed: data.replayed,
        persisted: true,
        demo: false,
      },
      data.replayed ? 200 : 201,
      requestId,
    );
  });
}
