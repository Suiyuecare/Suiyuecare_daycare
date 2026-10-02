import { canAccessCatalogPage, type NavigationGroup, type PageCatalogEntry } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";
import { STORE_OVERVIEW_PATH, STORE_OVERVIEW_TITLE } from "@/lib/store-overview/types";

type MobileNavigationContext = Pick<TenantContext, "roles" | "scopes" | "assuranceLevel" | "demo">;

export type MobileQuickLink =
  | { kind: "catalog"; page: PageCatalogEntry; label: string }
  | { kind: "store"; href: typeof STORE_OVERVIEW_PATH; title: typeof STORE_OVERVIEW_TITLE; label: "店務" };

const STORE = "store" as const;
type Candidate = number | typeof STORE;

// These are presentation priorities, not permissions. The supplied catalog is
// already server-filtered; every candidate is checked again before rendering.
const ROLE_PRIORITIES = [
  ["organization_manager", [1, STORE, 70, 54, 2]],
  ["branch_supervisor", [1, 46, 54, 63, 2]],
  ["branch_director", [1, 46, 54, 63, 2]],
  ["finance_claims", [1, 49, 64, 70]],
  ["nurse", [1, 51, 3, 7, 2]],
  ["case_manager_social_worker", [1, 2, 29, 39]],
  ["care_worker", [1, 46, 3, 6, 2]],
  ["transport_driver", [1, 48, 47, 2]],
  ["professional", [1, 2, 37, 42]],
  ["platform_ops", [83, 81, 82, 1]],
] as const satisfies readonly (readonly [string, readonly Candidate[]])[];

const SHORT_LABELS: Readonly<Record<number, string>> = {
  1: "今日", 2: "個案", 3: "量測", 6: "日誌", 7: "用藥",
  29: "社工", 33: "職能", 37: "照會", 39: "轉介", 40: "物治", 41: "職治",
  42: "專業", 46: "出勤", 47: "交通", 48: "接送", 49: "申報",
  51: "護理", 54: "彙整", 63: "排班", 64: "帳務", 70: "報表",
  81: "權限", 82: "規則", 83: "稽核",
};

// These read paths reject AAL1 in addition to their catalog scopes. The audit
// page also checks a separate recent challenge on entry; this filter does not
// claim that AAL2 alone authorizes the content or any write.
const AAL2_READ_PAGES = new Set([51, 64, 83]);

/** Pick at most three task shortcuts; never manufacture a route or grant access. */
export function getMobileQuickLinks(
  context: MobileNavigationContext,
  navigation: readonly NavigationGroup[],
  showStoreOverview: boolean,
): readonly MobileQuickLink[] {
  const allowedPages = new Map(navigation.flatMap((group) => group.pages)
    .filter((page) => canAccessCatalogPage(context, page))
    .filter((page) => !AAL2_READ_PAGES.has(page.number) || context.demo || context.assuranceLevel === "aal2")
    .map((page) => [page.number, page] as const));
  const roles = new Set(context.roles);
  const candidates: Candidate[] = [];
  for (const [role, numbers] of ROLE_PRIORITIES) {
    if (roles.has(role)) candidates.push(...numbers);
  }
  // A short bar is preferable to surfacing an unrelated high-risk page just
  // because the account happens to have a broad catalog grant.
  candidates.push(1, 2, 3);

  const links: MobileQuickLink[] = [];
  const seen = new Set<Candidate>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidate === STORE) {
      if (showStoreOverview) links.push({ kind: "store", href: STORE_OVERVIEW_PATH, title: STORE_OVERVIEW_TITLE, label: "店務" });
    } else {
      const page = allowedPages.get(candidate);
      if (page) links.push({ kind: "catalog", page, label: SHORT_LABELS[candidate] ?? page.title });
    }
    if (links.length === 3) break;
  }
  return links;
}
