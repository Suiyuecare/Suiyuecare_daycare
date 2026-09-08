import { ok } from "@/lib/api/response";
import {
  parseConsultantMessageCreate,
  parseConsultantMessageCreateDatabaseReceipt,
  parseConsultantMessageReceipt,
  parseConsultantMessageReceiptDatabaseReceipt,
} from "@/lib/consultant-messages/parser";
import type {
  ConsultantMessageCreateInput,
  ConsultantMessageReceiptInput,
} from "@/lib/consultant-messages/types";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateRow = {
  operation_id: string;
  message_id: string;
  category: string;
  recipient_count: number;
  published_at: string;
  replayed: boolean;
};

type ReceiptRow = {
  operation_id: string;
  message_id: string;
  category: string;
  action: string;
  read_at: string;
  confirmed_at: string | null;
  replayed: boolean;
};

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "CONSULTANT_MESSAGE_NOT_AUTHORIZED",
    "目前角色、機構、分支、顧問收件範圍或工作階段不允許這項操作。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "CONSULTANT_MESSAGE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同顧問訊息內容；請重新載入確認。",
    409,
  );
  if (code === "55000") return databaseFailure(
    "ATTACHMENT_PIPELINE_NOT_CONFIGURED",
    "可信附件上傳與掃描管線尚未設定；本次操作未完成。",
    503,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_CONSULTANT_MESSAGE_STATE",
      "顧問訊息內容、時間、收件者或回條狀態未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "CONSULTANT_MESSAGE_SAVE_FAILED",
    "顧問訊息操作結果尚未確認；請保留內容並以相同操作鍵重試。",
    409,
  );
}

async function authorizeCreate() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY",
    "展示模式只顯示合成顧問訊息，不會寫入或假裝成功。",
    403,
  );
  if (!actor.scopes.includes("consultant_messages.read") ||
      !actor.scopes.includes("consultant_messages.manage")) {
    throw new IntegrationError(
      "CONSULTANT_MESSAGE_NOT_AUTHORIZED",
      "目前角色沒有建立顧問訊息的權限。",
      403,
    );
  }
  return actor;
}

async function authorizeReceipt() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY",
    "展示模式只顯示合成顧問訊息，不會建立已讀或確認回條。",
    403,
  );
  if (!actor.scopes.includes("consultant_messages.read") ||
      !actor.scopes.includes("consultant_messages.receive")) {
    throw new IntegrationError(
      "CONSULTANT_MESSAGE_NOT_AUTHORIZED",
      "目前角色不是這個分支的顧問訊息收件角色。",
      403,
    );
  }
  return actor;
}

async function executeCreate(
  input: ConsultantMessageCreateInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED",
    "正式顧問訊息資料服務尚未設定。",
    503,
  );
  const { data, error } = await supabase.rpc("create_consultant_message", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_subject: input.subject,
    p_body: input.body,
    p_occurred_at: input.occurredAt,
    p_recipient_user_ids: input.recipientUserIds,
    p_attachments: input.attachments,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<CreateRow>();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return parseConsultantMessageCreateDatabaseReceipt(data, input);
}

async function executeReceipt(
  input: ConsultantMessageReceiptInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED",
    "正式顧問訊息資料服務尚未設定。",
    503,
  );
  const { data, error } = await supabase.rpc(
    "acknowledge_consultant_message",
    {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_message_id: input.messageId,
      p_action: input.action,
      p_idempotency_key: input.idempotencyKey,
    },
  ).maybeSingle<ReceiptRow>();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return parseConsultantMessageReceiptDatabaseReceipt(data, input);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Resolve the actor before reading the body so validation differences do
    // not become an oracle for signed-out, demo, or unauthorized callers.
    const actor = await authorizeCreate();
    const input = parseConsultantMessageCreate(
      await readJsonObject(request, 24 * 1024),
      request.headers.get("idempotency-key"),
    );
    const receipt = await executeCreate(input, actor);
    return ok({
      action: "create" as const,
      operationId: receipt.operation_id,
      messageId: receipt.message_id,
      category: receipt.category,
      recipientCount: receipt.recipient_count,
      publishedAt: receipt.published_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeReceipt();
    const input = parseConsultantMessageReceipt(
      await readJsonObject(request, 4 * 1024),
      request.headers.get("idempotency-key"),
    );
    const receipt = await executeReceipt(input, actor);
    return ok({
      operationId: receipt.operation_id,
      messageId: receipt.message_id,
      category: receipt.category,
      action: receipt.action,
      readAt: receipt.read_at,
      confirmedAt: receipt.confirmed_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, 200, requestId);
  });
}
