import { FamilyShell } from "@/components/family/family-shell";
import { requireTenantContext } from "@/lib/auth/context";
import { isSyntheticPreviewMode } from "@/lib/env";
import { SyntheticPreviewBanner } from "@/components/preview/synthetic-preview-banner";

export default async function FamilyLayout({ children }: LayoutProps<"/family">) {
  const context = await requireTenantContext("family");
  return <FamilyShell context={context}>
    {isSyntheticPreviewMode() ? <SyntheticPreviewBanner /> : null}
    {children}
  </FamilyShell>;
}
