import "server-only";
import { createHash } from "node:crypto";
import type { TenantContext } from "@/lib/domain/types";
import type { AdmissionPreparationSnapshot } from "./contract";

/** A capped history can change without its length changing. Never key by count. */
export function admissionPreparationWorkspaceKey(
  context: Pick<TenantContext, "organizationId" | "branchId" | "userId" | "scopes">,
  snapshot: AdmissionPreparationSnapshot,
): string {
  const revision = JSON.stringify([
    context.organizationId, context.branchId, context.userId, [...context.scopes].sort(), snapshot,
  ]);
  // Document references and review text must not become a raw React key.
  return `jubo-admission:${createHash("sha256").update(revision).digest("hex")}`;
}
