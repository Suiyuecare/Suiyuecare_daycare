import { describe, expect, it } from "vitest";

import { DEFAULT_ROLE_CATEGORIES } from "@/lib/domain/roles";
import type { TenantContext } from "@/lib/domain/types";

import { canAccessCatalogPage, filterNavigationByAccess, getNavigationGroups, pageCatalog } from "./index";

/** Pure application page-gate coverage. Role labels never derive permissions.
 * This is not live membership, Auth, AAL2, qualification or database RLS proof. */
const contextFor = (role: TenantContext["roles"][number], scopes: readonly string[]): TenantContext => ({
  organizationId: "11000000-0000-4000-8000-000000000001", organizationName: "合成測試機構",
  branchId: "12000000-0000-4000-8000-000000000001", branchName: "合成測試分支",
  userId: "13000000-0000-4000-8000-000000000001", displayName: "合成頁面守門測試",
  roles: [role], scopes: [...scopes], assuranceLevel: "aal1", recentAal2At: null, demo: false,
});

describe("11 role labels × 89 catalog pages: explicit application permissions only", () => {
  it("covers every frozen role and route without using demo authorization", () => {
    expect(DEFAULT_ROLE_CATEGORIES).toHaveLength(11); expect(pageCatalog).toHaveLength(89);
    expect(DEFAULT_ROLE_CATEGORIES.length * pageCatalog.length).toBe(979);
    expect(pageCatalog.filter(page => page.requiredPermissions.length > 0).length).toBeGreaterThan(70);
  });

  for (const role of DEFAULT_ROLE_CATEGORIES) {
    it(`${role.key}: a role name or unrelated scopes cannot open a gated page`, () => {
      for (const page of pageCatalog) {
        const hasNoPageGate = page.requiredPermissions.length === 0;
        expect(canAccessCatalogPage(contextFor(role.key, []), page), page.slug).toBe(hasNoPageGate);
        expect(canAccessCatalogPage(contextFor(role.key, [role.key, `role:${role.key}`, "unrelated.read"]), page), page.slug)
          .toBe(hasNoPageGate);
      }
    });

    it(`${role.key}: every required scope is needed and withdrawal hides navigation`, () => {
      for (const page of pageCatalog) {
        const granted = contextFor(role.key, page.requiredPermissions);
        expect(canAccessCatalogPage(granted, page), page.slug).toBe(true);
        for (const withdrawn of page.requiredPermissions) {
          const partial = contextFor(role.key, page.requiredPermissions.filter(permission => permission !== withdrawn));
          expect(canAccessCatalogPage(partial, page), `${page.slug}: ${withdrawn}`).toBe(false);
          const navigation = filterNavigationByAccess(getNavigationGroups(page.surface), partial);
          expect(navigation.flatMap(group => group.pages).some(visible => visible.slug === page.slug), page.slug).toBe(false);
          expect(navigation.every(group => group.pages.length > 0)).toBe(true);
        }
      }
    });
  }
});
