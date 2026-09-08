import type { TenantContext } from "@/lib/domain/types";

import type { NavigationGroup, PageCatalogEntry } from "./types";

type PageAccessContext = Pick<TenantContext, "demo" | "scopes">;

/**
 * Application-layer page gate. Database RLS remains the final data boundary,
 * but unauthorized pages must never mount data-loading components in the
 * first place. Demo mode intentionally exposes the full approved catalog.
 */
export function canAccessCatalogPage(
  context: PageAccessContext,
  page: PageCatalogEntry,
) {
  if (context.demo) return true;
  return page.requiredPermissions.every((permission) =>
    context.scopes.includes(permission),
  );
}

/** Remove unauthorized links and omit groups that become empty. */
export function filterNavigationByAccess(
  navigation: readonly NavigationGroup[],
  context: PageAccessContext,
): readonly NavigationGroup[] {
  return navigation.flatMap((group) => {
    const pages = group.pages.filter((page) =>
      canAccessCatalogPage(context, page),
    );
    return pages.length ? [{ ...group, pages }] : [];
  });
}
