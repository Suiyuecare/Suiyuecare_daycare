import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { StaffAccessDenied } from "@/components/app/staff-access-denied";
import { AssessmentMatrixWorkspace } from "@/components/assessment-matrix/assessment-matrix-workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { ASSESSMENT_MATRIX_TITLE, assessmentMatrixReady, canViewAssessmentMatrix } from "@/lib/assessment-matrix/config";
import { assessmentMatrixHref, parseAssessmentMatrixQuery } from "@/lib/assessment-matrix/query";
import { AssessmentMatrixSnapshotError, loadAssessmentMatrixSnapshot } from "@/lib/assessment-matrix/snapshot";
import type { AssessmentMatrixSnapshot } from "@/lib/assessment-matrix/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: ASSESSMENT_MATRIX_TITLE,
  description: "查看有權限個案各量表的本月草稿狀態。",
};

export default async function AssessmentMatrixPage({
  searchParams,
}: PageProps<"/app/assessment-matrix">) {
  // Keep the direct route closed until the guarded RPC is deployed and
  // verified with an actual staff session; a hidden menu item is not a gate.
  if (!assessmentMatrixReady()) notFound();
  const context = await requireTenantContext("staff");
  if (!canViewAssessmentMatrix(context)) return <StaffAccessDenied />;

  const query = parseAssessmentMatrixQuery(await searchParams);
  if (!query.ok) return <AssessmentMatrixWorkspace invalidQuery={query.message} />;

  let snapshot: AssessmentMatrixSnapshot | null = null;
  let loadError = false;
  try {
    snapshot = await loadAssessmentMatrixSnapshot(context, query.filters);
  } catch (error) {
    if (!(error instanceof AssessmentMatrixSnapshotError)) throw error;
    loadError = true;
  }
  if (snapshot) {
    const lastPage = Math.max(1, Math.ceil(snapshot.totalClients / snapshot.pageSize));
    if (query.filters.page > lastPage) {
      redirect(assessmentMatrixHref({ ...query.filters, page: lastPage }));
    }
  }
  return <AssessmentMatrixWorkspace filters={query.filters} snapshot={snapshot ?? undefined} loadError={loadError} />;
}
