import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { TenantContext } from "@/lib/domain/types";

type ClinicalSnapshotRoute =
  | "body_assessment"
  | "abcd_assessment"
  | "behavior_event"
  | "medication_administration"
  | "client_tocc"
  | "insulin_administration"
  | "client_inspection_report";

type FailureStage = "authorization" | "configuration" | "rpc" | "projection" | "dependency" | "unexpected";

type RpcResult = { status?: unknown; error?: { code?: unknown } | null };

/** Logs a deliberately tiny, non-PHI support event. Never pass or serialize the original error. */
export function recordClinicalSnapshotFailure(
  context: TenantContext,
  route: ClinicalSnapshotRoute,
  stage: FailureStage,
  result?: RpcResult,
): string {
  const requestId = randomUUID();
  const status = result?.status;
  const code = result?.error?.code;
  const event = {
    requestId,
    routeKey: `${route}.${stage}`,
    rpcStatus: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? status : null,
    postgrestCode: typeof code === "string" && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/u.test(code)
      ? code : null,
    branchScopeHash: createHash("sha256").update(context.branchId).digest("hex").slice(0, 16),
    atUtc: new Date().toISOString(),
  };
  try { console.error(JSON.stringify(event)); } catch { /* Diagnostics must not change access behavior. */ }
  return requestId;
}
