import { ok } from "@/lib/api/response";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { hasSupabaseConfiguration, isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImportError } from "@/lib/imports/errors";
import { handleImportRoute } from "@/lib/imports/http";
import { readTrustedUploadOperation, readUploadOperationKey } from "@/lib/imports/operation-locator";
import type { ImportActor } from "@/lib/imports/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(): Promise<ImportActor> {
  const context = await authorizeRoutineIntake("cms.preview");
  if (context.demo || !context.branchId || !context.scopes.includes("imports.manage"))
    throw new ImportError("IMPORT_PERMISSION_DENIED", "此帳號尚未獲准處理目前分支的 CMS 匯入。", 403);
  return { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId,
    assuranceLevel: context.assuranceLevel, recentAal2At: null };
}

export async function GET(request: Request) {
  return handleImportRoute(async requestId => {
    const key = readUploadOperationKey(request);
    if (isDemoMode()) throw new ImportError("DEMO_READ_ONLY", "展示模式不會查詢正式收案操作。", 403);
    if (!hasSupabaseConfiguration()) throw new ImportError("IMPORT_AUTH_NOT_CONFIGURED", "目前無法查證原操作，請保留原識別碼。", 503);
    const operation = await readTrustedUploadOperation({ createUserClient: createServerSupabaseClient,
      reauthorize: authorize, signal: request.signal }, key, "routine-intake");
    return ok({ found: operation !== null, operation }, 200, requestId);
  });
}
