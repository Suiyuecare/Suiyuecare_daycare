import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";

/** Prevent an old tab's outbox from being replayed into a new login/branch. */
export function assertOfflineCareScope(request: Request, actor: TenantContext) {
  const expected = [request.headers.get("x-care-organization"), request.headers.get("x-care-branch"), request.headers.get("x-care-user")];
  if (expected.every((value) => value === null)) return;
  if (expected[0] !== actor.organizationId || expected[1] !== actor.branchId || expected[2] !== actor.userId) {
    throw new IntegrationError("OFFLINE_SCOPE_CHANGED", "登入人員或作業分支已變更；原裝置草稿未送入目前分支。", 409);
  }
}
