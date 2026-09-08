import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoNotificationCenterSnapshot } from "./demo";
import {
  projectNotificationCenterSnapshot,
  type NotificationCenterSnapshotSourceRow,
} from "./projection";

export class NotificationCenterSnapshotError extends Error {
  constructor() {
    super("NOTIFICATION_CENTER_SNAPSHOT_UNAVAILABLE");
    this.name = "NotificationCenterSnapshotError";
  }
}

export async function loadNotificationCenterSnapshot(context: TenantContext) {
  if (context.demo) return buildDemoNotificationCenterSnapshot();
  if (!context.scopes.includes("notifications.read")) {
    throw new NotificationCenterSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new NotificationCenterSnapshotError();
  const { data, error } = await supabase
    .rpc("notification_center_snapshot", {
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
    })
    .maybeSingle<NotificationCenterSnapshotSourceRow>();
  if (error || !data) throw new NotificationCenterSnapshotError();
  try {
    return projectNotificationCenterSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      demo: false,
    });
  } catch {
    throw new NotificationCenterSnapshotError();
  }
}
