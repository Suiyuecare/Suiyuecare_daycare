import "server-only";

import { canUseRoutineCare } from "@/lib/auth/routine-care";
import type { TenantContext } from "@/lib/domain/types";

import { CoreCareSnapshotError, loadDailyCareSnapshot } from "./snapshot";

/** Read-only page preflights; write RPCs still recheck live authorization. */
export async function loadCoreDailyPageInputs(
  context: TenantContext,
  serviceDate: string,
  pageNumber: 3 | 6 | 46,
) {
  const writePermission = pageNumber === 3 ? "health.write"
    : pageNumber === 6 ? "care_records.write" : "attendance.write";
  const routinePermissionsPromise = Promise.all([
    canUseRoutineCare(context, writePermission),
    pageNumber === 6 ? canUseRoutineCare(context, "care_records.read") : Promise.resolve(false),
  ]);

  let snapshot: Awaited<ReturnType<typeof loadDailyCareSnapshot>> | null = null;
  let loadError = false;
  try {
    snapshot = await loadDailyCareSnapshot(context, serviceDate);
  } catch (error) {
    if (!(error instanceof CoreCareSnapshotError)) throw error;
    loadError = true;
  }
  const [canWriteRoutine, canReadDiary] = await routinePermissionsPromise;
  return { snapshot, loadError, canWriteRoutine, canReadDiary };
}
