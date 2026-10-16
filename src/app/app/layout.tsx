import { AppShell } from "@/components/app/app-shell";
import { canReadStoreOverview } from "@/lib/store-overview/access";
import {
  filterNavigationByAccess,
  staffNavigationGroups,
} from "@/lib/catalog";
import { requireTenantContext } from "@/lib/auth/context";
import { isSyntheticPreviewMode } from "@/lib/env";
import { SyntheticPreviewBanner } from "@/components/preview/synthetic-preview-banner";
import { OfflineCareProvider } from "@/components/core-care/offline-care-provider";
import { assessmentMatrixReady } from "@/lib/assessment-matrix/config";
import { canReviewJuboProfiles, juboReviewFeatureEnabled } from "@/lib/jubo-review/server";

export default async function StaffLayout({ children }: LayoutProps<"/app">) {
  const context = await requireTenantContext("staff");
  const navigation = filterNavigationByAccess(staffNavigationGroups, context);
  const showStoreOverview = await canReadStoreOverview(context);
  return (
    <AppShell context={context} navigation={navigation} showStoreOverview={showStoreOverview}
      showAssessmentMatrix={assessmentMatrixReady()}
      showJuboReview={juboReviewFeatureEnabled() && !isSyntheticPreviewMode() && canReviewJuboProfiles(context)}>
      {isSyntheticPreviewMode() ? <SyntheticPreviewBanner /> : null}
      <OfflineCareProvider context={context}>{children}</OfflineCareProvider>
    </AppShell>
  );
}
