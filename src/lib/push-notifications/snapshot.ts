import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoPushNotificationManagementSnapshot } from "./demo";
import {
  projectPushNotificationManagementSnapshot,
  type PushNotificationSnapshotSourceRow,
} from "./projection";

export class PushNotificationManagementSnapshotError extends Error {
  constructor() {
    super("PUSH_NOTIFICATION_MANAGEMENT_SNAPSHOT_UNAVAILABLE");
    this.name = "PushNotificationManagementSnapshotError";
  }
}

export async function loadPushNotificationManagementSnapshot(
  context: TenantContext,
) {
  if (context.demo) return buildDemoPushNotificationManagementSnapshot();
  if (!context.scopes.includes("notifications.manage")) {
    throw new PushNotificationManagementSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new PushNotificationManagementSnapshotError();
  const { data, error } = await supabase
    .rpc("push_notification_management_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
    })
    .maybeSingle<PushNotificationSnapshotSourceRow>();
  if (error || !data) throw new PushNotificationManagementSnapshotError();
  try {
    return projectPushNotificationManagementSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new PushNotificationManagementSnapshotError();
  }
}
