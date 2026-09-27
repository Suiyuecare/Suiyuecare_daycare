import { ok } from "@/lib/api/response";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImportError } from "@/lib/imports/errors";
import { authorizeImportRequest, handleImportRoute } from "@/lib/imports/http";
import { createProductionImportRepository } from "@/lib/imports/production-repository";
import { readUploadRecoveryKey, readUploadRecoveryRequest } from "@/lib/imports/recovery-request";
import { requireImportWrite } from "@/lib/imports/request-security";
import { summarizeImportBatch } from "@/lib/imports/service";
import { readTrustedUploadRecovery } from "@/lib/imports/trusted-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireProduction() {
  if (isDemoMode()) throw new ImportError("DEMO_READ_ONLY", "合成資料模式不會續做正式匯入。", 403);
}

/** Observation is not reauthorization or a new upload. A missing receipt never
 * proves rollback and does not grant permission to create a replacement key. */
export async function GET(request: Request) {
  return handleImportRoute(async requestId => {
    const key = readUploadRecoveryKey(request); requireProduction();
    const actor = await authorizeImportRequest(request, "preview");
    const client = await createServerSupabaseClient();
    if (!client) throw new ImportError("IMPORT_AUTH_NOT_CONFIGURED", "目前無法查證原操作，請保留原識別碼。", 503);
    const recovery = await readTrustedUploadRecovery(client, actor, key, "general");
    return ok({ found: recovery !== null, recovery }, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleImportRoute(async requestId => {
    requireImportWrite(request, "multipart"); requireProduction();
    const actor = await authorizeImportRequest(request, "upload");
    const repository = await createProductionImportRepository(actor, "upload");
    const input = await readUploadRecoveryRequest(request, "general");
    const operation = await repository.recoverQueuedUpload(input.file, input.options, request.signal);
    return ok({ status: operation.batch.status, duplicate: false, replayed: operation.replayed,
      batch: summarizeImportBatch(operation.batch), staging_only: true, formally_imported: false },
      operation.replayed ? 200 : 201, requestId);
  });
}
