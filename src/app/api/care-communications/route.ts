import { ok } from "@/lib/api/response";
import {
  parseCareCommunicationCorrection,
  parseCareCommunicationCreate,
  parseCareCommunicationDatabaseReceipt,
} from "@/lib/care-communications/parser";
import type {
  CareCommunicationCorrectionInput,
  CareCommunicationCreateInput,
} from "@/lib/care-communications/types";
import type { TenantContext } from "@/lib/domain/types";
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

type OperationRow = {
  operation_id: string;
  operation_kind: string;
  communication_key: string;
  version_id: string;
  communication_version: number;
  previous_version_id: string | null;
  record_kind: string;
  client_id: string;
  recipient_count: number;
  delivery_status: string;
  read_status: string;
  family_confirmation_status: string;
  attachment_state: string;
  submitted_at: string;
  replayed: boolean;
};

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "CARE_COMMUNICATION_NOT_AUTHORIZED",
    "目前角色、機構、分支、個案指派、家屬授權或工作階段不允許這項操作。",
    403,
  );
  if (code === "40001") return databaseFailure(
    "CARE_COMMUNICATION_VERSION_CONFLICT",
    "這筆溝通紀錄已有新版本或收件授權已改變；請重新載入後再更正。",
    409,
  );
  if (code === "23505") return databaseFailure(
    "CARE_COMMUNICATION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請保留資料並重新載入。",
    409,
  );
  if (code === "55000") return databaseFailure(
    "ATTACHMENT_PIPELINE_NOT_CONFIGURED",
    "可信附件上傳、雜湊與掃毒管線尚未設定；本次操作未完成。",
    503,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_CARE_COMMUNICATION_STATE",
      "訊息內容、發生時間、版本、個案或家屬授權未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "CARE_COMMUNICATION_SAVE_FAILED",
    "操作結果尚未確認；請保留內容並以相同操作鍵重試。",
    409,
  );
}

async function authorize(
  permission: "care_communications.manage" | "care_communications.correct",
) {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY",
    "展示模式只顯示合成溝通紀錄，不會寫入或假裝成功。",
    403,
  );
  if (!actor.scopes.includes("care_communications.read") ||
      !actor.scopes.includes(permission)) {
    throw new IntegrationError(
      "CARE_COMMUNICATION_NOT_AUTHORIZED",
      "目前角色沒有這項照顧溝通操作權限。",
      403,
    );
  }
  await requireRecentAal2(actor);
  return actor;
}

async function executeCreate(
  input: CareCommunicationCreateInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED",
    "正式照顧溝通資料服務尚未設定。",
    503,
  );
  const { data, error } = await supabase.rpc("create_care_communication", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_subject: input.subject,
    p_body: input.body,
    p_occurred_at: input.occurredAt,
    p_attachments: input.attachments,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return parseCareCommunicationDatabaseReceipt(data, input);
}

async function executeCorrection(
  input: CareCommunicationCorrectionInput,
  actor: TenantContext,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED",
    "正式照顧溝通資料服務尚未設定。",
    503,
  );
  const { data, error } = await supabase.rpc("correct_care_communication", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_client_id: input.clientId,
    p_communication_key: input.communicationKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_subject: input.subject,
    p_body: input.body,
    p_correction_reason: input.correctionReason,
    p_attachments: input.attachments,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle<OperationRow>();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return parseCareCommunicationDatabaseReceipt(data, input);
}

function responseData(receipt: ReturnType<typeof parseCareCommunicationDatabaseReceipt>) {
  return {
    action: receipt.operation_kind,
    operationId: receipt.operation_id,
    communicationKey: receipt.communication_key,
    versionId: receipt.version_id,
    communicationVersion: receipt.communication_version,
    previousVersionId: receipt.previous_version_id,
    recordKind: receipt.record_kind,
    clientId: receipt.client_id,
    recipientCount: receipt.recipient_count,
    deliveryStatus: receipt.delivery_status,
    readStatus: receipt.read_status,
    familyConfirmationStatus: receipt.family_confirmation_status,
    attachmentState: receipt.attachment_state,
    submittedAt: receipt.submitted_at,
    replayed: receipt.replayed,
    persisted: true as const,
    demo: false as const,
  };
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Authorize before reading the body so validation cannot become an oracle.
    const actor = await authorize("care_communications.manage");
    const input = parseCareCommunicationCreate(
      await readJsonObject(request, 24 * 1024),
      request.headers.get("idempotency-key"),
    );
    const receipt = await executeCreate(input, actor);
    return ok(
      responseData(receipt),
      receipt.replayed ? 200 : 201,
      requestId,
    );
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize("care_communications.correct");
    const input = parseCareCommunicationCorrection(
      await readJsonObject(request, 24 * 1024),
      request.headers.get("idempotency-key"),
    );
    const receipt = await executeCorrection(input, actor);
    return ok(
      responseData(receipt),
      receipt.replayed ? 200 : 201,
      requestId,
    );
  });
}
