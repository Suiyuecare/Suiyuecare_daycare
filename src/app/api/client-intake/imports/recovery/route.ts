import { ok } from "@/lib/api/response";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { env } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ImportError } from "@/lib/imports/errors";
import { handleImportRoute } from "@/lib/imports/http";
import { readUploadRecoveryKey, readUploadRecoveryRequest } from "@/lib/imports/recovery-request";
import { requireImportWrite } from "@/lib/imports/request-security";
import { recoverTrustedHtmlImport, readTrustedUploadRecovery } from "@/lib/imports/trusted-recovery";
import { S3ComplianceArchive } from "@/lib/imports/worm-archive";
import type { TenantContext } from "@/lib/domain/types";
import type { ImportActor } from "@/lib/imports/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asActor(context: TenantContext): ImportActor {
  if (context.demo || !context.branchId || !context.scopes.includes("imports.manage"))
    throw new ImportError("IMPORT_PERMISSION_DENIED", "此帳號尚未獲准處理目前分支的 CMS 匯入。", 403);
  return { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId,
    assuranceLevel: context.assuranceLevel, recentAal2At: null };
}

export async function GET(request: Request) {
  return handleImportRoute(async requestId => {
    const key = readUploadRecoveryKey(request);
    const actor = asActor(await authorizeRoutineIntake("cms.preview"));
    const client = await createServerSupabaseClient();
    if (!client) throw new ImportError("IMPORT_AUTH_NOT_CONFIGURED", "目前無法查證原操作，請保留原識別碼。", 503);
    const recovery = await readTrustedUploadRecovery(client, actor, key, "routine-intake");
    return ok({ found: recovery !== null, recovery }, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleImportRoute(async requestId => {
    requireImportWrite(request, "multipart");
    const actor = asActor(await authorizeRoutineIntake("cms.stage"));
    if (env.AWS_REGION !== "ap-northeast-1" || !env.HTML_ARCHIVE_BUCKET || !env.AWS_KMS_KEY_ID)
      throw new ImportError("ARCHIVE_NOT_READY", "原檔安全封存尚未啟用，請保留原操作，暫勿續做。", 503);
    const userClient = await createServerSupabaseClient(); const workerClient = createSupabaseAdminClient();
    if (!userClient || !workerClient) throw new ImportError("IMPORT_STORAGE_NOT_CONFIGURED", "匯入續做服務尚未啟用，請保留原操作。", 503);
    const input = await readUploadRecoveryRequest(request, "routine-intake");
    const receipt = await recoverTrustedHtmlImport({ userClient, workerClient,
      archive: new S3ComplianceArchive({ region: "ap-northeast-1", bucket: env.HTML_ARCHIVE_BUCKET, kmsKeyId: env.AWS_KMS_KEY_ID }),
      reauthorize: async () => asActor(await authorizeRoutineIntake("cms.stage")), signal: request.signal,
    }, actor, input.file, input.options, "routine-intake");
    // This only restores trusted staging. Creating/updating a client still needs
    // the existing source preview, per-field decisions and atomic commit route.
    return ok(receipt, 200, requestId);
  });
}
