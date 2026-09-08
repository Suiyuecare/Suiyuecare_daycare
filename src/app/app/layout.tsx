import { AppShell } from "@/components/app/app-shell";
import {
  filterNavigationByAccess,
  staffNavigationGroups,
} from "@/lib/catalog";
import { requireTenantContext } from "@/lib/auth/context";
import { isSyntheticPreviewMode } from "@/lib/env";
import { SyntheticPreviewBanner } from "@/components/preview/synthetic-preview-banner";

export default async function StaffLayout({ children }: LayoutProps<"/app">) {
  const context = await requireTenantContext("staff");
  const navigation = filterNavigationByAccess(staffNavigationGroups, context);
  return (
    <AppShell context={context} navigation={navigation}>
      {isSyntheticPreviewMode() ? <SyntheticPreviewBanner /> : null}
      {children}
    </AppShell>
  );
}
