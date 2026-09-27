import { ok } from "@/lib/api/response";
import { hasSupabaseConfiguration, isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImportError } from "@/lib/imports/errors";
import { authorizeImportRequest, handleImportRoute } from "@/lib/imports/http";
import { readTrustedUploadOperation, readUploadOperationKey } from "@/lib/imports/operation-locator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleImportRoute(async requestId => {
    const key = readUploadOperationKey(request);
    if (isDemoMode()) throw new ImportError("DEMO_READ_ONLY", "展示模式不會查詢正式匯入操作。", 403);
    if (!hasSupabaseConfiguration()) throw new ImportError("IMPORT_AUTH_NOT_CONFIGURED", "目前無法查證原操作，請保留原識別碼。", 503);
    const operation = await readTrustedUploadOperation({ createUserClient: createServerSupabaseClient,
      reauthorize: () => authorizeImportRequest(request, "preview"), signal: request.signal }, key, "general");
    // Completion proves source staging only; repository attachment still uses
    // the explicit recovery workflow before the existing batch preview.
    return ok({ found: operation !== null, operation }, 200, requestId);
  });
}
