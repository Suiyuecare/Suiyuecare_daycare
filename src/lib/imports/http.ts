import "server-only";

import { randomUUID } from "node:crypto";

import { fail } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { hasSupabaseConfiguration, isDemoMode } from "@/lib/env";
import { isIntegrationError } from "@/lib/integrations/errors";

import { ImportError, isImportError } from "./errors";
import type { ImportActor } from "./types";
import { readImportJsonObject } from "./request-security";
import { getGeneralImportRecentAal2At } from "./reauth";

export type ImportPermission = "upload" | "preview" | "reparse" | "approve";

export interface ProductionImportAuthorizer {
  authorize(
    request: Request,
    permission: ImportPermission,
  ): Promise<ImportActor>;
}

let productionAuthorizer: ProductionImportAuthorizer | null = null;

export function registerProductionImportAuthorizer(
  authorizer: ProductionImportAuthorizer,
) {
  productionAuthorizer = authorizer;
}

const importPermissionKeys: Record<ImportPermission, string> = {
  upload: "imports.manage",
  preview: "imports.manage",
  reparse: "imports.manage",
  approve: "imports.approve",
};

async function authorizeWithTenantContext(permission: ImportPermission) {
  if (!hasSupabaseConfiguration()) {
    throw new ImportError(
      "IMPORT_AUTH_NOT_CONFIGURED",
      "正式匯入授權尚未設定，系統已停止操作。",
      503,
    );
  }
  const context = await getTenantContext("staff");
  if (!context || !context.branchId) {
    throw new ImportError("IMPORT_AUTH_REQUIRED", "請先登入並選擇作業分支。", 401);
  }
  if (context.assuranceLevel !== "aal2") {
    throw new ImportError(
      "AAL2_REQUIRED",
      "通用匯入包含大量敏感資料，請先完成安全驗證。",
      403,
    );
  }
  const permissionKey = importPermissionKeys[permission];
  if (!context.scopes.includes(permissionKey)) {
    throw new ImportError("IMPORT_PERMISSION_DENIED", "您沒有執行此匯入操作的權限。", 403);
  }

  const recentAal2At = permission === "preview" ? null : await getGeneralImportRecentAal2At(context);
  if (["upload", "reparse", "approve"].includes(permission) && !recentAal2At) {
    throw new ImportError(
      "RECENT_AAL2_REQUIRED",
      "這項匯入操作需要在最近 15 分鐘內重新完成雙因素驗證。",
      403,
    );
  }

  return {
    organizationId: context.organizationId,
    branchId: context.branchId,
    userId: context.userId,
    assuranceLevel: context.assuranceLevel,
    recentAal2At,
  } satisfies ImportActor;
}

function demoActor(request: Request): ImportActor {
  const organizationId =
    request.headers.get("x-demo-organization-id") ??
    "00000000-0000-4000-8000-000000000001";
  const branchId =
    request.headers.get("x-demo-branch-id") ??
    "00000000-0000-4000-8000-000000000002";
  const userId =
    request.headers.get("x-demo-user-id") ??
    "00000000-0000-4000-8000-000000000003";

  return {
    organizationId,
    branchId,
    userId,
    assuranceLevel: "aal2",
    recentAal2At: new Date().toISOString(),
  };
}

export async function authorizeImportRequest(
  request: Request,
  permission: ImportPermission,
) {
  if (isDemoMode()) return demoActor(request);
  return productionAuthorizer
    ? productionAuthorizer.authorize(request, permission)
    : authorizeWithTenantContext(permission);
}

export function assertImportId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new ImportError(
      "INVALID_IMPORT_ID",
      "匯入批次識別碼格式錯誤。",
      400,
      "id",
    );
  }
}

export async function readSmallJsonBody(request: Request) {
  return readImportJsonObject(request);
}

export async function handleImportRoute(
  operation: (requestId: ReturnType<typeof randomUUID>) => Promise<Response>,
) {
  const requestId = randomUUID();
  try {
    return await operation(requestId);
  } catch (error) {
    if (isImportError(error) || isIntegrationError(error)) {
      return fail(
        error.httpStatus,
        {
          code: error.code,
          message: error.message,
          ...(error.field ? { field: error.field } : {}),
        },
        requestId,
      );
    }
    return fail(
      500,
      {
        code: "IMPORT_INTERNAL_ERROR",
        message: "匯入處理失敗，請稍後再試並提供請求識別碼。",
      },
      requestId,
    );
  }
}

export function readIdempotencyKey(
  request: Request,
  bodyValue?: unknown,
) {
  const header = request.headers.get("idempotency-key");
  if (header !== null && bodyValue !== undefined && bodyValue !== null &&
      (typeof bodyValue !== "string" || header !== bodyValue)) {
    throw new ImportError("IDEMPOTENCY_KEY_REUSED", "操作識別碼不一致，請保留原操作並重新核對。", 409, "idempotency_key");
  }
  const key =
    request.headers.get("idempotency-key") ??
    (typeof bodyValue === "string" ? bodyValue : "");
  if (!key.trim() || key.length > 200 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new ImportError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請提供長度不超過 200 字元的冪等鍵。",
      400,
      "idempotency_key",
    );
  }
  return key;
}
