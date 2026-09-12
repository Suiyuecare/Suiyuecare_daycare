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

export default async function StaffLayout({ children }: LayoutProps<"/app">) {
  const context = await requireTenantContext("staff");
  const navigation = filterNavigationByAccess(staffNavigationGroups, context);
  const showStoreOverview = await canReadStoreOverview(context);
  return (
    <AppShell context={context} navigation={navigation} showStoreOverview={showStoreOverview}>
      {isSyntheticPreviewMode() ? <SyntheticPreviewBanner /> : null}
      <OfflineCareProvider context={context}>{children}</OfflineCareProvider>
    </AppShell>
  );
}
