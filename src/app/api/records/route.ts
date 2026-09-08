import { ok } from "@/lib/api/response";
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

type CareDiaryDraftRpcRow = {
  id: string;
  version: number;
  status: string;
  replayed: boolean;
};

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
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

    const fields = draft.data as {
      shift: "morning" | "afternoon" | "full_day";
      care_item: string;
      note: string;
      abnormal: boolean;
      follow_up?: string;
    };
    const { data, error } = await supabase
      .rpc("record_care_diary_draft", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: draft.clientId,
        p_occurred_at: draft.occurredAt,
        p_shift: fields.shift,
        p_care_item: fields.care_item,
        p_note: fields.note,
        p_abnormal: fields.abnormal,
        p_follow_up: fields.follow_up ?? null,
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
