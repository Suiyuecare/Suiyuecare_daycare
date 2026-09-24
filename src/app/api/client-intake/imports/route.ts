import { z } from "zod";
import { ok } from "@/lib/api/response";
import { env } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { S3ComplianceArchive } from "@/lib/imports/worm-archive";
import { stageTrustedIntakeHtmlImport } from "@/lib/imports/trusted-staging";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { isImportError } from "@/lib/imports/errors";
import { MAX_INTAKE_WEB_UPLOAD_BYTES, cmsPreviewSchema } from "@/lib/client-intake/model";
import { readIntakeMultipart } from "@/lib/client-intake/multipart";
import { validateHtmlImportFile } from "@/lib/imports/validation";
import { authorizeIntake, intakeRpc } from "@/lib/client-intake/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeIntake();
    if (actor.demo || !actor.scopes.includes("imports.manage")) throw new IntegrationError("IMPORT_NOT_AUTHORIZED", "此帳號無法讀取正式匯入來源，請由收案負責人操作。", 403);
    const params = new URL(request.url).searchParams;
    const batch = z.uuid().safeParse(params.get("batch"));
    const client = z.uuid().nullable().safeParse(params.get("client"));
    if (!batch.success || !client.success) throw new IntegrationError("IMPORT_INVALID", "請重新選擇匯入批次與個案。", 400);
    const preview = cmsPreviewSchema.safeParse(await intakeRpc("cms_intake_preview", { p_org: actor.organizationId, p_branch: actor.branchId, p_batch: batch.data, p_client: client.data }));
    if (!preview.success || preview.data.batchId !== batch.data || (preview.data.current?.clientId ?? null) !== client.data) throw new IntegrationError("IMPORT_PREVIEW_UNCERTAIN", "來源預覽與目前個案或批次不一致，請重新核對。", 502);
    return ok(preview.data, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeRoutineIntake("cms.stage");
    if (!actor.scopes.includes("imports.manage")) throw new IntegrationError("IMPORT_NOT_AUTHORIZED", "此帳號尚未獲准匯入 CMS 資料。", 403);
    if (env.AWS_REGION !== "ap-northeast-1" || !env.HTML_ARCHIVE_BUCKET || !env.AWS_KMS_KEY_ID) throw new IntegrationError("ARCHIVE_NOT_READY", "原始檔安全封存尚未啟用，暫不能接收 CMS 檔案。可先手動建檔；請管理員完成封存設定。", 503);
    const userClient = await createServerSupabaseClient();
    const workerClient = createSupabaseAdminClient();
    if (!userClient || !workerClient) throw new IntegrationError("IMPORT_NOT_READY", "個案匯入服務尚未啟用，請管理員確認後重試。", 503);
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    if (!key.success) throw new IntegrationError("INVALID_OPERATION", "請重新選檔以開始一次匯入。", 400);
    const form = await readIntakeMultipart(request);
    const file = form.get("file");
    if ([...form.keys()].some((key) => key !== "file")) throw new IntegrationError("INVALID_FILE", "請透過選檔送出，不接受自行提供解析結果或檔案路徑。", 400);
    if (!(file instanceof File) || form.getAll("file").length !== 1 || file.size > MAX_INTAKE_WEB_UPLOAD_BYTES) throw new IntegrationError("INVALID_FILE", "請選擇一份 4 MB 以下的 CMS HTML。", 400);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validated = validateHtmlImportFile({ fileName: file.name, mimeType: file.type, bytes });
      const existing = await userClient.rpc("find_cms_intake_source", { p_org: actor.organizationId, p_branch: actor.branchId, p_file_sha256: validated.sha256 });
      if (existing.error) throw new IntegrationError("IMPORT_LOOKUP_FAILED", "尚未確認是否已匯入相同檔案，請保留本次操作後重試。", 503);
      if (existing.data !== null) {
        const recovered = z.object({ status: z.enum(["queued", "completed"]), reservationId: z.uuid(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), clientId: z.uuid().nullable() }).safeParse(existing.data);
        if (!recovered.success) throw new IntegrationError("IMPORT_LOOKUP_FAILED", "匯入批次回覆尚未通過核對，請重試。", 503);
        if (recovered.data.status === "completed" && recovered.data.payloadSha256) return ok({ reservation_id: recovered.data.reservationId, status: "completed", recovered: true }, 200, requestId);
        // A queued reservation may belong to this exact retry key. The trusted
        // reserve RPC decides whether it can resume; a different key cannot take it over.
      }
      const receipt = await stageTrustedIntakeHtmlImport({ userClient, workerClient, archive: new S3ComplianceArchive({ region: "ap-northeast-1", bucket: env.HTML_ARCHIVE_BUCKET, kmsKeyId: env.AWS_KMS_KEY_ID }) }, {
        organizationId: actor.organizationId, branchId: actor.branchId!, userId: actor.userId, assuranceLevel: actor.assuranceLevel, recentAal2At: null,
      }, { fileName: file.name, mimeType: file.type, bytes }, key.data);
      return ok(receipt, 200, requestId);
    } catch (error) {
      if (isImportError(error)) throw new IntegrationError(error.code, error.message, error.httpStatus, error.field);
      throw error;
    }
  });
}
